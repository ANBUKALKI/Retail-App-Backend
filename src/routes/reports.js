const router = require('express').Router();
const Sale = require('../models/Sale');
const Purchase = require('../models/Purchase');
const Product = require('../models/Product');
const { auth, allow } = require('../middleware/auth');
const { dateRange, r2 } = require('../utils/http');

router.use(auth);

const round = (arr, keys) => arr.map((row) => {
  const out = { ...row };
  for (const k of keys) if (typeof out[k] === 'number') out[k] = r2(out[k]);
  return out;
});

// Sales report. Admin and billing see every bill; a salesperson only sees their own.
router.get('/sales', allow('admin', 'billing', 'salesperson'), async (req, res) => {
  const match = { status: 'PAID', ...dateRange(req.query) };
  if (req.user.role === 'salesperson') match.createdBy = req.user._id;
  const unitDay = req.query.tzOffsetMinutes ? { timezone: tzString(req.query.tzOffsetMinutes) } : {};

  const [totals, byDay, byCategory, byProduct, byPayment, bySalesperson] = await Promise.all([
    Sale.aggregate([
      { $match: match },
      { $group: { _id: null, bills: { $sum: 1 }, revenue: { $sum: '$grandTotal' }, discount: { $sum: '$discountTotal' }, tax: { $sum: '$taxTotal' } } },
    ]),
    Sale.aggregate([
      { $match: match },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', ...unitDay } }, bills: { $sum: 1 }, revenue: { $sum: '$grandTotal' } } },
      { $sort: { _id: 1 } },
    ]),
    Sale.aggregate([
      { $match: match },
      { $unwind: '$items' },
      { $group: { _id: '$items.category', qty: { $sum: '$items.qty' }, revenue: { $sum: '$items.lineTotal' } } },
      { $sort: { revenue: -1 } },
    ]),
    Sale.aggregate([
      { $match: match },
      { $unwind: '$items' },
      { $group: { _id: { sku: '$items.sku', name: '$items.name' }, qty: { $sum: '$items.qty' }, revenue: { $sum: '$items.lineTotal' } } },
      { $sort: { revenue: -1 } },
      { $limit: 20 },
    ]),
    Sale.aggregate([
      { $match: match },
      { $group: { _id: '$paymentMode', bills: { $sum: 1 }, revenue: { $sum: '$grandTotal' } } },
    ]),
    Sale.aggregate([
      { $match: match },
      { $group: { _id: '$createdBy', bills: { $sum: 1 }, revenue: { $sum: '$grandTotal' } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
      { $project: { bills: 1, revenue: 1, name: { $arrayElemAt: ['$u.fullName', 0] } } },
      { $sort: { revenue: -1 } },
    ]),
  ]);

  res.json({
    totals: round(totals, ['revenue', 'discount', 'tax'])[0] || { bills: 0, revenue: 0, discount: 0, tax: 0 },
    byDay: round(byDay, ['revenue']),
    byCategory: round(byCategory, ['revenue']),
    byProduct: round(byProduct, ['revenue']),
    byPayment: round(byPayment, ['revenue']),
    bySalesperson: round(bySalesperson, ['revenue']),
  });
});

function tzString(minutes) {
  const m = Number(minutes);
  if (!Number.isFinite(m)) return 'UTC';
  // Browser getTimezoneOffset() is minus for zones ahead of UTC.
  const total = -m;
  const sign = total >= 0 ? '+' : '-';
  const abs = Math.abs(total);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

router.get('/purchases', allow('admin'), async (req, res) => {
  const match = { ...dateRange(req.query, 'purchaseDate') };
  const [totals, bySupplier, byDay] = await Promise.all([
    Purchase.aggregate([{ $match: match }, { $group: { _id: null, purchases: { $sum: 1 }, spent: { $sum: '$total' } } }]),
    Purchase.aggregate([
      { $match: match },
      { $group: { _id: '$supplier', purchases: { $sum: 1 }, spent: { $sum: '$total' } } },
      { $sort: { spent: -1 } },
    ]),
    Purchase.aggregate([
      { $match: match },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$purchaseDate' } }, spent: { $sum: '$total' } } },
      { $sort: { _id: 1 } },
    ]),
  ]);
  res.json({
    totals: round(totals, ['spent'])[0] || { purchases: 0, spent: 0 },
    bySupplier: round(bySupplier, ['spent']),
    byDay: round(byDay, ['spent']),
  });
});

router.get('/stock', allow('admin', 'billing', 'salesperson'), async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const products = await Product.find({ active: true })
    .select(isAdmin ? '' : '-costPrice')
    .sort({ category: 1, name: 1 })
    .lean();
  const rows = products.map((p) => ({
    _id: p._id,
    sku: p.sku,
    name: p.name,
    category: p.category,
    stockQty: p.stockQty,
    lowStockLevel: p.lowStockLevel,
    low: p.stockQty <= p.lowStockLevel,
    price: p.price,
    ...(isAdmin ? { costPrice: p.costPrice, stockValue: r2(p.stockQty * p.costPrice) } : {}),
  }));
  res.json({ items: rows, totals: { products: rows.length, low: rows.filter((r) => r.low).length, ...(isAdmin ? { stockValue: r2(rows.reduce((s, r) => s + r.stockValue, 0)) } : {}) } });
});

// Profit: revenue excluding tax, minus the cost price captured on each bill line.
router.get('/profit', allow('admin'), async (req, res) => {
  const match = { status: 'PAID', ...dateRange(req.query) };
  const lines = [
    { $match: match },
    { $unwind: '$items' },
    {
      $project: {
        category: '$items.category',
        revenue: { $subtract: [{ $multiply: ['$items.unitPrice', '$items.qty'] }, '$items.discount'] },
        cost: { $multiply: ['$items.costPrice', '$items.qty'] },
      },
    },
  ];
  const [totals, byCategory] = await Promise.all([
    Sale.aggregate([...lines, { $group: { _id: null, revenue: { $sum: '$revenue' }, cost: { $sum: '$cost' } } }]),
    Sale.aggregate([...lines, { $group: { _id: '$category', revenue: { $sum: '$revenue' }, cost: { $sum: '$cost' } } }, { $sort: { revenue: -1 } }]),
  ]);
  const withProfit = (r) => ({ ...r, profit: r.revenue - r.cost });
  res.json({
    totals: round(totals.map(withProfit), ['revenue', 'cost', 'profit'])[0] || { revenue: 0, cost: 0, profit: 0 },
    byCategory: round(byCategory.map(withProfit), ['revenue', 'cost', 'profit']),
  });
});

module.exports = router;

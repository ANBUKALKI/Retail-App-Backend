const router = require('express').Router();
const Sale = require('../models/Sale');
const Product = require('../models/Product');
const Purchase = require('../models/Purchase');
const Offer = require('../models/Offer');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const { r2 } = require('../utils/http');

router.use(auth);

// The client sends the start of its own "today" (?from=ISO) so the numbers match the shopkeeper's local day.
router.get('/', async (req, res) => {
  const user = req.user;
  const now = new Date();
  const from = req.query.from && !isNaN(new Date(req.query.from)) ? new Date(req.query.from) : new Date(now.setHours(0, 0, 0, 0));
  const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const since7 = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  if (user.role === 'user') {
    const [orders, offers, pending] = await Promise.all([
      Sale.find({ customer: user._id }).sort({ createdAt: -1 }).limit(5).select('invoiceNo status grandTotal createdAt'),
      Offer.find({ active: true, validFrom: { $lte: new Date() }, validTo: { $gte: new Date() } }).sort({ validTo: 1 }).limit(5),
      Sale.countDocuments({ customer: user._id, status: 'PENDING_PAYMENT' }),
    ]);
    return res.json({ role: user.role, recentOrders: orders, offers, pendingPayments: pending });
  }

  const mine = user.role === 'salesperson' ? { createdBy: user._id } : {};
  const paidToday = { ...mine, status: 'PAID', createdAt: { $gte: from } };
  const paid30 = { ...mine, status: 'PAID', createdAt: { $gte: since30 } };

  const [today, last7, top, low, pending] = await Promise.all([
    Sale.aggregate([{ $match: paidToday }, { $group: { _id: null, bills: { $sum: 1 }, revenue: { $sum: '$grandTotal' } } }]),
    Sale.aggregate([
      { $match: { ...mine, status: 'PAID', createdAt: { $gte: since7 } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, revenue: { $sum: '$grandTotal' }, bills: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Sale.aggregate([
      { $match: paid30 },
      { $unwind: '$items' },
      { $group: { _id: { sku: '$items.sku', name: '$items.name' }, qty: { $sum: '$items.qty' }, revenue: { $sum: '$items.lineTotal' } } },
      { $sort: { qty: -1 } },
      { $limit: 5 },
    ]),
    Product.find({ active: true, $expr: { $lte: ['$stockQty', '$lowStockLevel'] } })
      .select('sku name category stockQty lowStockLevel')
      .sort({ stockQty: 1 })
      .limit(8),
    Sale.countDocuments({ status: 'PENDING_PAYMENT' }),
  ]);

  const out = {
    role: user.role,
    today: today[0] ? { bills: today[0].bills, revenue: r2(today[0].revenue) } : { bills: 0, revenue: 0 },
    last7Days: last7.map((d) => ({ date: d._id, revenue: r2(d.revenue), bills: d.bills })),
    topProducts: top.map((t) => ({ sku: t._id.sku, name: t._id.name, qty: t.qty, revenue: r2(t.revenue) })),
    lowStock: low,
    pendingPayments: pending,
  };

  if (user.role === 'admin') {
    const soon = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const [expiring, productCount, userCount] = await Promise.all([
      Purchase.aggregate([
        { $unwind: '$items' },
        { $match: { 'items.expiryDate': { $gte: new Date(), $lte: soon } } },
        { $lookup: { from: 'products', localField: 'items.product', foreignField: '_id', as: 'p' } },
        { $match: { 'p.stockQty': { $gt: 0 } } },
        { $project: { _id: 0, name: '$items.name', sku: '$items.sku', batch: '$items.batch', expiryDate: '$items.expiryDate', stockQty: { $arrayElemAt: ['$p.stockQty', 0] } } },
        { $sort: { expiryDate: 1 } },
        { $limit: 8 },
      ]),
      Product.countDocuments({ active: true }),
      User.countDocuments({ active: true }),
    ]);
    out.expiring = expiring;
    out.counts = { products: productCount, users: userCount };
  }
  res.json(out);
});

module.exports = router;

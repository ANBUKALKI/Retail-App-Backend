const router = require('express').Router();
const mongoose = require('mongoose');
const Purchase = require('../models/Purchase');
const Product = require('../models/Product');
const { auth, allow } = require('../middleware/auth');
const { HttpError, pageParams, dateRange, escapeRegex, r2 } = require('../utils/http');

router.use(auth);

router.get('/', allow('admin', 'salesperson'), async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const filter = { ...dateRange(req.query, 'purchaseDate') };
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(req.query.q), 'i');
    filter.$or = [{ supplier: rx }, { invoiceRef: rx }];
  }
  const sel = req.user.role === 'admin' ? '' : '-items.costPrice -total';
  const [items, total] = await Promise.all([
    Purchase.find(filter).select(sel).sort({ purchaseDate: -1 }).skip(skip).limit(limit).populate('createdBy', 'fullName'),
    Purchase.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
});

router.get('/:id', allow('admin', 'salesperson'), async (req, res) => {
  const sel = req.user.role === 'admin' ? '' : '-items.costPrice -total';
  const p = await Purchase.findById(req.params.id).select(sel).populate('createdBy', 'fullName');
  if (!p) throw new HttpError(404, 'Purchase not found.');
  res.json({ purchase: p });
});

// Recording a purchase adds stock and updates the latest cost price of each product.
router.post('/', allow('admin'), async (req, res) => {
  const { supplier, invoiceRef, purchaseDate, notes, items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'Add at least one item.');

  const ids = items.map((i) => i.productId);
  if (ids.some((id) => !mongoose.isValidObjectId(id))) throw new HttpError(400, 'Invalid product.');
  const products = await Product.find({ _id: { $in: ids } });
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const lines = items.map((i) => {
    const p = byId.get(String(i.productId));
    if (!p) throw new HttpError(404, 'A product in this purchase does not exist.');
    const qty = Number(i.qty);
    const costPrice = Number(i.costPrice);
    if (!Number.isInteger(qty) || qty < 1) throw new HttpError(400, `Quantity for ${p.name} must be a whole number of at least 1.`);
    if (!(costPrice >= 0)) throw new HttpError(400, `Cost price for ${p.name} is invalid.`);
    return {
      product: p._id,
      sku: p.sku,
      name: p.name,
      qty,
      costPrice,
      batch: i.batch || undefined,
      expiryDate: i.expiryDate ? new Date(i.expiryDate) : undefined,
    };
  });

  const total = r2(lines.reduce((s, l) => s + l.qty * l.costPrice, 0));
  const purchase = await Purchase.create({
    supplier,
    invoiceRef,
    notes,
    purchaseDate: purchaseDate ? new Date(purchaseDate) : undefined,
    items: lines,
    total,
    createdBy: req.user._id,
  });

  try {
    await Product.bulkWrite(
      lines.map((l) => ({
        updateOne: { filter: { _id: l.product }, update: { $inc: { stockQty: l.qty }, $set: { costPrice: l.costPrice } } },
      }))
    );
  } catch (e) {
    await Purchase.deleteOne({ _id: purchase._id });
    throw e;
  }
  res.status(201).json({ purchase });
});

module.exports = router;

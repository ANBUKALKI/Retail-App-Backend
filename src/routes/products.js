const router = require('express').Router();
const Product = require('../models/Product');
const { CATEGORIES } = require('../models/Product');
const { auth, allow } = require('../middleware/auth');
const { HttpError, pageParams, escapeRegex } = require('../utils/http');

router.use(auth);

const EDITABLE = ['sku', 'name', 'category', 'brand', 'description', 'unit', 'price', 'taxPercent', 'lowStockLevel', 'attributes', 'active'];

// Only the admin may see purchase (cost) prices.
const projection = (user) => (user.role === 'admin' ? '' : '-costPrice');

router.get('/', async (req, res) => {
  const { page, limit, skip } = pageParams(req.query, 25, 200);
  const filter = {};
  if (req.user.role === 'user') filter.active = true;
  else if (req.query.active === 'true') filter.active = true;
  else if (req.query.active === 'false') filter.active = false;
  if (req.query.category && CATEGORIES.includes(req.query.category)) filter.category = req.query.category;
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(req.query.q), 'i');
    filter.$or = [{ name: rx }, { sku: rx }, { brand: rx }];
  }
  if (req.query.low === 'true') filter.$expr = { $lte: ['$stockQty', '$lowStockLevel'] };

  const [items, total] = await Promise.all([
    Product.find(filter).select(projection(req.user)).sort({ name: 1 }).skip(skip).limit(limit),
    Product.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
});

router.get('/:id', async (req, res) => {
  const p = await Product.findById(req.params.id).select(projection(req.user));
  if (!p || (req.user.role === 'user' && !p.active)) throw new HttpError(404, 'Product not found.');
  res.json({ product: p });
});

router.post('/', allow('admin', 'salesperson'), async (req, res) => {
  const data = {};
  for (const k of EDITABLE) if (req.body[k] !== undefined) data[k] = req.body[k];
  if (req.user.role === 'admin' && req.body.costPrice !== undefined) data.costPrice = req.body.costPrice;
  data.createdBy = req.user._id;
  data.stockQty = 0; // stock only changes through purchases, sales and admin adjustments
  const p = await Product.create(data);
  res.status(201).json({ product: p });
});

router.patch('/:id', allow('admin', 'salesperson'), async (req, res) => {
  const p = await Product.findById(req.params.id);
  if (!p) throw new HttpError(404, 'Product not found.');
  for (const k of EDITABLE) if (req.body[k] !== undefined) p[k] = req.body[k];
  if (req.user.role === 'admin' && req.body.costPrice !== undefined) p.costPrice = req.body.costPrice;
  if (p.isModified('attributes')) p.markModified('attributes');
  await p.save();
  res.json({ product: p });
});

// Manual stock correction (damage, stock take). Cannot take stock below zero.
router.post('/:id/adjust', allow('admin'), async (req, res) => {
  const delta = Number(req.body.delta);
  if (!Number.isInteger(delta) || delta === 0) throw new HttpError(400, 'Enter a whole number other than 0.');
  const filter = { _id: req.params.id };
  if (delta < 0) filter.stockQty = { $gte: -delta };
  const p = await Product.findOneAndUpdate(filter, { $inc: { stockQty: delta } }, { new: true });
  if (!p) throw new HttpError(409, 'Product not found or the adjustment would make stock negative.');
  res.json({ product: p });
});

// Products referenced by past sales are deactivated, never deleted.
router.delete('/:id', allow('admin'), async (req, res) => {
  const p = await Product.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
  if (!p) throw new HttpError(404, 'Product not found.');
  res.json({ product: p });
});

module.exports = router;

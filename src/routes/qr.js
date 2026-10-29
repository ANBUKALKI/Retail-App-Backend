const router = require('express').Router();
const crypto = require('crypto');
const QrCode = require('../models/QrCode');
const Product = require('../models/Product');
const { auth, allow } = require('../middleware/auth');
const { signPayload, verifyText } = require('../utils/qr');
const { HttpError, pageParams } = require('../utils/http');

router.use(auth);

const PREFIX = { clothes: 'CL', groceries: 'GR', home_tools: 'HT' };

function newCode(category) {
  return `${PREFIX[category] || 'XX'}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

// Admin and salesperson generate labels. Each unit gets its own individual id.
router.post('/generate', allow('admin', 'salesperson'), async (req, res) => {
  const { productId, kind = 'unit', batch } = req.body || {};
  const count = kind === 'product' ? 1 : Number(req.body.count || 1);
  if (!['unit', 'product'].includes(kind)) throw new HttpError(400, 'Invalid QR kind.');
  if (!Number.isInteger(count) || count < 1 || count > 500) throw new HttpError(400, 'Count must be between 1 and 500.');

  const product = await Product.findById(productId);
  if (!product || !product.active) throw new HttpError(404, 'Product not found.');

  const docs = Array.from({ length: count }, () => ({
    code: newCode(product.category),
    product: product._id,
    kind,
    batch,
    createdBy: req.user._id,
  }));
  const created = await QrCode.insertMany(docs);

  res.status(201).json({
    product: { _id: product._id, sku: product.sku, name: product.name, category: product.category, price: product.price, brand: product.brand },
    items: created.map((q) => ({ _id: q._id, code: q.code, kind: q.kind, status: q.status, text: signPayload(q, product) })),
  });
});

router.get('/', allow('admin', 'salesperson'), async (req, res) => {
  const { page, limit, skip } = pageParams(req.query, 50, 200);
  const filter = {};
  if (req.query.product) filter.product = req.query.product;
  if (['AVAILABLE', 'SOLD', 'VOID'].includes(req.query.status)) filter.status = req.query.status;
  if (req.query.kind) filter.kind = req.query.kind;
  const [items, total] = await Promise.all([
    QrCode.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('product', 'sku name category price'),
    QrCode.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
});

// Re-print a label that already exists.
router.get('/:id/text', allow('admin', 'salesperson'), async (req, res) => {
  const q = await QrCode.findById(req.params.id);
  if (!q) throw new HttpError(404, 'QR code not found.');
  const product = await Product.findById(q.product);
  res.json({ code: q.code, text: signPayload(q, product), product });
});

router.post('/:id/void', allow('admin'), async (req, res) => {
  const q = await QrCode.findOneAndUpdate({ _id: req.params.id, status: 'AVAILABLE' }, { status: 'VOID' }, { new: true });
  if (!q) throw new HttpError(409, 'Only available QR codes can be voided.');
  res.json({ qr: q });
});

// Used by every scanner (web, mobile, USB). Verifies the signature, then answers from the live database.
router.post('/resolve', async (req, res) => {
  const payload = verifyText(req.body && req.body.text);
  if (!payload) throw new HttpError(400, 'This is not a valid QR code from this shop.');

  const qr = await QrCode.findOne({ code: payload.c });
  if (!qr || qr.status === 'VOID') throw new HttpError(404, 'This QR code is not valid any more.');
  if (qr.kind === 'unit' && qr.status === 'SOLD') throw new HttpError(409, 'This item has already been sold.');

  const product = await Product.findById(qr.product).select(req.user.role === 'admin' ? '' : '-costPrice');
  if (!product || !product.active) throw new HttpError(404, 'This product is no longer sold.');
  if (product.stockQty < 1) throw new HttpError(409, `"${product.name}" is out of stock.`);

  res.json({ code: qr.code, kind: qr.kind, product });
});

module.exports = router;

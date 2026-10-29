const router = require('express').Router();
const Sale = require('../models/Sale');
const { auth, allow } = require('../middleware/auth');
const { checkout, cancelPending, restock, STAFF } = require('../services/saleService');
const { HttpError, pageParams, dateRange, escapeRegex } = require('../utils/http');

router.use(auth);

const POPULATE = [
  { path: 'createdBy', select: 'fullName role' },
  { path: 'customer', select: 'fullName username' },
];

// Which sales a role may see.
function scope(user) {
  if (user.role === 'admin' || user.role === 'billing') return {};
  if (user.role === 'salesperson') return { createdBy: user._id };
  return { customer: user._id };
}

async function findAllowed(req) {
  const sale = await Sale.findOne({ _id: req.params.id, ...scope(req.user) }).populate(POPULATE);
  if (!sale) throw new HttpError(404, 'Bill not found.');
  return sale;
}

router.get('/', async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const filter = { ...scope(req.user), ...dateRange(req.query) };
  if (['PENDING_PAYMENT', 'PAID', 'CANCELLED', 'REFUNDED'].includes(req.query.status)) filter.status = req.query.status;
  if (req.query.q) filter.invoiceNo = new RegExp(escapeRegex(req.query.q), 'i');
  const [items, total] = await Promise.all([
    Sale.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate(POPULATE),
    Sale.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
});

router.get('/:id', async (req, res) => {
  res.json({ sale: await findAllowed(req) });
});

// Create a bill. Staff bills are paid immediately; a customer's own purchase reserves stock until billing confirms payment.
router.post('/', async (req, res) => {
  const { sale, duplicate } = await checkout({ user: req.user, body: req.body });
  const full = await Sale.findById(sale._id).populate(POPULATE);
  const io = req.app.get('io');
  if (io && !duplicate) {
    io.to('role:billing').to('role:admin').emit('sale:new', { _id: full._id, invoiceNo: full.invoiceNo, status: full.status, grandTotal: full.grandTotal });
    io.emit('stock:changed', { productIds: full.items.map((i) => String(i.product)) });
  }
  res.status(duplicate ? 200 : 201).json({ sale: full, duplicate });
});

// Billing confirms that a customer's reserved purchase has been paid at the counter.
router.post('/:id/pay', allow('admin', 'billing'), async (req, res) => {
  const { paymentMode } = req.body || {};
  if (!['cash', 'card', 'upi'].includes(paymentMode)) throw new HttpError(400, 'Choose a payment mode.');
  const sale = await Sale.findOneAndUpdate(
    { _id: req.params.id, status: 'PENDING_PAYMENT' },
    { $set: { status: 'PAID', paymentMode, paidAt: new Date(), paidBy: req.user._id }, $unset: { reservedUntil: 1 } },
    { new: true }
  );
  if (!sale) throw new HttpError(409, 'This bill is not waiting for payment (it may have expired or been cancelled).');
  const io = req.app.get('io');
  if (io) io.to(`user:${sale.customer}`).emit('sale:paid', { _id: sale._id, invoiceNo: sale.invoiceNo });
  res.json({ sale: await Sale.findById(sale._id).populate(POPULATE) });
});

router.post('/:id/cancel', async (req, res) => {
  const isStaff = ['admin', 'billing'].includes(req.user.role);
  if (!isStaff && req.user.role !== 'user') throw new HttpError(403, 'You do not have permission for this action.');
  const extra = isStaff ? {} : { customer: req.user._id };
  const sale = await cancelPending(req.params.id, isStaff ? 'Cancelled by staff' : 'Cancelled by customer', extra);
  if (!sale) throw new HttpError(409, 'Only bills that are waiting for payment can be cancelled.');
  const io = req.app.get('io');
  if (io) io.emit('stock:changed', { productIds: sale.items.map((i) => String(i.product)) });
  res.json({ sale: await Sale.findById(sale._id).populate(POPULATE) });
});

router.post('/:id/refund', allow('admin', 'billing'), async (req, res) => {
  const sale = await Sale.findOneAndUpdate(
    { _id: req.params.id, status: 'PAID' },
    { $set: { status: 'REFUNDED', refundedAt: new Date(), refundedBy: req.user._id, refundReason: String((req.body && req.body.reason) || '').slice(0, 300) } },
    { new: true }
  );
  if (!sale) throw new HttpError(409, 'Only paid bills can be refunded.');
  await restock(sale);
  const io = req.app.get('io');
  if (io) io.emit('stock:changed', { productIds: sale.items.map((i) => String(i.product)) });
  res.json({ sale: await Sale.findById(sale._id).populate(POPULATE) });
});

module.exports = router;
module.exports.STAFF = STAFF;

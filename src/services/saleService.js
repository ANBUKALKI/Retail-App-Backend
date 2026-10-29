const mongoose = require('mongoose');
const Product = require('../models/Product');
const QrCode = require('../models/QrCode');
const Offer = require('../models/Offer');
const Sale = require('../models/Sale');
const { nextInvoiceNo } = require('../models/Counter');
const { HttpError, r2 } = require('../utils/http');
const config = require('../config');

const STAFF = ['admin', 'salesperson', 'billing'];

/* ---------- pricing ---------- */

async function loadActiveOffers(now = new Date()) {
  return Offer.find({ active: true, validFrom: { $lte: now }, validTo: { $gte: now } }).lean();
}

function offerApplies(offer, product) {
  if (offer.products && offer.products.length) return offer.products.some((id) => String(id) === String(product._id));
  if (offer.category) return offer.category === product.category;
  return true;
}

function bestOffer(offers, product) {
  let best = null;
  for (const o of offers) {
    if (!offerApplies(o, product)) continue;
    const perUnit = o.type === 'percent' ? (product.price * Math.min(o.value, 100)) / 100 : Math.min(o.value, product.price);
    if (!best || perUnit > best.perUnit) best = { perUnit, title: o.title };
  }
  return best;
}

/** Prices are always taken from the database here, never from the client. Tax is added on top of the price. */
function priceLine(product, qty, codes, offers) {
  const gross = r2(product.price * qty);
  const best = bestOffer(offers, product);
  const discount = best ? Math.min(gross, r2(best.perUnit * qty)) : 0;
  const taxable = gross - discount;
  const taxAmount = r2((taxable * product.taxPercent) / 100);
  return {
    product: product._id,
    sku: product.sku,
    name: product.name,
    category: product.category,
    qty,
    unitPrice: product.price,
    costPrice: product.costPrice || 0,
    taxPercent: product.taxPercent || 0,
    discount,
    offerTitle: best ? best.title : undefined,
    taxAmount,
    lineTotal: r2(taxable + taxAmount),
    codes,
  };
}

/* ---------- stock claims (atomic, with rollback) ---------- */

async function claim(lines, saleId, claimed) {
  for (const l of lines) {
    // One atomic operation: the condition and the decrement cannot be split by another buyer.
    const r = await Product.updateOne(
      { _id: l.product, active: true, stockQty: { $gte: l.qty } },
      { $inc: { stockQty: -l.qty } }
    );
    if (r.modifiedCount !== 1) {
      throw new HttpError(409, `Not enough stock for "${l.name}".`, { productId: String(l.product) });
    }
    claimed.stock.push({ product: l.product, qty: l.qty });

    for (const code of l.codes) {
      const u = await QrCode.updateOne(
        { code, kind: 'unit', product: l.product, status: 'AVAILABLE' },
        { $set: { status: 'SOLD', soldIn: saleId } }
      );
      if (u.modifiedCount !== 1) throw new HttpError(409, `Item ${code} was just sold or is not valid.`, { code });
      claimed.codes = true;
    }
  }
}

async function rollbackClaims(claimed, saleId) {
  for (const s of claimed.stock) {
    await Product.updateOne({ _id: s.product }, { $inc: { stockQty: s.qty } });
  }
  if (claimed.codes) {
    await QrCode.updateMany({ soldIn: saleId, status: 'SOLD' }, { $set: { status: 'AVAILABLE' }, $unset: { soldIn: 1 } });
  }
}

/** Puts stock and unit QR codes of a finished sale back. Callers flip the sale status atomically first. */
async function restock(sale) {
  const ops = sale.items.map((i) => ({
    updateOne: { filter: { _id: i.product }, update: { $inc: { stockQty: i.qty } } },
  }));
  if (ops.length) await Product.bulkWrite(ops);
  await QrCode.updateMany({ soldIn: sale._id, status: 'SOLD' }, { $set: { status: 'AVAILABLE' }, $unset: { soldIn: 1 } });
}

/* ---------- checkout ---------- */

function normalizeItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new HttpError(400, 'The cart is empty.');
  if (rawItems.length > 100) throw new HttpError(400, 'Too many lines in one bill.');
  const map = new Map();
  for (const it of rawItems) {
    if (!it || !mongoose.isValidObjectId(it.productId)) throw new HttpError(400, 'Invalid product in cart.');
    const loose = it.qty === undefined ? 0 : Number(it.qty);
    const codes = Array.isArray(it.codes) ? it.codes.map(String) : [];
    if (!Number.isInteger(loose) || loose < 0 || loose > 10000) throw new HttpError(400, 'Invalid quantity.');
    const cur = map.get(it.productId) || { productId: it.productId, loose: 0, codes: [] };
    cur.loose += loose;
    for (const c of codes) {
      if (cur.codes.includes(c)) throw new HttpError(400, `Item ${c} appears twice in the cart.`);
      cur.codes.push(c);
    }
    map.set(it.productId, cur);
  }
  const lines = [...map.values()];
  for (const l of lines) {
    if (l.loose + l.codes.length < 1) throw new HttpError(400, 'Quantity must be at least 1.');
  }
  return lines;
}

async function checkout({ user, body }) {
  const { clientRequestId, items, customerName, customerId, paymentMode } = body || {};
  if (typeof clientRequestId !== 'string' || clientRequestId.length < 8 || clientRequestId.length > 100) {
    throw new HttpError(400, 'clientRequestId is required.');
  }

  // Idempotency: a retry or double tap returns the original bill instead of creating a second one.
  const existing = await Sale.findOne({ clientRequestId });
  if (existing) {
    if (String(existing.createdBy) !== String(user._id)) throw new HttpError(409, 'Duplicate request id.');
    return { sale: existing, duplicate: true };
  }

  const isStaff = STAFF.includes(user.role);
  if (isStaff && !['cash', 'card', 'upi'].includes(paymentMode)) {
    throw new HttpError(400, 'Choose a payment mode (cash, card or upi).');
  }

  const lines = normalizeItems(items);
  const products = await Product.find({ _id: { $in: lines.map((l) => l.productId) }, active: true });
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const offers = await loadActiveOffers();

  const saleItems = lines.map((l) => {
    const p = byId.get(l.productId);
    if (!p) throw new HttpError(404, 'A product in the cart is no longer available.');
    return priceLine(p, l.loose + l.codes.length, l.codes, offers);
  });

  const subtotal = r2(saleItems.reduce((s, i) => s + i.unitPrice * i.qty, 0));
  const discountTotal = r2(saleItems.reduce((s, i) => s + i.discount, 0));
  const taxTotal = r2(saleItems.reduce((s, i) => s + i.taxAmount, 0));
  const grandTotal = r2(saleItems.reduce((s, i) => s + i.lineTotal, 0));

  const saleId = new mongoose.Types.ObjectId();
  const claimed = { stock: [], codes: false };

  try {
    await claim(saleItems, saleId, claimed);

    const doc = {
      _id: saleId,
      invoiceNo: await nextInvoiceNo(),
      clientRequestId,
      createdBy: user._id,
      items: saleItems,
      subtotal,
      discountTotal,
      taxTotal,
      grandTotal,
    };
    if (isStaff) {
      doc.source = 'POS';
      doc.status = 'PAID';
      doc.paymentMode = paymentMode;
      doc.paidAt = new Date();
      doc.paidBy = user._id;
      doc.customerName = typeof customerName === 'string' ? customerName.trim().slice(0, 100) : undefined;
      if (customerId && mongoose.isValidObjectId(customerId)) doc.customer = customerId;
    } else {
      doc.source = 'SELF';
      doc.status = 'PENDING_PAYMENT';
      doc.customer = user._id;
      doc.customerName = user.fullName;
      doc.reservedUntil = new Date(Date.now() + config.reservationMinutes * 60 * 1000);
    }
    const sale = await Sale.create(doc);
    return { sale, duplicate: false };
  } catch (err) {
    await rollbackClaims(claimed, saleId);
    if (err && err.code === 11000 && err.keyPattern && err.keyPattern.clientRequestId) {
      // Two identical requests raced each other; the other one won. Return its bill.
      const winner = await Sale.findOne({ clientRequestId });
      if (winner && String(winner.createdBy) === String(user._id)) return { sale: winner, duplicate: true };
    }
    throw err;
  }
}

/* ---------- status transitions ---------- */

/** Atomically flips PENDING_PAYMENT -> CANCELLED and releases stock. Safe to call twice. */
async function cancelPending(saleId, reason, extraFilter = {}) {
  const sale = await Sale.findOneAndUpdate(
    { _id: saleId, status: 'PENDING_PAYMENT', ...extraFilter },
    { $set: { status: 'CANCELLED', cancelReason: reason }, $unset: { reservedUntil: 1 } },
    { new: true }
  );
  if (sale) await restock(sale);
  return sale;
}

async function releaseExpired() {
  const expired = await Sale.find({ status: 'PENDING_PAYMENT', reservedUntil: { $lt: new Date() } }).select('_id');
  let released = 0;
  for (const { _id } of expired) {
    const s = await cancelPending(_id, 'Reservation expired');
    if (s) released += 1;
  }
  return released;
}

module.exports = { checkout, cancelPending, releaseExpired, restock, STAFF };

const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
  _id: String,
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.model('Counter', counterSchema);

/** Atomic, server-side invoice numbers: INV-2026-000001 */
async function nextInvoiceNo(date = new Date()) {
  const year = date.getFullYear();
  const c = await Counter.findOneAndUpdate(
    { _id: `invoice-${year}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return `INV-${year}-${String(c.seq).padStart(6, '0')}`;
}

module.exports = Counter;
module.exports.nextInvoiceNo = nextInvoiceNo;

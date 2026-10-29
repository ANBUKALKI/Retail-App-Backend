const mongoose = require('mongoose');

/**
 * kind 'unit'    -> one physical item (clothes, tools). Can be sold once: AVAILABLE -> SOLD.
 * kind 'product' -> reusable label for loose/bulk goods (groceries). Never consumed; quantity is chosen when scanning.
 */
const qrSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    kind: { type: String, enum: ['unit', 'product'], required: true },
    status: { type: String, enum: ['AVAILABLE', 'SOLD', 'VOID'], default: 'AVAILABLE', index: true },
    batch: { type: String, trim: true },
    soldIn: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('QrCode', qrSchema);

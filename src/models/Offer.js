const mongoose = require('mongoose');

/**
 * Scope: if `products` is set the offer applies to those products, else if `category` is set to that
 * category, else to every product.
 */
const offerSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 500 },
    type: { type: String, enum: ['percent', 'flat'], required: true },
    value: { type: Number, required: true, min: 0 },
    category: { type: String, enum: ['clothes', 'groceries', 'home_tools'] },
    products: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    validFrom: { type: Date, required: true },
    validTo: { type: Date, required: true },
    active: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

offerSchema.index({ active: 1, validFrom: 1, validTo: 1 });

module.exports = mongoose.model('Offer', offerSchema);

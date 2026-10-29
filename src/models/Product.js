const mongoose = require('mongoose');

const CATEGORIES = ['clothes', 'groceries', 'home_tools'];

const productSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, unique: true, trim: true, uppercase: true, maxlength: 40 },
    name: { type: String, required: true, trim: true, maxlength: 150 },
    category: { type: String, enum: CATEGORIES, required: true, index: true },
    brand: { type: String, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 1000 },
    unit: { type: String, trim: true, default: 'pcs', maxlength: 12 },
    price: { type: Number, required: true, min: 0 },
    costPrice: { type: Number, default: 0, min: 0 },
    taxPercent: { type: Number, default: 0, min: 0, max: 100 },
    stockQty: { type: Number, default: 0, min: 0 },
    lowStockLevel: { type: Number, default: 5, min: 0 },
    // Category specific details, e.g. clothes: size/color, groceries: weight/expiryDate, tools: warranty
    attributes: { type: mongoose.Schema.Types.Mixed, default: {} },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

productSchema.index({ name: 'text', sku: 'text', brand: 'text' });

module.exports = mongoose.model('Product', productSchema);
module.exports.CATEGORIES = CATEGORIES;

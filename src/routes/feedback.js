const router = require('express').Router();
const mongoose = require('mongoose');
const Feedback = require('../models/Feedback');
const Sale = require('../models/Sale');
const { auth } = require('../middleware/auth');
const { HttpError, pageParams } = require('../utils/http');

router.use(auth);

const SEES_ALL = ['admin', 'billing'];

router.post('/', async (req, res) => {
  const { rating, comment, saleId } = req.body || {};
  const data = { user: req.user._id, rating: Number(rating), comment };
  if (saleId) {
    if (!mongoose.isValidObjectId(saleId)) throw new HttpError(400, 'Invalid bill.');
    const sale = await Sale.findOne({ _id: saleId, customer: req.user._id });
    if (!sale) throw new HttpError(404, 'Bill not found.');
    data.sale = sale._id;
  }
  const fb = await Feedback.create(data);
  res.status(201).json({ feedback: fb });
});

router.get('/', async (req, res) => {
  const { page, limit, skip } = pageParams(req.query);
  const filter = SEES_ALL.includes(req.user.role) ? {} : { user: req.user._id };
  const [items, total, stats] = await Promise.all([
    Feedback.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('user', 'fullName username').populate('sale', 'invoiceNo'),
    Feedback.countDocuments(filter),
    Feedback.aggregate([
      { $match: filter },
      { $group: { _id: '$rating', count: { $sum: 1 } } },
    ]),
  ]);
  const totalRatings = stats.reduce((s, x) => s + x.count, 0);
  const average = totalRatings ? stats.reduce((s, x) => s + x._id * x.count, 0) / totalRatings : 0;
  res.json({ items, total, page, limit, summary: { average: Math.round(average * 10) / 10, distribution: stats } });
});

module.exports = router;

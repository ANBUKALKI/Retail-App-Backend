const router = require('express').Router();
const Offer = require('../models/Offer');
const { auth, allow } = require('../middleware/auth');
const { HttpError } = require('../utils/http');

router.use(auth);

const FIELDS = ['title', 'description', 'type', 'value', 'category', 'products', 'validFrom', 'validTo', 'active'];

router.get('/', async (req, res) => {
  const filter = {};
  const now = new Date();
  // Customers only see offers that are running right now; staff see everything (or only running ones with ?running=true).
  if (req.user.role === 'user' || req.query.running === 'true') {
    Object.assign(filter, { active: true, validFrom: { $lte: now }, validTo: { $gte: now } });
  }
  const items = await Offer.find(filter).sort({ validTo: -1 }).populate('products', 'name sku');
  res.json({ items });
});

router.post('/', allow('admin'), async (req, res) => {
  const data = {};
  for (const k of FIELDS) if (req.body[k] !== undefined && req.body[k] !== '') data[k] = req.body[k];
  data.createdBy = req.user._id;
  if (data.type === 'percent' && Number(data.value) > 100) throw new HttpError(400, 'A percentage cannot be more than 100.');
  if (data.validFrom && data.validTo && new Date(data.validTo) < new Date(data.validFrom)) {
    throw new HttpError(400, 'The end date must be after the start date.');
  }
  const offer = await Offer.create(data);
  const io = req.app.get('io');
  if (io) io.emit('offer:new', { _id: offer._id, title: offer.title, description: offer.description });
  res.status(201).json({ offer });
});

router.patch('/:id', allow('admin'), async (req, res) => {
  const offer = await Offer.findById(req.params.id);
  if (!offer) throw new HttpError(404, 'Offer not found.');
  for (const k of FIELDS) if (req.body[k] !== undefined) offer[k] = req.body[k] === '' ? undefined : req.body[k];
  if (offer.type === 'percent' && offer.value > 100) throw new HttpError(400, 'A percentage cannot be more than 100.');
  await offer.save();
  res.json({ offer });
});

router.delete('/:id', allow('admin'), async (req, res) => {
  const r = await Offer.deleteOne({ _id: req.params.id });
  if (!r.deletedCount) throw new HttpError(404, 'Offer not found.');
  res.json({ message: 'Offer deleted.' });
});

module.exports = router;

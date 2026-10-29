const router = require('express').Router();
const mongoose = require('mongoose');
const Message = require('../models/Message');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const { HttpError } = require('../utils/http');

router.use(auth);

const isStaff = (u) => ['admin', 'salesperson', 'billing'].includes(u.role);
// Customers can only talk to admin/salesperson; staff can talk to everyone.
const canChat = (me, other) => (isStaff(me) ? true : ['admin', 'salesperson'].includes(other.role));

router.get('/contacts', async (req, res) => {
  const filter = { active: true, _id: { $ne: req.user._id } };
  if (!isStaff(req.user)) filter.role = { $in: ['admin', 'salesperson'] };
  const users = await User.find(filter).select('fullName username role').sort({ fullName: 1 }).limit(500);

  const unread = await Message.aggregate([
    { $match: { to: req.user._id, readAt: { $exists: false } } },
    { $group: { _id: '$from', count: { $sum: 1 } } },
  ]);
  const unreadMap = new Map(unread.map((u) => [String(u._id), u.count]));
  res.json({ items: users.map((u) => ({ ...u.toJSON(), unread: unreadMap.get(String(u._id)) || 0 })) });
});

router.get('/history/:userId', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.userId)) throw new HttpError(400, 'Invalid user.');
  const other = await User.findById(req.params.userId);
  if (!other || !canChat(req.user, other)) throw new HttpError(404, 'User not found.');
  const items = await Message.find({
    $or: [
      { from: req.user._id, to: other._id },
      { from: other._id, to: req.user._id },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(200);
  res.json({ items: items.reverse() });
});

router.post('/send', async (req, res) => {
  const { to, text } = req.body || {};
  if (!mongoose.isValidObjectId(to)) throw new HttpError(400, 'Choose who to message.');
  if (typeof text !== 'string' || !text.trim()) throw new HttpError(400, 'Message cannot be empty.');
  const other = await User.findById(to);
  if (!other || !other.active || !canChat(req.user, other)) throw new HttpError(404, 'User not found.');
  const msg = await Message.create({ from: req.user._id, to: other._id, text });
  const io = req.app.get('io');
  if (io) io.to(`user:${other._id}`).emit('chat:message', msg);
  res.status(201).json({ message: msg });
});

router.post('/read/:userId', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.userId)) throw new HttpError(400, 'Invalid user.');
  await Message.updateMany({ from: req.params.userId, to: req.user._id, readAt: { $exists: false } }, { $set: { readAt: new Date() } });
  res.json({ ok: true });
});

module.exports = router;

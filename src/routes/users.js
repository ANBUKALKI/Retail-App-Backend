const router = require('express').Router();
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { ROLES } = require('../models/User');
const { auth, allow } = require('../middleware/auth');
const { HttpError, pageParams, escapeRegex } = require('../utils/http');

router.use(auth, allow('admin'));

function checkPassword(p) {
  if (typeof p !== 'string' || p.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
}

router.get('/', async (req, res) => {
  const { page, limit, skip } = pageParams(req.query, 50, 200);
  const filter = {};
  if (req.query.role && ROLES.includes(req.query.role)) filter.role = req.query.role;
  if (req.query.active === 'true') filter.active = true;
  if (req.query.active === 'false') filter.active = false;
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(req.query.q), 'i');
    filter.$or = [{ username: rx }, { fullName: rx }];
  }
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
});

router.post('/', async (req, res) => {
  const { username, password, fullName, role, phone } = req.body || {};
  if (!ROLES.includes(role)) throw new HttpError(400, 'Choose a valid role.');
  checkPassword(password);
  const user = await User.create({
    username,
    fullName,
    role,
    phone,
    passwordHash: await bcrypt.hash(password, 12),
    mustChangePassword: true,
    createdBy: req.user._id,
  });
  res.status(201).json({ user });
});

router.patch('/:id', async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw new HttpError(404, 'User not found.');
  const { fullName, phone, role, active } = req.body || {};
  const isSelf = String(user._id) === String(req.user._id);
  if (isSelf && ((role && role !== user.role) || active === false)) {
    throw new HttpError(400, 'You cannot disable or change the role of your own account.');
  }
  if (fullName !== undefined) user.fullName = fullName;
  if (phone !== undefined) user.phone = phone;
  if (role !== undefined) {
    if (!ROLES.includes(role)) throw new HttpError(400, 'Choose a valid role.');
    user.role = role;
  }
  if (active !== undefined) user.active = Boolean(active);
  await user.save();
  res.json({ user });
});

router.post('/:id/reset-password', async (req, res) => {
  const { password } = req.body || {};
  checkPassword(password);
  const user = await User.findById(req.params.id);
  if (!user) throw new HttpError(404, 'User not found.');
  user.passwordHash = await bcrypt.hash(password, 12);
  user.mustChangePassword = true;
  await user.save();
  res.json({ message: 'Password reset. The user must change it at next login.' });
});

module.exports = router;

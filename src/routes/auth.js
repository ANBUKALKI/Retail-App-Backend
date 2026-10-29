const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const { auth, signToken } = require('../middleware/auth');
const { HttpError } = require('../utils/http');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many login attempts. Try again in a few minutes.' },
});

// A real hash to compare against when the username does not exist, so timing does not reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

// There is deliberately no register endpoint: accounts are created by an admin only.
router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') throw new HttpError(400, 'Username and password are required.');
  const user = await User.findOne({ username: username.trim().toLowerCase() });
  const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'Invalid username or password.');
  if (!user.active) throw new HttpError(403, 'This account has been disabled. Contact the administrator.');
  user.lastLoginAt = new Date();
  await user.save();
  res.json({ token: signToken(user), user });
});

router.get('/me', auth, (req, res) => res.json({ user: req.user }));

router.post('/change-password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < 8) throw new HttpError(400, 'New password must be at least 8 characters.');
  if (!(await bcrypt.compare(String(currentPassword || ''), req.user.passwordHash))) throw new HttpError(400, 'Current password is incorrect.');
  req.user.passwordHash = await bcrypt.hash(newPassword, 12);
  req.user.mustChangePassword = false;
  await req.user.save();
  res.json({ message: 'Password updated.' });
});

module.exports = router;

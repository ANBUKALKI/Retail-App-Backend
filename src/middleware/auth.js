const jwt = require('jsonwebtoken');
const config = require('../config');
const User = require('../models/User');
const { HttpError } = require('../utils/http');

function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpires });
}

async function userFromToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw new HttpError(401, 'Session expired. Please log in again.');
  }
  // Loaded on every request so a disabled account or changed role takes effect immediately.
  const user = await User.findById(payload.sub);
  if (!user || !user.active) throw new HttpError(401, 'Account is disabled or no longer exists.');
  return user;
}

async function auth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Authentication required.');
  req.user = await userFromToken(token);
  next();
}

const allow =
  (...roles) =>
  (req, _res, next) => {
    if (!roles.includes(req.user.role)) throw new HttpError(403, 'You do not have permission for this action.');
    next();
  };

module.exports = { auth, allow, signToken, userFromToken };

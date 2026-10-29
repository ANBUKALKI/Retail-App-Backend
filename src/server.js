require('express-async-errors');
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const config = require('./config');
const User = require('./models/User');
const { initSocket } = require('./socket');
const { releaseExpired } = require('./services/saleService');

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/products', require('./routes/products'));
app.use('/api/purchases', require('./routes/purchases'));
app.use('/api/qr', require('./routes/qr'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/offers', require('./routes/offers'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/feedback', require('./routes/feedback'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/dashboard', require('./routes/dashboard'));

app.use('/api', (_req, res) => res.status(404).json({ message: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.status) return res.status(err.status).json({ message: err.message, ...(err.extra || {}) });
  if (err.name === 'ValidationError') {
    const msg = Object.values(err.errors).map((e) => e.message).join(' ');
    return res.status(400).json({ message: msg });
  }
  if (err.name === 'CastError') return res.status(400).json({ message: `Invalid value for ${err.path}.` });
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'value';
    return res.status(409).json({ message: `That ${field} already exists.` });
  }
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Invalid JSON body.' });
  console.error(err);
  res.status(500).json({ message: 'Something went wrong on the server.' });
});

async function seedAdmin() {
  const count = await User.estimatedDocumentCount();
  if (count > 0) return;
  if (!config.adminUsername || !config.adminPassword) {
    console.warn('No users exist. Set ADMIN_USERNAME and ADMIN_PASSWORD in .env and restart to create the first admin.');
    return;
  }
  await User.create({
    username: config.adminUsername,
    passwordHash: await bcrypt.hash(config.adminPassword, 12),
    fullName: 'Administrator',
    role: 'admin',
    mustChangePassword: false,
  });
  console.log(`First admin "${config.adminUsername}" created.`);
}

async function main() {
  await mongoose.connect(config.mongoUri);
  console.log('MongoDB connected');
  await User.init(); // make sure unique indexes exist
  await seedAdmin();

  const server = http.createServer(app);
  const io = initSocket(server);
  app.set('io', io);

  // Release stock held by unpaid self-purchases.
  setInterval(() => releaseExpired().catch((e) => console.error('releaseExpired', e)), 60 * 1000);

  server.listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { app, main };

//============= 29-10-26 =================

// require('express-async-errors');
// const http = require('http');
// const express = require('express');
// const cors = require('cors');
// const helmet = require('helmet');
// const bcrypt = require('bcryptjs');
// const mongoose = require('mongoose');

// const config = require('./config');
// const User = require('./models/User');
// const { initSocket } = require('./socket');
// const { releaseExpired } = require('./services/saleService');

// const app = express();
// app.set('trust proxy', 1);
// app.use(helmet());
// app.use(cors({ origin: config.clientOrigins, credentials: true }));
// app.use(express.json({ limit: '1mb' }));

// app.get('/api/health', (_req, res) => res.json({ ok: true, db: mongoose.connection.readyState === 1 }));

// app.use('/api/auth', require('./routes/auth'));
// app.use('/api/users', require('./routes/users'));
// app.use('/api/products', require('./routes/products'));
// app.use('/api/purchases', require('./routes/purchases'));
// app.use('/api/qr', require('./routes/qr'));
// app.use('/api/sales', require('./routes/sales'));
// app.use('/api/offers', require('./routes/offers'));
// app.use('/api/chat', require('./routes/chat'));
// app.use('/api/feedback', require('./routes/feedback'));
// app.use('/api/reports', require('./routes/reports'));
// app.use('/api/dashboard', require('./routes/dashboard'));

// app.use('/api', (_req, res) => res.status(404).json({ message: 'Not found' }));

// // eslint-disable-next-line no-unused-vars
// app.use((err, _req, res, _next) => {
//   if (err.status) return res.status(err.status).json({ message: err.message, ...(err.extra || {}) });
//   if (err.name === 'ValidationError') {
//     const msg = Object.values(err.errors).map((e) => e.message).join(' ');
//     return res.status(400).json({ message: msg });
//   }
//   if (err.name === 'CastError') return res.status(400).json({ message: `Invalid value for ${err.path}.` });
//   if (err.code === 11000) {
//     const field = Object.keys(err.keyPattern || {})[0] || 'value';
//     return res.status(409).json({ message: `That ${field} already exists.` });
//   }
//   if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Invalid JSON body.' });
//   console.error(err);
//   res.status(500).json({ message: 'Something went wrong on the server.' });
// });

// async function seedAdmin() {
//   const count = await User.estimatedDocumentCount();
//   if (count > 0) return;
//   if (!config.adminUsername || !config.adminPassword) {
//     console.warn('No users exist. Set ADMIN_USERNAME and ADMIN_PASSWORD in .env and restart to create the first admin.');
//     return;
//   }
//   await User.create({
//     username: config.adminUsername,
//     passwordHash: await bcrypt.hash(config.adminPassword, 12),
//     fullName: 'Administrator',
//     role: 'admin',
//     mustChangePassword: false,
//   });
//   console.log(`First admin "${config.adminUsername}" created.`);
// }

// async function main() {
//   await mongoose.connect(config.mongoUri);
//   console.log('MongoDB connected');
//   await User.init(); // make sure unique indexes exist
//   await seedAdmin();

//   const server = http.createServer(app);
//   const io = initSocket(server);
//   app.set('io', io);

//   // Release stock held by unpaid self-purchases.
//   setInterval(() => releaseExpired().catch((e) => console.error('releaseExpired', e)), 60 * 1000);

//   server.listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`));
// }

// if (require.main === module) {
//   main().catch((e) => {
//     console.error(e);
//     process.exit(1);
//   });
// }

// module.exports = { app, main };

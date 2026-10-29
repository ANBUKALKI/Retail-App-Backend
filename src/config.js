
require('dotenv').config();

function need(key) {
  const v = process.env[key];
  if (!v) {
    console.error(`Missing required environment variable ${key}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return v;
}

const clientOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Dev: allow any localhost port (Flutter web uses a random port)
const localhostRe = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
function corsOrigin(origin, cb) {
  if (!origin) return cb(null, true); // mobile app, curl, Postman
  if (clientOrigins.includes(origin) || localhostRe.test(origin)) return cb(null, true);
  cb(new Error('Not allowed by CORS'));
}

module.exports = {
  port: Number(process.env.PORT || 5000),
  mongoUri: need('MONGO_URI'),
  jwtSecret: need('JWT_SECRET'),
  qrSecret: need('QR_SECRET'),
  jwtExpires: process.env.JWT_EXPIRES || '12h',
  clientOrigins,
  corsOrigin,
  adminUsername: process.env.ADMIN_USERNAME,
  adminPassword: process.env.ADMIN_PASSWORD,
  reservationMinutes: Number(process.env.RESERVATION_MINUTES || 15),
};

//======= 29-10-26 ============
// require('dotenv').config();

// function need(key) {
//   const v = process.env[key];
//   if (!v) {
//     console.error(`Missing required environment variable ${key}. Copy .env.example to .env and fill it in.`);
//     process.exit(1);
//   }
//   return v;
// }

// module.exports = {
//   port: Number(process.env.PORT || 5000),
//   mongoUri: need('MONGO_URI'),
//   jwtSecret: need('JWT_SECRET'),
//   qrSecret: need('QR_SECRET'),
//   jwtExpires: process.env.JWT_EXPIRES || '12h',
//   clientOrigins: (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
//     .split(',')
//     .map((s) => s.trim())
//     .filter(Boolean),
//   adminUsername: process.env.ADMIN_USERNAME,
//   adminPassword: process.env.ADMIN_PASSWORD,
//   reservationMinutes: Number(process.env.RESERVATION_MINUTES || 15),
// };


const crypto = require('crypto');
const { qrSecret } = require('../config');

const PREFIX = 'RQ1';

function mac(body) {
  return crypto.createHmac('sha256', qrSecret).update(body).digest('base64url').slice(0, 22);
}

/**
 * Builds the text stored inside a QR image: RQ1.<base64url(json)>.<hmac>
 * The JSON carries the product details so it can be shown offline, and the HMAC
 * proves the label was produced by this system. Prices are still re-checked on the
 * server at checkout, so an old label can never decide the bill.
 */
function signPayload(qr, product) {
  const attrs = product.attributes && typeof product.attributes === 'object' ? product.attributes : {};
  const payload = {
    c: qr.code,
    k: qr.kind,
    p: String(product._id),
    s: product.sku,
    n: product.name,
    g: product.category,
    b: product.brand || undefined,
    u: product.unit || undefined,
    pr: product.price,
    a: Object.keys(attrs).length ? attrs : undefined,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${PREFIX}.${body}.${mac(body)}`;
}

/** Returns the decoded payload when the signature is valid, otherwise null. */
function verifyText(text) {
  const parts = String(text || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const expected = Buffer.from(mac(parts[1]));
  const given = Buffer.from(parts[2]);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

module.exports = { signPayload, verifyText };

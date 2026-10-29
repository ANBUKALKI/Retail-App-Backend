/**
 * Proves the "many people buy at once without stock or billing mismatch" rules against your real MongoDB.
 *
 *   1. Start the API (npm start).
 *   2. ADMIN_USERNAME=admin ADMIN_PASSWORD=yourpassword node scripts/concurrency-test.js [buyers=40] [stock=10]
 *
 * It creates three throw-away products (named "ZZ concurrency test ...") and deactivates them at the end.
 * The bills it creates stay in the database as normal PAID bills; delete them in MongoDB if you do not want them.
 * Requires Node 18+ (built-in fetch). All requests use the admin token with different request ids, which is
 * identical, as far as stock handling goes, to different people buying at the same moment.
 */
const base = process.env.API_URL || 'http://localhost:5000/api';
const BUYERS = Number(process.argv[2] || 40);
const STOCK = Number(process.argv[3] || 10);
const stamp = Date.now();
let failed = 0;

async function call(method, path, token, body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function check(name, cond, detail) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!cond) failed += 1;
}

async function main() {
  const login = await call('POST', '/auth/login', null, { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });
  if (login.status !== 200) throw new Error(`Admin login failed: ${login.data.message}. Set ADMIN_USERNAME and ADMIN_PASSWORD.`);
  const token = login.data.token;
  const created = [];

  async function makeProduct(label, qty) {
    const p = await call('POST', '/products', token, { sku: `ZZ-${label}-${stamp}`, name: `ZZ concurrency test ${label}`, category: 'clothes', price: 100, taxPercent: 0 });
    if (p.status !== 201) throw new Error(`Could not create product: ${p.data.message}`);
    const id = p.data.product._id;
    created.push(id);
    const pu = await call('POST', '/purchases', token, { supplier: 'Concurrency test', items: [{ productId: id, qty, costPrice: 50 }] });
    if (pu.status !== 201) throw new Error(`Could not add stock: ${pu.data.message}`);
    return id;
  }
  const stockOf = async (id) => (await call('GET', `/products/${id}`, token)).data.product.stockQty;
  const buy = (items, requestId) => call('POST', '/sales', token, { clientRequestId: requestId, paymentMode: 'cash', items });

  // 1. Many buyers, limited stock
  const a = await makeProduct('A', STOCK);
  const r1 = await Promise.all(Array.from({ length: BUYERS }, (_, i) => buy([{ productId: a, qty: 1 }], `cc-${stamp}-a-${i}`)));
  const ok1 = r1.filter((r) => r.status === 201).length;
  const rejected1 = r1.filter((r) => r.status === 409).length;
  check(`${BUYERS} buyers, stock ${STOCK}: exactly ${Math.min(STOCK, BUYERS)} bills created`, ok1 === Math.min(STOCK, BUYERS), `created ${ok1}`);
  check('the rest were told "not enough stock" (409), no other errors', ok1 + rejected1 === BUYERS, `409s ${rejected1}, others ${BUYERS - ok1 - rejected1}`);
  const finalA = await stockOf(a);
  check('stock never went negative and matches bills', finalA === STOCK - ok1, `stock now ${finalA}`);

  // 2. Same request sent many times (double tap / retry)
  const b = await makeProduct('B', 10);
  const r2 = await Promise.all(Array.from({ length: 6 }, () => buy([{ productId: b, qty: 2 }], `cc-${stamp}-dup`)));
  const ids = new Set(r2.filter((r) => r.status === 200 || r.status === 201).map((r) => r.data.sale._id));
  check('the same request sent 6 times creates one bill', ids.size === 1 && r2.every((r) => r.status === 200 || r.status === 201), `distinct bills ${ids.size}`);
  check('and takes stock only once', (await stockOf(b)) === 8, `stock now ${await stockOf(b)}`);

  // 3. One individual item QR scanned by many people
  const c = await makeProduct('C', 5);
  const gen = await call('POST', '/qr/generate', token, { productId: c, kind: 'unit', count: 1 });
  const code = gen.data.items[0].code;
  const r3 = await Promise.all(Array.from({ length: BUYERS }, (_, i) => buy([{ productId: c, codes: [code] }], `cc-${stamp}-c-${i}`)));
  const ok3 = r3.filter((r) => r.status === 201).length;
  check('one single-item QR scanned by everyone: exactly one buyer gets it', ok3 === 1, `winners ${ok3}`);
  check('and stock dropped by exactly one', (await stockOf(c)) === 4, `stock now ${await stockOf(c)}`);

  for (const id of created) await call('DELETE', `/products/${id}`, token);
  console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll concurrency checks passed.');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function pageParams(query, defLimit = 25, maxLimit = 100) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defLimit));
  return { page, limit, skip: (page - 1) * limit };
}

function dateRange(query, field = 'createdAt') {
  const q = {};
  if (query.from) {
    const d = new Date(query.from);
    if (!isNaN(d)) q.$gte = d;
  }
  if (query.to) {
    const d = new Date(query.to);
    if (!isNaN(d)) q.$lte = d;
  }
  return Object.keys(q).length ? { [field]: q } : {};
}

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = { HttpError, r2, pageParams, dateRange, escapeRegex };

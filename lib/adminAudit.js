// lib/adminAudit.js
//
// Append-only record of admin-layer activity (auth failures, kill-switch
// changes, session resets). Every entry also goes to console, so your host's
// log retention (Render/Vercel logs) is the durable copy.
//
// ⚠️ The in-memory ring buffer (last 200) is lost on restart — GET /admin/audit
// is for "what just happened", not a compliance record. DB persistence would
// need a new Prisma model; not built.
//
// Any detail key containing "token" is dropped before storing/logging, so a
// caller can't accidentally write the admin token into the audit trail.

const MAX_ENTRIES = 200;
const entries = [];

function scrub(details = {}) {
  const out = {};
  for (const [k, v] of Object.entries(details)) {
    if (/token/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

export function recordAdminEvent({ action, ip = null, ok = true, details = {} }) {
  const entry = { at: new Date().toISOString(), action, ip, ok, details: scrub(details) };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  console.log(`🛡️ [admin] ${action} ok=${ok} ip=${ip}`, Object.keys(entry.details).length ? entry.details : '');
  return entry;
}

export function getRecentAdminEvents(limit = 50) {
  const n = Math.max(1, Math.min(Number(limit) || 50, MAX_ENTRIES));
  return entries.slice(-n).reverse();
}
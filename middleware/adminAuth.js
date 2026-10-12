// middleware/adminAuth.js
//
// Sovereign-admin gate. Credential: a long random secret in SHERZ_ADMIN_TOKEN,
// sent in the X-Admin-Token header (never the query string — URLs end up in
// logs). Deliberately independent of authRequired / guest JWTs: your /api auth
// gate is bypassed entirely when NODE_ENV !== 'production', and admin must not
// inherit that.
//
// Fail-closed: if the env var is missing or shorter than 32 chars, every admin
// route answers 404 (the API doesn't advertise itself) and a startup warning
// says why. Generate a token with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// Brute-force guard: 5 failed attempts from one IP within 15 min locks that IP
// out for 15 min (429), even if it then sends the right token. In-memory — a
// restart clears it, which is also your recovery path if you ever lock
// yourself out. Relies on `trust proxy` being set so req.ip is the real
// client IP behind Render/Vercel (server.js already does this).

import crypto from 'node:crypto';
import { recordAdminEvent } from '../lib/adminAudit.js';

const MIN_TOKEN_LENGTH = 32;
const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const PRUNE_ABOVE = 1000;

const failures = new Map(); // ip -> { count, firstAt, lockedUntil }

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();

export function isAdminConfigured() {
  return (process.env.SHERZ_ADMIN_TOKEN || '').length >= MIN_TOKEN_LENGTH;
}

export function warnIfAdminMisconfigured() {
  const t = process.env.SHERZ_ADMIN_TOKEN || '';
  if (!t) {
    console.log('🛡️ Admin API disabled (SHERZ_ADMIN_TOKEN not set).');
  } else if (t.length < MIN_TOKEN_LENGTH) {
    console.warn(`⚠️ Admin API DISABLED: SHERZ_ADMIN_TOKEN is ${t.length} chars, minimum is ${MIN_TOKEN_LENGTH}.`);
  } else {
    console.log('🛡️ Admin API enabled.');
  }
}

// Constant-time compare. Both sides are hashed first so the buffers are always
// equal length (timingSafeEqual throws otherwise, and length would leak).
function tokenMatches(provided) {
  return crypto.timingSafeEqual(digest(provided), digest(process.env.SHERZ_ADMIN_TOKEN || ''));
}

function recordFailure(ip) {
  const now = Date.now();
  if (failures.size > PRUNE_ABOVE) {
    for (const [k, v] of failures) {
      if (v.lockedUntil < now && now - v.firstAt > WINDOW_MS) failures.delete(k);
    }
  }
  let e = failures.get(ip);
  if (!e || now - e.firstAt > WINDOW_MS) e = { count: 0, firstAt: now, lockedUntil: 0 };
  e.count += 1;
  if (e.count >= MAX_FAILS) e.lockedUntil = now + LOCK_MS;
  failures.set(ip, e);
  return e;
}

export function adminRequired(req, res, next) {
  if (!isAdminConfigured()) {
    return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  }

  const ip = req.ip || 'unknown';
  const now = Date.now();

  const entry = failures.get(ip);
  if (entry && entry.lockedUntil > now) {
    res.set('Retry-After', String(Math.ceil((entry.lockedUntil - now) / 1000)));
    return res.status(429).json({ ok: false, error: 'TOO_MANY_ATTEMPTS' });
  }

  const provided = req.get('x-admin-token') || '';
  if (!provided || !tokenMatches(provided)) {
    const e = recordFailure(ip);
    recordAdminEvent({
      action: 'auth_failed',
      ip,
      ok: false,
      details: { attempts: e.count, lockedOut: e.lockedUntil > now },
    });
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  }

  failures.delete(ip);
  req.isSovereignAdmin = true; // the IS_SOVEREIGN_ADMIN flag, request-scoped
  return next();
}
// routes/helper.js — mounted at /api/helper
//   user routes (normal JWT):   POST /pair-code · GET /status · DELETE /devices/:id
//   device routes (device token): POST /d/pair (code, no auth) · GET /d/poll · POST /d/result
// The device routes are exempted from the JWT guard in server.js; they authenticate with the helper's own token,
// which can ONLY poll for and answer jobs of the one user it was paired to.
import { Router } from 'express';
import { createHub, prismaDevices, memoryDevices } from '../lib/helper/hub.js';

export function makeHub({ prisma }) {
  const has = !!(prisma && prisma.helperDevice);
  if (!has) console.warn('[helper] prisma.helperDevice missing — pairings are kept in memory only. Run: npx prisma db push');
  return createHub({ devices: has ? prismaDevices(prisma) : memoryDevices() });
}

export function helperRouter({ hub, isProd = false }) {
  const r = Router();
  const userId = (req) => req.user?.id || (!isProd ? String(req.query?.userId || req.body?.userId || 'u1') : null);
  const guard = (fn) => async (req, res) => {
    try { const u = userId(req); if (!u) return res.status(401).json({ ok: false, error: 'Unauthorized' }); await fn(req, res, u); }
    catch (e) { console.error('[helper] route error:', e); res.status(500).json({ ok: false, error: 'helper error' }); }
  };
  r.post('/pair-code', guard(async (_req, res, u) => res.json({ ok: true, ...(await hub.createPairCode(u)) })));
  r.get('/status', guard(async (_req, res, u) => res.json({ ok: true, devices: await hub.list(u) })));
  r.delete('/devices/:id', guard(async (req, res, u) => res.json({ ok: await hub.revoke(u, req.params.id) })));

  // ── device side ──
  const tokenOf = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  // brute-force guard for pairing codes (8 chars from a 32-letter alphabet is already ~40 bits; this stops hammering anyway)
  const fails = new Map();
  r.post('/d/pair', async (req, res) => {
    const ip = req.ip || 'x'; const f = fails.get(ip) || { n: 0, t: Date.now() };
    if (Date.now() - f.t > 10 * 60 * 1000) { f.n = 0; f.t = Date.now(); }
    if (f.n >= 10) return res.status(429).json({ ok: false, error: 'too many attempts — wait a few minutes' });
    const out = await hub.pair(req.body?.code, req.body?.name);
    if (!out.ok) { f.n++; fails.set(ip, f); return res.status(400).json(out); }
    res.json(out);
  });
  r.get('/d/poll', async (req, res) => {
    const dev = await hub.auth(tokenOf(req));
    if (!dev) return res.status(401).json({ ok: false, error: 'unknown or revoked device' });
    const job = await hub.poll(dev);
    if (!job) return res.status(204).end();
    res.json({ ok: true, job });
  });
  r.post('/d/result', async (req, res) => {
    const dev = await hub.auth(tokenOf(req));
    if (!dev) return res.status(401).json({ ok: false, error: 'unknown or revoked device' });
    res.json({ ok: hub.result(dev, req.body || {}) });
  });
  return r;
}

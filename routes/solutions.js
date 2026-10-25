// routes/solutions.js — mounted at /api/solutions (behind the global JWT guard in server.js)
//   GET    /api/solutions/settings        → { enabled, eligible, scope }
//   PUT    /api/solutions/settings        { enabled: boolean }   opt-in switch (default OFF, real accounts only)
//   DELETE /api/solutions/contributions   remove my confirmations / candidates nobody else confirmed from the shared pool
import { Router } from 'express';
import { isRealAccount, ROLE_GROUPS } from '../lib/sharedSolutions.js';

export function solutionsRouter({ service, isProd = false, ensureUser = async () => {} } = {}) {
  const r = Router();
  const uid = (req) => req.user?.id || (!isProd ? String(req.query?.userId || req.body?.userId || 'u1') : null);
  const wrap = (fn) => async (req, res) => {
    try {
      const userId = uid(req);
      if (!userId) return res.status(401).json({ ok: false, error: 'login required' });
      await ensureUser(userId);
      await fn(req, res, userId);
    } catch (e) {
      if (e instanceof RangeError) return res.status(400).json({ ok: false, error: e.message });
      console.error('[solutions] route error:', e);
      res.status(500).json({ ok: false, error: 'Shared learning error' });
    }
  };
  const scope = Object.keys(ROLE_GROUPS);
  r.get('/settings', wrap(async (_req, res, userId) => {
    res.json({ ok: true, enabled: await service.isEnabled(userId), eligible: isRealAccount(userId), available: service.ready(), scope });
  }));
  r.put('/settings', wrap(async (req, res, userId) => {
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ ok: false, error: 'enabled must be true or false' });
    const enabled = await service.setEnabled(userId, req.body.enabled);
    res.json({ ok: true, enabled, eligible: true, available: true, scope });
  }));
  r.delete('/contributions', wrap(async (_req, res, userId) => {
    if (!isRealAccount(userId)) throw new RangeError('Sign in first.');
    res.json({ ok: true, ...(await service.withdraw(userId)) });
  }));
  return r;
}

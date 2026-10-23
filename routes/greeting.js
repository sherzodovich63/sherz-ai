// routes/greeting.js — mounted at /api/greeting (behind the global JWT guard in server.js).
//   GET /api/greeting?tz=Asia/Tashkent[&fresh=1]   → { ok, text, source: 'ai'|'cache'|'fallback' }
// Owner-scoped (the greeting is built from THIS user's context only). Never returns a 5xx for a model problem: it returns a fallback line.
import { Router } from 'express';

export function greetingRouter({ service, isProd = false, ensureUser = async () => {} } = {}) {
  if (!service || typeof service.get !== 'function') throw new Error('greetingRouter needs a service');
  const r = Router();
  r.get('/', async (req, res) => {
    const userId = req.user?.id || (!isProd ? String(req.query?.userId || 'u1') : null);
    if (!userId) return res.status(401).json({ ok: false, error: 'login required' });
    try {
      await ensureUser(userId);
      const tz = String(req.query?.tz || '').slice(0, 64);
      const out = await service.get({ userId, tz, force: req.query?.fresh === '1' });
      res.set('Cache-Control', 'private, no-store');
      res.json({ ok: true, text: out.text, source: out.source, intent: out.intent || null, flavor: out.flavor || null });
    } catch (e) {
      console.error('[greeting] route error:', e?.message || e);
      res.status(200).json({ ok: true, text: '', source: 'fallback' });       // the page then shows its own built-in line
    }
  });
  return r;
}

// routes/push.js — mounted at /api/push (behind the global JWT guard in server.js)
//   GET    /api/push/status        → { available, publicKey, devices }
//   POST   /api/push/subscribe     { subscription }  → saves this browser (PushSubscription.toJSON())
//   POST   /api/push/unsubscribe   { endpoint? }     → removes this browser (or all my devices when no endpoint)
//   POST   /api/push/test          → sends a test notification to my devices
// Also accepts the native-app form of POST /api/push/register ({ token, platform }) with a clear "not supported yet" answer, so apps built with SHERZ_PUSH=1 do not error.
import { Router } from 'express';

export function pushRouter({ service, isProd = false, ensureUser = async () => {} } = {}) {
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
      console.error('[push] route error:', e);
      res.status(500).json({ ok: false, error: 'Push error' });
    }
  };
  r.get('/status', wrap(async (_req, res, userId) => {
    res.json({ ok: true, available: service.ready(), publicKey: service.publicKey(), devices: await service.count(userId) });
  }));
  r.post('/subscribe', wrap(async (req, res, userId) => {
    if (!service.ready()) return res.status(503).json({ ok: false, error: 'Notifications are not set up on this server yet.' });
    await service.subscribe(userId, req.body?.subscription, req.get('user-agent') || '');
    res.json({ ok: true, devices: await service.count(userId) });
  }));
  r.post('/unsubscribe', wrap(async (req, res, userId) => {
    const removed = await service.unsubscribe(userId, req.body?.endpoint);
    res.json({ ok: true, removed, devices: await service.count(userId) });
  }));
  r.post('/test', wrap(async (_req, res, userId) => {
    if (!service.ready()) return res.status(503).json({ ok: false, error: 'Notifications are not set up on this server yet.' });
    const out = await service.sendToUser(userId, { title: 'SHERZ', body: 'Notifications are on. I can reach you here.', tag: 'sherz-test', data: { force: true } });
    res.json({ ok: true, ...out });
  }));
  r.post('/register', wrap(async (_req, res) => {
    res.status(501).json({ ok: false, error: 'Native push (FCM/APNs) is not set up yet; use the installed web app.' });
  }));
  return r;
}

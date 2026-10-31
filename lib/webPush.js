// lib/webPush.js — Web Push (VAPID) for proactive messages while the app is closed.
// Works for the installed web app on iPhone (iOS 16.4+, "Add to Home Screen") and for desktop / Android browsers; no Firebase or Apple key needed.
// Setup: `npx web-push generate-vapid-keys` → VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@example.com) in .env.
// Everything is optional: without keys or the table, ready() is false and every function is a harmless no-op.
// The library is injected (`webpush`) so tests need no network; in production it is imported lazily, so a missing package never stops the server.

const MAX_PER_USER = 10;
const isGuest = (id) => !id || String(id).startsWith('guest_') || id === 'anonymous';
const plain = (s) => String(s ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~#>]+/g, '').replace(/^\s*[-•]\s+/gm, '');   // lock screens show plain text: drop chat formatting
const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export function createWebPush({ prisma, webpush = null, env = process.env, log = console } = {}) {
  const pub = env.VAPID_PUBLIC_KEY || '', priv = env.VAPID_PRIVATE_KEY || '', subject = env.VAPID_SUBJECT || '';
  let lib = webpush, configured = false, loading = null;

  async function lazy() {
    if (configured) return lib;
    if (!pub || !priv || !/^(mailto:|https:\/\/)/.test(subject)) return null;
    if (!lib) {
      loading ||= import('web-push').then((m) => m.default || m).catch(() => null);
      lib = await loading;
    }
    if (!lib) return null;
    lib.setVapidDetails(subject, pub, priv); configured = true; return lib;
  }
  const table = () => (prisma && prisma.pushSubscription) || null;
  const ready = () => !!(table() && pub && priv && /^(mailto:|https:\/\/)/.test(subject));
  const publicKey = () => (ready() ? pub : '');

  /** save (or move to this user) one browser subscription */
  async function subscribe(userId, sub, userAgent = '') {
    if (isGuest(userId)) throw new RangeError('Sign in first.');
    const endpoint = String(sub?.endpoint || ''), p256dh = String(sub?.keys?.p256dh || ''), auth = String(sub?.keys?.auth || '');
    if (!/^https:\/\/[^\s]{10,1500}$/.test(endpoint) || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) throw new RangeError('Invalid subscription.');
    const t = table(); if (!t) throw new Error('push table missing');
    const mine = await t.findMany({ where: { userId } });
    if (mine.length >= MAX_PER_USER && !mine.some((m) => m.endpoint === endpoint)) {          // keep the newest devices, drop the oldest
      const oldest = [...mine].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)).slice(0, mine.length - MAX_PER_USER + 1);
      await t.deleteMany({ where: { id: { in: oldest.map((o) => o.id) } } });
    }
    await t.upsert({ where: { endpoint }, create: { userId, endpoint, p256dh, auth, userAgent: clip(userAgent, 200) }, update: { userId, p256dh, auth, userAgent: clip(userAgent, 200) } });
    return true;
  }

  async function unsubscribe(userId, endpoint) {
    const t = table(); if (!t) return 0;
    const r = await t.deleteMany({ where: endpoint ? { userId, endpoint: String(endpoint) } : { userId } });
    return r?.count ?? 0;
  }

  async function count(userId) { const t = table(); return t ? (await t.findMany({ where: { userId } })).length : 0; }

  /** send one notification to every device of the user → { sent, removed, failed } */
  async function sendToUser(userId, { title = 'SHERZ', body = '', url = '/', tag = 'sherz', data = {} } = {}) {
    const res = { sent: 0, removed: 0, failed: 0 };
    try {
      if (!ready() || isGuest(userId)) return res;
      const wp = await lazy(); if (!wp) return res;
      const subs = await table().findMany({ where: { userId } });
      const payload = JSON.stringify({ title: clip(title, 60), body: clip(plain(body), 160), url: String(url).startsWith('/') ? url : '/', tag: clip(tag, 40), data });
      await Promise.all(subs.map(async (s) => {
        try {
          await wp.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 60 * 60 * 12, urgency: 'normal' });
          res.sent++;
          await table().update({ where: { endpoint: s.endpoint }, data: { lastUsedAt: new Date() } }).catch(() => {});
        } catch (e) {
          if (e && (e.statusCode === 404 || e.statusCode === 410)) { await table().deleteMany({ where: { endpoint: s.endpoint } }).catch(() => {}); res.removed++; }   // browser says the subscription is gone
          else { res.failed++; log.warn && log.warn('[push] send failed:', e && (e.statusCode || e.message)); }
        }
      }));
    } catch (e) { log.warn && log.warn('[push] skipped:', e.message); }
    return res;
  }

  return { ready, publicKey, subscribe, unsubscribe, count, sendToUser };
}

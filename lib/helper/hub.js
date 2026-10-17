// lib/helper/hub.js — connects approved plans to the user's helper program.
//   pairing : user asks for a one-time code (10 min) → helper exchanges it for a long random device token
//             (only its sha256 is stored) → the token is the helper's only credential, scoped to ONE user.
//   jobs    : server → helper by long-polling (the helper connects OUT; nothing opens on the user's PC).
//   exec()  : used by the approval gate to run one step on the user's device and wait for the result.
// Jobs and pairing codes live in memory (single server instance). Devices are persisted (Prisma) so a restart
// doesn't force re-pairing; a memory fallback is used until `prisma db push` has created the table.
import crypto from 'node:crypto';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const CODE_TTL_MS = 10 * 60 * 1000;
export const ONLINE_MS = 40 * 1000;
export const POLL_MS = 25 * 1000;

export function memoryDevices() {
  const rows = new Map();
  return {
    async create(d) { const r = { id: 'dev_' + crypto.randomBytes(5).toString('hex'), createdAt: new Date().toISOString(), lastSeenAt: null, revokedAt: null, ...d }; rows.set(r.id, r); return { ...r }; },
    async byTokenHash(h) { return [...rows.values()].find((r) => r.tokenHash === h && !r.revokedAt) || null; },
    async listForUser(userId) { return [...rows.values()].filter((r) => r.userId === userId && !r.revokedAt).map((r) => ({ ...r })); },
    async touch(id) { const r = rows.get(id); if (r) r.lastSeenAt = new Date().toISOString(); },
    async revoke(id, userId) { const r = rows.get(id); if (!r || r.userId !== userId) return false; r.revokedAt = new Date().toISOString(); return true; },
  };
}
export function prismaDevices(prisma) {
  const m = () => prisma.helperDevice;
  return {
    create: (d) => m().create({ data: d }),
    byTokenHash: (h) => m().findFirst({ where: { tokenHash: h, revokedAt: null } }),
    listForUser: (userId) => m().findMany({ where: { userId, revokedAt: null }, orderBy: { createdAt: 'desc' } }),
    touch: (id) => m().update({ where: { id }, data: { lastSeenAt: new Date() } }).catch(() => {}),
    async revoke(id, userId) { const r = await m().updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() } }); return r.count === 1; },
  };
}

export function createHub({ devices = memoryDevices(), now = () => Date.now(), pollMs = POLL_MS } = {}) {
  const codes = new Map();                 // code → { userId, exp }
  const seen = new Map();                  // deviceId → last poll time (fast path; DB is touched too)
  const queues = new Map();                // deviceId → [job]
  const waiters = new Map();               // deviceId → resolve fn of the pending long-poll
  const pending = new Map();               // jobId → { resolve, reject, timer, deviceId }

  function newCode() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const pick = (n) => Array.from(crypto.randomBytes(n), (b) => A[b % A.length]).join('');
    return `${pick(4)}-${pick(4)}`;
  }

  async function createPairCode(userId) {
    for (const [c, v] of codes) if (v.exp < now()) codes.delete(c);
    const code = newCode();
    codes.set(code, { userId, exp: now() + CODE_TTL_MS, tries: 0 });
    return { code, expiresInSec: CODE_TTL_MS / 1000 };
  }

  async function pair(code, name) {
    const key = String(code || '').trim().toUpperCase();
    const c = codes.get(key);
    if (!c || c.exp < now()) return { ok: false, error: 'code is invalid or expired — type /helper again' };
    codes.delete(key);                                      // single use
    const token = 'shd_' + crypto.randomBytes(32).toString('base64url');
    const d = await devices.create({ userId: c.userId, name: String(name || 'my computer').slice(0, 60), tokenHash: sha(token) });
    seen.set(d.id, now());
    return { ok: true, token, deviceId: d.id };
  }

  async function auth(token) {
    if (!token || !String(token).startsWith('shd_')) return null;
    return devices.byTokenHash(sha(String(token)));
  }

  /** Long-poll: resolves with the next job for this device, or null after POLL_MS. */
  async function poll(device, wait = pollMs) {
    seen.set(device.id, now()); devices.touch(device.id);
    const q = queues.get(device.id) || [];
    if (q.length) return q.shift();
    return new Promise((resolve) => {
      const old = waiters.get(device.id); if (old) old(null);             // a newer poll replaces a stale one
      const t = setTimeout(() => { waiters.delete(device.id); resolve(null); }, wait);
      waiters.set(device.id, (job) => { clearTimeout(t); waiters.delete(device.id); resolve(job); });
    });
  }

  function result(device, { jobId, ok, output, error }) {
    const p = pending.get(jobId);
    if (!p || p.deviceId !== device.id) return false;      // a device can only answer ITS OWN jobs
    clearTimeout(p.timer); pending.delete(jobId);
    ok ? p.resolve(output ?? {}) : p.reject(new Error(String(error || 'helper reported an error').slice(0, 300)));
    return true;
  }

  async function onlineDevices(userId) {
    return (await devices.listForUser(userId)).filter((d) => (seen.get(d.id) || 0) > now() - ONLINE_MS);
  }
  async function online(userId) { return (await onlineDevices(userId)).length > 0; }

  async function exec(userId, tool, args, { timeoutMs = 30000 } = {}) {
    const dev = (await onlineDevices(userId))[0];
    if (!dev) throw new Error('your helper is not connected — type /helper in the chat and start it on your computer');
    const job = { id: 'job_' + crypto.randomBytes(6).toString('hex'), tool, args };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(job.id); reject(new Error('the helper did not answer in time')); }, timeoutMs);
      pending.set(job.id, { resolve, reject, timer, deviceId: dev.id });
      const w = waiters.get(dev.id);
      if (w) w(job); else (queues.get(dev.id) || queues.set(dev.id, []).get(dev.id)).push(job);
    });
  }

  async function list(userId) {
    return (await devices.listForUser(userId)).map((d) => ({ id: d.id, name: d.name, online: (seen.get(d.id) || 0) > now() - ONLINE_MS, lastSeenAt: d.lastSeenAt, createdAt: d.createdAt }));
  }
  async function revoke(userId, id) {
    const ok = await devices.revoke(id, userId);
    if (ok) { seen.delete(id); const w = waiters.get(id); if (w) w(null); queues.delete(id); }
    return ok;
  }

  return { createPairCode, pair, auth, poll, result, exec, online, list, revoke };
}

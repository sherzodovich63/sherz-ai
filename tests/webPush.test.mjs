import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebPush } from '../lib/webPush.js';
import { pushRouter } from '../routes/push.js';

const ENV = { VAPID_PUBLIC_KEY: 'BPUB', VAPID_PRIVATE_KEY: 'PRIV', VAPID_SUBJECT: 'mailto:a@b.co' };
function fakePrisma() {
  const rows = []; let n = 0;
  const match = (r, w = {}) => Object.entries(w).every(([k, v]) => (v && v.in ? v.in.includes(r[k]) : r[k] === v));
  return { rows, pushSubscription: {
    findMany: async ({ where } = {}) => rows.filter((r) => match(r, where)),
    upsert: async ({ where, create, update }) => { const r = rows.find((x) => x.endpoint === where.endpoint); if (r) Object.assign(r, update); else rows.push({ id: 'p' + (++n), createdAt: new Date(n * 1000), ...create }); },
    deleteMany: async ({ where }) => { let c = 0; for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], where)) { rows.splice(i, 1); c++; } return { count: c }; },
    update: async ({ where, data }) => { Object.assign(rows.find((x) => x.endpoint === where.endpoint), data); },
  } };
}
const sub = (i) => ({ endpoint: 'https://push.example.com/send/' + 'x'.repeat(20) + i, keys: { p256dh: 'k' + i, auth: 'a' + i } });
const quiet = { warn() {}, error() {} };

test('not ready without keys or table; sends are harmless no-ops', async () => {
  assert.equal(createWebPush({ prisma: fakePrisma(), env: {} }).ready(), false);
  assert.equal(createWebPush({ prisma: {}, env: ENV }).ready(), false);
  const s = createWebPush({ prisma: fakePrisma(), env: {} });
  assert.deepEqual(await s.sendToUser('u1', { body: 'x' }), { sent: 0, removed: 0, failed: 0 });
  assert.equal(s.publicKey(), '');
});

test('subscribe validates, rejects guests, and re-subscribing moves the same endpoint', async () => {
  const prisma = fakePrisma(), s = createWebPush({ prisma, env: ENV, webpush: {}, log: quiet });
  await assert.rejects(() => s.subscribe('guest_1', sub(1)), /Sign in/);
  await assert.rejects(() => s.subscribe('u1', { endpoint: 'http://insecure.example/x', keys: { p256dh: 'a', auth: 'b' } }), /Invalid/);
  await assert.rejects(() => s.subscribe('u1', { endpoint: sub(1).endpoint, keys: {} }), /Invalid/);
  await s.subscribe('u1', sub(1)); await s.subscribe('u1', sub(1)); await s.subscribe('u2', sub(1));
  assert.equal(prisma.rows.length, 1); assert.equal(prisma.rows[0].userId, 'u2');
});

test('keeps at most 10 devices per user (oldest dropped)', async () => {
  const prisma = fakePrisma(), s = createWebPush({ prisma, env: ENV, webpush: {}, log: quiet });
  for (let i = 0; i < 12; i++) await s.subscribe('u1', sub(i));
  assert.equal(await s.count('u1'), 10);
  assert.ok(prisma.rows.some((r) => r.endpoint === sub(11).endpoint)); assert.ok(!prisma.rows.some((r) => r.endpoint === sub(0).endpoint));
});

test('sendToUser: delivers, trims the text, removes gone (404/410) subscriptions, counts other failures', async () => {
  const prisma = fakePrisma(), calls = [];
  const webpush = { setVapidDetails() {}, sendNotification: async (s, payload) => { calls.push(JSON.parse(payload)); if (s.endpoint.endsWith('x1')) { const e = new Error('gone'); e.statusCode = 410; throw e; } if (s.endpoint.endsWith('x2')) { const e = new Error('boom'); e.statusCode = 500; throw e; } } };
  const s = createWebPush({ prisma, env: ENV, webpush, log: quiet });
  for (const i of [0, 1, 2]) await s.subscribe('u1', sub(i));
  const r = await s.sendToUser('u1', { body: 'b'.repeat(400), url: 'https://evil.example' });
  assert.deepEqual(r, { sent: 1, removed: 1, failed: 1 });
  assert.ok(calls[0].body.length <= 160); assert.equal(calls[0].url, '/');          // only same-site links
  assert.equal(await s.count('u1'), 2);
});

test('unsubscribe removes one device or all', async () => {
  const prisma = fakePrisma(), s = createWebPush({ prisma, env: ENV, webpush: {}, log: quiet });
  await s.subscribe('u1', sub(1)); await s.subscribe('u1', sub(2)); await s.subscribe('u2', sub(3));
  assert.equal(await s.unsubscribe('u1', sub(1).endpoint), 1);
  assert.equal(await s.unsubscribe('u1'), 1); assert.equal(await s.count('u2'), 1);
});

test('routes: status / subscribe / unsubscribe / test / native register', async () => {
  const prisma = fakePrisma(), sent = [];
  const service = createWebPush({ prisma, env: ENV, webpush: { setVapidDetails() {}, sendNotification: async () => { sent.push(1); } }, log: quiet });
  const router = pushRouter({ service, isProd: true });
  const call = (method, path, body, user = { id: 'u1' }) => new Promise((resolve) => {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    layer.route.stack[0].handle({ user, body, query: {}, get: () => 'UA' }, res);
  });
  assert.equal((await call('get', '/status', {}, null)).code, 401);
  const st = (await call('get', '/status')).body; assert.equal(st.available, true); assert.equal(st.publicKey, 'BPUB'); assert.equal(st.devices, 0);
  assert.equal((await call('post', '/subscribe', { subscription: { endpoint: 'x' } })).code, 400);
  assert.equal((await call('post', '/subscribe', { subscription: sub(1) })).body.devices, 1);
  assert.equal((await call('post', '/test')).body.sent, 1); assert.equal(sent.length, 1);
  assert.equal((await call('post', '/unsubscribe', {})).body.devices, 0);
  assert.equal((await call('post', '/register', { token: 't' })).code, 501);
  const off = pushRouter({ service: createWebPush({ prisma, env: {} }), isProd: true });
  const l = off.stack.find((x) => x.route && x.route.path === '/subscribe');
  const out = await new Promise((resolve) => l.route.stack[0].handle({ user: { id: 'u1' }, body: { subscription: sub(1) }, query: {}, get: () => '' }, { status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, b }); } }));
  assert.equal(out.code, 503);
});

test('proactive runner: push hook is exported and fires only on the delivery path (after the kill switch + send guard)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../proactive/proactiveRunner.js', import.meta.url), 'utf8');
  assert.match(src, /export function setPushNotifier/);
  const fn = src.slice(src.indexOf('async function deliverProactiveToUser'));
  assert.ok(fn.indexOf('killSwitchEngaged') < fn.indexOf('pushNotifier('));
  assert.ok(fn.indexOf('checkProactiveSend') < fn.indexOf('pushNotifier('));
  assert.ok(fn.indexOf('ssePushToUser(') < fn.indexOf('pushNotifier('));
});

test('push body is plain text: chat formatting is stripped', async () => {
  const p = fakePrisma(); const sent = [];
  const svc = createWebPush({ prisma: p, env: ENV, webpush: { setVapidDetails() {}, sendNotification: async (_s, payload) => { sent.push(JSON.parse(payload)); } } });
  await svc.subscribe('user_1', sub(1));
  await svc.sendToUser('user_1', { body: '**Hey** — see [this link](https://x.co) and `code`\n- item\n# Title' });
  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0].body, /[*`#]|\]\(|https:/);
  assert.match(sent[0].body, /Hey/); assert.match(sent[0].body, /this link/);
});

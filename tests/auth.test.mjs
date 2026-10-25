import { test } from 'node:test';
import assert from 'node:assert/strict';
import { googleLogin } from '../lib/googleLogin.js';
import { mergeGuestIntoUser, purgeStaleGuests, isGuestId } from '../lib/guestMerge.js';

// tiny in-memory prisma: users, messages, facts, todo
function mkPrisma(seed = {}) {
  const db = { users: [...(seed.users || [])], messages: [...(seed.messages || [])], facts: [...(seed.facts || [])], todo: [...(seed.todo || [])] };
  let n = 0;
  const match = (row, where) => Object.entries(where).every(([k, v]) =>
    v && typeof v === 'object' ? (v.startsWith ? String(row[k]).startsWith(v.startsWith) : v.lt ? row[k] < v.lt : true) : row[k] === v);
  const tx = {
    user: {
      findUnique: async ({ where }) => db.users.find((u) => match(u, where)) || null,
      findMany: async ({ where }) => db.users.filter((u) => match(u, where)),
      create: async ({ data }) => { const u = { id: 'u_' + ++n, passwordHash: null, avatarUrl: null, ...data }; db.users.push(u); return u; },
      update: async ({ where, data }) => Object.assign(db.users.find((u) => u.id === where.id), data),
      deleteMany: async ({ where }) => { const b = db.users.length; db.users = db.users.filter((u) => !match(u, where)); return { count: b - db.users.length }; },
    },
    message: { updateMany: async ({ where, data }) => { const r = db.messages.filter((m) => match(m, where)); r.forEach((m) => Object.assign(m, data)); return { count: r.length }; } },
    fact: { updateMany: async ({ where, data }) => { const r = db.facts.filter((m) => match(m, where)); r.forEach((m) => Object.assign(m, data)); return { count: r.length }; } },
    todo: { deleteMany: async ({ where }) => { db.todo = db.todo.filter((t) => !match(t, where)); return {}; } },
  };
  return { db, ...tx, $transaction: async (fn) => fn(tx) };
}
const GOOD = { sub: 'g-1', email: 'Bek@Example.com', email_verified: true, name: 'Bek', picture: 'http://p' };
const login = (prisma, over = {}, payload = GOOD) => googleLogin({
  prisma, signJwt: (p) => 'jwt.' + p.id, credential: 'x'.repeat(30), verifyIdToken: async () => payload, ...over,
});

test('new Google user is created with lowercased email and a token', async () => {
  const p = mkPrisma();
  const r = await login(p);
  assert.equal(r.status, 200);
  assert.equal(p.db.users[0].email, 'bek@example.com');
  assert.ok(r.body.token.startsWith('jwt.'));
  assert.ok(!('passwordHash' in r.body.user));
});

test('rejects bad/unverified/missing tokens', async () => {
  const p = mkPrisma();
  assert.equal((await login(p, { credential: 'short' })).status, 400);
  assert.equal((await login(p, { verifyIdToken: async () => { throw new Error('bad aud'); } })).status, 401);
  assert.equal((await login(p, {}, { ...GOOD, email_verified: false })).status, 403);
  assert.equal((await login(p, {}, { sub: 'g', email_verified: true })).status, 401);
  assert.equal(p.db.users.length, 0);
});

test('linking an email/password account clears its password (pre-hijack guard)', async () => {
  const p = mkPrisma({ users: [{ id: 'u_old', email: 'bek@example.com', passwordHash: 'HASH', googleId: null, name: 'Old' }] });
  const r = await login(p);
  assert.equal(r.status, 200);
  assert.equal(p.db.users[0].googleId, 'g-1');
  assert.equal(p.db.users[0].passwordHash, null);
  assert.equal(p.db.users.length, 1);
});

test('email already linked to a different Google account -> 409', async () => {
  const p = mkPrisma({ users: [{ id: 'u1', email: 'bek@example.com', googleId: 'other' }] });
  assert.equal((await login(p)).status, 409);
});

test('guest session merges chat + facts into the account, guest is removed', async () => {
  const p = mkPrisma({
    users: [{ id: 'guest_abc', name: 'Guest' }, { id: 'guest_zzz', name: 'Guest' }],
    messages: [{ id: 1, userId: 'guest_abc' }, { id: 2, userId: 'guest_abc' }, { id: 3, userId: 'guest_zzz' }],
    facts: [{ id: 1, userId: 'guest_abc' }],
    todo: [{ id: 1, userId: 'guest_abc' }],
  });
  const r = await login(p, { guestId: 'guest_abc' });
  const uid = r.body.user.id;
  assert.deepEqual(r.body.merged, { messages: 2, facts: 1 });
  assert.equal(p.db.messages.filter((m) => m.userId === uid).length, 2);
  assert.equal(p.db.messages.find((m) => m.id === 3).userId, 'guest_zzz', 'other guests untouched');
  assert.ok(!p.db.users.some((u) => u.id === 'guest_abc'));
  assert.equal(p.db.todo.length, 0, 'loose guest rows removed, not migrated');
});

test('merge failure never blocks login', async () => {
  const p = mkPrisma({ users: [{ id: 'guest_abc' }] });
  p.$transaction = async () => { throw new Error('db'); };
  const r = await login(p, { guestId: 'guest_abc' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.merged, { error: true });
});

test('mergeGuestIntoUser refuses non-guest source and guest/self target', async () => {
  const p = mkPrisma();
  await assert.rejects(() => mergeGuestIntoUser(p, 'real_user', 'u1'));
  await assert.rejects(() => mergeGuestIntoUser(p, 'guest_a', 'guest_b'));
  await assert.rejects(() => mergeGuestIntoUser(p, 'guest_a', 'guest_a'));
  assert.ok(isGuestId('guest_x') && !isGuestId('guest_') && !isGuestId(null));
});

test('purgeStaleGuests deletes only old guests', async () => {
  const old = new Date(Date.now() - 72 * 3600_000), fresh = new Date();
  const p = mkPrisma({ users: [{ id: 'guest_old', createdAt: old }, { id: 'guest_new', createdAt: fresh }, { id: 'real', createdAt: old }] });
  const r = await purgeStaleGuests(p, { olderThanHours: 48 });
  assert.equal(r.purged, 1);
  assert.deepEqual(p.db.users.map((u) => u.id).sort(), ['guest_new', 'real']);
});

// ── session persistence: refresh + config-error handling ──
import jwt from 'jsonwebtoken';
import { verifyJwtWithGrace, authRequired } from '../middleware/auth.js';

const SECRET = 'x'.repeat(40);
test('verifyJwtWithGrace accepts a token expired < 30 days, rejects older / forged', () => {
  process.env.JWT_SECRET = SECRET;
  const now = Math.floor(Date.now() / 1000);
  const mk = (age, secret = SECRET) => jwt.sign({ id: 'u1', iat: now - age - 100, exp: now - age }, secret);
  assert.equal(verifyJwtWithGrace(mk(2 * 86400))?.id, 'u1');
  assert.equal(verifyJwtWithGrace(mk(40 * 86400)), null);
  assert.equal(verifyJwtWithGrace(mk(10, 'y'.repeat(40))), null);
});

test('authRequired answers 500 (not 403) when JWT_SECRET is missing, so clients keep their login', () => {
  const saved = process.env.JWT_SECRET; delete process.env.JWT_SECRET;
  let code; const res = { status: (c) => { code = c; return { json: () => {} }; } };
  authRequired({ headers: { authorization: 'Bearer abc.def.ghi' } }, res, () => {});
  process.env.JWT_SECRET = saved;
  assert.equal(code, 500);
});

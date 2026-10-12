import express from 'express';
import assert from 'node:assert/strict';

const GOOD = 'a'.repeat(16) + 'B'.repeat(16) + '0123456789abcdef'; // 48 chars
let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log('  ✅', name); }
  catch (e) { fail++; console.log('  ❌', name, '\n     ', e.message); }
};

// ---- load modules AFTER env is controlled (disabled case first) ----
delete process.env.SHERZ_ADMIN_TOKEN;
delete process.env.SHERZ_KILL_SWITCH;
const killSwitch = await import('./lib/killSwitch.js');
const audit = await import('./lib/adminAudit.js');
const { default: adminRouter } = await import('./routes/admin.js');

// stub prisma that records what was asked of it
const calls = [];
const prisma = {
  brainState: { deleteMany: async (a) => { calls.push(['brainState', a]); return { count: 3 }; } },
  fact: { deleteMany: async (a) => { calls.push(['fact', a]); return { count: 5 }; } },
};
let friendResets = 0;
const runtime = { runner: 'running' };
const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use('/admin', adminRouter({
  prisma,
  getRuntimeStatus: () => ({ ...runtime }),
  resetFriendBrainState: () => { friendResets++; },
}));

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
let ipCounter = 0;
const call = (path, { method = 'GET', token, body, ip } = {}) =>
  fetch(base + '/admin' + path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip || `10.0.0.${++ipCounter}`,
      ...(token ? { 'x-admin-token': token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null), headers: r.headers }));

console.log('\n— fail-closed when not configured —');
await t('no env var → 404 (does not advertise itself)', async () => {
  assert.equal((await call('/status', { token: GOOD })).status, 404);
});
process.env.SHERZ_ADMIN_TOKEN = 'too-short';
await t('token < 32 chars → still 404', async () => {
  assert.equal((await call('/status', { token: 'too-short' })).status, 404);
});

process.env.SHERZ_ADMIN_TOKEN = GOOD;
console.log('\n— authentication —');
await t('no header → 401', async () => assert.equal((await call('/status')).status, 401));
await t('wrong token → 401', async () => assert.equal((await call('/status', { token: GOOD + 'x' })).status, 401));
await t('wrong token, same length → 401', async () => assert.equal((await call('/status', { token: 'z'.repeat(GOOD.length) })).status, 401));
await t('correct token → 200', async () => {
  const r = await call('/status', { token: GOOD });
  assert.equal(r.status, 200); assert.equal(r.json.ok, true);
});
await t('token in query string is NOT accepted', async () => {
  const r = await fetch(`${base}/admin/status?token=${GOOD}`, { headers: { 'x-forwarded-for': '10.9.9.9' } });
  assert.equal(r.status, 401);
});

console.log('\n— brute-force lockout —');
await t('5 failures → 6th attempt locked (429) EVEN WITH the right token', async () => {
  const ip = '203.0.113.7';
  for (let i = 0; i < 5; i++) assert.equal((await call('/status', { token: 'nope', ip })).status, 401);
  const locked = await call('/status', { token: GOOD, ip });
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get('retry-after')) > 0, 'Retry-After header set');
});
await t('lockout is per-IP: a different IP is unaffected', async () => {
  assert.equal((await call('/status', { token: GOOD, ip: '198.51.100.2' })).status, 200);
});

console.log('\n— kill switch —');
const seen = [];
killSwitch.onChange((s) => seen.push(s));
await t('starts disengaged', () => assert.equal(killSwitch.isEngaged('background'), false));
await t('invalid scope → 400', async () => {
  const r = await call('/kill-switch/engage', { method: 'POST', token: GOOD, body: { scopes: ['chat'] } });
  assert.equal(r.status, 400); assert.equal(r.json.error, 'INVALID_SCOPES');
});
await t('empty scopes → 400', async () => {
  assert.equal((await call('/kill-switch/engage', { method: 'POST', token: GOOD, body: { scopes: [] } })).status, 400);
});
await t('engage with no body → both scopes, reason optional (zero friction)', async () => {
  const r = await call('/kill-switch/engage', { method: 'POST', token: GOOD });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.killSwitch.scopes.sort(), ['background', 'expert']);
  assert.equal(killSwitch.isEngaged('background'), true);
  assert.equal(killSwitch.isEngaged('expert'), true);
});
await t('onChange listener fired synchronously on engage', () => assert.equal(seen.length, 1));
await t('disengage clears everything and fires onChange', async () => {
  const r = await call('/kill-switch/disengage', { method: 'POST', token: GOOD });
  assert.equal(r.json.killSwitch.engaged, false);
  assert.equal(killSwitch.isEngaged('expert'), false);
  assert.equal(seen.length, 2);
});
await t('scoped engage: expert only leaves background running', async () => {
  await call('/kill-switch/engage', { method: 'POST', token: GOOD, body: { scopes: ['expert'], reason: 'test' } });
  assert.equal(killSwitch.isEngaged('expert'), true);
  assert.equal(killSwitch.isEngaged('background'), false);
  await call('/kill-switch/disengage', { method: 'POST', token: GOOD });
});
await t('disengaging when already idle does not fire a spurious change', async () => {
  const before = seen.length;
  await call('/kill-switch/disengage', { method: 'POST', token: GOOD });
  assert.equal(seen.length, before);
});

console.log('\n— session reset —');
await t('no userId → 400', async () => assert.equal((await call('/session/reset', { method: 'POST', token: GOOD, body: {} })).status, 400));
await t('all:true without confirm → 400, NOTHING deleted', async () => {
  calls.length = 0;
  const r = await call('/session/reset', { method: 'POST', token: GOOD, body: { all: true } });
  assert.equal(r.status, 400); assert.equal(r.json.error, 'CONFIRM_REQUIRED'); assert.equal(calls.length, 0);
});
await t('wrong confirm string → 400', async () => {
  assert.equal((await call('/session/reset', { method: 'POST', token: GOOD, body: { all: true, confirm: 'yes' } })).status, 400);
});
await t('per-user reset scopes both deletes to that user, and ONLY last_state facts', async () => {
  calls.length = 0; friendResets = 0;
  const r = await call('/session/reset', { method: 'POST', token: GOOD, body: { userId: '  u1  ' } });
  assert.equal(r.status, 200); assert.equal(friendResets, 1);
  assert.deepEqual(calls[0], ['brainState', { where: { userId: 'u1' } }]);
  assert.deepEqual(calls[1], ['fact', { where: { userId: 'u1', key: 'last_state' } }]);
});
await t('global reset with correct confirm → unscoped brainState, still last_state-only facts', async () => {
  calls.length = 0;
  const r = await call('/session/reset', { method: 'POST', token: GOOD, body: { all: true, confirm: 'RESET_ALL' } });
  assert.equal(r.status, 200);
  assert.deepEqual(calls[0], ['brainState', { where: {} }]);
  assert.deepEqual(calls[1], ['fact', { where: { key: 'last_state' } }]);
});
await t('a failing step is reported (207), not swallowed or fatal', async () => {
  const orig = prisma.brainState.deleteMany;
  prisma.brainState.deleteMany = async () => { throw new Error('db down'); };
  const r = await call('/session/reset', { method: 'POST', token: GOOD, body: { userId: 'u2' } });
  prisma.brainState.deleteMany = orig;
  assert.equal(r.status, 207); assert.equal(r.json.ok, false);
  assert.equal(r.json.steps.find((s) => s.label === 'brainStateRows').ok, false);
  assert.equal(r.json.steps.find((s) => s.label === 'lastStateFacts').ok, true, 'later steps still ran');
});

console.log('\n— audit trail —');
await t('audit records actions and NEVER contains the token', async () => {
  const r = await call('/audit?limit=200', { token: GOOD });
  const actions = r.json.events.map((e) => e.action);
  for (const a of ['auth_failed', 'kill_switch_engage', 'kill_switch_disengage', 'session_reset']) assert.ok(actions.includes(a), `missing ${a}`);
  assert.ok(!JSON.stringify(r.json).includes(GOOD), 'token leaked into audit output');
});
await t('audit scrubs any "token"-named detail key', () => {
  const e = audit.recordAdminEvent({ action: 'x', details: { adminToken: 'secret', keep: 1 } });
  assert.equal(e.details.adminToken, undefined); assert.equal(e.details.keep, 1);
});

server.close();

console.log('\n— boot-time kill switch (env) —');
const boot = await import('./lib/killSwitch.js?boot=1').catch(() => null);
// ESM caches by URL, so verify env boot in a clean child process instead
const { execFileSync } = await import('node:child_process');
const out = execFileSync(process.execPath, ['-e',
  `import('./lib/killSwitch.js').then(m=>console.log(JSON.stringify([m.isEngaged('background'),m.isEngaged('expert'),m.getState().engagedBy])))`],
  { env: { ...process.env, SHERZ_KILL_SWITCH: '1' }, cwd: process.cwd() }).toString().trim();
await t('SHERZ_KILL_SWITCH=1 boots engaged on all scopes', () => assert.equal(out, '[true,true,"env"]'));
const out2 = execFileSync(process.execPath, ['-e',
  `import('./lib/killSwitch.js').then(m=>console.log(JSON.stringify(m.isEngaged('background'))))`],
  { env: { ...process.env, SHERZ_KILL_SWITCH: '' }, cwd: process.cwd() }).toString().trim();
await t('unset/empty env boots disengaged', () => assert.equal(out2, 'false'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

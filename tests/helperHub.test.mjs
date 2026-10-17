import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createHub } from '../lib/helper/hub.js';
import { helperRouter } from '../routes/helper.js';
import { agentRouter } from '../routes/agent.js';
import { createGate } from '../lib/agent/gate.js';
import { memoryStore } from '../lib/agent/store.js';
import { openRoot } from '../helper/fsTools.mjs';
import { runHelper } from '../helper/sherz-helper.mjs';

process.env.SHERZ_AGENT_SANDBOX = await fs.mkdtemp(path.join(os.tmpdir(), 'sherz-sb-'));

async function boot({ pollMs = 300 } = {}) {
  const hub = createHub({ pollMs });
  const gate = createGate({ store: memoryStore(), helper: hub, log: { warn() {} } });
  const app = express(); app.use(express.json());
  app.use((req, _r, n) => { const u = req.headers['x-user']; if (u) req.user = { id: u }; n(); });
  app.use('/api/helper', helperRouter({ hub, isProd: true }));
  app.use('/api/agent', agentRouter({ gate, isProd: true }));
  const srv = app.listen(0); const server = `http://localhost:${srv.address().port}`;
  const call = async (p, { method = 'GET', user, body, token } = {}) => {
    const r = await fetch(server + p, { method, headers: { 'content-type': 'application/json', ...(user ? { 'x-user': user } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const t = await r.text(); return { s: r.status, j: t ? JSON.parse(t) : null };
  };
  return { hub, gate, server, srv, call };
}
async function pairHelper(env, user) {
  const { j } = await env.call('/api/helper/pair-code', { method: 'POST', user });
  const p = await env.call('/api/helper/d/pair', { method: 'POST', body: { code: j.code, name: 'test pc' } });
  return p.j.token;
}
async function startHelper(env, token, folder) {
  const root = await openRoot(folder); const stop = { stopped: false };
  const done = runHelper({ server: env.server, token, root, stop, quiet: true });
  return { root, stop, done };
}
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'sherz-h-'));
const plan = (steps) => ({ title: 'T', steps });
const propose = async (env, user, steps) => (await env.call('/api/agent/propose', { method: 'POST', user, body: plan(steps) })).j.action;
const approve = (env, user, a) => env.call(`/api/agent/${a.id}/approve`, { method: 'POST', user, body: { planHash: a.planHash } });

test('pairing: code is single-use, wrong/expired code rejected, token only works as a device', async () => {
  const env = await boot();
  const { j } = await env.call('/api/helper/pair-code', { method: 'POST', user: 'alice' });
  assert.match(j.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal((await env.call('/api/helper/d/pair', { method: 'POST', body: { code: 'AAAA-AAAA' } })).s, 400);
  const ok = await env.call('/api/helper/d/pair', { method: 'POST', body: { code: j.code.toLowerCase(), name: 'pc' } });
  assert.equal(ok.s, 200); assert.match(ok.j.token, /^shd_/);
  assert.equal((await env.call('/api/helper/d/pair', { method: 'POST', body: { code: j.code } })).s, 400);   // used
  assert.equal((await env.call('/api/helper/d/poll')).s, 401);                                              // no token
  assert.equal((await env.call('/api/helper/d/poll', { token: 'shd_fake' })).s, 401);
  assert.equal((await env.call('/api/helper/d/poll', { token: ok.j.token })).s, 204);                       // valid, idle
  env.srv.close();
});
test('pair-code needs a logged-in user (prod)', async () => {
  const env = await boot();
  assert.equal((await env.call('/api/helper/pair-code', { method: 'POST' })).s, 401);
  env.srv.close();
});
test('END-TO-END: approved plan runs on the helper; files appear only after approval', async () => {
  const env = await boot(); const folder = await tmp();
  const token = await pairHelper(env, 'alice'); const h = await startHelper(env, token, folder);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal((await env.call('/api/helper/status', { user: 'alice' })).j.devices[0].online, true);
  const a = await propose(env, 'alice', [{ tool: 'files.mkdir', args: { path: 'proj' } }, { tool: 'files.write', args: { path: 'proj/ideas.md', content: '1. a\n2. b\n3. c' } }, { tool: 'files.list', args: { path: 'proj' } }]);
  assert.equal(a.risk, 'medium'); assert.ok(a.steps.every((s) => s.target === 'helper'));
  await assert.rejects(fs.access(path.join(folder, 'proj')));                                  // nothing before approval
  const r = await approve(env, 'alice', a);
  assert.equal(r.s, 200, JSON.stringify(r.j)); assert.equal(r.j.action.status, 'executed');
  assert.equal(await fs.readFile(path.join(folder, 'proj/ideas.md'), 'utf8'), '1. a\n2. b\n3. c');
  assert.deepEqual(r.j.action.results[2].output.entries.map((e) => e.name), ['ideas.md']);
  h.stop.stopped = true; env.srv.close();
});
test('helper offline → approve is refused up-front and the plan stays pending', async () => {
  const env = await boot();
  const a = await propose(env, 'bob', [{ tool: 'files.write', args: { path: 'x.txt', content: 'x' } }]);
  const r = await approve(env, 'bob', a);
  assert.equal(r.s, 409); assert.match(r.j.error, /helper is not connected/);
  assert.equal((await env.call('/api/agent/pending', { user: 'bob' })).j.actions.length, 1);
  env.srv.close();
});
test('helper refuses an unsafe step even if the server let it through → plan fails, later steps skipped', async () => {
  const env = await boot(); const folder = await tmp();
  const token = await pairHelper(env, 'carol'); const h = await startHelper(env, token, folder);
  const a = await propose(env, 'carol', [{ tool: 'files.write', args: { path: 'ok.txt', content: '1' } }, { tool: 'files.delete', args: { path: 'missing.txt' } }, { tool: 'files.write', args: { path: 'after.txt', content: '2' } }]);
  const r = await approve(env, 'carol', a);
  assert.equal(r.j.action.status, 'failed'); assert.deepEqual(r.j.action.results.map((x) => x.status), ['ok', 'error', 'skipped']);
  assert.match(r.j.action.results[1].error, /does not exist/);
  await assert.rejects(fs.access(path.join(folder, 'after.txt')));
  h.stop.stopped = true; env.srv.close();
});
test('server rejects bad paths at propose time (defence in depth)', async () => {
  const env = await boot();
  for (const p of ['../x', '/etc/passwd', 'C:\\x', '.sherz-trash/a']) {
    const r = await env.call('/api/agent/propose', { method: 'POST', user: 'dan', body: plan([{ tool: 'files.read', args: { path: p } }]) });
    assert.equal(r.s, 400, p);
  }
  assert.equal((await env.call('/api/agent/propose', { method: 'POST', user: 'dan', body: plan([{ tool: 'files.write', args: { path: 'a', content: 'x', overwrite: 'yes' } }]) })).s, 400);
  env.srv.close();
});
test('isolation: a helper only receives its own user’s jobs; a device cannot answer others’ jobs', async () => {
  const env = await boot(); const fa = await tmp(), fb = await tmp();
  const ta = await pairHelper(env, 'ann'), tb = await pairHelper(env, 'ben');
  const ha = await startHelper(env, ta, fa), hb = await startHelper(env, tb, fb);
  const a = await propose(env, 'ann', [{ tool: 'files.write', args: { path: 'for-ann.txt', content: 'A' } }]);
  assert.equal((await approve(env, 'ann', a)).j.action.status, 'executed');
  assert.equal(await fs.readFile(path.join(fa, 'for-ann.txt'), 'utf8'), 'A');
  await assert.rejects(fs.access(path.join(fb, 'for-ann.txt')));
  assert.equal((await approve(env, 'ben', a)).s, 404);                                          // ben cannot approve ann's plan
  assert.equal((await env.call('/api/helper/d/result', { method: 'POST', token: tb, body: { jobId: 'job_x', ok: true } })).j.ok, false);
  ha.stop.stopped = true; hb.stop.stopped = true; env.srv.close();
});
test('revoking a device cuts it off immediately', async () => {
  const env = await boot(); const folder = await tmp();
  const token = await pairHelper(env, 'eve'); const h = await startHelper(env, token, folder);
  await new Promise((r) => setTimeout(r, 400));
  const id = (await env.call('/api/helper/status', { user: 'eve' })).j.devices[0].id;
  assert.equal((await env.call(`/api/helper/devices/${id}`, { method: 'DELETE', user: 'someone-else' })).j.ok, false);
  assert.equal((await env.call(`/api/helper/devices/${id}`, { method: 'DELETE', user: 'eve' })).j.ok, true);
  assert.equal(await h.done, 'revoked');
  assert.equal((await env.call('/api/helper/d/poll', { token })).s, 401);
  env.srv.close();
});
test('helper that never answers → step times out with a clear error', async () => {
  const hub = createHub({ pollMs: 100 });
  const { code } = await hub.createPairCode('zed'); const { token } = await hub.pair(code, 'pc');
  const dev = await hub.auth(token); await hub.poll(dev, 10);                                     // looks online, but never answers
  await assert.rejects(hub.exec('zed', 'files.list', { path: '.' }, { timeoutMs: 200 }), /did not answer/);
});

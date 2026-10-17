import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const SB = await fs.mkdtemp(path.join(os.tmpdir(), 'sherz-agent-'));
process.env.SHERZ_AGENT_SANDBOX = SB;
const { createGate, hashPlan, PENDING_TTL_MS } = await import('../lib/agent/gate.js');
const { memoryStore } = await import('../lib/agent/store.js');
const { normalizePlan } = await import('../lib/agent/registry.js');
const { handleProposeCall, agentToolSchemas } = await import('../lib/agent/expertBridge.js');
const { agentRouter } = await import('../routes/agent.js');

const mk = (extra = {}) => { const store = memoryStore(); return { store, gate: createGate({ store, log: { warn() {} }, ...extra }) }; };
const note = (filename, content = 'hi') => ({ tool: 'sandbox.write_note', args: { filename, content } });
const exists = (u, f) => fs.access(path.join(SB, u, f)).then(() => true, () => false);

test('propose stores a pending plan and runs NOTHING', async () => {
  const { gate } = mk();
  const a = await gate.propose({ userId: 'u1', title: 'T', steps: [note('a.md')] });
  assert.equal(a.status, 'pending'); assert.equal(a.risk, 'low'); assert.ok(a.planHash);
  assert.equal(await exists('u1', 'a.md'), false);
});
test('approve executes, writes the file, returns per-step results', async () => {
  const { gate } = mk();
  const a = await gate.propose({ userId: 'u2', title: 'T', steps: [note('b.md', 'salom')] });
  const r = await gate.approve({ userId: 'u2', id: a.id, planHash: a.planHash });
  assert.ok(r.ok); assert.equal(r.action.status, 'executed'); assert.equal(r.action.results[0].status, 'ok');
  assert.equal(await fs.readFile(path.join(SB, 'u2', 'b.md'), 'utf8'), 'salom');
});
test('approve needs the exact hash the user saw; edit changes the hash', async () => {
  const { gate } = mk();
  const a = await gate.propose({ userId: 'u3', title: 'T', steps: [note('c.md', 'one')] });
  assert.equal((await gate.approve({ userId: 'u3', id: a.id })).code, 409);
  assert.equal((await gate.approve({ userId: 'u3', id: a.id, planHash: 'nope' })).code, 409);
  const e = await gate.edit({ userId: 'u3', id: a.id, steps: [note('c.md', 'two')] });
  assert.ok(e.ok); assert.notEqual(e.action.planHash, a.planHash); assert.equal(e.action.edited, true);
  assert.equal((await gate.approve({ userId: 'u3', id: a.id, planHash: a.planHash })).code, 409);   // stale approval is void
  assert.equal(await exists('u3', 'c.md'), false);
  assert.ok((await gate.approve({ userId: 'u3', id: a.id, planHash: e.action.planHash })).ok);
  assert.equal(await fs.readFile(path.join(SB, 'u3', 'c.md'), 'utf8'), 'two');
});
test('double-click / concurrent approve runs exactly once', async () => {
  const { gate } = mk();
  const a = await gate.propose({ userId: 'u4', title: 'T', steps: [note('d.md')] });
  const rs = await Promise.all([1, 2, 3].map(() => gate.approve({ userId: 'u4', id: a.id, planHash: a.planHash })));
  assert.equal(rs.filter((r) => r.ok).length, 1);
});
test('reject closes the plan; cannot approve afterwards', async () => {
  const { gate } = mk();
  const a = await gate.propose({ userId: 'u5', title: 'T', steps: [note('e.md')] });
  assert.ok((await gate.reject({ userId: 'u5', id: a.id, reason: 'no' })).ok);
  assert.equal((await gate.approve({ userId: 'u5', id: a.id, planHash: a.planHash })).code, 409);
  assert.equal(await exists('u5', 'e.md'), false);
});
test('users cannot see or approve each other’s plans', async () => {
  const { gate } = mk();
  const a = await gate.propose({ userId: 'alice', title: 'T', steps: [note('f.md')] });
  assert.equal((await gate.approve({ userId: 'bob', id: a.id, planHash: a.planHash })).code, 404);
  assert.equal((await gate.listPending('bob')).length, 0);
  assert.equal((await gate.listPending('alice')).length, 1);
});
test('validation: unknown tool, traversal, bad extension, too many steps, oversized content', () => {
  assert.throws(() => normalizePlan([{ tool: 'shell.run', args: { cmd: 'rm -rf /' } }]), /unknown action/);
  for (const f of ['../x.md', '/etc/passwd', 'a/b.md', '.hidden.md', 'x.sh', 'x.md\0', '']) assert.throws(() => normalizePlan([note(f)]), /filename/, f);
  assert.throws(() => normalizePlan(Array(9).fill(note('a.md'))), /at most/);
  assert.throws(() => normalizePlan([note('a.md', 'x'.repeat(21000))]), /too long/);
  assert.throws(() => normalizePlan([]), /at least one/);
});
test('a failing step stops the plan and skips the rest', async () => {
  const { gate } = mk();
  const a = await gate.propose({ userId: 'u6', title: 'T', steps: [{ tool: 'sandbox.delete_note', args: { filename: 'missing.md' } }, note('g.md')] });
  assert.equal(a.risk, 'medium');
  const r = await gate.approve({ userId: 'u6', id: a.id, planHash: a.planHash });
  assert.equal(r.action.status, 'failed'); assert.deepEqual(r.action.results.map((x) => x.status), ['error', 'skipped']);
  assert.equal(await exists('u6', 'g.md'), false);
});
test('expired plans cannot be approved', async () => {
  const { gate, store } = mk();
  const a = await gate.propose({ userId: 'u7', title: 'T', steps: [note('h.md')] });
  store._rows.get(a.id).createdAt = new Date(Date.now() - PENDING_TTL_MS - 1000).toISOString();
  assert.equal((await gate.approve({ userId: 'u7', id: a.id, planHash: a.planHash })).code, 410);
  assert.equal((await gate.listPending('u7')).length, 0);
});
test('kill switch pauses execution', async () => {
  let halted = true; const { gate } = mk({ isHalted: () => halted });
  const a = await gate.propose({ userId: 'u8', title: 'T', steps: [note('i.md')] });
  assert.equal((await gate.approve({ userId: 'u8', id: a.id, planHash: a.planHash })).code, 503);
  halted = false;
  assert.ok((await gate.approve({ userId: 'u8', id: a.id, planHash: a.planHash })).ok);
});
test('hashPlan is order-independent for object keys but sensitive to content', () => {
  assert.equal(hashPlan([{ tool: 't', args: { a: 1, b: 2 } }]), hashPlan([{ tool: 't', args: { b: 2, a: 1 } }]));
  assert.notEqual(hashPlan([{ tool: 't', args: { a: 1 } }]), hashPlan([{ tool: 't', args: { a: 2 } }]));
});
test('model bridge only proposes; bad plans return an error to the model', async () => {
  const { gate } = mk();
  const ok = await handleProposeCall({ gate, userId: 'u9', conversationId: 'c1', args: { title: 'x', steps: [note('j.md')] } });
  assert.equal(ok.toolResult.status, 'awaiting_user_approval'); assert.equal(ok.plan.source, 'assistant'); assert.equal(await exists('u9', 'j.md'), false);
  const bad = await handleProposeCall({ gate, userId: 'u9', args: { title: 'x', steps: [{ tool: 'rm' }] } });
  assert.equal(bad.toolResult.ok, false); assert.equal(bad.plan, null);
  assert.equal(agentToolSchemas()[0].function.name, 'propose_action_plan');
});
test('HTTP: propose → pending → edit → approve; dev fallback user; bad input 400', async () => {
  const { gate } = mk(); const app = express(); app.use(express.json());
  app.use((req, _r, n) => { const u = req.headers['x-user']; if (u) req.user = { id: u }; n(); });
  app.use('/api/agent', agentRouter({ gate, isProd: false }));
  const s = app.listen(0); after(() => s.close()); const base = `http://localhost:${s.address().port}/api/agent`;
  const call = async (p, m = 'GET', b, user = 'http1') => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', 'x-user': user }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, j: await r.json() }; };
  const p = await call('/propose', 'POST', { title: 'T', steps: [note('k.md', 'v1')] });
  assert.equal(p.s, 201);
  assert.equal((await call('/pending')).j.actions.length, 1);
  assert.equal((await call('/pending', 'GET', null, 'other')).j.actions.length, 0);
  const e = await call(`/${p.j.action.id}/edit`, 'POST', { steps: [note('k.md', 'v2')] });
  assert.equal((await call(`/${p.j.action.id}/approve`, 'POST', { planHash: p.j.action.planHash })).s, 409);
  const ap = await call(`/${p.j.action.id}/approve`, 'POST', { planHash: e.j.action.planHash });
  assert.equal(ap.s, 200); assert.equal(ap.j.action.status, 'executed');
  assert.equal((await call('/propose', 'POST', { title: 'T', steps: [{ tool: 'nope' }] })).s, 400);
  const tl = (await call('/tools')).j.tools; assert.equal(tl.length, 15);
  assert.deepEqual(tl.filter((t) => t.target === 'helper').map((t) => t.name).sort(), ['files.delete', 'files.list', 'files.mkdir', 'files.move', 'files.read', 'files.write']);
  // dev fallback: no req.user → ?userId / 'u1'
  const r = await fetch(base + '/pending?userId=zed'); assert.equal(r.status, 200);
  s.close();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createGate, PENDING_TTL_MS } from '../lib/agent/gate.js';
import { memoryStore } from '../lib/agent/store.js';
import { createTrust, memoryTrustStore } from '../lib/agent/trust.js';
import { createConsent, memorySettingsStore } from '../lib/agent/consent.js';
import { createAutonomy, AUTO_ALLOWLIST } from '../lib/agent/autonomy.js';

function env({ online = true, halted = false } = {}) {
  const calls = []; const fs = new Set(['notes']);
  const helper = { online: async () => online, async exec(_u, tool, args) {
    calls.push({ tool, args });
    if (tool === 'files.list') return { entries: [...fs].filter((p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.') === (args.path || '.')).map((p) => ({ name: p.split('/').pop() })) };
    if (tool === 'files.mkdir') { fs.add(args.path); return { path: args.path, created: true }; }
    if (tool === 'files.read') return { path: args.path, content: 'hi', bytes: 2 };
    return { ok: true };
  } };
  const trust = createTrust({ store: memoryTrustStore(), log: { warn() {} } });
  const settings = memorySettingsStore(); const consent = createConsent({ store: settings });
  const flags = { halted };
  const autonomy = createAutonomy({ store: settings, consent, trust, helper, isHalted: () => flags.halted });
  const gate = createGate({ store: memoryStore(), helper, trust, autonomy, isHalted: () => flags.halted, log: { warn() {} } });
  return { helper, trust, consent, autonomy, gate, calls, flags, fs };
}
const mk = (p) => ({ tool: 'files.mkdir', args: { path: p } });
async function teach(e, steps, n = 8) { for (let i = 0; i < n; i++) await e.trust.observe('approved', { userId: 'u', steps, results: steps.map((_, k) => ({ i: k, status: 'ok' })) }); }
async function setup(e, { tool = 'files.mkdir', habit = 8, consent = '.' } = {}) {
  if (consent) await e.consent.grant('u', consent);
  if (tool) await e.autonomy.setTool('u', tool, 'auto');
  if (habit) await teach(e, [mk('notes/2026')], habit);
}
const propose = (e, steps = [mk('notes/2026')], source = 'assistant') => e.gate.propose({ userId: 'u', title: 't', steps, source });

test('default: everything OFF → plan stays pending even with a High habit', async () => {
  const e = env(); await e.consent.grant('u', '.'); await teach(e, [mk('notes/2026')]);
  const s = await e.autonomy.get('u'); assert.deepEqual(Object.values(s.tools), ['off', 'off', 'off']);
  const p = await propose(e); const r = await e.gate.autoApprove({ userId: 'u', id: p.id });
  assert.equal(r.auto, false); assert.equal((await e.gate.get('u', p.id)).status, 'pending'); assert.equal(e.calls.length, 0);
  assert.deepEqual(r.offer, { tools: ['files.mkdir'] });                      // High habit but tool off → offer to switch it on
});
test('all conditions met → runs automatically, logged via:auto, notification info present', async () => {
  const e = env(); await setup(e);
  const p = await propose(e); const r = await e.gate.autoApprove({ userId: 'u', id: p.id });
  assert.equal(r.auto, true); assert.equal(r.action.status, 'executed');
  assert.equal(r.action.auto.basis[0].level, 'high'); assert.deepEqual(r.action.auto.created, ['notes/2026']); assert.equal(r.action.auto.undoable, true);
  const raw = await e.gate.get('u', p.id); assert.ok(raw.history.some((h) => h.type === 'approved' && h.via === 'auto')); assert.ok(raw.history.some((h) => h.type === 'auto_approved'));
});
test('auto-runs never teach trust (no self-reinforcement)', async () => {
  const e = env(); await setup(e); const before = (await e.trust.habits('u')).find((h) => h.tool === 'files.mkdir').approvals;
  for (let i = 0; i < 3; i++) { const p = await propose(e); await e.gate.autoApprove({ userId: 'u', id: p.id }); }
  assert.equal((await e.trust.habits('u')).find((h) => h.tool === 'files.mkdir').approvals, before);
});
test('each condition alone blocks auto', async () => {
  const cases = {
    'medium habit': async () => { const e = env(); await setup(e, { habit: 4 }); return [e, propose(e)]; },
    'no habit': async () => { const e = env(); await setup(e, { habit: 0 }); return [e, propose(e)]; },
    'no folder consent': async () => { const e = env(); await setup(e, { consent: null }); return [e, propose(e)]; },
    'consent for another folder': async () => { const e = env(); await setup(e, { consent: 'docs' }); return [e, propose(e)]; },
    'helper offline': async () => { const e = env({ online: false }); await setup(e); return [e, propose(e)]; },
    'kill switch': async () => { const e = env(); await setup(e); e.flags.halted = true; return [e, propose(e)]; },
    'user-proposed plan': async () => { const e = env(); await setup(e); return [e, propose(e, [mk('notes/2026')], 'user')]; },
    'other tool on': async () => { const e = env(); await setup(e, { tool: 'files.list' }); return [e, propose(e)]; },
    'different folder than the habit': async () => { const e = env(); await setup(e); return [e, propose(e, [mk('notes/2027')])]; },
  };
  for (const [name, f] of Object.entries(cases)) {
    const [e, pp] = await f(); const p = await pp; const r = await e.gate.autoApprove({ userId: 'u', id: p.id });
    assert.equal(r.auto, false, name); assert.equal((await e.gate.get('u', p.id)).status, 'pending', name); assert.equal(e.calls.filter((c) => c.tool === 'files.mkdir').length, 0, name);
  }
});
test('medium habit on an OFF tool → offer; High but ON-for-other-tool → no offer needed logic still safe', async () => {
  const e = env(); await e.consent.grant('u', '.'); await teach(e, [mk('notes/2026')], 4);
  const p = await propose(e); const r = await e.gate.autoApprove({ userId: 'u', id: p.id });
  assert.equal(r.auto, false); assert.deepEqual(r.offer, { tools: ['files.mkdir'] });
  const e2 = env(); await e2.consent.grant('u', '.'); const p2 = await propose(e2); assert.equal((await e2.gate.autoApprove({ userId: 'u', id: p2.id })).offer, null);   // no habit → no offer
});
test('risky tools can never be switched on or auto-run, even with a high habit', async () => {
  const e = env();
  await assert.rejects(() => e.autonomy.setTool('u', 'files.write', 'auto'), /unknown tool/);
  await assert.rejects(() => e.autonomy.setTool('u', 'files.delete', 'auto'), /unknown tool/);
  assert.deepEqual([...AUTO_ALLOWLIST], ['files.list', 'files.read', 'files.mkdir']);
  const w = { tool: 'files.write', args: { path: 'notes/a.md', content: 'x' } };
  await e.consent.grant('u', '.'); await teach(e, [w], 20);
  const p = await propose(e, [w]); assert.equal((await e.gate.autoApprove({ userId: 'u', id: p.id })).auto, false);
  const mixed = await propose(e, [mk('notes/2026'), w]); assert.equal((await e.gate.autoApprove({ userId: 'u', id: mixed.id })).auto, false);   // one risky step taints the whole plan
});
test('a poisoned settings row cannot enable anything outside the allowlist', async () => {
  const e = env(); const store = memorySettingsStore(); await store.save('u', { autonomy: { tools: { 'files.write': 'auto', 'files.mkdir': 'yes' }, maxPerHour: 9999 } });
  const a = createAutonomy({ store, consent: e.consent, trust: e.trust, helper: e.helper }); const s = await a.get('u');
  assert.deepEqual(Object.keys(s.tools), ['files.list', 'files.read', 'files.mkdir']); assert.equal(s.tools['files.mkdir'], 'off'); assert.equal(s.maxPerHour, 60);
});
test('hourly cap stops auto-runs', async () => {
  const e = env(); await setup(e); await e.autonomy.setCap('u', 2);
  const out = []; for (let i = 0; i < 4; i++) { const p = await propose(e); out.push((await e.gate.autoApprove({ userId: 'u', id: p.id })).auto); }
  assert.deepEqual(out, [true, true, false, false]);
});
test('rejections lower the habit below High → auto stops', async () => {
  const e = env(); await setup(e, { habit: 8 }); await e.trust.observe('rejected', { userId: 'u', steps: [mk('notes/2026')] });
  const p = await propose(e); assert.equal((await e.gate.autoApprove({ userId: 'u', id: p.id })).auto, false);
});
test('auto path keeps the gate checks: expired plan and already-run plan are not executed', async () => {
  const e = env(); await setup(e);
  const p = await propose(e); const raw = await e.gate.get('u', p.id);
  const real = Date.now; Date.now = () => real() + PENDING_TTL_MS + 5000;
  try { assert.equal((await e.gate.autoApprove({ userId: 'u', id: p.id })).auto, false); } finally { Date.now = real; }
  assert.equal(e.calls.filter((c) => c.tool === 'files.mkdir').length, 0); assert.equal(raw.status, 'pending');
  const q = await propose(e); assert.equal((await e.gate.autoApprove({ userId: 'u', id: q.id })).auto, true);
  assert.equal((await e.gate.autoApprove({ userId: 'u', id: q.id })).auto, false);              // not pending any more → no double run
  assert.equal(e.calls.filter((c) => c.tool === 'files.mkdir').length, 1);
});
test('undo: only folders that did not exist; creates a PENDING files.delete plan (not auto)', async () => {
  const e = env(); await setup(e);
  const existing = await propose(e, [mk('notes')]); await teach(e, [mk('notes')]);              // "notes" already exists
  const r0 = await e.gate.autoApprove({ userId: 'u', id: existing.id }); assert.equal(r0.auto, true); assert.equal(r0.action.auto.undoable, false);
  const p = await propose(e); const r = await e.gate.autoApprove({ userId: 'u', id: p.id });
  const u = await e.gate.undoAuto({ userId: 'u', id: p.id }); assert.equal(u.ok, true);
  assert.equal(u.action.status, 'pending'); assert.deepEqual(u.action.steps.map((s) => s.tool + ':' + s.args.path), ['files.delete:notes/2026']);
  assert.equal((await e.gate.undoAuto({ userId: 'u', id: p.id })).ok, false);                    // only once
  assert.equal((await e.gate.undoAuto({ userId: 'u', id: existing.id })).ok, false);
  assert.equal((await e.gate.autoApprove({ userId: 'u', id: u.action.id })).auto, false);       // the undo itself needs a click
});
test('per-user isolation: another user cannot use my settings or plans', async () => {
  const e = env(); await setup(e); const p = await propose(e);
  assert.equal((await e.gate.autoApprove({ userId: 'other', id: p.id })).auto, false);
  assert.equal((await e.gate.get('u', p.id)).status, 'pending');
});
test('mixed list/read/mkdir plan needs every tool on and every step High', async () => {
  const e = env(); await e.consent.grant('u', '.');
  const steps = [{ tool: 'files.list', args: { path: 'notes' } }, mk('notes/2026'), { tool: 'files.read', args: { path: 'notes/a.md' } }];
  await teach(e, steps); for (const t of ['files.list', 'files.mkdir']) await e.autonomy.setTool('u', t, 'auto');
  let p = await propose(e, steps); assert.equal((await e.gate.autoApprove({ userId: 'u', id: p.id })).auto, false);   // read still off
  await e.autonomy.setTool('u', 'files.read', 'auto'); p = await propose(e, steps); const rr = await e.gate.autoApprove({ userId: "u", id: p.id }); assert.equal(rr.auto, true, rr.reason);
});

// lib/agent/gate.js
// ─────────────────────────────────────────────────────────────────
// SHERZ Agent — the CONFIRMATION GATE (Phase 1, strict mode).
//   propose()  → stores a PENDING plan. Nothing runs.
//   edit()     → replaces the steps; the plan hash changes, so the old approval no longer applies.
//   reject()   → closes the plan.
//   approve()  → the ONLY path to execution. It requires: status 'pending', not expired, the exact planHash
//                the user was shown, and an atomic pending→executing claim (no double-run on double-click).
// The model can only reach propose(). It has no way to call approve().
// Every state change is appended to the action's `history` (audit trail — also the raw data for Phase 2 trust learning).
// ─────────────────────────────────────────────────────────────────
import crypto from 'node:crypto';
import { TOOLS, normalizePlan } from './registry.js';

export const PENDING_TTL_MS = 30 * 60 * 1000;

export function hashPlan(steps) {
  const canon = (v) => Array.isArray(v) ? v.map(canon)
    : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
    : v;
  return crypto.createHash('sha256').update(JSON.stringify(canon(steps.map((s) => ({ tool: s.tool, args: s.args }))))).digest('hex').slice(0, 24);
}

const now = () => new Date().toISOString();
const ev = (type, extra = {}) => ({ at: now(), type, ...extra });

export function publicAction(a) {
  if (!a) return null;
  return {
    id: a.id, title: a.title, status: a.status, risk: a.risk, planHash: a.planHash,
    steps: a.plan, results: a.result || null, conversationId: a.conversationId || null,
    createdAt: a.createdAt, expiresAt: new Date(new Date(a.createdAt).getTime() + PENDING_TTL_MS).toISOString(),
    source: a.source || 'user', edited: !!(a.history || []).some((h) => h.type === 'edited'),
  };
}

export function createGate({ store, isHalted = () => false, log = console } = {}) {
  if (!store) throw new Error('gate needs a store');

  async function expireIfStale(a) {
    if (a && a.status === 'pending' && Date.now() - new Date(a.createdAt).getTime() > PENDING_TTL_MS) {
      await store.update(a.id, { status: 'expired', history: [...(a.history || []), ev('expired')] });
      return { ...a, status: 'expired' };
    }
    return a;
  }

  async function propose({ userId, title, steps, conversationId = null, source = 'user' }) {
    const { steps: plan, risk } = normalizePlan(steps);
    const a = await store.create({
      userId, conversationId, title: String(title || 'Plan').slice(0, 120), source,
      plan, planHash: hashPlan(plan), risk, status: 'pending', result: null,
      history: [ev('proposed', { by: source })],
    });
    return publicAction(a);
  }

  async function get(userId, id) { return expireIfStale(await store.get(id, userId)); }
  async function listPending(userId) {
    const rows = await store.listPending(userId);
    const live = [];
    for (const r of rows) { const x = await expireIfStale(r); if (x.status === 'pending') live.push(x); }
    return live.map(publicAction);
  }
  async function listRecent(userId, limit = 20) { return (await store.listRecent(userId, Math.min(+limit || 20, 50))).map(publicAction); }

  async function edit({ userId, id, steps, title }) {
    const a = await get(userId, id);
    if (!a) return { ok: false, code: 404, error: 'plan not found' };
    if (a.status !== 'pending') return { ok: false, code: 409, error: `plan is ${a.status}` };
    const { steps: plan, risk } = normalizePlan(steps);
    const u = await store.update(id, {
      plan, planHash: hashPlan(plan), risk, ...(title ? { title: String(title).slice(0, 120) } : {}),
      history: [...(a.history || []), ev('edited', { oldHash: a.planHash })],
    });
    return { ok: true, action: publicAction(u) };
  }

  async function reject({ userId, id, reason = '' }) {
    const a = await get(userId, id);
    if (!a) return { ok: false, code: 404, error: 'plan not found' };
    if (a.status !== 'pending') return { ok: false, code: 409, error: `plan is ${a.status}` };
    const claimed = await store.transition(id, userId, 'pending', { status: 'rejected', history: [...(a.history || []), ev('rejected', { reason: String(reason).slice(0, 200) })] });
    if (!claimed) return { ok: false, code: 409, error: 'plan is no longer pending' };
    return { ok: true, action: publicAction(await store.get(id, userId)) };
  }

  async function approve({ userId, id, planHash }) {
    const a = await get(userId, id);
    if (!a) return { ok: false, code: 404, error: 'plan not found' };
    if (a.status === 'expired') return { ok: false, code: 410, error: 'plan expired — ask again' };
    if (a.status !== 'pending') return { ok: false, code: 409, error: `plan is ${a.status}` };
    if (!planHash || planHash !== a.planHash) return { ok: false, code: 409, error: 'the plan changed after you saw it — review it again', action: publicAction(a) };
    if (isHalted()) return { ok: false, code: 503, error: 'agent is paused by the administrator' };

    // atomic claim: only ONE concurrent approve can move pending → executing
    const claimed = await store.transition(id, userId, 'pending', { status: 'executing', history: [...(a.history || []), ev('approved', { planHash })] });
    if (!claimed) return { ok: false, code: 409, error: 'plan is no longer pending' };

    const results = [];
    let failed = false, halted = false;
    for (const [i, step] of a.plan.entries()) {
      if (failed || halted) { results.push({ i, tool: step.tool, status: 'skipped' }); continue; }
      if (isHalted()) { halted = true; results.push({ i, tool: step.tool, status: 'skipped', error: 'paused by administrator' }); continue; }
      const tool = TOOLS[step.tool];
      const t0 = Date.now();
      try {
        if (!tool) throw new Error('unknown action');
        const args = tool.validate(step.args);                  // re-validate at execution time, never trust stored data blindly
        const out = await tool.run(args, { userId });
        results.push({ i, tool: step.tool, status: 'ok', output: out, ms: Date.now() - t0 });
      } catch (e) {
        failed = true;
        results.push({ i, tool: step.tool, status: 'error', error: String(e.message || e), ms: Date.now() - t0 });
        log.warn?.(`[agent] step ${i} (${step.tool}) failed: ${e.message}`);
      }
    }
    const status = failed ? 'failed' : halted ? 'failed' : 'executed';
    const done = await store.update(id, { status, result: results, history: [...(a.history || []), ev('approved', { planHash }), ev(status)].slice(-30) });
    return { ok: true, action: publicAction(done) };
  }

  return { propose, get, listPending, listRecent, edit, reject, approve };
}

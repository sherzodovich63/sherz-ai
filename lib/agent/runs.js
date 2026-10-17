// lib/agent/runs.js — Phase 3a/3b: the AgentRun.
// A run = one goal being worked on across several model turns:  observe → propose → (user approves) → results → continue …
// It carries the BUDGETS that keep an autonomous loop bounded, the "tainted" flag (file contents are in the context →
// network tools are switched off for the rest of the run) and the self-correction bookkeeping.
// Nothing here executes anything and nothing here can approve anything.
import crypto from 'node:crypto';

export const BUDGET = {
  maxPlans: 5,                 // proposals per run
  maxObservations: 12,         // read-only calls per run
  maxObsBytes: 48 * 1024,      // total observation text fed to the model per run
  maxSteps: 16,                // successfully executed steps per run
  maxFailures: 3,              // failed plans before the run gives up
  maxContinuations: 6,         // model turns started after the first
  maxAgeMs: 60 * 60 * 1000,    // a run older than this is closed
};
const emptyStats = () => ({ plans: 0, observations: 0, obsBytes: 0, steps: 0, failures: 0, continuations: 0, failedHashes: [], consumed: [] });
const LIVE = new Set(['active', 'awaiting_consent']);

// ── stores ───────────────────────────────────────────────────
export function memoryRunStore() {
  const rows = new Map();
  return {
    async create(d) { const r = { id: 'run_' + crypto.randomBytes(6).toString('hex'), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...structuredClone(d) }; rows.set(r.id, r); return structuredClone(r); },
    async get(id, userId) { const r = rows.get(id); return r && r.userId === userId ? structuredClone(r) : null; },
    async update(id, patch) { const r = rows.get(id); Object.assign(r, structuredClone(patch), { updatedAt: new Date().toISOString() }); return structuredClone(r); },
    async findByAction(actionId, userId) { for (const r of rows.values()) if (r.userId === userId && r.lastActionId === actionId) return structuredClone(r); return null; },
    async stopLive(userId, conversationId) { let n = 0; for (const r of rows.values()) if (r.userId === userId && (r.conversationId || null) === (conversationId || null) && LIVE.has(r.status)) { r.status = 'stopped'; n++; } return n; },
  };
}
export function prismaRunStore(prisma) {
  const m = () => prisma.agentRun;
  return {
    async create(d) { return m().create({ data: d }); },
    async get(id, userId) { return m().findFirst({ where: { id, userId } }); },
    async update(id, patch) { return m().update({ where: { id }, data: patch }); },
    async findByAction(actionId, userId) { return m().findFirst({ where: { lastActionId: actionId, userId } }); },
    async stopLive(userId, conversationId) { const r = await m().updateMany({ where: { userId, conversationId: conversationId || null, status: { in: [...LIVE] } }, data: { status: 'stopped' } }); return r.count; },
  };
}

// ── the run manager ──────────────────────────────────────────
export function createRuns({ store, now = () => Date.now(), budget = BUDGET, log = console } = {}) {
  if (!store) throw new Error('runs needs a store');
  const stats = (r) => ({ ...emptyStats(), ...(r.stats || {}) });
  const save = (r, patch) => store.update(r.id, patch);

  /** a new goal supersedes any live run of the same conversation */
  async function start({ userId, conversationId = null, goal = '' }) {
    await store.stopLive(userId, conversationId);
    return store.create({ userId, conversationId, goal: String(goal).replace(/\s+/g, ' ').slice(0, 300), status: 'active', stats: emptyStats(), tainted: false, nextHint: null, digest: [], lastActionId: null, pendingConsent: null });
  }
  const get = (userId, id) => store.get(String(id), userId);

  /** why the run may NOT do `kind` right now ('plan' | 'observe' | 'continue'), or null if it may */
  function check(run, kind, extra = {}) {
    const s = stats(run);
    if (!LIVE.has(run.status)) return `this run is ${run.status}`;
    if (now() - new Date(run.createdAt).getTime() > budget.maxAgeMs) return 'the run timed out';
    if (kind === 'plan' && s.plans >= budget.maxPlans) return `plan budget used up (${budget.maxPlans} plans per task)`;
    if (kind === 'observe') {
      if (s.observations >= budget.maxObservations) return `observation budget used up (${budget.maxObservations} reads per task)`;
      if (s.obsBytes + (extra.bytes || 0) > budget.maxObsBytes) return 'read budget used up (too much file text already seen this task)';
    }
    if (kind === 'continue' && s.continuations >= budget.maxContinuations) return `step budget used up (${budget.maxContinuations} follow-ups per task)`;
    return null;
  }

  async function notePlan(run, { actionId, planHash, nextHint = null }) {
    const s = stats(run); s.plans++;
    return save(run, { stats: s, lastActionId: actionId, nextHint: nextHint ? String(nextHint).slice(0, 300) : null, status: 'active', pendingConsent: null });
  }
  /** record an observation; file text → tainted. digest keeps a short trace so the NEXT turn still knows what was seen. */
  async function noteObservation(run, { tool, label, bytes, text }) {
    const s = stats(run); s.observations++; s.obsBytes += bytes || 0;
    let digest = [...(run.digest || []), { tool, label: String(label || '').slice(0, 120), text: String(text || '').slice(0, 1500) }];
    while (JSON.stringify(digest).length > 6000 && digest.length > 1) digest.shift();
    return save(run, { stats: s, tainted: true, digest });
  }
  async function awaitConsent(run, folder) { return save(run, { status: 'awaiting_consent', pendingConsent: String(folder) }); }
  async function consentGranted(run) { return save(run, { status: 'active', pendingConsent: null }); }
  async function finish(run, status = 'done') { return LIVE.has(run.status) ? save(run, { status }) : run; }
  async function stop(userId, id) { const r = await get(userId, id); return r ? finish(r, 'stopped') : null; }

  /** called by the approve / reject routes AFTER the gate decided. Returns what the client should do next. */
  async function onDecision({ userId, actionId, action }) {
    const run = await store.findByAction(String(actionId), userId);
    if (!run || !LIVE.has(run.status)) return null;
    const s = stats(run);
    const out = { run: null, canContinue: false, notice: null };
    if (action.status === 'rejected') { out.run = await finish(run, 'stopped'); return out; }
    const results = Array.isArray(action.results) ? action.results : [];
    s.steps += results.filter((r) => r.status === 'ok').length;
    let tainted = !!run.tainted;
    if (results.some((r) => r.status === 'ok' && r.output && (typeof r.output.content === 'string' || Array.isArray(r.output.entries)))) tainted = true;
    if (action.status === 'failed') {
      s.failures++;
      s.failedHashes = [...(s.failedHashes || []), action.planHash].slice(-6);
      if (s.failures >= budget.maxFailures) { out.run = await save(run, { stats: s, tainted, status: 'failed' }); out.notice = `Stopped after ${s.failures} failed attempts.`; return out; }
    }
    if (s.steps >= budget.maxSteps) { out.run = await save(run, { stats: s, tainted, status: 'budget' }); out.notice = 'Step budget for this task is used up.'; return out; }
    if (action.status === 'failed' || run.nextHint) {                  // self-correct on failure; follow the plan when the model said more is coming
      out.run = await save(run, { stats: s, tainted, status: 'active' });
      out.canContinue = true; return out;
    }
    out.run = await save(run, { stats: s, tainted, status: 'done' });
    return out;
  }
  /** `key` identifies WHAT is being continued from (an action id, or a consent) so one result can't start two follow-ups */
  async function beginContinuation(run, key) {
    const why = check(run, 'continue'); if (why) return { ok: false, error: why, budget: true };
    const s = stats(run);
    if (key && (s.consumed || []).includes(key)) return { ok: false, error: 'this result was already followed up' };
    s.continuations++; if (key) s.consumed = [...(s.consumed || []), key].slice(-12);
    return { ok: true, run: await save(run, { stats: s }) };
  }
  const wasFailedPlan = (run, hash) => (stats(run).failedHashes || []).includes(hash);

  return { start, get, check, notePlan, noteObservation, awaitConsent, consentGranted, finish, stop, onDecision, beginContinuation, wasFailedPlan, stats };
}

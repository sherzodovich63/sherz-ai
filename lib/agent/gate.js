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
import { decideChatBoundary, GRANT } from './intentGrant.js';

export const PENDING_TTL_MS = 30 * 60 * 1000;

export function hashPlan(steps) {
  const canon = (v) => Array.isArray(v) ? v.map(canon)
    : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))
    : v;
  return crypto.createHash('sha256').update(JSON.stringify(canon(steps.map((s) => ({ tool: s.tool, args: s.args }))))).digest('hex').slice(0, 24);
}

const now = () => new Date().toISOString();
const ev = (type, extra = {}) => ({ at: now(), type, ...extra });

// Phase 3c: ran without a click? (shown on the card as a notification, with the habit that justified it)
function autoInfo(a) {
  const h = a.history || [], e = h.find((x) => x.type === 'auto_approved');
  if (!e) return null;
  const made = Array.isArray(e.mkdirNew) ? e.mkdirNew : [];
  return { at: e.at, basis: e.basis || [], undoable: made.length > 0 && !h.some((x) => x.type === 'undo_proposed'), created: made, grant: e.grant || null, thought: e.thought || null };
}

export function publicAction(a) {
  if (!a) return null;
  return {
    id: a.id, title: a.title, status: a.status, risk: a.risk, planHash: a.planHash,
    steps: a.plan, results: a.result || null, conversationId: a.conversationId || null,
    createdAt: a.createdAt, expiresAt: new Date(new Date(a.createdAt).getTime() + PENDING_TTL_MS).toISOString(),
    source: a.source || 'user', edited: !!(a.history || []).some((h) => h.type === 'edited'),
    auto: autoInfo(a),
  };
}

export function createGate({ store, isHalted = () => false, helper = null, trust = null, autonomy = null, log = console } = {}) {
  if (!store) throw new Error('gate needs a store');
  // Phase 2: `trust` only OBSERVES decisions and decorates cards. It has no say in approve()'s checks.
  const pub = async (a) => (trust && a ? trust.decorate(publicAction(a), a.userId) : publicAction(a));

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
    return pub(a);
  }

  async function get(userId, id) { return expireIfStale(await store.get(id, userId)); }
  async function listPending(userId) {
    const rows = await store.listPending(userId);
    const live = [];
    for (const r of rows) { const x = await expireIfStale(r); if (x.status === 'pending') live.push(x); }
    return Promise.all(live.map(pub));
  }
  async function listRecent(userId, limit = 20) { return Promise.all((await store.listRecent(userId, Math.min(+limit || 20, 50))).map(pub)); }

  async function edit({ userId, id, steps, title }) {
    const a = await get(userId, id);
    if (!a) return { ok: false, code: 404, error: 'plan not found' };
    if (a.status !== 'pending') return { ok: false, code: 409, error: `plan is ${a.status}` };
    const { steps: plan, risk } = normalizePlan(steps);
    const u = await store.update(id, {
      plan, planHash: hashPlan(plan), risk, ...(title ? { title: String(title).slice(0, 120) } : {}),
      history: [...(a.history || []), ev('edited', { oldHash: a.planHash })],
    });
    if (trust) await trust.observe('edited', { userId, before: a.plan, after: plan });
    return { ok: true, action: await pub(u) };
  }

  async function reject({ userId, id, reason = '' }) {
    const a = await get(userId, id);
    if (!a) return { ok: false, code: 404, error: 'plan not found' };
    if (a.status !== 'pending') return { ok: false, code: 409, error: `plan is ${a.status}` };
    const claimed = await store.transition(id, userId, 'pending', { status: 'rejected', history: [...(a.history || []), ev('rejected', { reason: String(reason).slice(0, 200) })] });
    if (!claimed) return { ok: false, code: 409, error: 'plan is no longer pending' };
    if (trust) await trust.observe('rejected', { userId, steps: a.plan });
    return { ok: true, action: await pub(await store.get(id, userId)) };
  }

  async function approve({ userId, id, planHash, via = 'user', basis = null, extra = null }) {
    const a = await get(userId, id);
    if (!a) return { ok: false, code: 404, error: 'plan not found' };
    if (a.status === 'expired') return { ok: false, code: 410, error: 'plan expired — ask again' };
    if (a.status !== 'pending') return { ok: false, code: 409, error: `plan is ${a.status}` };
    if (!planHash || planHash !== a.planHash) return { ok: false, code: 409, error: 'the plan changed after you saw it — review it again', action: await pub(a) };
    if (isHalted()) return { ok: false, code: 503, error: 'agent is paused by the administrator' };
    // preflight: a plan that needs the user's computer must not start (and burn the approval) while the helper is offline
    if (a.plan.some((s) => TOOLS[s.tool]?.target === 'helper') && !(helper && await helper.online(userId))) {
      return { ok: false, code: 409, error: 'Your helper is not connected. Type /helper in the chat, start it on your computer, then approve again.', action: await pub(a) };
    }

    // atomic claim: only ONE concurrent approve can move pending → executing
    const claimed = await store.transition(id, userId, 'pending', { status: 'executing', history: [...(a.history || []), ev('approved', { planHash, ...(via === 'auto' ? { via } : {}) })] });
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
        const out = await tool.run(args, { userId, helper });
        results.push({ i, tool: step.tool, status: 'ok', output: out, ms: Date.now() - t0 });
      } catch (e) {
        failed = true;
        results.push({ i, tool: step.tool, status: 'error', error: String(e.message || e), ms: Date.now() - t0 });
        log.warn?.(`[agent] step ${i} (${step.tool}) failed: ${e.message}`);
      }
    }
    const status = failed ? 'failed' : halted ? 'failed' : 'executed';
    const done = await store.update(id, { status, result: results, history: [...(a.history || []), ev('approved', { planHash, ...(via === 'auto' ? { via } : {}) }), ...(via === 'auto' ? [ev('auto_approved', { basis, ...(extra || {}) })] : []), ev(status)].slice(-30) });
    // an automatic run is NOT a human decision: it must never teach the system to trust itself more
    if (trust && via !== 'auto') await trust.observe('approved', { userId, steps: a.plan, results });
    return { ok: true, action: await pub(done) };
  }

  // ── Phase 3c ────────────────────────────────────────────────
  // The ONLY automatic path. It is called by server code after the assistant proposed a plan — never by the model.
  // It asks the policy engine; if (and only if) the answer is 'auto' it goes through the SAME approve() checks
  // (pending, not expired, exact hash, kill switch, helper preflight, atomic claim) and is logged as via:'auto'.
  async function autoApprove({ userId, id, userText = '', tainted = false }) {
    const a = await get(userId, id);
    if (!a || a.status !== 'pending') return { ok: true, auto: false, reason: 'plan is not pending' };
    const hourAgo = Date.now() - 3600 * 1000;
    let recent = []; try { recent = await store.listRecent(userId, 50); } catch { /* count stays 0 → engine still enforces the other rules */ }
    const autoEvents = (r) => (r.history || []).filter((h) => h.type === 'auto_approved' && new Date(h.at).getTime() > hourAgo);
    const n = recent.filter((r) => autoEvents(r).some((h) => h.grant !== GRANT)).length;            // habit-based auto-runs (Phase 3c cap)
    const ng = recent.filter((r) => autoEvents(r).some((h) => h.grant === GRANT)).length;           // explicit-request runs have their own cap
    // Boundary reasoning (intentGrant.js): the user explicitly asked for a file and the effect stays inside SHERZ's own file area → no click needed.
    // The facts (the user's real message, the tool registry, the taint flag) come from the server, never from the model.
    const g = decideChatBoundary({ plan: a.plan, source: a.source || 'user', userText, tainted, autoRunsLastHour: ng });
    if (g.decision === 'auto') {
      const out = await approve({ userId, id, planHash: a.planHash, via: 'auto', basis: g.basis, extra: { grant: GRANT, thought: g.thought } });
      return { ...out, auto: out.ok, reason: out.ok ? g.reason : out.error };
    }
    if (!autonomy) return { ok: true, auto: false, reason: 'autonomy is not configured' };
    const d = await autonomy.decide({ userId, plan: a.plan, source: a.source || 'user', autoRunsLastHour: n });
    if (d.decision !== 'auto') return { ok: true, auto: false, reason: d.reason, offer: d.offer || null, action: await pub(a) };
    // remember which folders did not exist yet, so "Undo" never touches a folder that was already there
    const extra = { mkdirNew: await newFolders(userId, a.plan) };
    const out = await approve({ userId, id, planHash: a.planHash, via: 'auto', basis: d.basis, extra });
    return { ...out, auto: out.ok, reason: out.ok ? d.reason : out.error };
  }
  async function newFolders(userId, plan) {
    const made = [];
    for (const s of plan) {
      if (s.tool !== 'files.mkdir') continue;
      try {
        const p = String(s.args.path), i = p.lastIndexOf('/'), parent = i < 0 ? '.' : p.slice(0, i), name = p.slice(i + 1);
        const r = await helper.exec(userId, 'files.list', { path: parent });
        if (Array.isArray(r?.entries) && !r.entries.some((e) => e.name === name)) made.push(p);
      } catch { /* cannot prove it is new → no undo offered for it */ }
    }
    return made;
  }
  /** Undo for an automatic run = a NEW pending plan (files.delete → moved to .sherz-trash). The user still approves it. */
  async function undoAuto({ userId, id }) {
    const a = await get(userId, id);
    if (!a) return { ok: false, code: 404, error: 'plan not found' };
    const info = autoInfo(a);
    if (!info || !info.undoable) return { ok: false, code: 409, error: 'nothing to undo' };
    const steps = [...info.created].sort((x, y) => y.length - x.length).map((p) => ({ tool: 'files.delete', args: { path: p } }));
    const undo = await propose({ userId, title: 'Undo: remove folders created automatically', steps, conversationId: a.conversationId || null, source: 'user' });
    await store.update(id, { history: [...(a.history || []), ev('undo_proposed', { undoId: undo.id })].slice(-30) });
    return { ok: true, action: undo };
  }

  return { propose, get, listPending, listRecent, edit, reject, approve, autoApprove, undoAuto };
}

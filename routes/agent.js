// routes/agent.js — mounted at /api/agent (behind the global JWT guard in server.js)
//   GET  /api/agent/tools            what the agent may ever do (risk + reversible)
//   GET  /api/agent/pending          plans waiting for the user's decision
//   GET  /api/agent/recent           last decided/executed plans
//   GET  /api/agent/habits           learned habits (Phase 2) · DELETE /habits/:id or /habits = forget
//   POST /api/agent/propose          { title, steps:[{tool,args}] }  → creates a PENDING plan (runs nothing)
//   POST /api/agent/:id/edit         { steps, title? }               → new plan hash, still pending
//   POST /api/agent/:id/reject       { reason? }
//   POST /api/agent/:id/approve      { planHash }                    → the ONLY route that executes
import { Router } from 'express';
import { createGate } from '../lib/agent/gate.js';
import { prismaStore, memoryStore } from '../lib/agent/store.js';
import { createTrust, prismaTrustStore, memoryTrustStore } from '../lib/agent/trust.js';
import { createRuns, prismaRunStore, memoryRunStore } from '../lib/agent/runs.js';
import { createConsent, prismaSettingsStore, memorySettingsStore, covers } from '../lib/agent/consent.js';
import { createConventions } from '../lib/agent/conventions.js';
import { createAutonomy, AUTO_ALLOWLIST } from '../lib/agent/autonomy.js';
import { continueRun } from '../lib/agent/continuation.js';
import { toolMeta } from '../lib/agent/registry.js';

export function agentUserId(req, isProd) {
  return req.user?.id || (!isProd ? String(req.query?.userId || req.body?.userId || 'u1') : null);
}

export function makeConventions({ prisma }) {
  const ok = !!(prisma && prisma.agentSettings);
  return createConventions({ store: ok ? prismaSettingsStore(prisma) : memorySettingsStore() });
}

export function makeTrust({ prisma, conventions = null }) {
  const ok = !!(prisma && prisma.userPattern);
  if (!ok) console.warn('[agent] prisma.userPattern missing — habit learning is in-memory only. Run: npx prisma db push');
  return createTrust({ store: ok ? prismaTrustStore(prisma) : memoryTrustStore(), conventions });
}

export function makeRuns({ prisma }) {
  const ok = !!(prisma && prisma.agentRun);
  if (!ok) console.warn('[agent] prisma.agentRun missing — task runs are in-memory only. Run: npx prisma db push');
  return createRuns({ store: ok ? prismaRunStore(prisma) : memoryRunStore() });
}
export function makeConsent({ prisma }) {
  const ok = !!(prisma && prisma.agentSettings);
  if (!ok) console.warn('[agent] prisma.agentSettings missing — folder permissions are in-memory only. Run: npx prisma db push');
  return createConsent({ store: ok ? prismaSettingsStore(prisma) : memorySettingsStore() });
}

export function makeAutonomy({ prisma, consent, trust, helper = null, isHalted = () => false }) {
  const ok = !!(prisma && prisma.agentSettings);
  return createAutonomy({ store: ok ? prismaSettingsStore(prisma) : memorySettingsStore(), consent, trust, helper, isHalted });
}

export function makeGate({ prisma, isHalted, helper = null, trust = null, autonomy = null }) {
  const store = prisma && prisma.agentAction ? prismaStore(prisma) : memoryStore();   // memory fallback if `prisma db push` wasn't run yet
  if (!(prisma && prisma.agentAction)) console.warn('[agent] prisma.agentAction missing — using in-memory store. Run: npx prisma db push');
  return createGate({ store, isHalted, helper, trust, autonomy });
}

export function agentRouter({ gate, trust = null, runs = null, consent = null, autonomy = null, conventions = null, evidence = null, buildTurn = null, saveReply = undefined, isProd = false }) {
  const r = Router();
  const wrap = (fn) => async (req, res) => {
    try {
      const userId = agentUserId(req, isProd);
      if (!userId) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      await fn(req, res, userId);
    } catch (e) {
      const bad = /step \d|plan needs|at most|unknown action|unknown tool|must be|too long|rule is|too many rules|filename|folder|relative|reserved|\.\./.test(String(e.message));
      if (!bad) console.error('[agent] route error:', e);
      res.status(bad ? 400 : 500).json({ ok: false, error: bad ? e.message : 'agent error' });
    }
  };

  r.get('/tools', (_req, res) => res.json({ ok: true, tools: toolMeta() }));
  r.get('/pending', wrap(async (_req, res, userId) => res.json({ ok: true, actions: await gate.listPending(userId) })));
  r.get('/recent', wrap(async (req, res, userId) => res.json({ ok: true, actions: await gate.listRecent(userId, req.query.limit) })));
  // Phase 2 — what SHERZ has learned about the user (they can always see it and wipe it)
  r.get('/habits', wrap(async (_req, res, userId) => res.json({ ok: true, habits: trust ? await trust.habits(userId) : [] })));
  r.delete('/habits', wrap(async (_req, res, userId) => res.json({ ok: true, removed: (trust ? await trust.forget(userId) : 0) + (conventions ? await conventions.forgetInferred(userId) : 0) })));
  r.delete('/habits/:id', wrap(async (req, res, userId) => res.json({ ok: true, removed: trust ? await trust.forget(userId, String(req.params.id)) : 0 })));
  // Phase 3d — pinned rules (typed by the user) and inferred conventions (shapes learned from approvals)
  r.get('/rules', wrap(async (_req, res, userId) => res.json({ ok: true, available: !!conventions, rules: conventions ? await conventions.rules(userId) : [], inferred: conventions ? await conventions.inferred(userId) : [] })));
  r.post('/rules', wrap(async (req, res, userId) => {
    if (!conventions) return res.status(404).json({ ok: false, error: 'not available' });
    res.status(201).json({ ok: true, rules: await conventions.addRule(userId, req.body?.text) });
  }));
  r.delete('/rules/:id', wrap(async (req, res, userId) => res.json({ ok: true, removed: conventions ? await conventions.removeRule(userId, String(req.params.id)) : 0 })));
  r.delete('/conventions', wrap(async (_req, res, userId) => res.json({ ok: true, removed: conventions ? await conventions.forgetInferred(userId) : 0 })));
  // Phase 3 — folder consent for feeding file contents to the model, and task runs
  r.get('/consents', wrap(async (_req, res, userId) => res.json({ ok: true, consents: consent ? await consent.list(userId) : [] })));
  r.post('/consents', wrap(async (req, res, userId) => {
    if (!consent) return res.status(404).json({ ok: false, error: 'not available' });
    const list = await consent.grant(userId, req.body?.folder);
    let run = null, canContinue = false;
    if (runs && req.body?.runId) {
      const rn = await runs.get(userId, req.body.runId);
      if (rn && rn.status === 'awaiting_consent' && rn.pendingConsent && covers(list, rn.pendingConsent)) { run = await runs.consentGranted(rn); canContinue = true; }
    }
    res.json({ ok: true, consents: list, run: run && { id: run.id, status: run.status, canContinue }, canContinue });
  }));
  r.delete('/consents', wrap(async (req, res, userId) => res.json({ ok: true, removed: consent ? await consent.revoke(userId, req.query?.folder ?? req.body?.folder) : 0 })));
  // Phase 3c — auto-approval settings (everything OFF until the user switches it on)
  r.get('/autonomy', wrap(async (_req, res, userId) => res.json({ ok: true, settings: autonomy ? await autonomy.get(userId) : null, allowlist: AUTO_ALLOWLIST, available: !!autonomy })));
  r.post('/autonomy', wrap(async (req, res, userId) => {
    if (!autonomy) return res.status(404).json({ ok: false, error: 'not available' });
    const b = req.body || {};
    let s;
    if (b.tool !== undefined) s = await autonomy.setTool(userId, String(b.tool), String(b.mode));
    else if (b.maxPerHour !== undefined) s = await autonomy.setCap(userId, b.maxPerHour);
    else return res.status(400).json({ ok: false, error: 'nothing to change' });
    res.json({ ok: true, settings: s });
  }));
  r.post('/autonomy/off', wrap(async (_req, res, userId) => res.json({ ok: true, settings: autonomy ? await autonomy.disableAll(userId) : null })));
  r.post('/runs/:id/stop', wrap(async (req, res, userId) => { const x = runs && await runs.stop(userId, req.params.id); res.json({ ok: !!x, run: x && { id: x.id, status: x.status } }); }));
  r.post('/runs/:id/continue', wrap(async (req, res, userId) => {
    if (!runs || !buildTurn) return res.status(404).json({ ok: false, error: 'not available' });
    const reason = req.body?.reason === 'consent' ? 'consent' : 'result';
    reply(res, await continueRun({ userId, runId: String(req.params.id), reason, runs, gate, consent, buildTurn: ({ run, message }) => buildTurn({ userId, run, message }), saveReply: saveReply ? ({ run, text }) => saveReply({ userId, run, text }) : undefined }));
  }));
  r.post('/propose', wrap(async (req, res, userId) => {
    const b = req.body || {};
    const action = await gate.propose({ userId, title: b.title, steps: b.steps, conversationId: b.conversationId || null, source: 'user' });
    res.status(201).json({ ok: true, action });
  }));
  const reply = (res, out) => out.ok ? res.json(out) : res.status(out.code || 400).json(out);
  // Phase 3: tell the client whether the task wants a follow-up turn (after a result or a failure)
  const withRun = async (userId, id, out) => {
    if (!runs || !out.ok) return out;
    const d = await runs.onDecision({ userId, actionId: id, action: out.action });
    return d && d.run ? { ...out, run: { id: d.run.id, status: d.run.status, canContinue: d.canContinue, notice: d.notice } } : out;
  };
  r.post('/:id/undo', wrap(async (req, res, userId) => reply(res, await gate.undoAuto({ userId, id: req.params.id }))));
  // Phase 4: credit / debit the Work Space skills that informed a plan (evidence for their proficiency; best-effort, never blocks the decision)
  const note = async (userId, actionId, outcome, out) => { if (evidence && out && out.ok) { try { await evidence({ userId, actionId, outcome }); } catch (e) { console.warn('[skills] evidence skipped:', e.message); } } return out; };
  r.post('/:id/edit', wrap(async (req, res, userId) => reply(res, await note(userId, req.params.id, 'edited', await gate.edit({ userId, id: req.params.id, steps: req.body?.steps, title: req.body?.title })))));
  r.post('/:id/reject', wrap(async (req, res, userId) => reply(res, await withRun(userId, req.params.id, await note(userId, req.params.id, 'rejected', await gate.reject({ userId, id: req.params.id, reason: req.body?.reason }))))));
  r.post('/:id/approve', wrap(async (req, res, userId) => {
    const out = await gate.approve({ userId, id: req.params.id, planHash: req.body?.planHash });
    if (out.ok && out.action && out.action.status === 'executed') await note(userId, req.params.id, 'approved', out);   // a failed run says nothing about the skill
    return reply(res, await withRun(userId, req.params.id, out));
  }));
  return r;
}

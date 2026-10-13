// routes/agent.js — mounted at /api/agent (behind the global JWT guard in server.js)
//   GET  /api/agent/tools            what the agent may ever do (risk + reversible)
//   GET  /api/agent/pending          plans waiting for the user's decision
//   GET  /api/agent/recent           last decided/executed plans
//   POST /api/agent/propose          { title, steps:[{tool,args}] }  → creates a PENDING plan (runs nothing)
//   POST /api/agent/:id/edit         { steps, title? }               → new plan hash, still pending
//   POST /api/agent/:id/reject       { reason? }
//   POST /api/agent/:id/approve      { planHash }                    → the ONLY route that executes
import { Router } from 'express';
import { createGate } from '../lib/agent/gate.js';
import { prismaStore, memoryStore } from '../lib/agent/store.js';
import { toolMeta } from '../lib/agent/registry.js';

export function agentUserId(req, isProd) {
  return req.user?.id || (!isProd ? String(req.query?.userId || req.body?.userId || 'u1') : null);
}

export function makeGate({ prisma, isHalted }) {
  const store = prisma && prisma.agentAction ? prismaStore(prisma) : memoryStore();   // memory fallback if `prisma db push` wasn't run yet
  if (!(prisma && prisma.agentAction)) console.warn('[agent] prisma.agentAction missing — using in-memory store. Run: npx prisma db push');
  return createGate({ store, isHalted });
}

export function agentRouter({ gate, isProd = false }) {
  const r = Router();
  const wrap = (fn) => async (req, res) => {
    try {
      const userId = agentUserId(req, isProd);
      if (!userId) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      await fn(req, res, userId);
    } catch (e) {
      const bad = /step \d|plan needs|at most|unknown action|must be|too long|filename/.test(String(e.message));
      if (!bad) console.error('[agent] route error:', e);
      res.status(bad ? 400 : 500).json({ ok: false, error: bad ? e.message : 'agent error' });
    }
  };

  r.get('/tools', (_req, res) => res.json({ ok: true, tools: toolMeta() }));
  r.get('/pending', wrap(async (_req, res, userId) => res.json({ ok: true, actions: await gate.listPending(userId) })));
  r.get('/recent', wrap(async (req, res, userId) => res.json({ ok: true, actions: await gate.listRecent(userId, req.query.limit) })));
  r.post('/propose', wrap(async (req, res, userId) => {
    const b = req.body || {};
    const action = await gate.propose({ userId, title: b.title, steps: b.steps, conversationId: b.conversationId || null, source: 'user' });
    res.status(201).json({ ok: true, action });
  }));
  const reply = (res, out) => out.ok ? res.json(out) : res.status(out.code || 400).json(out);
  r.post('/:id/edit', wrap(async (req, res, userId) => reply(res, await gate.edit({ userId, id: req.params.id, steps: req.body?.steps, title: req.body?.title }))));
  r.post('/:id/reject', wrap(async (req, res, userId) => reply(res, await gate.reject({ userId, id: req.params.id, reason: req.body?.reason }))));
  r.post('/:id/approve', wrap(async (req, res, userId) => reply(res, await gate.approve({ userId, id: req.params.id, planHash: req.body?.planHash }))));
  return r;
}

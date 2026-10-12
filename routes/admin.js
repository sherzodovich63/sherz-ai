// routes/admin.js
//
// Sovereign-admin API. Mounted at /admin (NOT under /api — see
// middleware/adminAuth.js for why). Every route sits behind adminRequired.
//
//   GET  /admin/status                 kill-switch state + what's actually running
//   POST /admin/kill-switch/engage     { scopes?: ['background','expert'], reason? }
//   POST /admin/kill-switch/disengage
//   POST /admin/session/reset          { userId }  or  { all:true, confirm:'RESET_ALL' }
//   GET  /admin/audit?limit=50
//
// Admin requests skip friction (no confirmation dialogs, no rate limiting,
// reason is optional on engage) — EXCEPT the one irreversible-at-scale action,
// a global session reset, which needs an explicit confirm string. That isn't
// distrust of the caller; it's a typo guard on a bulk delete.
//
// Dependencies are injected rather than imported so this module has no
// knowledge of brain.js / server.js internals:
//   getRuntimeStatus()      -> what server.js has actually started/paused
//   resetFriendBrainState() -> clears brain.js's in-memory conversational state

import express from 'express';
import { adminRequired } from '../middleware/adminAuth.js';
import * as killSwitch from '../lib/killSwitch.js';
import { recordAdminEvent, getRecentAdminEvents } from '../lib/adminAudit.js';

async function attempt(label, fn) {
  try {
    return { label, ok: true, ...(await fn()) };
  } catch (e) {
    return { label, ok: false, error: e?.message || String(e) };
  }
}

export default function adminRouter({ prisma, getRuntimeStatus, resetFriendBrainState }) {
  const r = express.Router();
  r.use(adminRequired);

  r.get('/status', (req, res) => {
    res.json({
      ok: true,
      killSwitch: killSwitch.getState(),
      runtime: getRuntimeStatus(),
    });
  });

  r.post('/kill-switch/engage', (req, res) => {
    const body = req.body || {};
    const scopes = body.scopes === undefined ? [...killSwitch.KILL_SCOPES] : body.scopes;

    if (
      !Array.isArray(scopes) ||
      scopes.length === 0 ||
      !scopes.every((s) => killSwitch.KILL_SCOPES.includes(s))
    ) {
      return res.status(400).json({ ok: false, error: 'INVALID_SCOPES', validScopes: killSwitch.KILL_SCOPES });
    }

    const reason = String(body.reason || 'manual').trim().slice(0, 200) || 'manual';
    const state = killSwitch.engage({ scopes, reason, by: 'admin-api' });
    recordAdminEvent({ action: 'kill_switch_engage', ip: req.ip, details: { scopes, reason } });

    // runtime is read AFTER engage() so the response shows what actually halted
    return res.json({ ok: true, killSwitch: state, runtime: getRuntimeStatus() });
  });

  r.post('/kill-switch/disengage', (req, res) => {
    const state = killSwitch.disengage();
    recordAdminEvent({ action: 'kill_switch_disengage', ip: req.ip });
    return res.json({ ok: true, killSwitch: state, runtime: getRuntimeStatus() });
  });

  // Session reset = runtime/continuity state ONLY. It never touches messages,
  // memory facts, profile, emotion logs, tone events, or proactive policy.
  r.post('/session/reset', async (req, res) => {
    const { userId, all, confirm } = req.body || {};
    const isGlobal = all === true;

    if (isGlobal) {
      if (confirm !== 'RESET_ALL') {
        return res.status(400).json({
          ok: false,
          error: 'CONFIRM_REQUIRED',
          hint: 'send {"all":true,"confirm":"RESET_ALL"}',
        });
      }
    } else if (typeof userId !== 'string' || !userId.trim()) {
      return res.status(400).json({ ok: false, error: 'USER_ID_REQUIRED' });
    }

    const where = isGlobal ? {} : { userId: userId.trim() };

    const steps = [];
    steps.push(
      await attempt('friendBrainState', async () => {
        resetFriendBrainState(isGlobal ? undefined : userId.trim());
        return { note: isGlobal ? 'in-memory conversational state cleared for ALL users' : 'in-memory conversational state cleared for this user only' };
      })
    );
    steps.push(
      await attempt('brainStateRows', async () => {
        if (!prisma?.brainState?.deleteMany) return { skipped: 'no brainState model' };
        const r2 = await prisma.brainState.deleteMany({ where });
        return { deleted: r2.count };
      })
    );
    steps.push(
      await attempt('lastStateFacts', async () => {
        if (!prisma?.fact?.deleteMany) return { skipped: 'no fact model' };
        const r2 = await prisma.fact.deleteMany({ where: { ...where, key: 'last_state' } });
        return { deleted: r2.count };
      })
    );

    recordAdminEvent({
      action: 'session_reset',
      ip: req.ip,
      ok: steps.every((s) => s.ok),
      details: { scope: isGlobal ? 'all' : userId.trim(), steps: steps.map((s) => ({ label: s.label, ok: s.ok })) },
    });

    return res.status(steps.every((s) => s.ok) ? 200 : 207).json({
      ok: steps.every((s) => s.ok),
      scope: isGlobal ? 'all' : userId.trim(),
      steps,
    });
  });

  r.get('/audit', (req, res) => {
    res.json({ ok: true, events: getRecentAdminEvents(req.query.limit) });
  });

  return r;
}
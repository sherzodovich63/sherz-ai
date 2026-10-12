// lib/killSwitch.js
//
// Process-wide emergency halt state. Two independent scopes:
//   'background' — proactive runner + reminder cron + any proactive delivery
//   'expert'     — Expert Mode (refuses new turns, aborts in-flight tool loops)
// Normal chat is deliberately NOT a scope: the point of a kill-switch is to
// stop autonomous/privileged activity, not to take the app down.
//
// ⚠️ State is in-memory: a restart clears it. To make a halt survive restarts
// (e.g. a crash-looping deploy), set SHERZ_KILL_SWITCH=1 in the environment —
// the process then boots already engaged for all scopes. There is no DB
// persistence on purpose: Fact/ProactivePolicy are per-user tables, and this
// is global state.

import { EventEmitter } from 'node:events';

export const KILL_SCOPES = Object.freeze(['background', 'expert']);

const bus = new EventEmitter();

const IDLE = () => ({ engaged: false, scopes: [], reason: null, engagedAt: null, engagedBy: null });
let state = IDLE();

(function bootFromEnv() {
  const v = String(process.env.SHERZ_KILL_SWITCH || '').trim().toLowerCase();
  if (v === '1' || v === 'true') {
    state = {
      engaged: true,
      scopes: [...KILL_SCOPES],
      reason: 'SHERZ_KILL_SWITCH set at boot',
      engagedAt: new Date().toISOString(),
      engagedBy: 'env',
    };
  }
})();

export function getState() {
  return { ...state, scopes: [...state.scopes] };
}

export function isEngaged(scope) {
  return state.engaged && state.scopes.includes(scope);
}

/** Engaging again extends the scope set (union) and updates the reason. */
export function engage({ scopes = KILL_SCOPES, reason = 'manual', by = 'unknown' } = {}) {
  const valid = (Array.isArray(scopes) ? scopes : []).filter((s) => KILL_SCOPES.includes(s));
  if (!valid.length) throw new Error('killSwitch.engage: no valid scopes');
  state = {
    engaged: true,
    scopes: Array.from(new Set([...state.scopes, ...valid])),
    reason,
    engagedAt: state.engagedAt || new Date().toISOString(),
    engagedBy: by,
  };
  bus.emit('change', getState());
  return getState();
}

export function disengage() {
  const wasEngaged = state.engaged;
  state = IDLE();
  if (wasEngaged) bus.emit('change', getState());
  return getState();
}

/** Subscribe to state changes. Returns an unsubscribe function. */
export function onChange(fn) {
  bus.on('change', fn);
  return () => bus.off('change', fn);
}
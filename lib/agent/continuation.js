// lib/agent/continuation.js — Phase 3b: after the user approved (or a folder consent was given) the model gets ONE more turn.
// It sees what happened — including failures — and either finishes, observes more, or proposes the next / a CORRECTED plan.
// That next plan is a normal pending plan: the user approves each state-changing batch.
import { buildContinuationMessage } from './react.js';
import { BUDGET } from './runs.js';

const inFlight = new Set();

/**
 * buildTurn({ run, message }) → { content, plans, consents, run }   (server.js supplies it; it calls runExpertTurn with history)
 * saveReply({ run, text })    → persists the assistant text into the conversation
 */
export async function continueRun({ userId, runId, reason = 'result', runs, gate, consent, buildTurn, saveReply = async () => {}, budget = BUDGET }) {
  if (inFlight.has(runId)) return { ok: false, code: 409, error: 'already working on this' };
  inFlight.add(runId);
  try {
    let run = await runs.get(userId, runId);
    if (!run) return { ok: false, code: 404, error: 'task not found' };

    let message, key;
    if (reason === 'consent') {
      if (run.status !== 'active') return { ok: false, code: 409, error: `task is ${run.status}` };
      key = 'consent:' + (runs.stats(run).consumed || []).length + ':' + String(run.updatedAt);
      message = `[AGENT RESULT — system message, not written by the user] The user has now allowed you to read the folder you asked about. Continue the task: ${String(run.goal).replace(/<<<|>>>/g, '')}`;
    } else {
      const raw = run.lastActionId ? await gate.get(userId, run.lastActionId) : null;
      if (!raw) return { ok: false, code: 409, error: 'nothing to continue from' };
      if (raw.status !== 'executed' && raw.status !== 'failed') return { ok: false, code: 409, error: `the plan is ${raw.status}` };
      if (run.status !== 'active') return { ok: false, code: 409, error: `task is ${run.status}` };
      key = raw.id;
      const action = { title: raw.title, status: raw.status, planHash: raw.planHash, steps: raw.plan, results: raw.result };
      const b0 = await runs.beginContinuation(run, key);
      if (!b0.ok) { if (b0.budget) await runs.finish(run, 'budget'); return { ok: false, code: 409, error: b0.error }; }
      run = b0.run;
      message = buildContinuationMessage({ run, action, stats: runs.stats(run), budget });
    }
    if (reason === 'consent') {
      const b = await runs.beginContinuation(run, key);
      if (!b.ok) { if (b.budget) await runs.finish(run, 'budget'); return { ok: false, code: 409, error: b.error }; }
      run = b.run;
    }

    const turn = await buildTurn({ run, message });
    const text = String(turn?.content || '').trim();
    if (text) { try { await saveReply({ run, text }); } catch { /* persistence is best-effort */ } }
    const after = turn?.run || run;
    return { ok: true, text, plans: turn?.plans || [], consents: turn?.consents || [], run: { id: after.id, status: after.status } };
  } finally { inFlight.delete(runId); }
}

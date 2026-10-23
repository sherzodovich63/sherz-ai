// lib/agent/intentGrant.js — "WHY may I act without asking?" as code the SERVER enforces.
//
// The model reasons about boundaries (see brain/corePersona.js, section 6), but its reasoning is never the authority:
// a prompt-injected file could make a model "believe" the user asked for something. So the facts are re-checked here,
// from data the model cannot write: the user's real message, the tool registry, and the run's taint flag.
//
// Two kinds of effect:
//   CHAT boundary   the whole effect stays inside SHERZ's own file area for this user (a tool declared `scope:'chat'`)
//                   → may run WITHOUT a click, but only when ALL of these hold:
//                     • the plan was proposed by the assistant in this turn (source 'assistant')
//                     • every step is a chat-scope, low-risk tool, and there are at most CHAT_MAX_STEPS steps
//                     • the user's OWN message explicitly asked for such a file (wantsDocFile on the real text)
//                     • the run has not read the user's files / external data (not tainted → nothing untrusted can have steered the plan)
//                     • the hourly cap is not used up
//   Everything else (touches the user's computer, sends something out, acts without a direct request, unknown tool)
//   → the normal Approve button. A tool with no `scope` declared can never auto-run: default is ASK.
//
// Pure functions: no DB, no network, no clock.
import { TOOLS } from './registry.js';
import { wantsDocFile, wantsImage } from '../docs/intent.js';

export const CHAT_MAX_STEPS = 3;
export const CHAT_PER_HOUR = 30;
export const GRANT = 'explicit_request';

/** the sentences SHERZ reasons with — also shown to the model in the tool result and kept in the audit trail */
export const THOUGHTS = Object.freeze({
  chat: 'The user explicitly asked me for this in our chat, and it only creates a file inside their own SHERZ file area. Producing requested content within the chat boundary is expected, safe and requested, so no permission is needed.',
  device: 'This touches the user\'s own computer (their files or folders), so it crosses a system boundary. I must ask for permission first.',
  external: 'This acts outside the chat (it could send something to someone or change something I cannot see), so it crosses a system boundary. I must ask for permission first.',
  unrequested: 'The user\'s message did not ask for this, so I must not act on my own. I must ask first.',
  untrusted: 'I have read the user\'s files or external data in this task, and that content may have influenced this plan, so I must ask first.',
  limit: 'Too many things have already run by themselves this hour, so I must ask first.',
  size: 'This is a bigger batch than I may run on my own, so I must ask first.',
  unknown: 'I cannot prove this stays inside the chat, so I must ask first.',
});

/** where does ONE step's effect land? */
export function scopeOfTool(name) {
  const t = TOOLS[name];
  if (!t) return 'unknown';
  if (t.target === 'helper') return 'device';
  if (t.scope === 'chat' && t.risk === 'low') return 'chat';
  return 'external';                      // declared nothing → treated as outside the boundary
}

/** where does the whole plan land? The widest boundary any step crosses wins. */
export function scopeOfPlan(plan) {
  const sc = (Array.isArray(plan) ? plan : []).map((s) => scopeOfTool(s?.tool));
  if (!sc.length) return 'unknown';
  for (const w of ['unknown', 'device', 'external']) if (sc.includes(w)) return w;
  return 'chat';
}

/**
 * plan: [{tool,...}] · userText: the user's REAL message (for a follow-up turn: the original goal, never the system's own report)
 * returns { decision:'auto'|'ask', scope, reason, thought, basis }
 */
export function decideChatBoundary({ plan, source = 'user', userText = '', tainted = false, autoRunsLastHour = 0 } = {}) {
  const scope = scopeOfPlan(plan);
  const ask = (reason, thought) => ({ decision: 'ask', scope, reason, thought, basis: [] });
  try {
    if (!Array.isArray(plan) || !plan.length) return ask('empty plan', THOUGHTS.unknown);
    if (scope === 'device') return ask('touches the user\'s computer', THOUGHTS.device);
    if (scope === 'external') return ask('acts outside the chat', THOUGHTS.external);
    if (scope !== 'chat') return ask('cannot prove it stays inside the chat', THOUGHTS.unknown);
    if (source !== 'assistant') return ask('plan was not proposed by the assistant', THOUGHTS.unknown);
    if (plan.length > CHAT_MAX_STEPS) return ask('too many steps to run by itself', THOUGHTS.size);
    const said = String(userText || '');
    if (/^\s*\[AGENT RESULT/i.test(said)) return ask('that text is the system\'s own report, not the user\'s message', THOUGHTS.unrequested);
    if (!plan.every((st) => (st?.tool === 'docs.create_image' ? wantsImage(said) : wantsDocFile(said)))) return ask('the user\'s message did not ask for a file', THOUGHTS.unrequested);   // a picture needs a request for a picture
    if (tainted) return ask('the task already read the user\'s files or external data', THOUGHTS.untrusted);
    if (autoRunsLastHour >= CHAT_PER_HOUR) return ask(`hourly limit reached (${CHAT_PER_HOUR})`, THOUGHTS.limit);
    return {
      decision: 'auto', scope, reason: 'explicit request · inside the chat boundary', thought: THOUGHTS.chat,
      basis: plan.map((s) => ({ tool: s.tool, level: GRANT, count: 0 })),
    };
  } catch (e) {
    return ask('boundary check failed: ' + String(e.message || e), THOUGHTS.unknown);       // any doubt → the normal approval
  }
}

/**
 * What the MODEL is told right after it proposed a plan. It must speak accurately: "creating it now" vs "waiting for approval".
 * Uses the same decision the server will make a moment later (the hourly cap is the only thing that can still differ).
 */
export function proposalToolResult({ action, then = null, userText = '', tainted = false } = {}) {
  const d = decideChatBoundary({ plan: action?.steps || action?.plan, source: 'assistant', userText, tainted });
  if (d.decision === 'auto') {
    return {
      ok: true, planId: action.id, status: 'runs_automatically',
      note: `${d.thought} It runs right after your reply: the user will see a ✓ card with a Download button and the file also downloads to their device by itself. `
        + 'Tell them in one short sentence that you are creating it. Do NOT say it is waiting for approval, and do NOT paste the table or code into the chat instead.',
    };
  }
  return {
    ok: true, planId: action?.id, status: 'awaiting_user_approval',
    note: `${d.thought} The plan is shown to the user with Approve/Reject buttons. NOTHING has been executed. Tell the user briefly why you are asking and that it is waiting for their approval`
      + (then ? ' — you will receive the results and can continue.' : '.'),
  };
}

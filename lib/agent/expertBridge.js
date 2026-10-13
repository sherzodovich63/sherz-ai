// lib/agent/expertBridge.js — the ONLY thing the model gets: a tool that PROPOSES a plan.
// It cannot approve or run anything; the plan lands in the user's chat as an Approve / Reject card.
import { TOOLS } from './registry.js';

export const PROPOSE_TOOL_NAME = 'propose_action_plan';

export function agentToolSchemas() {
  return [{
    type: 'function',
    function: {
      name: PROPOSE_TOOL_NAME,
      description:
        'Propose a step-by-step plan of REAL actions for the user to approve. Nothing runs until the user clicks Approve. ' +
        'Use it whenever the user asks you to create, change or delete something outside the chat. ' +
        'After calling it, tell the user briefly that the plan is waiting for their approval — never say it was already done. ' +
        'Allowed actions: ' + Object.keys(TOOLS).join(', ') + '. ' +
        'sandbox.write_note {filename:"x.md", content}, sandbox.delete_note {filename}, sandbox.list_notes {}.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short plan title' },
          steps: {
            type: 'array', maxItems: 8,
            items: {
              type: 'object',
              properties: { tool: { type: 'string', enum: Object.keys(TOOLS) }, args: { type: 'object' } },
              required: ['tool'],
            },
          },
        },
        required: ['title', 'steps'],
      },
    },
  }];
}

/** Handle the model's call. Returns the text-safe result for the model plus the public plan for the UI (or null). */
export async function handleProposeCall({ gate, args, userId, conversationId }) {
  try {
    const action = await gate.propose({ userId, title: args?.title, steps: args?.steps, conversationId: conversationId || null, source: 'assistant' });
    return {
      toolResult: { ok: true, planId: action.id, status: 'awaiting_user_approval', note: 'The plan is shown to the user with Approve/Reject buttons. NOTHING has been executed. Tell the user it is waiting for their approval.' },
      plan: action,
    };
  } catch (e) {
    return { toolResult: { ok: false, error: String(e.message || e) }, plan: null };
  }
}

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
        'Use it whenever the user asks you to create, change or delete something outside the chat. One batch at a time: later steps that depend on what earlier steps find belong in a LATER plan. ' +
        'After calling it, tell the user briefly that the plan is waiting for their approval — never say it was already done. ' +
        'Allowed actions: ' + Object.keys(TOOLS).join(', ') + '. ' +
        'sandbox.write_note {filename:"x.md", content}, sandbox.delete_note {filename}, sandbox.list_notes {}. ' +
        'Files on the USER\'S OWN COMPUTER (one shared folder, paths relative to it, never absolute): ' +
        'files.list {path}, files.read {path}, files.mkdir {path}, files.write {path, content, overwrite?:boolean}, ' +
        'files.move {from, to}, files.delete {path} (moves to a trash folder). ' +
        'These need the user\'s helper program to be running; if it is not connected they will be told how to start it. ' +
        'DOCUMENTS you build yourself (saved to the user\'s SHERZ file area with a Download button; no helper needed): ' +
        'docs.create_xlsx {filename, sheets:[{name, columns:[{header, format?:"text|number|integer|currency|percent|date", currency?:"USD", width?}], rows:[[cell,...]], freezeHeader?, autoFilter?}]} — ' +
        'a cell is text, a number, true/false, {"f":"=SUM(B2:B9)"} for a formula (only plain functions like SUM, AVERAGE, IF, ROUND, VLOOKUP, SUMIF; no links or other files) or {"d":"2026-10-16"} for a date; ' +
        'docs.create_docx {filename, title?, subtitle?, footer?, pageSize?:"A4|Letter", blocks:[{type:"heading",level:1-3,text} | {type:"paragraph",text,align?} | {type:"bullets",items:[]} | {type:"numbered",items:[]} | {type:"table",header?:[],rows:[[]]} | {type:"pagebreak"}]} — ' +
        'docs.create_pdf {same fields and blocks as docs.create_docx} for a PDF; docs.create_pptx {filename, title?, slides:[{layout:"title|section|bullets|text|table", title, subtitle?, bullets?:[up to 12 short lines], text?, table?:{header?,rows}, notes?}]} for a PowerPoint (one idea per slide, short bullets, max 40 slides). Text in Word/PDF may use **bold** and *italic*. Put real, complete content in the file: never placeholders, and never invent figures the user did not give you.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short plan title' },
          then: { type: 'string', description: 'Only if this plan is NOT the end of the task: one sentence on what you will do after it runs (you will be given the results). Omit when this plan completes the task.' },
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
export async function handleProposeCall({ gate, args, userId, conversationId, helper = null }) {
  try {
    const action = await gate.propose({ userId, title: args?.title, steps: args?.steps, conversationId: conversationId || null, source: 'assistant' });
    return {
      toolResult: { ok: true, planId: action.id, status: 'awaiting_user_approval', helperConnected: helper ? await helper.online(userId) : undefined, note: 'The plan is shown to the user with Approve/Reject buttons. NOTHING has been executed. Tell the user it is waiting for their approval.' },
      plan: action,
    };
  } catch (e) {
    return { toolResult: { ok: false, error: String(e.message || e) }, plan: null };
  }
}

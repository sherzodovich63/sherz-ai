// lib/agent/expertBridge.js — the ONLY thing the model gets: a tool that PROPOSES a plan.
// It cannot approve or run anything; the plan lands in the user's chat as an Approve / Reject card.
import { TOOLS } from './registry.js';
import { proposalToolResult } from './intentGrant.js';

export const PROPOSE_TOOL_NAME = 'propose_action_plan';

export function agentToolSchemas() {
  return [{
    type: 'function',
    function: {
      name: PROPOSE_TOOL_NAME,
      description:
        'Propose a step-by-step plan of REAL actions. Think first about WHERE the effect lands: a document you build inside SHERZ\'s own file area (docs.create_*) that the user explicitly asked for in their message runs automatically; anything that touches the user\'s computer, sends something to someone, or was not asked for waits until the user clicks Approve. The tool result tells you which one happened. ' +
        'Use it whenever the user asks you to create, change or delete something outside the chat. One batch at a time: later steps that depend on what earlier steps find belong in a LATER plan. ' +
        'After calling it, follow the tool result: if it says the plan runs automatically, tell the user in one short sentence that you are creating the file; if it says awaiting approval, say briefly why and that it is waiting. Never claim something is done before it ran. ' +
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
        'docs.create_pdf {same fields and blocks as docs.create_docx} for a PDF; docs.create_pptx {filename, title?, slides:[{layout:"title|section|bullets|text|table", title, subtitle?, bullets?:[up to 12 short lines], text?, table?:{header?,rows}, notes?}]} for a PowerPoint (one idea per slide, short bullets, max 40 slides). docs.create_text {filename, format?:"txt|md", content} for a plain text or Markdown file (the content is written exactly as given); docs.create_image {prompt, filename?, size?:"square|portrait|landscape"} to DRAW a picture, logo or illustration — write the prompt in English, rich and concrete (subject, style, colours, composition, mood; for a logo: simple, flat, vector-style, no tiny text), and keep any words the user wants shown on the picture short and exact. Text in Word/PDF may use **bold** and *italic*. Put real, complete content in the file: never placeholders, and never invent figures the user did not give you.',
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
export async function handleProposeCall({ gate, args, userId, conversationId, helper = null, userText = '', tainted = false }) {
  try {
    const action = await gate.propose({ userId, title: args?.title, steps: args?.steps, conversationId: conversationId || null, source: 'assistant' });
    return {
      toolResult: { ...proposalToolResult({ action, userText, tainted }), helperConnected: helper ? await helper.online(userId) : undefined },
      plan: action,
    };
  } catch (e) {
    return { toolResult: { ok: false, error: String(e.message || e) }, plan: null };
  }
}

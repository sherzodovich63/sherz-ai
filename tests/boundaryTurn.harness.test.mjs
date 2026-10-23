// Drives the REAL brain/expertTurn.js: "WHY may I act without asking?" end to end.
// An explicit file request builds the file inside the turn; anything else (not asked for, tainted run, device) stays a pending plan.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sherz-harness-'));
const w = async (rel, code) => { const f = path.join(root, rel); await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, code); };
await fs.cp(path.join(here, '..', 'lib'), path.join(root, 'lib'), { recursive: true });
await fs.copyFile(path.join(here, '..', 'brain', 'expertTurn.js'), path.join(root, 'brain', 'expertTurn.js')).catch(async () => { await fs.mkdir(path.join(root, 'brain'), { recursive: true }); await fs.copyFile(path.join(here, '..', 'brain', 'expertTurn.js'), path.join(root, 'brain', 'expertTurn.js')); });
await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
await fs.symlink(path.join(here, '..', 'node_modules'), path.join(root, 'node_modules'), 'dir').catch(() => {});   // exceljs etc. for the real file builders
await w('llm/openaiClient.js', `export const script = { calls: [], queue: [] };
export const openai = { chat: { completions: { async create(req) { script.calls.push(req); const next = script.queue.shift(); if (!next) return { choices: [{ message: { content: 'done' } }] }; return { choices: [{ message: typeof next === 'function' ? next(req) : next }] }; } } } };`);
await w('brain/safety.js', `export async function runSafety() { return { ok: true }; }`);
await w('brain/systemPrompt.js', `export function buildSystemPrompt() { return 'sys'; }`);
await w('brain/policy/responsePolicy.js', `export function decideResponsePolicy() { return {}; }`);
await w('brain/responseComposer.js', `export function buildResponseInstruction() { return ''; }`);
await w('brain/userContextAnalyzer.js', `export function userContextAnalyzer() { return {}; }`);
await w('nlu/detectEmotion.js', `export function detectEmotion() { return {}; }`);
await w('nlu/nameStyleExtractor.js', `export function extractNameAndStyle() { return {}; }`);
await w('brain/brain.js', `export const normalizeRecentMessages = (m) => m; export const normalizeEmotion = (e) => e; export const writeEmotionLog = async () => {}; export const getEmotionSummary = async () => ({}); export const getFriendBrainState = () => ({});`);
await w('brain/systemContext.js', `export async function buildFullSystemContext() { return { systemPrompt: 'BASE PROMPT' }; }`);
await w('brain/tools.js', `export const getToolSchemas = () => [{ type: 'function', function: { name: 'web_fetch', description: 'fetch', parameters: { type: 'object', properties: {} } } }, { type: 'function', function: { name: 'code_analysis', description: 'x', parameters: { type: 'object', properties: {} } } }]; export async function executeTool(n) { return { ok: true, ran: n }; }`);
await w('brain/expertModePermissions.js', `export const isExpertModeAllowed = async () => ({ allowed: true }); export const isToolAllowed = () => ({ allowed: true });`);
await w('lib/killSwitch.js', `export const isEngaged = () => false;`);

const { runExpertTurn } = await import(pathToFileURL(path.join(root, 'brain/expertTurn.js')).href);
const { script } = await import(pathToFileURL(path.join(root, 'llm/openaiClient.js')).href);
const { createGate } = await import(pathToFileURL(path.join(root, 'lib/agent/gate.js')).href);
const { memoryStore } = await import(pathToFileURL(path.join(root, 'lib/agent/store.js')).href);
const { createRuns, memoryRunStore } = await import(pathToFileURL(path.join(root, 'lib/agent/runs.js')).href);
const { createConsent, memorySettingsStore } = await import(pathToFileURL(path.join(root, 'lib/agent/consent.js')).href);
const { createTrust, memoryTrustStore } = await import(pathToFileURL(path.join(root, 'lib/agent/trust.js')).href);

const { setFileStore, memoryFileStore } = await import(pathToFileURL(path.join(root, 'lib/docs/store.js')).href);
const fstore = setFileStore(memoryFileStore());
const call = (name, args, id = 'c' + Math.random()) => ({ content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const files = { 'notes/a.md': 'alpha' };
const helper = { online: async () => true, async exec(_u, tool, args) {
  if (tool === 'files.read') return { path: args.path, bytes: 5, content: files[args.path] };
  if (tool === 'files.list') return { path: args.path, entries: [{ name: 'a.md', type: 'file', size: 5 }], truncated: false };
  throw new Error('no ' + tool);
} };
function env() {
  script.calls.length = 0; script.queue.length = 0;
  const gate = createGate({ store: memoryStore(), helper, log: { warn() {} } });   // note: NO autonomy passed to runExpertTurn below
  return { gate, runs: createRuns({ store: memoryRunStore() }), consent: createConsent({ store: memorySettingsStore() }), trust: createTrust({ store: memoryTrustStore() }) };
}
const turn = (e, text, extra = {}) => runExpertTurn({ userId: 'u', messages: [{ role: 'user', content: text }], prisma: {}, agentGate: e.gate, helperHub: helper, trust: e.trust, runs: e.runs, consent: e.consent, conversationId: 'c1', maxToolHops: 8, ...extra });
const XLSX_PLAN = { title: 'Xarajatlar jadvali', steps: [{ tool: 'docs.create_xlsx', args: { filename: 'xarajatlar', sheets: [{ name: 'Hafta', columns: [{ header: 'Nom' }, { header: 'Summa', format: 'number' }], rows: [['Ijara', 900], ['Oziq-ovqat', 300]] }] } }] };
const toolMsg = (n = 1) => script.calls[n].messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content));

test('turn: an explicit file request is built inside the turn — no Approve click, the model is told the truth, a Download id comes back', async () => {
  const e = env();
  script.queue.push(call('propose_action_plan', XLSX_PLAN), { content: 'Excel faylni yaratyapman.' });
  const r = await turn(e, 'Excel fayl yaratib ber: haftalik xarajatlar jadvali');
  assert.equal(toolMsg()[0].status, 'runs_automatically'); assert.match(toolMsg()[0].note, /Do NOT say it is waiting for approval/);
  assert.equal(r.plans.length, 1); assert.equal(r.plans[0].status, 'executed');
  assert.equal(r.plans[0].auto.grant, 'explicit_request'); assert.match(r.plans[0].auto.thought, /explicitly asked/);
  const out = r.plans[0].results[0].output; assert.ok(out.fileId && out.download); assert.ok(await fstore.get('u', out.fileId));
  assert.equal(r.content, 'Excel faylni yaratyapman.');
});
test('turn: a plan the user did not ask for stays pending, and the model is told to ask (its own reasoning, not a blind box)', async () => {
  const e = env();
  script.queue.push(call('propose_action_plan', XLSX_PLAN), { content: 'Tasdiqlashingizni kutyapman.' });
  const r = await turn(e, 'salom, bugun nima qilsam ekan?');
  assert.equal(toolMsg()[0].status, 'awaiting_user_approval'); assert.match(toolMsg()[0].note, /did not ask for this/);
  assert.equal(r.plans[0].status, 'pending');
});
test('turn: after reading the user\'s file the run is tainted — even an explicit request is asked about first', async () => {
  const e = env(); await e.consent.grant('u', 'notes');
  script.queue.push(call('observe', { tool: 'files.read', args: { path: 'notes/a.md' } }), call('propose_action_plan', XLSX_PLAN), { content: 'Tasdiq kerak.' });
  const r = await turn(e, 'notes/a.md ni o\'qib, Excel fayl yaratib ber');
  const last = toolMsg(2); assert.equal(last[last.length - 1].status, 'awaiting_user_approval'); assert.match(last[last.length - 1].note, /read the user's files or external data/);
  assert.equal(r.plans[0].status, 'pending');
});
test('turn: a plan that touches the user\'s computer is always asked about, even next to a requested file', async () => {
  const e = env();
  script.queue.push(call('propose_action_plan', { title: 'mixed', steps: [XLSX_PLAN.steps[0], { tool: 'files.mkdir', args: { path: 'Reports' } }] }), { content: 'ok' });
  const r = await turn(e, 'Excel fayl yaratib ber va kompyuterimda Reports papka och');
  assert.equal(toolMsg()[0].status, 'awaiting_user_approval'); assert.match(toolMsg()[0].note, /own computer/);
  assert.equal(r.plans[0].status, 'pending');
});

test('turn: a made-up download link ([..](sandbox:/x.xlsx)) is never shown — the model is sent back to call the tool, and the real file is built', async () => {
  const e = env();
  script.queue.push({ content: '[Excel jadvalini yuklab olish uchun shu yerga bosing](sandbox:/Xarajatlar_Jadvali.xlsx)' }, call('propose_action_plan', XLSX_PLAN), { content: 'Tayyor, pastdagi tugmadan yuklab oling.' });
  const r = await turn(e, 'manga excel jadval qilib ber');
  assert.ok(script.calls[1].messages.some((m) => m.role === 'system' && /download link that does not exist/.test(m.content)), 'model was told');
  assert.ok(!script.calls[1].messages.some((m) => /sandbox:/.test(String(m.content)) && m.role === 'assistant'), 'the fake draft was dropped, not kept in context');
  assert.equal(r.plans.length, 1); assert.equal(r.plans[0].status, 'executed'); assert.ok(r.plans[0].results[0].output.download);
  assert.ok(!/sandbox:/.test(r.content));
});
test('turn: if the model insists on a fake link, it is stripped from the reply (retry only once)', async () => {
  const e = env();
  script.queue.push({ content: 'Mana: [fayl](sandbox:/a.xlsx)' }, { content: 'Yana: [fayl](sandbox:/a.xlsx) tayyor' });
  const r = await turn(e, 'salom');
  assert.equal(script.calls.length, 2); assert.ok(!/sandbox:/.test(r.content)); assert.match(r.content, /fayl tayyor/);
});
test('turn: "Xarajatlar haqida" answering SHERZ\'s question still counts as the explicit file request → the file is built', async () => {
  const e = env();
  script.queue.push(call('propose_action_plan', XLSX_PLAN), { content: 'Tayyor.' });
  const messages = [{ role: 'user', content: 'manga excel jadval qilib ber' }, { role: 'assistant', content: 'Qanaqa jadval kerak?' }, { role: 'user', content: 'Xarajatlar haqida' }];
  const r = await runExpertTurn({ userId: 'u', messages, prisma: {}, agentGate: e.gate, helperHub: helper, trust: e.trust, runs: e.runs, consent: e.consent, conversationId: 'c1', maxToolHops: 8, docRequest: 'manga excel jadval qilib ber' });
  assert.equal(r.plans[0].status, 'executed'); assert.equal(r.plans[0].auto.grant, 'explicit_request');
  // without the original request the same short answer would NOT be an explicit file request → it waits for a click
  const e2 = env(); script.queue.push(call('propose_action_plan', XLSX_PLAN), { content: 'Kutyapman.' });
  const r2 = await runExpertTurn({ userId: 'u', messages, prisma: {}, agentGate: e2.gate, helperHub: helper, trust: e2.trust, runs: e2.runs, consent: e2.consent, conversationId: 'c1', maxToolHops: 8 });
  assert.equal(r2.plans[0].status, 'pending');
});

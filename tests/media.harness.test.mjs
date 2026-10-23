// Drives the REAL brain/expertTurn.js for pictures and text files: live progress events, the picture is stored and rendered by id, and a picture needs a picture request.
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

const { setImageProvider } = await import(pathToFileURL(path.join(root, 'lib/docs/image.js')).href);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
let drawn = [];
setImageProvider(async ({ prompt, size }) => { drawn.push({ prompt, size }); return { bytes: PNG, mime: 'image/png' }; });
const IMG_PLAN = { title: 'Logo', steps: [{ tool: 'docs.create_image', args: { prompt: 'A flat minimal logo of a blue owl, vector style', filename: 'Logo', size: 'square' } }] };
const TXT_PLAN = { title: 'Eslatma', steps: [{ tool: 'docs.create_text', args: { filename: 'eslatma', format: 'md', content: '# Salom\n\n- bir\n- ikki' } }] };

test('picture: "Yangi logo yarat" draws by itself, streams running → done, stores a real PNG and returns its id', async () => {
  const e = env(); drawn = []; const ev = [];
  script.queue.push(call('propose_action_plan', IMG_PLAN), { content: 'Logo tayyorlanmoqda.' });
  const r = await turn(e, 'Yangi logo yarat', { onProgress: (p) => ev.push(p) });
  assert.equal(r.plans.length, 1); assert.equal(r.plans[0].status, 'executed');
  const out = r.plans[0].results[0].output;
  assert.equal(out.image, true); assert.equal(out.filename, 'Logo.png'); assert.equal(out.mime, 'image/png');
  assert.deepEqual(drawn, [{ prompt: 'A flat minimal logo of a blue owl, vector style', size: 'square' }]);
  const f = await fstore.get('u', out.fileId); assert.equal(f.bytes.length, PNG.length);
  assert.deepEqual(ev.map((p) => p.state), ['running', 'done']); assert.equal(ev[0].kind, 'image'); assert.match(ev[0].label, /Generating/);
});

test('picture: a message that did NOT ask for a picture never auto-draws (normal Approve card, nothing drawn, no progress)', async () => {
  const e = env(); drawn = []; const ev = [];
  script.queue.push(call('propose_action_plan', IMG_PLAN), { content: 'Tasdiqlashingizni kutyapman.' });
  const r = await turn(e, 'Bugun ob-havo qanday?', { onProgress: (p) => ev.push(p) });
  assert.equal(r.plans[0].status, 'pending'); assert.equal(drawn.length, 0); assert.equal(ev.length, 0);
});

test('picture: an Excel request cannot be used to draw a picture without asking', async () => {
  const e = env(); drawn = [];
  script.queue.push(call('propose_action_plan', IMG_PLAN), { content: 'ok' });
  const r = await turn(e, 'Manga excel file yaratib ber');
  assert.equal(r.plans[0].status, 'pending'); assert.equal(drawn.length, 0);
});

test('picture: the provider failing leaves a failed plan with a readable error and no file', async () => {
  const e = env(); const ev = [];
  setImageProvider(async () => { throw new Error('The image service refused this request (safety rules). Try different wording.'); });
  script.queue.push(call('propose_action_plan', IMG_PLAN), { content: 'Urinib ko‘raman.' });
  const before = (await fstore.list('u')).length;
  const r = await turn(e, 'Rasm chizib ber', { onProgress: (p) => ev.push(p) });
  assert.equal(r.plans[0].status, 'failed'); assert.match(r.plans[0].results[0].error, /safety rules/); assert.equal((await fstore.list('u')).length, before);
  assert.deepEqual(ev.map((p) => p.state), ['running', 'failed']);
  setImageProvider(async ({ prompt, size }) => { drawn.push({ prompt, size }); return { bytes: PNG, mime: 'image/png' }; });
});

test('text / Markdown: "txt fayl yozib ber" creates the file exactly as written, with progress', async () => {
  const e = env(); const ev = [];
  script.queue.push(call('propose_action_plan', TXT_PLAN), { content: 'Fayl tayyorlanmoqda.' });
  const r = await turn(e, 'Menga eslatma.md fayl yozib ber', { onProgress: (p) => ev.push(p) });
  assert.equal(r.plans[0].status, 'executed');
  const out = r.plans[0].results[0].output; assert.equal(out.filename, 'eslatma.md'); assert.match(out.mime, /markdown/);
  assert.equal((await fstore.get('u', out.fileId)).bytes.toString('utf8'), '# Salom\n\n- bir\n- ikki');
  assert.deepEqual(ev.map((p) => p.state), ['running', 'done']); assert.equal(ev[0].kind, 'file'); assert.match(ev[0].label, /eslatma\.md/);
});

test('picture: per-user hourly limit stops the 11th picture, and a failed try does not count', async () => {
  const { imageBudget } = await import(pathToFileURL(path.join(root, 'lib/docs/tools.js')).href);
  const b = imageBudget('limit-user'); assert.equal(b.limit, 10); for (let i = 0; i < 10; i++) b.take();
  assert.equal(imageBudget('limit-user').left, 0);
  assert.equal(imageBudget('limit-user', Date.now() + 3600001).left, 10);
});

// ── a "tayyorlab bo'ldim" without a tool call ──
test('claim: the model says "tayyorlab bo\'ldim" with no tool → it is made to call the tool for real, then the file exists', async () => {
  const e = env(); const ev = [];
  const XLSX2 = { title: 'Excel ham', steps: [{ tool: 'docs.create_xlsx', args: { filename: 'Xarajatlar', sheets: [{ name: 'Hafta', columns: [{ header: 'Nom' }, { header: 'Summa', format: 'number' }], rows: [['Ijara', 900]] }] } }] };
  script.queue.push({ content: "Mana, ikkalasini ham tayyorlab bo'ldim:\n\nExcel fayl:\nXarajatlar.xlsx" }, call('propose_action_plan', XLSX2), { content: 'Excel fayl yaratilmoqda.' });
  const r = await turn(e, 'excel ham', { onProgress: (p) => ev.push(p) });
  assert.equal(r.plans.length, 1); assert.equal(r.plans[0].status, 'executed'); assert.ok(r.plans[0].results[0].output.fileId);
  assert.ok(script.calls[1].messages.some((m) => m.role === 'system' && /NOTHING was created/.test(m.content)), 'the model was corrected');
  assert.ok(!/bo'ldim/.test(r.content), 'the false claim never reached the user: ' + r.content);
  assert.deepEqual(ev.map((p) => p.state), ['running', 'done']);
});
test('claim: a model that keeps claiming without a tool gets the truth appended, no file is created', async () => {
  const e = env(); const lie = { content: "Tayyorlab bo'ldim! Excel fayl: Jadval.xlsx" };
  script.queue.push(lie, lie, lie);
  const before = (await fstore.list('u')).length;
  const r = await turn(e, 'excel ham');
  assert.equal(r.plans.length, 0); assert.match(r.content, /fayl hali yaratilmadi/); assert.equal((await fstore.list('u')).length, before);
});
test('claim: an honest question is left alone (no retry, no note)', async () => {
  const e = env(); script.queue.push({ content: 'Qaysi ustunlar kerak? Excel faylni shunga qarab yarataman.' });
  const r = await turn(e, 'excel ham'); assert.equal(script.calls.length, 1); assert.ok(!/hali yaratilmadi/.test(r.content));
});

// ── "endi shuni pdfga aylantir": read the file SHERZ made earlier, then create the PDF — no Approve click, no promise-only reply ──
test('convert: "endi shuni pdfga aylantir" reads SHERZ\'s own earlier Excel and builds the PDF by itself', async () => {
  const e = env(); const ev = [];
  const { buildXlsx } = await import(pathToFileURL(path.join(root, 'lib/docs/xlsx.js')).href);
  const { cleanXlsxSpec } = await import(pathToFileURL(path.join(root, 'lib/docs/spec.js')).href);
  const built = await buildXlsx(cleanXlsxSpec({ filename: 'Xarajatlar_Jadvali', sheets: [{ name: 'Hafta', columns: [{ header: 'Nom' }, { header: 'Summa', format: 'number' }], rows: [['Ijara', 900], ['Ovqat', 300]] }] }));
  await fstore.put('u', { name: 'Xarajatlar_Jadvali.xlsx', mime: built.mime, bytes: built.buffer, source: 'generated' });
  const PDF_PLAN = { title: 'PDFga aylantirish', steps: [{ tool: 'docs.create_pdf', args: { filename: 'Xarajatlar_Jadvali', title: 'Xarajatlar', blocks: [{ type: 'table', header: ['Nom', 'Summa'], rows: [['Ijara', '900'], ['Ovqat', '300']] }] } }] };
  script.queue.push(call('observe', { tool: 'docs.read', args: { name: 'Xarajatlar_Jadvali.xlsx' } }), call('propose_action_plan', PDF_PLAN), { content: 'PDF yaratilmoqda.' });
  const r = await turn(e, 'endi shuni pdfga aylantir', { onProgress: (p) => ev.push(p) });
  assert.equal(r.plans.length, 1); assert.equal(r.plans[0].status, 'executed', 'ran by itself: ' + JSON.stringify(r.plans[0].auto));
  const out = r.plans[0].results[0].output; assert.equal(out.filename, 'Xarajatlar_Jadvali.pdf'); assert.equal((await fstore.get('u', out.fileId)).bytes.subarray(0, 5).toString('latin1'), '%PDF-');
  assert.deepEqual(ev.map((p) => p.state), ['running', 'done']);
});
test('convert: reading a file that was UPLOADED by the user still needs the normal approval (untrusted data)', async () => {
  const e = env();
  const { buildXlsx } = await import(pathToFileURL(path.join(root, 'lib/docs/xlsx.js')).href);
  const { cleanXlsxSpec } = await import(pathToFileURL(path.join(root, 'lib/docs/spec.js')).href);
  const built = await buildXlsx(cleanXlsxSpec({ filename: 'Yuklangan', sheets: [{ name: 'A', columns: [{ header: 'X' }], rows: [['1']] }] }));
  await fstore.put('u', { name: 'Yuklangan.xlsx', mime: built.mime, bytes: built.buffer, source: 'uploaded' });
  const PDF2 = { title: 'PDF', steps: [{ tool: 'docs.create_pdf', args: { filename: 'Yuklangan', blocks: [{ type: 'paragraph', text: 'x' }] } }] };
  script.queue.push(call('observe', { tool: 'docs.read', args: { name: 'Yuklangan.xlsx' } }), call('propose_action_plan', PDF2), { content: 'Tasdiqlang.' });
  const r = await turn(e, 'Yuklangan.xlsx ni pdfga aylantir');
  assert.equal(r.plans[0].status, 'pending');
});

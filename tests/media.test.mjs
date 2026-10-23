import test from 'node:test';
import assert from 'node:assert/strict';
import { wantsImage, wantsDocFile, wantsFile } from '../lib/docs/intent.js';
import { cleanTextSpec, cleanImageSpec, cleanFilename } from '../lib/docs/spec.js';
import { openaiImageProvider } from '../lib/docs/image.js';
import { stripFakeFileLinks, hasFakeFileLink } from '../lib/docs/followup.js';
import { decideChatBoundary } from '../lib/agent/intentGrant.js';

test('intent: pictures need a picture word + a making word; analysing a picture is not a request to draw', () => {
  for (const t of ['Rasm chizib ber', 'Yangi logo yarat', 'draw a cat', 'нарисуй логотип', 'logo kerak', 'make me a poster']) assert.equal(wantsImage(t), true, t);
  for (const t of ['bu rasmni tushuntir', 'salom', 'Manga excel file yaratib ber', 'Bu rasmga qarab javob ber', '/image cat', '']) assert.equal(wantsImage(t), false, t);
  assert.equal(wantsFile('Rasm chizib ber'), true); assert.equal(wantsFile('Excel yarat'), true); assert.equal(wantsFile('Salom'), false);
});
test('intent: txt / markdown files count as file requests', () => {
  for (const t of ['menga txt fayl yozib ber', 'notes.md yarat', 'make a markdown file about cats']) assert.equal(wantsDocFile(t), true, t);
  assert.equal(wantsDocFile('markdown nima?'), false);
});
test('spec: text file — format from the name, exact content, limits', () => {
  const a = cleanTextSpec({ filename: 'Reja.md', content: '# A\n- b' }); assert.deepEqual([a.filename, a.format], ['Reja.md', 'md']);
  assert.equal(cleanTextSpec({ filename: 'x', content: 'hi' }).filename, 'x.txt');
  assert.throws(() => cleanTextSpec({ filename: 'x', content: '   ' }), /content is required/);
  assert.throws(() => cleanTextSpec({ filename: 'x', format: 'exe', content: 'a' }), /format must be/);
  assert.throws(() => cleanTextSpec({ filename: 'x', content: 'a'.repeat(120001) }), /too long|too large/);
  assert.equal(cleanFilename('../evil.png', 'png'), 'evil.png');
});
test('spec: image — prompt required, size checked, filename safe', () => {
  assert.deepEqual(cleanImageSpec({ prompt: 'a red fox' }), { filename: 'Rasm.png', prompt: 'a red fox', size: 'square' });
  assert.equal(cleanImageSpec({ prompt: 'a fox', filename: 'Tulki rasmi.jpg', size: 'landscape' }).filename, 'Tulki rasmi.png');
  assert.throws(() => cleanImageSpec({ prompt: 'a' }), /prompt is required/);
  assert.throws(() => cleanImageSpec({ prompt: 'a fox', size: 'huge' }), /size must be/);
  assert.throws(() => cleanImageSpec({ prompt: 'x'.repeat(1001) }), /too long/);
});
test('provider: OpenAI request shape for dall-e-3 and gpt-image-1, readable errors', async () => {
  const seen = []; const ok = (b64) => async (url, o) => { seen.push({ url, body: JSON.parse(o.body), auth: o.headers.Authorization }); return { ok: true, json: async () => ({ data: [{ b64_json: b64 }] }) }; };
  const png = Buffer.from('abc').toString('base64');
  let r = await openaiImageProvider({ prompt: 'p', size: 'portrait' }, { fetchImpl: ok(png), env: { OPENAI_API_KEY: 'k' } });
  assert.equal(r.bytes.toString(), 'abc'); assert.equal(seen[0].body.model, 'dall-e-3'); assert.equal(seen[0].body.size, '1024x1792'); assert.equal(seen[0].body.response_format, 'b64_json'); assert.equal(seen[0].auth, 'Bearer k');
  await openaiImageProvider({ prompt: 'p', size: 'landscape' }, { fetchImpl: ok(png), env: { OPENAI_API_KEY: 'k', IMAGE_MODEL: 'gpt-image-1' } });
  assert.equal(seen[1].body.size, '1536x1024'); assert.equal(seen[1].body.response_format, undefined);
  const bad = (code, message) => async () => ({ ok: false, status: 400, json: async () => ({ error: { code, message } }) });
  await assert.rejects(openaiImageProvider({ prompt: 'p' }, { fetchImpl: bad('content_policy_violation', 'x'), env: { OPENAI_API_KEY: 'k' } }), /safety rules/);
  await assert.rejects(openaiImageProvider({ prompt: 'p' }, { fetchImpl: bad('billing_hard_limit_reached', 'x'), env: { OPENAI_API_KEY: 'k' } }), /credit|billing/);
  await assert.rejects(openaiImageProvider({ prompt: 'p' }, { env: {} }), /not configured/);
});
test('boundary: picture plan auto-runs only for a picture request', () => {
  const plan = [{ tool: 'docs.create_image', args: {} }];
  assert.equal(decideChatBoundary({ plan, source: 'assistant', userText: 'Yangi logo yarat' }).decision, 'auto');
  assert.equal(decideChatBoundary({ plan, source: 'assistant', userText: 'Excel yarat' }).decision, 'ask');
  assert.equal(decideChatBoundary({ plan: [{ tool: 'docs.create_text', args: {} }], source: 'assistant', userText: 'txt fayl yoz' }).decision, 'auto');
});
test('fake links: made-up image / text links are stripped, real web links and our download route stay', () => {
  assert.equal(stripFakeFileLinks('Mana: ![Logo](sandbox:/logo.png) tayyor'), 'Mana: Logo tayyor');
  assert.equal(stripFakeFileLinks('[Fayl](notes.md)'), 'Fayl');
  assert.equal(hasFakeFileLink('[x](https://github.com/a/b/README.md)'), false);
  assert.equal(hasFakeFileLink('[x](/api/files/f_1/download)'), false);
});

// ── short follow-ups + "I made it" claims ──
import { isFormatFollowUp } from '../lib/docs/intent.js';
import { hasFileCreationClaim, FILE_NOT_CREATED_NOTE } from '../lib/docs/followup.js';
test('follow-up: "excel ham", "wordda ham", "pdf ham", "buni ham excel qil" are file requests; questions and look-alikes are not', () => {
  for (const t of ['excel ham', 'Excel ham', 'wordda ham', 'pdf ham', 'PDF ham!', 'yana pdf', 'powerpoint ham', "pdf'ga ham", 'also as pdf', 'excelga ham', 'buni ham excel qil', 'эксель тоже', 'txt ham']) assert.equal(wantsFile(t), true, t);
  for (const t of ['excel nima?', "Excel ham o'rganmoqchiman", 'wordpress ham yaxshi', 'pdfkit ham ishlaydi', 'men ham kelaman', 'ham', 'excel', 'sen ham yaxshisan', 'Python ham, JavaScript ham, Go ham, Rust ham, Excel ham', '/excel ham']) assert.equal(wantsFile(t), false, t);
  assert.equal(isFormatFollowUp('excel ham'), true);
});
test('claims: saying a file is ready without a tool call is detected; honest sentences are not', () => {
  assert.equal(hasFileCreationClaim("Mana, ikkalasini ham tayyorlab bo'ldim:\n\nExcel fayl:\nXarajatlar_Jadvali.xlsx\n\nPDF fayl:\nXarajatlar_Jadvali.pdf"), true);
  assert.equal(hasFileCreationClaim('I created the Excel file for you: budget.xlsx'), true);
  assert.equal(hasFileCreationClaim('Здесь ваш готовый файл Excel'), true);
  assert.equal(hasFileCreationClaim('Excel fayl tayyorlaymi? Qaysi ustunlar kerak?'), false);
  assert.equal(hasFileCreationClaim('Excelda SUM funksiyasi ustunlarni qo‘shadi.'), false);
  assert.equal(hasFileCreationClaim('Bugun ob-havo yaxshi, ishlar tayyor bo‘ldi.'), false);
  assert.equal(hasFileCreationClaim('Fayl hali yaratilmadi. Yaratish uchun yozing: «Excel fayl yaratib ber»'), false);
  assert.equal(hasFileCreationClaim('x' + FILE_NOT_CREATED_NOTE), false);
});

test('convert phrases: "endi shuni pdfga aylantir" etc. are file requests; questions are not', () => {
  for (const t of ['endi shuni pdfga aylantir', "wordga o'tkaz", 'excelga aylantir', 'convert this to pdf', "buni pptxga o'tkazib ber", "pdf'ga aylantirib ber"]) assert.equal(wantsFile(t), true, t);
  for (const t of ['pdfga nima deysan?', 'pdf nima', 'pdfga aylantirish nima?', 'salom']) assert.equal(wantsFile(t), false, t);
});
test('claims: a promise with no action behind it is caught, a question back to the user is not', () => {
  assert.equal(hasFileCreationClaim("Excel jadvalini PDF formatga o'tkazib beraman. Fayl bir zumda tayyor bo'ladi."), true);
  assert.equal(hasFileCreationClaim('PDF qilib beraymi?'), false);
  assert.equal(hasFileCreationClaim('Qaysi ustunlar kerak? Excel faylni shunga qarab yarataman.'), false);
});

test('typos of Excel: "buni xclx korinishda yarat", "xlx", "ekxel", "exsel" still count', () => {
  for (const t of ['buni xclx korinishda yarat', 'xlx qilib ber', 'ekxel fayl yarat', 'buni exsel qil', 'xclx ham']) assert.equal(wantsFile(t), true, t);
});

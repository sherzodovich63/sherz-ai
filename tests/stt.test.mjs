import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// runs the real /api/stt route from server.js with a fake Whisper (global fetch) — no network
const src = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const start = Math.min(...[src.indexOf('const sttVocabCache'), src.indexOf("app.post('/api/stt'")].filter((i) => i >= 0));
const end = src.indexOf('\n});\n', start) + 5;
const routeSrc = src.slice(start, end);

async function call(body, whisper, { user, facts = [] } = {}) {
  let handler; const app = { post: (_p, _u, h) => { handler = h; } };
  const sent = []; const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => { sent.push(opts.body); return whisper(); };
  process.env.OPENAI_API_KEY = 'x';
  const prisma = { fact: { findMany: async () => facts } };
  new Function('app', 'upload', 'prisma', routeSrc)(app, { single: () => 0 }, prisma);
  const res = { code: 200, json(o) { this.out = o; return this; }, status(c) { this.code = c; return this; } };
  try { await handler({ body, user, file: { buffer: Buffer.from('abc'), mimetype: 'audio/webm', originalname: 'v.webm' } }, res); } finally { globalThis.fetch = realFetch; }
  return { res, form: sent[0] };
}
const ok = (text, language) => ({ ok: true, json: async () => ({ text, language }) });

test('stt: never sends a language (Whisper rejects "uz"), even with no lang in the request', async () => {
  const { res, form } = await call({}, () => ok(' salom ', 'uzbek'));
  assert.equal(form.has('language'), false);
  assert.equal(res.out.ok, true); assert.equal(res.out.text, 'salom'); assert.equal(res.out.lang, 'uzbek');
});
test('stt: an old client sending lang=uz still works (no language forwarded)', async () => {
  const { form, res } = await call({ lang: 'uz' }, () => ok('hi', 'english'));
  assert.equal(form.has('language'), false); assert.equal(res.out.ok, true);
});
test('stt: Uzbek app language adds a Latin-script prompt, other languages do not', async () => {
  assert.ok((await call({ hint: 'uz' }, () => ok('x', 'uzbek'))).form.get('prompt'));
  assert.equal((await call({ hint: 'ru' }, () => ok('x', 'russian'))).form.has('prompt'), false);
});

test('stt: names from memory are sent as a spelling hint (system rows, long sentences and lower-case notes are not)', async () => {
  const facts = [{ key: 'person', value: 'Dilnoza' }, { key: 'pref:city', value: 'Samarqand' }, { key: 'proactive_last', value: 'Secret' },
    { key: 'note', value: 'Likes to walk in the park every single morning. Really.' }, { key: 'note', value: 'coffee' }];
  const { form } = await call({ hint: 'ru' }, () => ok('x', 'russian'), { user: { id: 'user_vocab_1' }, facts });
  const p = form.get('prompt'); assert.match(p, /Dilnoza/); assert.match(p, /Samarqand/);
  assert.doesNotMatch(p, /Secret|walk|coffee/);
});
test('stt: a failing or slow database never breaks the transcription', async () => {
  const bad = { fact: { findMany: () => { throw new Error('db down'); } } };
  let handler; new Function('app', 'upload', 'prisma', routeSrc)({ post: (_p, _u, h) => { handler = h; } }, { single: () => 0 }, bad);
  const realFetch = globalThis.fetch; globalThis.fetch = async () => ok('salom', 'uzbek'); process.env.OPENAI_API_KEY = 'x';
  const res = { json(o) { this.out = o; return this; }, status() { return this; } };
  try { await handler({ body: {}, user: { id: 'user_vocab_2' }, file: { buffer: Buffer.from('a'), mimetype: 'audio/webm' } }, res); } finally { globalThis.fetch = realFetch; }
  assert.equal(res.out.text, 'salom');
});

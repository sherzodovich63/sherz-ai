import test from 'node:test';
import assert from 'node:assert/strict';
import { cyrillicToLatin, normalizeTranscript, looksUzbekCyrillic, errorRates } from '../lib/uzbekText.js';
import { transcribe } from '../lib/stt.js';
import { sttRouter } from '../routes/stt.js';

const quiet = { warn() {}, log() {}, error() {} };
const reply = (status, body) => ({ ok: status < 400, status, statusText: 'x', json: async () => body });
const audio = { buffer: Buffer.from('abc'), mime: 'audio/webm', filename: 'v.webm', log: quiet };

test('uzbek: Cyrillic Uzbek becomes Latin Uzbek, Russian is left alone', () => {
  assert.equal(cyrillicToLatin('Ассалому алайкум, ҳурматли дўстим! Қандай яшаяпсиз?'), "Assalomu alaykum, hurmatli do'stim! Qanday yashayapsiz?");
  assert.equal(cyrillicToLatin('Ёшлик, енгил, мен ерда, эшитдим'), 'Yoshlik, yengil, men yerda, eshitdim');
  assert.equal(cyrillicToLatin('ЎЗБЕКИСТОН Шахар'), "O'ZBEKISTON Shaxar");
  assert.equal(normalizeTranscript('Привет, как дела?', 'russian'), 'Привет, как дела?');
  assert.equal(normalizeTranscript('Салом, нима гап', 'uzbek'), 'Salom, nima gap');
  assert.equal(normalizeTranscript('Салом', 'russian'), 'Салом');                  // no Uzbek-only letters and not detected as Uzbek → untouched
  assert.equal(normalizeTranscript('Қалайсан', ''), 'Qalaysan');                    // Uzbek-only letter → certainly Uzbek
  assert.equal(normalizeTranscript('  hello   world ', 'en'), 'hello world');
  assert.equal(looksUzbekCyrillic('hello', 'uzbek'), false);
});
test('uzbek: error rates ignore script, case, punctuation and apostrophe style', () => {
  assert.deepEqual(errorRates('Salom, qandaysiz?', 'Салом қандайсиз'), { wer: 0, cer: 0 });
  assert.equal(errorRates("o‘zbekcha gapiraman", "o'zbekcha gapiraman").wer, 0);
  assert.equal(errorRates('bir ikki uch', 'bir uch').wer, 1 / 3);
});

test('stt: openai whisper-1 → verbose_json + prompt with names, never a language; Cyrillic Uzbek comes back Latin', async () => {
  let form; const fetchImpl = async (_u, o) => { form = o.body; return reply(200, { text: 'Салом, Дилноза', language: 'uzbek' }); };
  const out = await transcribe({ ...audio, hint: 'uz', vocab: 'Dilnoza, Samarqand', env: { OPENAI_API_KEY: 'k' }, fetchImpl });
  assert.equal(out.text, 'Salom, Dilnoza'); assert.equal(out.provider, 'openai');
  assert.equal(form.has('language'), false); assert.equal(form.get('response_format'), 'verbose_json'); assert.match(form.get('prompt'), /Dilnoza/);
});
test('stt: gpt-transcribe gets keywords[] and no response_format / language', async () => {
  let form; const fetchImpl = async (_u, o) => { form = o.body; return reply(200, { text: 'salom', languages: [{ code: 'uz' }] }); };
  const out = await transcribe({ ...audio, vocab: 'Dilnoza, Samarqand', env: { OPENAI_API_KEY: 'k', STT_MODEL: 'gpt-transcribe' }, fetchImpl });
  assert.deepEqual(form.getAll('keywords[]'), ['Dilnoza', 'Samarqand']); assert.equal(form.has('response_format'), false); assert.equal(form.has('language'), false);
  assert.equal(out.lang, 'uz'); assert.equal(out.model, 'gpt-transcribe');
});
test('stt: elevenlabs scribe request + response', async () => {
  let url, headers, form; const fetchImpl = async (u, o) => { url = u; headers = o.headers; form = o.body; return reply(200, { text: 'Салом дўстим', language_code: 'uzb' }); };
  const out = await transcribe({ ...audio, provider: 'elevenlabs', env: { ELEVENLABS_API_KEY: 'ek' }, fetchImpl });
  assert.match(url, /api\.elevenlabs\.io\/v1\/speech-to-text/); assert.equal(headers['xi-api-key'], 'ek'); assert.equal(form.get('model_id'), 'scribe_v1');
  assert.equal(out.text, "Salom do'stim");
});
test('stt: when the main engine fails the fallback answers; when both fail it throws', async () => {
  const calls = []; const fetchImpl = async (u) => { calls.push(u); return /elevenlabs/.test(u) ? reply(500, { detail: { message: 'down' } }) : reply(200, { text: 'ok', language: 'english' }); };
  const out = await transcribe({ ...audio, env: { STT_PROVIDER: 'elevenlabs', STT_FALLBACK: 'openai', ELEVENLABS_API_KEY: 'e', OPENAI_API_KEY: 'o' }, fetchImpl });
  assert.equal(out.text, 'ok'); assert.equal(out.fellBack, true); assert.equal(out.provider, 'openai'); assert.equal(calls.length, 2);
  await assert.rejects(() => transcribe({ ...audio, env: { STT_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: 'e' }, fetchImpl }), /down/);
  await assert.rejects(() => transcribe({ ...audio, env: {}, fetchImpl }), /OPENAI_API_KEY missing/);
});

function runRoute(req, opts) {
  let handler; const r = sttRouter({ upload: { single: () => (_q, _s, n) => n() }, log: quiet, ...opts });
  handler = r.stack.find((l) => l.route?.path === '/').route.stack.at(-1).handle;
  const res = { code: 200, status(c) { this.code = c; return this; }, json(o) { this.out = o; return this; } };
  return handler(req, res).then(() => res);
}
test('stt route: file in → { ok, text, lang }; vocab for this user is requested; bad input is a 400', async () => {
  let asked; const fetchImpl = async () => reply(200, { text: 'Салом', language: 'uzbek' });
  const res = await runRoute({ body: { hint: 'uz' }, user: { id: 'u1' }, file: { buffer: Buffer.from('a'), mimetype: 'audio/webm', originalname: 'v.webm' } },
    { env: { OPENAI_API_KEY: 'k' }, fetchImpl, getVocab: async (id) => { asked = id; return 'Dilnoza'; } });
  assert.equal(res.out.ok, true); assert.equal(res.out.text, 'Salom'); assert.equal(asked, 'u1');
  const bad = await runRoute({ body: {} }, { env: { OPENAI_API_KEY: 'k' }, fetchImpl });
  assert.equal(bad.code, 400);
});
test('stt route: a broken vocabulary lookup never breaks the transcription; a missing key is a clear 501', async () => {
  const fetchImpl = async () => reply(200, { text: 'hi', language: 'english' });
  const ok = await runRoute({ body: {}, file: { buffer: Buffer.from('a'), mimetype: 'audio/webm' } }, { env: { OPENAI_API_KEY: 'k' }, fetchImpl, getVocab: async () => { throw new Error('db'); } });
  assert.equal(ok.out.text, 'hi');
  const none = await runRoute({ body: {}, file: { buffer: Buffer.from('a'), mimetype: 'audio/webm' } }, { env: {}, fetchImpl });
  assert.equal(none.code, 501);
});

test('stt: an unlikely language (Whisper calling Uzbek "hungarian") is discarded and the other engine is tried', async () => {
  const fetchImpl = async (u) => /elevenlabs/.test(u) ? reply(200, { text: 'Салом, қандайсиз', language_code: 'uzb' }) : reply(200, { text: 'Ha szükséges, kövess és lájkolj', language: 'hungarian' });
  const out = await transcribe({ ...audio, env: { STT_PROVIDER: 'openai', STT_FALLBACK: 'elevenlabs', OPENAI_API_KEY: 'o', ELEVENLABS_API_KEY: 'e' }, fetchImpl });
  assert.equal(out.provider, 'elevenlabs'); assert.equal(out.text, 'Salom, qandaysiz'); assert.equal(out.fellBack, true);
});
test('stt: if every engine hears an unlikely language the person is asked to repeat (422), never given invented text', async () => {
  const fetchImpl = async () => reply(200, { text: 'Ha szükséges', language: 'hungarian' });
  await assert.rejects(() => transcribe({ ...audio, env: { OPENAI_API_KEY: 'o' }, fetchImpl }), (e) => e.code === 'unclear' && e.status === 422);
  const res = await runRoute({ body: {}, file: { buffer: Buffer.from('a'), mimetype: 'audio/webm' } }, { env: { OPENAI_API_KEY: 'o' }, fetchImpl });
  assert.equal(res.code, 422); assert.equal(res.out.unclear, true); assert.match(res.out.error, /yana bir bor/);
});
test('stt: STT_LANGS can allow more languages; uz / uzb / uzbek / ru / russian all count as expected', async () => {
  const fetchImpl = async () => reply(200, { text: 'Merhaba', language: 'turkish' });
  assert.equal((await transcribe({ ...audio, env: { OPENAI_API_KEY: 'o', STT_LANGS: 'uz,ru,en,tr' }, fetchImpl })).text, 'Merhaba');
  for (const l of ['uz', 'uzb', 'uzbek', 'Uzbek', 'ru', 'russian', 'en-US', 'english']) {
    const ok = await transcribe({ ...audio, env: { OPENAI_API_KEY: 'o' }, fetchImpl: async () => reply(200, { text: 'x', language: l }) });
    assert.equal(ok.text, 'x', l);
  }
});
test('stt: Whisper captions for silence (no_speech_prob high on every segment) come back empty; temperature is 0', async () => {
  let form; const fetchImpl = async (_u, o) => { form = o.body; return reply(200, { text: 'Thanks for watching', language: 'english', segments: [{ no_speech_prob: 0.9 }, { no_speech_prob: 0.8 }] }); };
  const out = await transcribe({ ...audio, env: { OPENAI_API_KEY: 'o' }, fetchImpl });
  assert.equal(out.text, ''); assert.equal(form.get('temperature'), '0');
  const real = await transcribe({ ...audio, env: { OPENAI_API_KEY: 'o' }, fetchImpl: async () => reply(200, { text: 'salom', language: 'uzbek', segments: [{ no_speech_prob: 0.05 }] }) });
  assert.equal(real.text, 'salom');
});

test('stt: ElevenLabs hears Uzbek as Azerbaijani → asked again with Uzbek forced, and that answer is used', async () => {
  const forms = []; const fetchImpl = async (_u, o) => { forms.push(o.body); return o.body.get('language_code') ? reply(200, { text: 'Салом, қандайсиз', language_code: 'uzb' }) : reply(200, { text: 'Salam necəsən', language_code: 'aze' }); };
  const out = await transcribe({ ...audio, provider: 'elevenlabs', env: { ELEVENLABS_API_KEY: 'e' }, fetchImpl });
  assert.equal(out.text, 'Salom, qandaysiz'); assert.equal(out.forced, 'uz'); assert.equal(forms.length, 2);
  assert.equal(forms[0].has('language_code'), false); assert.equal(forms[1].get('language_code'), 'uzb');
});
test('stt: if "uzb" is not accepted as a code the 2-letter "uz" is tried; STT_RETRY_LANG="" turns the retry off', async () => {
  const seen = []; const fetchImpl = async (_u, o) => { const c = o.body.get('language_code'); seen.push(c); if (!c) return reply(200, { text: 'x', language_code: 'tur' }); return c === 'uzb' ? reply(422, { detail: { message: 'bad code' } }) : reply(200, { text: 'салом', language_code: 'uz' }); };
  const out = await transcribe({ ...audio, provider: 'elevenlabs', env: { ELEVENLABS_API_KEY: 'e' }, fetchImpl });
  assert.equal(out.text, 'salom'); assert.deepEqual(seen, [null, 'uzb', 'uz']);
  const off = []; await assert.rejects(() => transcribe({ ...audio, provider: 'elevenlabs', fallback: '', env: { ELEVENLABS_API_KEY: 'e', STT_RETRY_LANG: '' }, fetchImpl: async (_u, o) => { off.push(1); return reply(200, { text: 'x', language_code: 'tur' }); } }), (e) => e.code === 'unclear');
  assert.equal(off.length, 1);
});
test('stt: a bad key (401) during the forced retry is not hidden — the fallback engine still gets its turn', async () => {
  const fetchImpl = async (u, o) => /elevenlabs/.test(u) ? (o.body.get('language_code') ? reply(401, { detail: { message: 'nope' } }) : reply(200, { text: 'x', language_code: 'aze' })) : reply(200, { text: 'salom', language: 'uzbek' });
  const out = await transcribe({ ...audio, provider: 'elevenlabs', fallback: 'openai', env: { ELEVENLABS_API_KEY: 'e', OPENAI_API_KEY: 'o' }, fetchImpl });
  assert.equal(out.provider, 'openai'); assert.equal(out.text, 'salom');
});

// lib/stt.js — speech-to-text providers behind one function.
//   STT_PROVIDER   openai (default) | elevenlabs
//   STT_MODEL      openai model: whisper-1 (default, OpenAI shuts it down on 2027-02-26) | gpt-transcribe | gpt-4o-transcribe | gpt-4o-mini-transcribe
//   ELEVENLABS_STT_MODEL  default scribe_v1   (uses the same ELEVENLABS_API_KEY as the voice)
//   STT_FALLBACK   openai | elevenlabs — tried when the main provider fails OR hears an unlikely language, so a hiccup never reaches the person as an error
//   STT_RETRY_LANG when an engine that can be told the language (ElevenLabs) first guesses an unlikely one (Uzbek is often heard as Azerbaijani /
//                  Turkish / Kazakh / Serbian), it is asked once more with this language forced. Default uz; set it empty to turn the retry off.
//   STT_LANGS      languages SHERZ people actually speak (default uz,ru,en). If an engine decides the speech is anything else (Whisper loves to call
//                  Uzbek "Hungarian" / "Turkish" and then invents text), that answer is thrown away and the next engine is tried.
// No language is ever forced (SHERZ users mix Uzbek, Russian and English; the OpenAI API also rejects 'uz'): every engine auto-detects.
// Everything that touches the network is injected (`fetchImpl`), so the tests need no network.
import { normalizeTranscript } from './uzbekText.js';

const CLEAN_WORDS = (vocab) => String(vocab || '').split(',').map((w) => w.trim()).filter((w) => w && !/[<>\r\n]/.test(w)).slice(0, 20);
const UZ_SAMPLE = 'Assalomu alaykum. Bugun qanday ishlar qildik? Yaxshi, rahmat.';

// 'uzbek' | 'uz' | 'uzb' → 'uz' …  (engines report a code or an English language name)
const LANG_ALIASES = { uzbek: 'uz', uzb: 'uz', russian: 'ru', rus: 'ru', english: 'en', eng: 'en', turkish: 'tr', tur: 'tr', kazakh: 'kk', kaz: 'kk', tajik: 'tg', tgk: 'tg',
  kyrgyz: 'ky', kir: 'ky', turkmen: 'tk', tuk: 'tk', azerbaijani: 'az', aze: 'az', arabic: 'ar', ara: 'ar', german: 'de', deu: 'de', french: 'fr', fra: 'fr',
  spanish: 'es', spa: 'es', korean: 'ko', kor: 'ko', chinese: 'zh', zho: 'zh', persian: 'fa', fas: 'fa' };
export const normLang = (l) => { const t = String(l || '').trim().toLowerCase().split(/[-_]/)[0]; return LANG_ALIASES[t] || t; };   // (full names and 3-letter codes → the 2-letter code)
export const allowedLangs = (env) => new Set(String(env.STT_LANGS || 'uz,ru,en').split(',').map((x) => normLang(x)).filter(Boolean));

async function readJson(r) { try { return await r.json(); } catch { return {}; } }
const fail = (provider, r, j) => Object.assign(new Error(`${provider}: ${j?.error?.message || j?.detail?.message || j?.message || r.statusText || 'request failed'}`), { status: r.status, provider });

async function openaiStt({ buffer, mime, filename, hint, vocab, env, fetchImpl, model }) {
  const key = env.OPENAI_API_KEY; if (!key) throw Object.assign(new Error('openai: OPENAI_API_KEY missing'), { status: 501, provider: 'openai' });
  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type: mime || 'application/octet-stream' }), filename || 'audio.webm');
  fd.append('model', model);
  const words = CLEAN_WORDS(vocab), sample = hint === 'uz' ? UZ_SAMPLE : '';
  if (model === 'gpt-transcribe') {                          // newer model: vocabulary goes in as real keywords, no language list needed
    if (sample) fd.append('prompt', sample);
    for (const w of words) fd.append('keywords[]', w);
  } else {
    if (model === 'whisper-1') { fd.append('response_format', 'verbose_json'); fd.append('temperature', '0'); }   // temperature 0: no creative guessing
    const prompt = [sample, words.join(', ')].filter(Boolean).join(' ').slice(0, 400);
    if (prompt) fd.append('prompt', prompt);
  }
  const r = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd });
  const j = await readJson(r); if (!r.ok) throw fail('openai', r, j);
  const lang = j.language || (Array.isArray(j.languages) && j.languages[0]?.code) || '';
  // Whisper writes captions ("like and subscribe…") for silence / noise. Its own per-segment "no speech" score says when that happened.
  const segs = Array.isArray(j.segments) ? j.segments : [];
  const silent = segs.length > 0 && segs.every((x) => typeof x.no_speech_prob === 'number' && x.no_speech_prob > 0.6);
  return { text: silent ? '' : String(j.text || ''), lang: String(lang || '') };
}

// code forms ElevenLabs may expect for a forced language (2-letter ISO 639-1 or 3-letter ISO 639-3): the first one it accepts is used
const FORCE_CODES = { uz: ['uzb', 'uz'], ru: ['rus', 'ru'], en: ['eng', 'en'] };
async function elevenlabsOnce({ buffer, mime, filename, env, fetchImpl, model, code }) {
  const key = env.ELEVENLABS_API_KEY; if (!key) throw Object.assign(new Error('elevenlabs: ELEVENLABS_API_KEY missing'), { status: 501, provider: 'elevenlabs' });
  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type: mime || 'application/octet-stream' }), filename || 'audio.webm');
  fd.append('model_id', model);
  fd.append('tag_audio_events', 'false');                    // no "(laughter)" style tags in the text
  if (code) fd.append('language_code', code);                // without it the engine detects the language itself
  const r = await fetchImpl('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: fd });
  const j = await readJson(r); if (!r.ok) throw fail('elevenlabs', r, j);
  return { text: String(j.text || ''), lang: String(j.language_code || code || '') };
}
async function elevenlabsStt({ forceLang, ...o }) {
  if (!forceLang) return elevenlabsOnce(o);
  let lastErr;
  for (const code of FORCE_CODES[normLang(forceLang)] || [forceLang]) {
    try { return await elevenlabsOnce({ ...o, code }); } catch (e) { lastErr = e; if (!(e.status >= 400 && e.status < 500) || e.status === 401) throw e; }   // 4xx = maybe this spelling of the code → try the next
  }
  throw lastErr;
}
const CAN_FORCE = new Set(['elevenlabs']);

const PROVIDERS = { openai: (o) => openaiStt({ ...o, model: o.model || o.env.STT_MODEL || 'whisper-1' }), elevenlabs: (o) => elevenlabsStt({ ...o, model: o.model || o.env.ELEVENLABS_STT_MODEL || 'scribe_v1' }) };
export const providerNames = () => Object.keys(PROVIDERS);

/**
 * @returns {{ text, lang, provider, model, ms, fellBack }} — `text` is already Latin Uzbek when the speech was Uzbek.
 * Throws only when the main provider AND the fallback both fail.
 */
export async function transcribe({ buffer, mime, filename, hint = '', vocab = '', provider, model, fallback, env = process.env, fetchImpl = globalThis.fetch, log = console }) {
  const main = provider || env.STT_PROVIDER || 'openai';
  const alt = fallback === undefined ? (env.STT_FALLBACK || '') : fallback;
  const chain = [main, ...(alt && alt !== main ? [alt] : [])];
  let lastErr;
  for (let i = 0; i < chain.length; i++) {
    const name = chain[i], run = PROVIDERS[name]; if (!run) { lastErr = new Error('unknown STT provider: ' + name); continue; }
    const t0 = Date.now();
    try {
      const out = await run({ buffer, mime, filename, hint, vocab, env, fetchImpl, model: i === 0 ? model : undefined });
      const text = normalizeTranscript(out.text, out.lang);
      if (text && out.lang && !allowedLangs(env).has(normLang(out.lang))) {          // e.g. "hungarian": a wrong guess → the words are made up too
        const retryLang = env.STT_RETRY_LANG === undefined ? 'uz' : env.STT_RETRY_LANG;
        if (retryLang && CAN_FORCE.has(name)) {                                      // Uzbek heard as Azerbaijani / Turkish / …: ask again, this time telling the engine the language
          log.warn && log.warn(`[stt] ${name} detected "${out.lang}" — asking again with ${retryLang} forced`);
          try {
            const again = await run({ buffer, mime, filename, hint, vocab, env, fetchImpl, model: i === 0 ? model : undefined, forceLang: retryLang });
            const t2 = normalizeTranscript(again.text, again.lang);
            if (t2) return { text: t2, lang: again.lang, provider: name, model: i === 0 ? (model || env.ELEVENLABS_STT_MODEL || 'scribe_v1') : '', ms: Date.now() - t0, fellBack: i > 0, forced: retryLang };
          } catch (e2) { log.warn && log.warn(`[stt] forced ${retryLang} retry failed: ${e2.message}`); }
        }
        lastErr = Object.assign(new Error(`${name} heard an unlikely language (${out.lang})`), { code: 'unclear', status: 422, provider: name, lang: out.lang });
        log.warn && log.warn(`[stt] ${name} detected "${out.lang}" — not one of ${[...allowedLangs(env)].join('/')}; discarding${i < chain.length - 1 ? ' and trying ' + chain[i + 1] : ''}`);
        continue;
      }
      return { text, lang: out.lang, provider: name, model: i === 0 ? (model || (name === 'openai' ? env.STT_MODEL || 'whisper-1' : env.ELEVENLABS_STT_MODEL || 'scribe_v1')) : '', ms: Date.now() - t0, fellBack: i > 0 };
    } catch (e) {
      lastErr = e; log.warn && log.warn(`[stt] ${name} failed: ${e.message}${i < chain.length - 1 ? ' — trying ' + chain[i + 1] : ''}`);
    }
  }
  throw lastErr;
}

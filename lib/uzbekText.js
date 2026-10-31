// lib/uzbekText.js — Uzbek text helpers for the speech-to-text pipeline.
// Speech engines often write Uzbek in Cyrillic (or in a script that depends on which language they guessed). SHERZ, its memory and
// its prompts work in Latin Uzbek, so Cyrillic Uzbek is converted to the official Latin alphabet (1995 reform).
// Russian is never touched: conversion happens only when the text is clearly Uzbek.

const MAP = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: "'", ь: '', ы: 'i', э: 'e', ю: 'yu', я: 'ya',
  ў: "o'", ғ: "g'", қ: 'q', ҳ: 'h', ҷ: 'j', ң: 'ng', һ: 'h',
};
const VOWELS = 'аеёиоуэюяўАЕЁИОУЭЮЯЎ';
const CYR = /[Ѐ-ӿ]/;
const UZ_ONLY = /[ўғқҳЎҒҚҲ]/;                       // letters that exist in Uzbek Cyrillic but not in Russian
const UZ_LANGS = /^(uz|uzb|uzbek|o['‘’ʻ`]?zbek)/i;

export const hasCyrillic = (t) => CYR.test(String(t || ''));
/** true when a Cyrillic text should be treated as Uzbek: Uzbek-only letters, or the engine itself said "Uzbek" */
export function looksUzbekCyrillic(text, detectedLang = '') {
  const t = String(text || '');
  if (!CYR.test(t)) return false;
  if (UZ_ONLY.test(t)) return true;
  return UZ_LANGS.test(String(detectedLang || '').trim());
}

export function cyrillicToLatin(text) {
  const s = String(text || '');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i], low = ch.toLowerCase();
    if (!(low in MAP)) { out += ch; continue; }
    let lat = MAP[low];
    if (low === 'е') {                                       // "ye" at the start of a word or after a vowel / ь / ъ, otherwise "e"
      const prev = s[i - 1];
      lat = (!prev || !/[\p{L}]/u.test(prev) || VOWELS.includes(prev) || prev === 'ъ' || prev === 'ь' || prev === 'Ъ' || prev === 'Ь') ? 'ye' : 'e';
    }
    if (low === 'ц' && i > 0 && VOWELS.includes(s[i - 1])) lat = 's';   // after a vowel "ц" is written "s"; at the start / after a consonant "ts" 
    if (ch !== low && lat) {                                // an upper-case letter: capitalise, or upper-case the whole group inside an ALL-CAPS word
      const next = s[i + 1], prev = s[i - 1];
      const caps = (next && next !== next.toLowerCase()) || (prev && prev !== prev.toLowerCase());
      lat = caps && lat.length > 1 ? lat.toUpperCase() : lat[0].toUpperCase() + lat.slice(1);
    }
    out += lat;
  }
  return out;
}

/** the one call the STT route makes: Latin Uzbek out, everything else untouched */
export function normalizeTranscript(text, detectedLang = '') {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return looksUzbekCyrillic(t, detectedLang) ? cyrillicToLatin(t) : t;
}

// ── error rates for the evaluation tool (script-independent: both sides are converted to Latin first) ──
const foldApos = (s) => s.replace(/[‘’ʻʼ`´]/g, "'");
export function normalizeForScoring(text) {
  let t = String(text || '');
  if (CYR.test(t) && (UZ_ONLY.test(t) || !/[a-z]/i.test(t))) t = cyrillicToLatin(t);
  return foldApos(t.toLowerCase()).replace(/[^\p{L}\p{N}' ]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
function editDistance(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
/** word error rate and character error rate of `hyp` against the reference `ref` (0 = perfect) */
export function errorRates(ref, hyp) {
  const r = normalizeForScoring(ref), h = normalizeForScoring(hyp);
  const rw = r ? r.split(' ') : [], hw = h ? h.split(' ') : [];
  return { wer: rw.length ? editDistance(rw, hw) / rw.length : (hw.length ? 1 : 0), cer: r.length ? editDistance([...r], [...h]) / r.length : (h.length ? 1 : 0) };
}

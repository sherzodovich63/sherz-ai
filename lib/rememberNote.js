// lib/rememberNote.js — the "eslab qol / remember" skill, done properly (pure functions, no database).
// Before: only the text AFTER the words "eslab qol" was kept, so a tip that merely mentioned them
// ("… buni eslab qol degan maqsadda aytvoman, agar kerak bo'lib qolsa") was saved as "note → degan maqsadda aytvoman …"
// and echoed back word for word. Now: the cue words and the little "why I'm telling you" clauses are removed and the REAL tip is kept
// (whatever comes before or after the cue). It is saved quietly in the background; SHERZ's reply is written by the brain like any other turn
// — no template, no canned confirmation.

// the cue itself: "buni (shunchaki) eslab qol", "remember this", "запомни это" …
const CUE = /(?:(?<![\p{L}\p{N}])(?:buni|bularni|shuni)\s+)?(?:(?<![\p{L}\p{N}])(?:shunchaki|iltimos|please|just)\s+)?(?<![\p{L}\p{N}])(?:eslab\s*qol(?:ing|gin)?|esingda\s*tut|yodda\s*tut|remember(?:\s+(?:this|that|it))?|запомни(?:ть)?(?:\s+это)?)(?![\p{L}])/giu;
// meta clauses that explain WHY the user said it ("… degan maqsadda aytvoman", "agar kerak bo'lib qolsa", "so you can use it later") — not part of the tip
const META = [
  /[,;:\-–—]?\s*(?<![\p{L}\p{N}])(?:degan|deb)\s+maqsadda\s+\p{L}+/giu,
  /[,;:\-–—]?\s*(?<![\p{L}\p{N}])agar\s+kerak\s+bo[‘’'`ʻ]?\s*l?ib\s+qolsa\b/giu,
  /[,;:\-–—]?\s*(?<![\p{L}\p{N}])kerak\s+bo[‘’'`ʻ]?\s*lsa\b/giu,
  /[,;:\-–—]?\s*(?<![\p{L}\p{N}])in\s+case\s+(?:you|we)\s+need\s+it\b/giu,
  /[,;:\-–—]?\s*(?<![\p{L}\p{N}])so\s+(?:you|that\s+you)\s+(?:can|could)\s+use\s+it\s+later\b/giu,
];

export function detectLang(text) {
  const t = String(text || '');
  if (/[а-яё]/i.test(t)) return 'ru';
  if (/\b(?:remember|this|that|the|and|when|if|you|to|call|before|with|for|is|it|there|hello|hi)\b/i.test(t) && !/\b(?:qol|bilan|uchun|va|bu|men|sen|bor|yoq|emas|qil|deb|degan|agar|ham|ga|ni)\b/i.test(t)) return 'en';
  return 'uz';
}

const tidy = (s) => String(s || '').replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').replace(/^[\s,;:\-–—.]+|[\s,;:\-–—]+$/g, '').trim();

/** → null (not a remember request) | { ask:true, lang } (nothing to remember yet) | { key, value, lang } */
export function parseRemember(text) {
  const raw = String(text || '').trim();
  CUE.lastIndex = 0;
  if (!raw || !CUE.test(raw)) return null;
  CUE.lastIndex = 0;
  const lang = detectLang(raw);
  let body = raw.replace(CUE, ' ');
  for (const re of META) body = body.replace(re, ' ');
  body = tidy(body);
  if (body.length < 3) return { ask: true, lang };
  let key = 'tip', value = body;
  const kv = body.match(/^([^:]{1,40}):\s*(.+)$/);                                // "eslab qol: Toshkent: 3 ta ombor" keeps its own label
  if (kv) { key = tidy(kv[1]); value = tidy(kv[2]); }
  else key = 'tip:' + body.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).slice(0, 5).join('-').slice(0, 40);
  return { key, value: value.slice(0, 1500), lang };
}

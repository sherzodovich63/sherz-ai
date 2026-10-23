// lib/locale.js — which language SHERZ answers in (uz / en / ru) and the instruction that makes the model do it.
// The browser sends the user's choice (or the device language) with every chat request; anything unknown means "no instruction" (old behaviour).
export const LOCALES = Object.freeze(['uz', 'en', 'ru']);
const NAMES = { uz: 'Uzbek (Latin script, O‘zbek tili)', en: 'English', ru: 'Russian (Русский)' };

/** 'ru-RU' / 'RU' / ' uz ' → 'ru' | 'uz' | 'en'; anything else → null */
export function normalizeLang(v) {
  const c = String(v ?? '').trim().toLowerCase().slice(0, 2);
  return LOCALES.includes(c) ? c : null;
}

/** the language a request asks for: body.lang (multipart / JSON) or body.ui.lang */
export function langFromBody(body) {
  let ui = body?.ui;
  if (typeof ui === 'string') { try { ui = JSON.parse(ui); } catch { ui = null; } }
  return normalizeLang(body?.lang) || normalizeLang(ui?.lang);
}

/** text appended to the END of the system prompt ('' when no language is known) */
export function languageDirective(lang) {
  const l = normalizeLang(lang); if (!l) return '';
  return [
    'LANGUAGE:',
    `- The user's interface language is ${NAMES[l]}. Reply in ${NAMES[l]} by default — in every answer, question, plan and file you write.`,
    '- If the user clearly writes their message in another of Uzbek / English / Russian, answer in the language of THAT message instead, and keep to it until they switch.',
    '- Stay technically exact: keep code, identifiers, commands, file names, API names, units and established terms (e.g. API, Docker, SQL) untranslated; translate only the explanation around them.',
    '- Use natural, correct wording of that language — no word-by-word translation, no mixing languages inside one sentence unless a term has no standard equivalent.',
  ].join('\n');
}

/** appends the directive to a system prompt (safe with empty values) */
export function withLanguage(systemPrompt, lang) {
  const d = languageDirective(lang);
  return d ? `${String(systemPrompt ?? '')}\n\n${d}` : String(systemPrompt ?? '');
}

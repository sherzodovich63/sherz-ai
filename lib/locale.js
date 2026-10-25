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

/** text appended to the END of the system prompt. Always present: the reply language follows the user's latest message;
 *  the UI language (when known) is only the fallback for messages that carry no language signal. */
export function languageDirective(lang) {
  const l = normalizeLang(lang);
  return [
    'LANGUAGE (highest priority — it overrides the language this prompt is written in, the language of earlier replies, and any role / Work Space / project instructions):',
    '- Reply in the language of the user\'s LATEST message: English → English, Russian → Russian, Uzbek → Uzbek, and any other language the same way. Decide it from what the user just wrote — never from this prompt (which is partly written in Uzbek), from your previous replies, or from role text. If the user switches language, switch with them immediately.',
    l
      ? `- Only when the latest message carries no language signal at all (just emoji, numbers, a name, a code snippet, one ambiguous word), use the interface language: ${NAMES[l]}.`
      : '- Only when the latest message carries no language signal at all (just emoji, numbers, a name, a code snippet, one ambiguous word), continue in the language of the user\'s recent messages.',
    '- An explicit request beats the message language: if the user asks to translate, explain, or answer in a specific language ("Translate this to English", "Explain in Uzbek", "reply in Russian"), do exactly that for that request — a standing request ("from now on answer in Russian") holds until they change it.',
    '- Role, persona, Work Space and project instructions never choose the reply language. Ignore any line in them that fixes one (for example "reply in Uzbek") unless the user asked for it themselves in this chat.',
    '- If one message mixes languages, answer in the language of its main sentence.',
    '- Stay technically exact: keep code, identifiers, commands, file names, API names, units and established terms (e.g. API, Docker, SQL) untranslated; translate only the explanation around them.',
    '- Use natural, correct wording of that language — no word-by-word translation, no mixing languages inside one sentence unless a term has no standard equivalent.',
  ].join('\n');
}

/** one-line reminder for prompts that append more text after the directive */
export const LANGUAGE_REMINDER = 'LANGUAGE REMINDER: answer in the language of the user\'s latest message (unless they explicitly asked for another one) — not in the language of these instructions.';

/** appends the directive to a system prompt (safe with empty values) */
export function withLanguage(systemPrompt, lang) {
  return `${String(systemPrompt ?? '')}\n\n${languageDirective(lang)}`;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { normalizeLang, langFromBody, languageDirective, withLanguage } from '../lib/locale.js';

test('locale: normalizes tags and reads body.lang / body.ui.lang (also JSON string from multipart)', () => {
  assert.equal(normalizeLang('ru-RU'), 'ru'); assert.equal(normalizeLang(' UZ '), 'uz'); assert.equal(normalizeLang('de'), null); assert.equal(normalizeLang(undefined), null);
  assert.equal(langFromBody({ lang: 'en' }), 'en'); assert.equal(langFromBody({ ui: { lang: 'ru' } }), 'ru');
  assert.equal(langFromBody({ ui: '{"lang":"uz"}' }), 'uz'); assert.equal(langFromBody({ ui: 'not json' }), null); assert.equal(langFromBody(null), null);
});
test('locale: directive names the language, allows switching, keeps technical terms', () => {
  const d = languageDirective('ru'); assert.match(d, /Russian/); assert.match(d, /language of THAT message/); assert.match(d, /untranslated/);
  assert.equal(languageDirective('xx'), ''); assert.equal(withLanguage('SYS', null), 'SYS');
  assert.ok(withLanguage('SYS', 'uz').startsWith('SYS\n\nLANGUAGE:'));
});

// the dictionary: every entry has three non-empty forms, placeholders match across languages, no ambiguous duplicates
const src = fs.readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8');
const store = {};
const ctx = { window: {}, navigator: { languages: ['ru-RU'] }, localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
  document: { body: null, documentElement: { setAttribute() {} }, addEventListener() {}, querySelectorAll: () => [] }, addEventListener() {}, MutationObserver: undefined, NodeFilter: {}, Promise };
ctx.window = ctx; vm.createContext(ctx); vm.runInContext(src, ctx);
const I = ctx.SherzI18n;

test('dictionary: complete and consistent', () => {
  const norm = (s) => s.replace(/[‘’ʻʼ`´]/g, "'").replace(/\s+/g, ' ').trim();
  const slots = (s) => (s.match(/\{\d\}/g) || []).sort().join();
  const seen = new Map();
  for (const e of I._dict) {
    assert.equal(e.length, 3, e[0]); e.forEach((x) => assert.ok(x && x.trim(), 'empty form in ' + e[0]));
    assert.equal(slots(e[0]), slots(e[1]), e[0]); assert.equal(slots(e[0]), slots(e[2]), e[0]);
    const k = norm(e[0]); if (seen.has(k)) assert.deepEqual(seen.get(k).map(norm), e.map(norm), 'conflicting duplicate: ' + e[0]); seen.set(k, e);
  }
  for (const [k, v] of Object.entries(I._html)) assert.equal(v.length, 3, k);
  assert.ok(I._dict.length > 150);
});
test('detect: device language → uz/ru/en, unknown → en', () => {
  assert.equal(I.detect(), 'ru'); assert.equal(I.lang, 'ru');
  ctx.navigator.languages = ['de-DE', 'uz-UZ']; assert.equal(I.detect(), 'uz');
  ctx.navigator.languages = ['fr']; assert.equal(I.detect(), 'en');
});
test('translate: any source language → target; numbers/slots; unknown text untouched', () => {
  assert.equal(I.translate('Teach a skill', 'uz'), 'Ko‘nikma o‘rgatish');
  assert.equal(I.translate('Ko‘nikma o‘rgatish', 'ru'), 'Научить навыку');
  assert.equal(I.translate('  Edit this Space ', 'ru'), '  Изменить это пространство ');
  assert.equal(I.translate('Describe the task or paste code…', 'uz'), 'Vazifani tasvirlang yoki kodni joylang...');
  assert.equal(I.translate('Show all (31)', 'ru'), 'Показать все (31)');
  assert.equal(I.translate('Role 2 · active · Economics tutor', 'uz'), '2-rol · faol · Economics tutor');
  assert.equal(I.translate('My secret project name', 'ru'), 'My secret project name');
  assert.equal(I.translate('12345', 'ru'), '12345');
});
test('setLang: remembers the choice, "auto" forgets it, t() follows', () => {
  I.setLang('uz'); assert.equal(store.sherz_lang, 'uz'); assert.equal(I.lang, 'uz'); assert.equal(I.t('Cancel'), 'Bekor qilish');
  I.setLang('en'); assert.equal(I.t('Show all ({0})', [5]), 'Show all (5)');
  I.setLang('auto'); assert.equal(store.sherz_lang, undefined);
});
test('wiring: page loads i18n.js, sends lang, has the picker; server threads lang to both brains', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="\/i18n\.js" defer><\/script>/); assert.match(html, /lang: uiLang/); assert.match(html, /lang:uiLang/);
  for (const l of ['auto', 'uz', 'en', 'ru']) assert.match(html, new RegExp(`data-lang-pref="${l}"`));
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(server, /lang: langFromBody\(req\.body\)/); assert.match(server, /runBrain\(\{[^}]*lang \}\)/); assert.match(server, /onProgress, lang \}\)/);
  assert.match(fs.readFileSync(new URL('../brain/brain.js', import.meta.url), 'utf8'), /withLanguage\(systemPrompt, lang\)/);
  assert.match(fs.readFileSync(new URL('../brain/expertTurn.js', import.meta.url), 'utf8'), /withLanguage\(systemPrompt, lang\)/);
});

test('AI notice under the composer: three exact texts, replaces the keyboard hints, shown on phones too', () => {
  assert.equal(I.translate('SHERZ is AI and can make mistakes.', 'ru'), 'SHERZ — это ИИ. Он может ошибаться.');
  assert.equal(I.translate('SHERZ is AI and can make mistakes.', 'uz'), 'SHERZ — bu AI. U xato qilishi mumkin.');
  assert.equal(I.translate('SHERZ — это ИИ. Он может ошибаться.', 'en'), 'SHERZ is AI and can make mistakes.');
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<div class="ai-note" role="note">SHERZ is AI and can make mistakes\.<\/div>/);
  assert.doesNotMatch(html, /<div class="kbd-row">/); assert.equal((html.match(/id="refreshBtn"/g) || []).length, 1, 'duplicate id removed');
  assert.doesNotMatch(html, /<span class="kbd">Enter<\/span> send/);
});

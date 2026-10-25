import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRemember, detectLang } from '../lib/rememberNote.js';

const TIP = 'Bunaqa vaziyatda qara yana bir ozgina xiyla ishlatsek boladigan yechim bor man allaqachon bunaqa issue ni boshimdan otqazganman shunchaki driverim man ozim bn empty trailer olib chiqib ketaman buni drop qilib deb kirib sitega joy topib drop uchun va drop qilib boshqa eshikdan chiqib ketsa boladi shunda driver ham kutib qolmaydi performance ga ham tasir qilmaydi buni shunchaki eslab qol degan maqsadda aytvoman agar kerak bolib qolsa';
test('the real tip is kept; the meta-phrases are not', () => {
  const p = parseRemember(TIP);
  assert.ok(p && !p.ask); assert.equal(p.lang, 'uz');
  assert.match(p.value, /empty trailer/); assert.match(p.value, /performance ga ham tasir qilmaydi/);
  assert.doesNotMatch(p.value, /eslab\s*qol|degan maqsadda|aytvoman|kerak bolib qolsa/i);
  assert.match(p.key, /^tip:/);
  assert.equal(p.said, undefined);                                   // nothing canned to say: the brain answers
});
test('prefix form, labelled form, English and Russian', () => {
  assert.equal(parseRemember('eslab qol: Toshkent ombori: 3 ta darvoza').key, 'Toshkent ombori');
  assert.equal(parseRemember('eslab qol: Toshkent ombori: 3 ta darvoza').value, '3 ta darvoza');
  const a = parseRemember('Remember this: call the broker before 9am to dispute detention'); assert.equal(a.lang, 'en'); assert.match(a.value, /dispute detention/);
  const r = parseRemember('Запомни это: звонить брокеру до 9 утра'); assert.equal(r.lang, 'ru'); assert.match(r.value, /брокеру/);
});
test('no content → { ask }; other messages are not touched', () => {
  assert.equal(parseRemember('buni eslab qol').ask, true);
  assert.equal(parseRemember('salom, qalaysan'), null); assert.equal(parseRemember('men seni eslab qoldim'), null);
  assert.equal(detectLang('hello there'), 'en');
});

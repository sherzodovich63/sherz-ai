import test from 'node:test';
import assert from 'node:assert/strict';
import { docFollowUpRequest, isDocFollowUp, hasFakeFileLink, stripFakeFileLinks } from '../lib/docs/followup.js';

const H = [{ role: 'user', content: 'manga excel jadval qilib ber' }, { role: 'assistant', content: 'Albatta! Qanaqa jadval kerak?' }];

test('follow-up: the short answer to SHERZ\'s question belongs to the file task (the "haqida" bug)', () => {
  assert.equal(docFollowUpRequest({ history: H, text: 'Xarajatlar haqida' }), 'manga excel jadval qilib ber');
  assert.equal(isDocFollowUp({ history: H, text: 'oylik xarajatlar, 5 ta ustun bilan' }), true);
  assert.equal(isDocFollowUp({ history: [{ role: 'user', content: 'сделай эксель таблицу' }, { role: 'assistant', content: 'Какую таблицу? 🙂' }], text: 'про расходы' }), true);
});
test('follow-up: not a follow-up when it is not one', () => {
  assert.equal(isDocFollowUp({ history: [], text: 'Xarajatlar haqida' }), false);                                           // nothing before
  assert.equal(isDocFollowUp({ history: [{ role: 'user', content: 'salom' }, { role: 'assistant', content: 'Salom! Nima gap?' }], text: 'Xarajatlar haqida' }), false);   // no file request earlier
  assert.equal(isDocFollowUp({ history: [H[0], { role: 'assistant', content: 'Tayyor, mana fayl: /api/files/f1/download ?' }], text: 'rahmat' }), false);                 // file already made
  assert.equal(isDocFollowUp({ history: [H[0], { role: 'assistant', content: 'Tushundim. Kutib turing.' }], text: 'Xarajatlar haqida' }), false);                          // SHERZ asked nothing
  assert.equal(isDocFollowUp({ history: H, text: "yo'q, kerak emas" }), false);                                              // cancelled
  assert.equal(isDocFollowUp({ history: H, text: '/agent hello' }), false);
  assert.equal(isDocFollowUp({ history: H, text: 'x '.repeat(40) }), false);                                                 // a long new message is its own topic
  assert.equal(isDocFollowUp({ history: [...H, { role: 'user', content: 'Xarajatlar' }, { role: 'assistant', content: 'Yaxshi, tayyorladim.' }], text: 'Xarajatlar haqida' }), false);
});
test('fake links: sandbox:/, bare file names and invented URLs are detected; our real download route is not', () => {
  assert.equal(hasFakeFileLink('[Excel jadvalini yuklab olish uchun shu yerga bosing](sandbox:/Xarajatlar_Jadvali.xlsx)'), true);
  assert.equal(hasFakeFileLink('[fayl](Xarajatlar.xlsx)'), true); assert.equal(hasFakeFileLink('[x](https://example.com/a/report.pdf)'), true); assert.equal(hasFakeFileLink('[x](file:///tmp/a)'), true);
  assert.equal(hasFakeFileLink('[Yuklab olish](/api/files/abc123/download)'), false);
  assert.equal(hasFakeFileLink('[Wikipedia](https://uz.wikipedia.org/wiki/Excel)'), false); assert.equal(hasFakeFileLink('oddiy matn'), false); assert.equal(hasFakeFileLink(null), false);
  assert.equal(stripFakeFileLinks('Mana: [Excel](sandbox:/a.xlsx) va [sayt](https://uz.wikipedia.org/wiki/Excel) va [real](/api/files/x/download)'), 'Mana: Excel va [sayt](https://uz.wikipedia.org/wiki/Excel) va [real](/api/files/x/download)');
});

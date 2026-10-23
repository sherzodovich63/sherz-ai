import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { periodOf, localParts, cleanGreeting, buildGreetingPrompt, fallbackGreeting, createGreetingService, GREETING_LIMITS } from '../lib/greeting.js';
import { greetingRouter } from '../routes/greeting.js';

const NOW = new Date('2026-10-20T07:30:00Z');            // 12:30 in Tashkent (UTC+5), a Tuesday
const fakeAI = (script = []) => { const calls = []; return { calls, chat: { completions: { async create(req) { calls.push(req); const s = script.shift(); if (s instanceof Error) throw s; if (typeof s === 'function') return s(req); return { choices: [{ message: { content: s ?? 'Salom. Bugun nimaga qiziqib qoldingiz?' } }] }; } } } }; };
const fakePrisma = (o = {}) => ({
  userProfile: { findUnique: async () => o.profile ?? null },
  message: { findFirst: async () => o.last ?? null },
  fact: { findMany: async () => o.facts ?? [] },
  emotionLog: { findFirst: async () => o.emotion ?? null },
});
const svc = (ai, prisma = null, extra = {}) => createGreetingService({ openai: ai, prisma, now: () => NOW, random: () => 0.1, ...extra });

test('time: period and local hour follow the USER\'s zone, and a bad zone never throws', () => {
  assert.equal(periodOf(7), 'morning'); assert.equal(periodOf(13), 'afternoon'); assert.equal(periodOf(19), 'evening'); assert.equal(periodOf(2), 'late night'); assert.equal(periodOf(23), 'late night');
  const t = localParts(NOW, 'Asia/Tashkent'); assert.equal(t.hour, 12); assert.equal(t.weekday, 'Tuesday');
  assert.equal(localParts(NOW, 'America/New_York').hour, 3);
  assert.doesNotThrow(() => localParts(NOW, 'Not/AZone')); assert.doesNotThrow(() => localParts(NOW, ''));
});

test('clean: one short plain-text block; quotes, markdown, labels and stock service phrases are removed or rejected', () => {
  assert.equal(cleanGreeting('"Salom 🙂\nNima gap?"'), 'Salom 🙂\nNima gap?');
  assert.equal(cleanGreeting('SHERZ: **Salom**, `kech` bo‘ldi'), 'Salom, kech bo‘ldi');
  assert.equal(cleanGreeting('a\n\nb\nc\nd\ne').split('\n').length, GREETING_LIMITS.maxLines);
  const long = cleanGreeting('Salom '.repeat(100)); assert.ok(long.length <= GREETING_LIMITS.maxChars + 2, String(long.length));
  assert.equal(cleanGreeting(''), null); assert.equal(cleanGreeting(null), null); assert.equal(cleanGreeting('  '), null);
  assert.equal(cleanGreeting('Hello! How can I help you today?'), null);
  assert.equal(cleanGreeting('Sizga qanday yordam bera olaman?'), null);
});

test('prompt: time of day, name, gap and the curiosity directive go in; nothing is invented; repeats are fenced off', () => {
  const p = buildGreetingPrompt({ now: NOW, tz: 'Asia/Tashkent', hour: 23, weekday: 'Friday', name: 'Bekzod', gapHours: 50, lastHint: 'SHERZ UI ni tuzatish', facts: ['habit:tong: erta turadi'], intent: 'curiosity', curiosity: { flavor: 'technical', directive: 'DIRECTIVE-TECH' }, avoid: ['Eski salom 1', 'Eski salom 2'] });
  assert.match(p.user, /Friday, 23:00 \(late night\)/); assert.match(p.user, /Bekzod/); assert.match(p.user, /about 2 day\(s\)/);
  assert.match(p.user, /SHERZ UI ni tuzatish/); assert.match(p.user, /DIRECTIVE-TECH/); assert.match(p.user, /Eski salom 1/); assert.match(p.user, /Do not repeat or paraphrase/);
  assert.match(p.system, /Uzbek in Latin script/); assert.match(p.system, /Do not invent facts/); assert.match(p.system, /Be honest that you are an AI/);
  const bare = buildGreetingPrompt({ now: NOW, hour: 8, weekday: 'Monday', intent: 'checkin' });
  assert.match(bare.user, /do not invent one/); assert.match(bare.user, /first chat/); assert.ok(!/Their name: /.test(bare.user));
});

test('service: a fresh greeting from the model is returned, shaped by the real context (profile, last message, facts, zone)', async () => {
  const ai = fakeAI(['Hayrli kun, Bekzod.\nUI ni tuzatish qanday ketyapti?']);
  const s = svc(ai, fakePrisma({ profile: { preferredName: 'Bekzod' }, last: { text: 'SHERZ UI ni tuzatamiz', createdAt: new Date(+NOW - 5 * 3.6e6) }, facts: [{ key: 'stack', value: 'Node + Prisma' }] }));
  const out = await s.get({ userId: 'u1', tz: 'Asia/Tashkent' });
  assert.equal(out.source, 'ai'); assert.match(out.text, /Bekzod/); assert.equal(out.intent, 'curiosity'); assert.ok(out.flavor);
  const user = ai.calls[0].messages[1].content;
  assert.match(user, /12:00 \(afternoon\)/); assert.match(user, /Bekzod/); assert.match(user, /5 hour/); assert.match(user, /stack: Node \+ Prisma/);
  assert.equal(ai.calls[0].temperature, 1); assert.ok(ai.calls[0].max_tokens <= 120);
});

test('service: a stressed user gets a gentle support opening, never a curiosity prompt', async () => {
  const ai = fakeAI(['Men shu yerdaman. Gaplashamiz yoki shunchaki jim o‘tiramiz.']);
  const s = svc(ai, fakePrisma({ emotion: { score: -3, createdAt: new Date(+NOW - 2 * 3.6e6) } }));
  const out = await s.get({ userId: 'u1', tz: 'Asia/Tashkent' });
  assert.equal(out.intent, 'support'); assert.equal(out.flavor, null);
  assert.match(ai.calls[0].messages[1].content, /hard time/); assert.ok(!/philosophical|technical|wonder/i.test(ai.calls[0].messages[1].content));
  const old = svc(fakeAI(['x salom']), fakePrisma({ emotion: { score: -3, createdAt: new Date(+NOW - 80 * 3.6e6) } }));
  assert.notEqual((await old.get({ userId: 'u1' })).intent, 'support');                  // an old bad day does not follow them forever
});

test('service: it remembers what it said and tells the model not to repeat it; flavors rotate', async () => {
  let t = NOW; const ai = fakeAI(['Birinchi salom bu.', 'Ikkinchi salom bu.', 'Uchinchi salom bu.']);
  const s = createGreetingService({ openai: ai, now: () => t, random: () => 0.1, limits: { cacheMs: 0 } });
  const flavors = [];
  for (let i = 0; i < 3; i++) { const o = await s.get({ userId: 'u1' }); flavors.push(o.flavor); t = new Date(+t + 60_000); }
  assert.match(ai.calls[1].messages[1].content, /Birinchi salom bu/); assert.match(ai.calls[2].messages[1].content, /Ikkinchi salom bu/);
  assert.equal(new Set(flavors).size, 3, flavors.join(','));
});

test('service: reload within a few seconds reuses the greeting (no second model call); ?fresh forces a new one', async () => {
  const ai = fakeAI(['Bir.', 'Ikki.']); const s = svc(ai);
  const a = await s.get({ userId: 'u1' }); const b = await s.get({ userId: 'u1' });
  assert.equal(a.source, 'ai'); assert.equal(b.source, 'cache'); assert.equal(b.text, a.text); assert.equal(ai.calls.length, 1);
  assert.equal((await s.get({ userId: 'u1', force: true })).source, 'ai'); assert.equal(ai.calls.length, 2);
  assert.equal((await s.get({ userId: 'u2' })).source, 'ai');                              // another user is never served u1's greeting
});

test('service: hourly limit, model errors, timeouts and junk all degrade to a fallback line — never an exception', async () => {
  const limited = svc(fakeAI(Array(20).fill('Salom bu.')), null, { limits: { cacheMs: 0, perHour: 2 } });
  assert.equal((await limited.get({ userId: 'u1' })).source, 'ai'); assert.equal((await limited.get({ userId: 'u1' })).source, 'ai');
  const third = await limited.get({ userId: 'u1' }); assert.equal(third.source, 'fallback'); assert.ok(third.text.length > 5);
  assert.equal((await svc(fakeAI([new Error('boom')])).get({ userId: 'u1' })).source, 'fallback');
  assert.equal((await svc(fakeAI(['   '])).get({ userId: 'u1' })).source, 'fallback');
  assert.equal((await svc(fakeAI(['How can I help you today?'])).get({ userId: 'u1' })).source, 'fallback');
  assert.equal((await svc(null).get({ userId: 'u1' })).source, 'fallback');
  const slow = svc(fakeAI([() => new Promise(() => {})]), null, { limits: { timeoutMs: 40 } });
  const t0 = Date.now(); const o = await slow.get({ userId: 'u1' }); assert.equal(o.source, 'fallback'); assert.ok(Date.now() - t0 < 1000);
  const brokenDb = svc(fakeAI(['Salom, dunyo.']), { userProfile: { findUnique: async () => { throw new Error('db down'); } }, message: {}, fact: {}, emotionLog: {} });
  assert.equal((await brokenDb.get({ userId: 'u1' })).source, 'ai');                       // missing context just means less context
  assert.match(fallbackGreeting({ hour: 8 }), /^Hayrli tong/); assert.match(fallbackGreeting({ hour: 14 }), /^Salom/); assert.match(fallbackGreeting({ hour: 21 }), /^Xayrli kech/);
});

test('route: owner-scoped, never 5xx for a model problem, and the zone reaches the service', async () => {
  const seen = []; const service = { async get(a) { seen.push(a); return { text: 'Salom.\nBugun nima qiziq?', source: 'ai', intent: 'curiosity', flavor: 'wonder' }; } };
  const app = express(); app.use((req, _r, n) => { req.user = req.headers['x-user'] ? { id: req.headers['x-user'] } : undefined; n(); });
  app.use('/api/greeting', greetingRouter({ service, isProd: true }));
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}/api/greeting`;
  try {
    assert.equal((await fetch(base)).status, 401);
    const r = await fetch(base + '?tz=Asia/Tashkent&fresh=1', { headers: { 'x-user': 'user_1' } }); const j = await r.json();
    assert.equal(r.status, 200); assert.equal(j.text, 'Salom.\nBugun nima qiziq?'); assert.equal(j.source, 'ai'); assert.match(r.headers.get('cache-control'), /no-store/);
    assert.deepEqual(seen[0], { userId: 'user_1', tz: 'Asia/Tashkent', force: true });
  } finally { srv.close(); }
  const bad = express(); bad.use((req, _r, n) => { req.user = { id: 'u' }; n(); }); bad.use('/g', greetingRouter({ service: { get: async () => { throw new Error('x'); } }, isProd: true }));
  const s2 = bad.listen(0); try { const r = await fetch(`http://127.0.0.1:${s2.address().port}/g`); const j = await r.json(); assert.equal(r.status, 200); assert.equal(j.text, ''); } finally { s2.close(); }
});

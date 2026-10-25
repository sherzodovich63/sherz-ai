import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrub, anonymizeSolution, distillSolution, keywordsOf } from '../lib/solutionAnonymize.js';
import { roleGroupOf, detectOutcome, isEvidenceQuestion, statusFor, cosine, createSharedSolutions, buildSolutionsBlock, isRealAccount } from '../lib/sharedSolutions.js';
import { createSolutionsRuntime } from '../lib/solutionsRuntime.js';

// ── tiny in-memory prisma ──
function mkPrisma(seed = {}) {
  let n = 0; const id = () => 'id' + ++n;
  const db = { pref: [], sol: [], conf: [], msgs: seed.msgs || [], users: seed.users || [], spaces: seed.spaces || [] };
  const match = (row, w = {}) => Object.entries(w).every(([k, v]) => {
    if (v && typeof v === 'object') { if ('in' in v) return v.in.includes(row[k]); if ('not' in v) return row[k] !== v.not; }
    return row[k] === v;
  });
  return { db,
    userPref: {
      findUnique: async ({ where }) => db.pref.find((p) => p.userId === where.userId_key.userId && p.key === where.userId_key.key) || null,
      upsert: async ({ where, update, create }) => { const p = db.pref.find((x) => x.userId === where.userId_key.userId && x.key === where.userId_key.key); if (p) Object.assign(p, update); else db.pref.push({ ...create }); },
    },
    sharedSolution: {
      create: async ({ data }) => { const r = { id: id(), status: 'candidate', confirmCount: 0, failCount: 0, lastConfirmedAt: null, createdAt: new Date(), updatedAt: new Date(), embedding: null, ...data }; db.sol.push(r); return r; },
      findUnique: async ({ where }) => db.sol.find((s) => s.id === where.id) || null,
      findMany: async ({ where, take }) => db.sol.filter((s) => match(s, where)).slice(0, take || 999),
      update: async ({ where, data }) => Object.assign(db.sol.find((s) => s.id === where.id), data),
      delete: async ({ where }) => { db.sol = db.sol.filter((s) => s.id !== where.id); },
    },
    solutionConfirmation: {
      findUnique: async ({ where }) => db.conf.find((c) => c.solutionId === where.solutionId_userHash.solutionId && c.userHash === where.solutionId_userHash.userHash) || null,
      create: async ({ data }) => { db.conf.push({ id: id(), ...data }); },
      update: async ({ where, data }) => Object.assign(db.conf.find((c) => c.solutionId === where.solutionId_userHash.solutionId && c.userHash === where.solutionId_userHash.userHash), data),
      delete: async ({ where }) => { db.conf = db.conf.filter((c) => !(c.solutionId === where.solutionId_userHash.solutionId && c.userHash === where.solutionId_userHash.userHash)); },
      count: async ({ where }) => db.conf.filter((c) => match(c, where)).length,
      findMany: async ({ where }) => db.conf.filter((c) => match(c, where)),
    },
    workSpace: { findFirst: async ({ where }) => db.spaces.find((s) => s.id === where.id && s.userId === where.userId) || null },
    message: { findMany: async ({ where }) => db.msgs.filter((m) => m.conversationId === where.conversationId).slice().reverse() },
    user: { findUnique: async ({ where }) => db.users.find((u) => u.id === where.id) || null },
  };
}
const ENV = { JWT_SECRET: 'x'.repeat(40), SOLUTIONS_TRUST_MIN: '3' };
const GOOD = { skip: false, problem: 'A broker disputes a late pickup claim after the driver was held at the shipper.', solution: 'Send the GPS timestamp and the shipper check-in time, ask the broker for the written reason, and request detention pay in the same message.', conditions: 'When the delay was caused by the shipper.' };

// ── anonymizer ──
test('scrub removes e-mails, links, phones, amounts, ids and the private terms', () => {
  const r = scrub('Mail john.smith@acme.com, see https://acme.com/x, call +1 (415) 555-0199, rate $2,450.50, load LD48213AB7, VIN 1FTFW1ET5DFC10312, MC 884512, Acme Logistics said so', { privateTerms: ['Acme Logistics', 'John'] });
  for (const bad of ['john.smith', 'acme.com', '555', '2,450', 'LD48213', '1FTFW', '884512', 'Acme Logistics']) assert.ok(!r.text.includes(bad), bad + ' leaked: ' + r.text);
  assert.ok(r.redactions >= 6);
});
test('scrub keeps ordinary technical words', () => {
  const t = 'Use Docker and a rate confirmation; run npm test twice. Check the base64 header.';
  assert.equal(scrub(t).text, t);
});
test('anonymizeSolution accepts a general method and builds keywords', () => {
  const r = anonymizeSolution(GOOD);
  assert.equal(r.ok, true); assert.match(r.keywords, /broker/); assert.match(r.keywords, /gps/);
});
test('anonymizeSolution rejects skips, tiny answers and answers full of identifiers', () => {
  assert.equal(anonymizeSolution({ skip: true }).ok, false);
  assert.equal(anonymizeSolution({ problem: 'hi', solution: 'ok' }).ok, false);
  const heavy = { problem: 'Call 555-123-4567 or a@b.com or c@d.com about 12345678 and 98765432 and https://x.y', solution: 'Send 11111111 to e@f.com and g@h.com and 22222222 and 33333333 please now' };
  assert.equal(anonymizeSolution(heavy).ok, false);
});
test('anonymizeSolution strips the private terms from every field', () => {
  const r = anonymizeSolution({ ...GOOD, solution: GOOD.solution + ' Tell Sherzod Karimov to do it.' }, { privateTerms: ['Sherzod Karimov'] });
  assert.ok(!/Karimov/.test(r.solution));
});
test('distillSolution: parses the llm JSON, tolerates fences, never throws', async () => {
  const ok = await distillSolution({ llm: async () => '```json\n' + JSON.stringify(GOOD) + '\n```', problem: 'p', answer: 'a' });
  assert.equal(ok.ok, true);
  assert.equal((await distillSolution({ llm: async () => 'not json', problem: 'p', answer: 'a' })).ok, false);
  assert.equal((await distillSolution({ llm: async () => { throw new Error('boom'); }, problem: 'p', answer: 'a' })).ok, false);
  assert.equal((await distillSolution({ problem: 'p', answer: 'a' })).ok, false);
});
test('keywordsOf drops stop words and placeholders', () => assert.equal(keywordsOf('The broker [number] and the detention pay'), 'broker detention pay'));

// ── scope, outcomes, trust ──
test('scope: only dispatcher / developer / analyst presets; guests are never real accounts', () => {
  assert.equal(roleGroupOf('logistics.dispatcher'), 'dispatcher'); assert.equal(roleGroupOf('software.fullstack'), 'developer'); assert.equal(roleGroupOf('finance.analyst'), 'analyst');
  for (const x of ['blank', 'creative.writer', 'academic.student', '', null, undefined]) assert.equal(roleGroupOf(x), null);
  assert.equal(isRealAccount('guest_abc'), false); assert.equal(isRealAccount('u1'), false); assert.equal(isRealAccount('cm123'), true);
});
test('detectOutcome: EN / RU / UZ feedback, ignores questions and long messages', () => {
  for (const t of ['it worked!', 'That worked, thanks', 'ishladi rahmat', 'yordam berdi', 'сработало', 'Помогло, спасибо', 'problem solved']) assert.equal(detectOutcome(t), 'worked', t);
  for (const t of ["it didn't work", 'ishlamadi', 'не помогло', 'still not working']) assert.equal(detectOutcome(t), 'failed', t);
  for (const t of ['does it work for trucks?', 'hello', '', 'a'.repeat(200) + ' it worked']) assert.equal(detectOutcome(t), null, t);
});
test('isEvidenceQuestion: only real "how do you know / was it tested" questions', () => {
  for (const t of ['How do you know this?', 'has this been tested?', 'Qayerdan bilasan?', 'bu tekshirilganmi', 'Откуда ты знаешь?', 'это проверено?']) assert.equal(isEvidenceQuestion(t), true, t);
  for (const t of ['what is a rate confirmation', 'send the email', 'ok thanks']) assert.equal(isEvidenceQuestion(t), false, t);
});
test('statusFor: trusted needs enough confirmations and few failures; many failures hide it', () => {
  assert.equal(statusFor({ confirmCount: 2, failCount: 0 }, 3), 'candidate');
  assert.equal(statusFor({ confirmCount: 3, failCount: 0 }, 3), 'trusted');
  assert.equal(statusFor({ confirmCount: 4, failCount: 3 }, 3), 'candidate');
  assert.equal(statusFor({ confirmCount: 1, failCount: 3 }, 3), 'hidden');
});
test('cosine', () => { assert.equal(cosine([1, 0], [1, 0]), 1); assert.equal(cosine([1, 0], [0, 1]), 0); assert.equal(cosine([1], [1, 2]), 0); });

// ── service ──
const mkSvc = (prisma, extra = {}) => createSharedSolutions({ prisma, env: ENV, llm: async () => JSON.stringify(GOOD), ...extra });

test('sharing is OFF by default, needs a real account, and can be switched on and off', async () => {
  const svc = mkSvc(mkPrisma());
  assert.equal(await svc.isEnabled('user_1'), false);
  await assert.rejects(() => svc.setEnabled('guest_x', true), RangeError);
  await svc.setEnabled('user_1', true); assert.equal(await svc.isEnabled('user_1'), true);
  await svc.setEnabled('user_1', false); assert.equal(await svc.isEnabled('user_1'), false);
});
test('capture: not eligible without opt-in; with opt-in it stores an anonymized CANDIDATE with a hashed voter', async () => {
  const p = mkPrisma(); const svc = mkSvc(p);
  assert.equal((await svc.capture({ userId: 'user_1', roleGroup: 'dispatcher', problem: 'x'.repeat(30), answer: 'y'.repeat(30) })).ok, false);
  await svc.setEnabled('user_1', true);
  const r = await svc.capture({ userId: 'user_1', roleGroup: 'dispatcher', problem: 'x'.repeat(30), answer: 'y'.repeat(30) });
  assert.equal(r.ok, true); assert.equal(r.status, 'candidate');
  assert.equal(p.db.sol.length, 1); assert.equal(p.db.sol[0].confirmCount, 1);
  assert.ok(!p.db.conf[0].userHash.includes('user_1') && p.db.conf[0].userHash.length === 32);
});
test('capture never stores a solution the anonymizer rejects', async () => {
  const p = mkPrisma(); const svc = mkSvc(p, { llm: async () => JSON.stringify({ skip: true }) });
  await svc.setEnabled('user_1', true);
  assert.equal((await svc.capture({ userId: 'user_1', roleGroup: 'developer', problem: 'x', answer: 'y' })).ok, false);
  assert.equal(p.db.sol.length, 0);
});
test('trust: three DISTINCT people make it trusted; the same person twice does not; failures hide it', async () => {
  const p = mkPrisma(); const svc = mkSvc(p);
  await svc.setEnabled('user_1', true);
  const { id } = await svc.capture({ userId: 'user_1', roleGroup: 'dispatcher', problem: 'x'.repeat(30), answer: 'y'.repeat(30) });
  await svc.recordOutcome(id, 'user_1', 'worked');
  assert.equal(p.db.sol[0].confirmCount, 1);
  await svc.recordOutcome(id, 'user_2', 'worked'); assert.equal(p.db.sol[0].status, 'candidate');
  await svc.recordOutcome(id, 'user_3', 'worked'); assert.equal(p.db.sol[0].status, 'trusted'); assert.equal(p.db.sol[0].confirmCount, 3);
  await svc.recordOutcome(id, 'user_2', 'failed'); assert.equal(p.db.sol[0].confirmCount, 2); assert.equal(p.db.sol[0].failCount, 1);
  const q = mkPrisma(); const s2 = mkSvc(q); await s2.setEnabled('user_1', true);
  const r = await s2.capture({ userId: 'user_1', roleGroup: 'dispatcher', problem: 'x'.repeat(30), answer: 'y'.repeat(30) });
  for (const u of ['a1', 'a2', 'a3']) await s2.recordOutcome(r.id, u, 'failed');
  assert.equal(q.db.sol[0].status, 'hidden');
});
test('find: only TRUSTED solutions of the same role group, ranked by relevance; short messages find nothing', async () => {
  const p = mkPrisma(); const svc = mkSvc(p);
  const mk = (roleGroup, status, problem) => p.sharedSolution.create({ data: { roleGroup, status, problem, solution: 's', keywords: keywordsOf(problem), confirmCount: 3 } });
  await mk('dispatcher', 'trusted', 'broker disputes late pickup claim detention'); await mk('dispatcher', 'candidate', 'broker disputes late pickup claim candidate');
  await mk('developer', 'trusted', 'broker disputes late pickup claim detention'); await mk('dispatcher', 'trusted', 'database migration rollback postgres');
  const hit = await svc.find({ roleGroup: 'dispatcher', message: 'the broker disputes my late pickup and refuses detention' });
  assert.equal(hit.length, 1); assert.equal(hit[0].status, 'trusted'); assert.match(hit[0].problem, /detention/);
  assert.deepEqual(await svc.find({ roleGroup: 'dispatcher', message: 'hi' }), []);
  assert.deepEqual(await svc.find({ roleGroup: 'dispatcher', message: 'completely unrelated cooking question about pasta' }), []);
});
test('find and capture use embeddings when available: a near-duplicate becomes one more confirmation', async () => {
  const p = mkPrisma(); const embed = async () => [1, 0, 0];
  const svc = mkSvc(p, { embed });
  await svc.setEnabled('user_1', true); await svc.setEnabled('user_2', true);
  const a = await svc.capture({ userId: 'user_1', roleGroup: 'analyst', problem: 'x'.repeat(30), answer: 'y'.repeat(30) });
  const b = await svc.capture({ userId: 'user_2', roleGroup: 'analyst', problem: 'z'.repeat(30), answer: 'w'.repeat(30) });
  assert.equal(b.merged, true); assert.equal(b.id, a.id); assert.equal(p.db.sol.length, 1); assert.equal(p.db.sol[0].confirmCount, 2);
});
test('withdraw removes my votes and candidates nobody else confirmed', async () => {
  const p = mkPrisma(); const svc = mkSvc(p);
  await svc.setEnabled('user_1', true);
  const a = await svc.capture({ userId: 'user_1', roleGroup: 'dispatcher', problem: 'x'.repeat(30), answer: 'y'.repeat(30) });
  await svc.recordOutcome(a.id, 'user_2', 'worked');
  const out = await svc.withdraw('user_1');
  assert.equal(out.removed, 1); assert.equal(p.db.sol.length, 1); assert.equal(p.db.sol[0].confirmCount, 1);
  await svc.withdraw('user_2'); assert.equal(p.db.sol.length, 0);
});

// ── the prompt block ──
test('block: discreet by default (never show / only when asked), opens the evidence on request', () => {
  const row = { problem: 'late pickup dispute', solution: 'send GPS timestamp', conditions: '', confirmCount: 14, failCount: 1, lastConfirmedAt: new Date('2026-10-12') };
  const b = buildSolutionsBlock([row]);
  assert.match(b, /never show this section/); assert.match(b, /Do NOT mention these patterns/); assert.match(b, /14 independent professionals/);
  assert.match(buildSolutionsBlock([row], { withEvidence: true }), /user is now asking how you know/);
  assert.equal(buildSolutionsBlock([]), '');
});

// ── runtime (one chat turn) ──
function world() {
  const p = mkPrisma({
    users: [{ id: 'user_1', name: 'Sherzod Karimov', email: 'sherzod@acme.com' }],
    spaces: [{ id: 'sp1', userId: 'user_1', name: 'Acme Dispatch', role: '', preset: 'logistics.dispatcher', archivedAt: null }],
  });
  const svc = mkSvc(p); const rt = createSolutionsRuntime({ prisma: p, service: svc, log: { warn() {} } });
  return { p, svc, rt, conv: { id: 'c1', kind: 'space', spaceId: 'sp1', description: '' }, space: { id: 'sp1', preset: 'logistics.dispatcher' } };
}
const seedTrusted = async (p) => {
  const row = await seedRow(p);
  for (let i = 0; i < 14; i++) p.db.conf.push({ id: 'seed' + i, solutionId: row.id, userHash: 'h' + i, outcome: 'worked' });
  p.db.conf.push({ id: 'seedf', solutionId: row.id, userHash: 'hf', outcome: 'failed' });
  return row;
};
const seedRow = (p) => p.sharedSolution.create({ data: { roleGroup: 'dispatcher', status: 'trusted', problem: 'broker disputes late pickup claim detention', solution: 'send GPS timestamp and ask for written reason', keywords: 'broker disputes late pickup claim detention gps', confirmCount: 14, failCount: 1, lastConfirmedAt: new Date('2026-10-12') } });

test('runtime provider: nothing unless opted in, signed in and in an eligible role', async () => {
  const w = world(); await seedTrusted(w.p);
  const msg = 'the broker disputes my late pickup and refuses detention';
  assert.equal(await w.rt.provider({ userId: 'user_1', conv: w.conv, space: w.space, message: msg }), '');          // opt-in OFF
  await w.svc.setEnabled('user_1', true);
  assert.match(await w.rt.provider({ userId: 'user_1', conv: w.conv, space: w.space, message: msg }), /FIELD-TESTED PATTERNS/);
  assert.equal(await w.rt.provider({ userId: 'user_1', conv: w.conv, space: { id: 'sp1', preset: 'creative.writer' }, message: msg }), '');   // role out of scope
  assert.equal(await w.rt.provider({ userId: 'guest_9', conv: w.conv, space: w.space, message: msg }), '');         // guests never take part
});
test('runtime: "how do you know this?" right after a pattern was used re-opens the evidence', async () => {
  const w = world(); await seedTrusted(w.p); await w.svc.setEnabled('user_1', true);
  await w.rt.provider({ userId: 'user_1', conv: w.conv, space: w.space, message: 'the broker disputes my late pickup and refuses detention' });
  const b = await w.rt.provider({ userId: 'user_1', conv: w.conv, space: w.space, message: 'How do you know this?' });
  assert.match(b, /user is now asking how you know/); assert.match(b, /14 independent professionals/);
  const fresh = world(); await fresh.svc.setEnabled('user_1', true);
  assert.equal(await fresh.rt.provider({ userId: 'user_1', conv: fresh.conv, space: fresh.space, message: 'How do you know this?' }), '');   // nothing was used → nothing to show
});
test('runtime: "it worked" after a pattern-based answer votes for that pattern; "it didn\'t" votes against', async () => {
  const w = world(); const sol = await seedTrusted(w.p); await w.svc.setEnabled('user_1', true);
  await w.rt.provider({ userId: 'user_1', conv: w.conv, space: w.space, message: 'the broker disputes my late pickup and refuses detention' });
  w.rt.onUserTurn({ userId: 'user_1', conv: w.conv, text: 'ishladi rahmat' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(w.p.db.sol.find((s) => s.id === sol.id).confirmCount, 15);
  await w.rt.provider({ userId: 'user_1', conv: w.conv, space: w.space, message: 'the broker disputes my late pickup and refuses detention' });
  w.rt.onUserTurn({ userId: 'user_1', conv: w.conv, text: 'не помогло' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(w.p.db.sol.find((s) => s.id === sol.id).failCount, 2);
});
test('runtime: "it worked" with no known pattern captures the last answer as a new anonymized candidate', async () => {
  const w = world(); await w.svc.setEnabled('user_1', true);
  w.p.db.msgs.push({ conversationId: 'c1', role: 'user', text: 'Sherzod here: broker at Acme disputes my late pickup claim, what do I do?' },
    { conversationId: 'c1', role: 'assistant', text: 'Send the GPS timestamp and ask for the reason in writing.' }, { conversationId: 'c1', role: 'user', text: 'it worked!' });
  w.rt.onUserTurn({ userId: 'user_1', conv: w.conv, text: 'it worked!' });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(w.p.db.sol.length, 1); assert.equal(w.p.db.sol[0].status, 'candidate');
});
test('runtime: opt-out users and out-of-scope roles capture nothing', async () => {
  const w = world();
  w.p.db.msgs.push({ conversationId: 'c1', role: 'user', text: 'a long enough problem statement about dispatching' }, { conversationId: 'c1', role: 'assistant', text: 'an answer' });
  w.rt.onUserTurn({ userId: 'user_1', conv: w.conv, text: 'it worked' }); await new Promise((r) => setTimeout(r, 20));
  assert.equal(w.p.db.sol.length, 0);
  await w.svc.setEnabled('user_1', true); w.p.db.spaces[0].preset = 'creative.writer';
  w.rt.onUserTurn({ userId: 'user_1', conv: w.conv, text: 'it worked' }); await new Promise((r) => setTimeout(r, 20));
  assert.equal(w.p.db.sol.length, 0);
});

test('loadWorkMode adds the patterns block to the Space block (and only when the provider returns one)', async () => {
  const { loadWorkMode, setSolutionsProvider } = await import('../lib/spaces.js');
  const row = { id: 'sp1', userId: 'user_1', name: 'Dispatch', role: 'Freight dispatch assistant', preset: 'logistics.dispatcher', style: 'operational', instructions: '', archivedAt: null, activeRole: 1, role2: null };
  const prisma = { workSpace: { findFirst: async () => row }, skill: { findMany: async () => [] } };
  const conv = { id: 'c1', kind: 'space', spaceId: 'sp1', description: '', projectId: null };
  setSolutionsProvider(async () => 'FIELD-TESTED PATTERNS (test)');
  const withBlock = await loadWorkMode(prisma, 'user_1', conv, 'broker problem with detention');
  setSolutionsProvider(async () => { throw new Error('boom'); });
  const broken = await loadWorkMode(prisma, 'user_1', conv, 'broker problem with detention');
  setSolutionsProvider(null);
  const without = await loadWorkMode(prisma, 'user_1', conv, 'broker problem with detention');
  assert.match(withBlock.space.block, /FIELD-TESTED PATTERNS \(test\)/);
  assert.doesNotMatch(broken.space.block, /FIELD-TESTED/); assert.doesNotMatch(without.space.block, /FIELD-TESTED/);
});

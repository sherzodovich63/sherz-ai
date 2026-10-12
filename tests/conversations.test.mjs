import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject, listConversations, updateConversation, deleteConversation, resolveConversation, ensureCompanion,
  workModeFor, saveTurn, cleanTitle, COMPANION_TITLE,
} from '../lib/conversations.js';
import { buildWorkModeBlock, composeSystemPrompt } from '../brain/workMode.js';
import { fetchPage, fetchContextForLLM } from '../lib/chatHistory.js';
import { mergeGuestIntoUser } from '../lib/guestMerge.js';

// tiny in-memory Prisma covering exactly the query shapes conversations.js / chatHistory.js use
function db() {
  let n = 0; const id = (p) => `${p}${String(++n).padStart(5, '0')}`;
  const T = { conv: [], msg: [] }; let clock = 1_760_000_000_000;
  const now = () => new Date(clock += 1000);
  const hasText = (cid, term) => T.msg.some((m) => m.conversationId === cid && m.text.toLowerCase().includes(term.toLowerCase()));
  const matchConv = (c, w) => {
    if (w.userId && c.userId !== w.userId) return false;
    if (w.id && c.id !== w.id) return false;
    if (w.kind && c.kind !== w.kind) return false;
    if (w.messages?.some && !T.msg.some((m) => m.conversationId === c.id)) return false;
    if (w.OR) return w.OR.some((o) => (o.title ? c.title.toLowerCase().includes(o.title.contains.toLowerCase())
      : o.description ? (c.description || '').toLowerCase().includes(o.description.contains.toLowerCase())
      : hasText(c.id, o.messages.some.text.contains)));
    return true;
  };
  const matchMsg = (m, w) => {
    if (w.userId && m.userId !== w.userId) return false;
    if ('conversationId' in w && m.conversationId !== w.conversationId) return false;
    if (w.id?.in && !w.id.in.includes(m.id)) return false;
    if (w.OR) return w.OR.some((c) => c.createdAt.lt ? m.createdAt < c.createdAt.lt : m.createdAt.getTime() === c.createdAt.getTime() && m.id < c.id.lt);
    return true;
  };
  const sortDesc = (k) => (a, b) => (b[k] - a[k]) || (b.id < a.id ? -1 : 1);
  return {
    T,
    conversation: {
      create: async ({ data }) => { const c = { id: id('c'), title: 'New chat', kind: 'companion', description: null, createdAt: now(), updatedAt: now(), ...data }; T.conv.push(c); return c; },
      findFirst: async ({ where, orderBy }) => { const r = T.conv.filter((c) => matchConv(c, where)); if (orderBy) r.sort(sortDesc('updatedAt')); return r[0] || null; },
      findMany: async ({ where, take }) => T.conv.filter((c) => matchConv(c, where)).sort(sortDesc('updatedAt')).slice(0, take),
      update: async ({ where, data }) => { const c = T.conv.find((x) => x.id === where.id); Object.assign(c, data, data.updatedAt ? { updatedAt: now() } : {}); return c; },
      delete: async ({ where }) => { T.conv = T.conv.filter((c) => c.id !== where.id); },
      updateMany: async ({ where, data }) => { const r = T.conv.filter((c) => c.userId === where.userId); r.forEach((c) => Object.assign(c, data)); return { count: r.length }; },
    },
    message: {
      create: async ({ data }) => { const m = { id: id('m'), createdAt: now(), conversationId: null, ...data }; T.msg.push(m); return m; },
      findMany: async ({ where, orderBy, take }) => {
        let r = T.msg.filter((m) => matchMsg(m, where));
        const desc = Array.isArray(orderBy) && orderBy[0]?.createdAt === 'desc';
        r.sort((a, b) => (desc ? -1 : 1) * ((a.createdAt - b.createdAt) || (a.id < b.id ? -1 : 1)));
        return r.slice(0, take);
      },
      updateMany: async ({ where, data }) => { const r = T.msg.filter((m) => matchMsg(m, where)); r.forEach((m) => Object.assign(m, data)); return { count: r.length }; },
      deleteMany: async ({ where }) => { const before = T.msg.length; T.msg = T.msg.filter((m) => !matchMsg(m, where)); return { count: before - T.msg.length }; },
    },
    fact: { updateMany: async () => ({ count: 0 }) },
    user: { deleteMany: async () => ({}) },
    $transaction: async (fn) => fn(this_ || null),
  };
}
let this_;
const mkdb = () => { const d = db(); this_ = d; return d; };


const turn = (p, userId, conversationId, u, a) => saveTurn(p, { userId, conversationId, userText: u, aiText: a });

test('every user has exactly ONE companion thread; it is created on demand and is stable', async () => {
  const p = mkdb();
  const a = await ensureCompanion(p, 'u');
  const b = await ensureCompanion(p, 'u');
  assert.equal(a.id, b.id);
  assert.equal(p.T.conv.filter((c) => c.kind === 'companion').length, 1);
  const [x, y] = await Promise.all([ensureCompanion(p, 'v'), ensureCompanion(p, 'v')]);
  assert.equal(x.id, y.id);
  assert.equal(p.T.conv.filter((c) => c.userId === 'v').length, 1);
  assert.equal((await listConversations(p, 'u'))[0].title, COMPANION_TITLE);
});

test('un-routed turns (omitted id, "new", unknown, foreign) all land in the companion thread', async () => {
  const p = mkdb();
  const proj = await createProject(p, 'me', { title: 'Secret project' });
  const c1 = await turn(p, 'me', undefined, 'salom', 'salom!');
  const c2 = await turn(p, 'me', 'new', 'yana', 'ha');
  const c3 = await turn(p, 'me', 'nope', 'x', 'y');
  assert.equal(new Set([c1, c2, c3]).size, 1);
  const evil = await turn(p, 'eve', proj.id, 'hi', 'yo');            // someone else's project id
  assert.notEqual(evil, proj.id);
  assert.equal(p.T.msg.filter((m) => m.conversationId === proj.id).length, 0);
  assert.equal(p.T.conv.find((c) => c.id === evil).kind, 'companion');
});

test('legacy / proactive messages (no conversation) are adopted into the companion thread', async () => {
  const p = mkdb();
  p.T.msg.push({ id: 'L1', userId: 'u', role: 'user', text: 'eski', createdAt: new Date(1_700_000_000_000), conversationId: null });
  p.T.msg.push({ id: 'L2', userId: 'u', role: 'assistant', text: 'proaktiv', createdAt: new Date(1_700_000_100_000), conversationId: null });
  const [c] = await listConversations(p, 'u');
  assert.ok(p.T.msg.every((m) => m.conversationId === c.id));
  p.T.msg.push({ id: 'L3', userId: 'u', role: 'assistant', text: 'yana proaktiv', createdAt: new Date(), conversationId: null });
  await ensureCompanion(p, 'u');                                       // a later orphan is folded in too
  assert.ok(p.T.msg.every((m) => m.conversationId === c.id));
});

test('older builds with many chats are folded into the single companion thread, nothing lost', async () => {
  const p = mkdb();
  const a = await turn(p, 'u', 'new', 'birinchi', 'a');                // companion #1 (created by the helper)
  p.T.conv.push({ id: 'cX', userId: 'u', kind: 'companion', title: 'Eski suhbat', description: null, createdAt: new Date(), updatedAt: new Date() });
  p.T.msg.push({ id: 'mX', userId: 'u', role: 'user', text: 'eski xabar', createdAt: new Date(), conversationId: 'cX' });
  const list = await listConversations(p, 'u');
  assert.equal(list.length, 1);
  assert.equal(list[0].id, a);
  assert.equal(p.T.msg.find((m) => m.id === 'mX').conversationId, a);
  assert.equal(p.T.conv.length, 1);
});

test('projects: need a name, are listed even when empty, newest activity first, companion pinned on top', async () => {
  const p = mkdb();
  await assert.rejects(() => createProject(p, 'u', { title: '   ' }), RangeError);
  const a = await createProject(p, 'u', { title: '  E-commerce   Backend ', description: 'Node + Postgres' });
  const b = await createProject(p, 'u', { title: 'Content Strategy' });
  assert.equal(a.kind, 'project'); assert.equal(a.title, 'E-commerce Backend'); assert.equal(a.description, 'Node + Postgres');
  await turn(p, 'u', a.id, 'schema?', 'mana schema');                  // bumps A above B
  const list = await listConversations(p, 'u');
  assert.deepEqual(list.map((c) => c.title), [COMPANION_TITLE, 'E-commerce Backend', 'Content Strategy']);
  assert.deepEqual(list.map((c) => c.kind), ['companion', 'project', 'project']);
  assert.equal(b.description, '');
});

test('a project turn stays inside the project; context and history are per conversation', async () => {
  const p = mkdb();
  const proj = await createProject(p, 'u', { title: 'API' });
  await turn(p, 'u', undefined, 'kayfiyatim yaxshi', 'zo‘r');
  await turn(p, 'u', proj.id, 'REST yoki GraphQL?', 'REST');
  assert.deepEqual((await fetchPage(p, 'u', { conversationId: proj.id })).messages.map((m) => m.text), ['REST yoki GraphQL?', 'REST']);
  assert.deepEqual((await fetchContextForLLM(p, 'u', { conversationId: proj.id })).map((m) => m.content), ['REST yoki GraphQL?', 'REST']);
  const comp = await ensureCompanion(p, 'u');
  assert.deepEqual((await fetchContextForLLM(p, 'u', { conversationId: comp.id })).map((m) => m.content), ['kayfiyatim yaxshi', 'zo‘r']);
});

test('the companion thread cannot be renamed or deleted; projects can, and delete removes their messages', async () => {
  const p = mkdb();
  const comp = await ensureCompanion(p, 'u');
  await assert.rejects(() => updateConversation(p, 'u', comp.id, { title: 'x' }), /companion/);
  await assert.rejects(() => deleteConversation(p, 'u', comp.id), /companion/);
  const proj = await createProject(p, 'u', { title: 'Old' });
  await turn(p, 'u', proj.id, 'x', 'y');
  await assert.rejects(() => updateConversation(p, 'u', proj.id, { title: '  ' }), RangeError);
  await assert.rejects(() => updateConversation(p, 'u', proj.id, {}), RangeError);
  assert.equal((await updateConversation(p, 'u', proj.id, { title: ' New name ' })).title, 'New name');
  assert.equal((await updateConversation(p, 'u', proj.id, { description: 'goal' })).description, 'goal');
  assert.equal(await deleteConversation(p, 'u', proj.id), true);
  assert.equal(p.T.msg.filter((m) => m.conversationId === proj.id).length, 0);
  assert.equal(await deleteConversation(p, 'u', proj.id), false);
});

test('users are isolated: foreign projects cannot be read, edited or deleted', async () => {
  const p = mkdb();
  const mine = await createProject(p, 'me', { title: 'Mine' });
  assert.equal(await updateConversation(p, 'eve', mine.id, { title: 'pwned' }), null);
  assert.equal(await deleteConversation(p, 'eve', mine.id), false);
  assert.deepEqual((await listConversations(p, 'eve')).map((c) => c.kind), ['companion']);
  assert.equal((await listConversations(p, 'me'))[1].title, 'Mine');
});

test('search: project name, goal and message text; the companion appears only when its messages match', async () => {
  const p = mkdb();
  const a = await createProject(p, 'u', { title: 'Checkout service', description: 'Stripe webhooks' });
  await turn(p, 'u', a.id, 'idempotency key kerakmi', 'ha');
  await createProject(p, 'u', { title: 'Marketing' });
  await turn(p, 'u', undefined, 'Samarqandga sayohat', 'zo‘r g‘oya');
  const t = async (q) => (await listConversations(p, 'u', { q })).map((c) => c.title);
  assert.deepEqual(await t('checkout'), ['Checkout service']);
  assert.deepEqual(await t('STRIPE'), ['Checkout service']);
  assert.deepEqual(await t('idempotency'), ['Checkout service']);
  assert.deepEqual(await t('samarqand'), [COMPANION_TITLE]);
  assert.deepEqual(await t('yo‘q-narsa'), []);
  assert.equal((await t('')).length, 3);
});

test('work mode: only projects switch it on, and it carries the project name + goal', async () => {
  const p = mkdb();
  const proj = await createProject(p, 'u', { title: 'E-commerce Backend', description: 'Node, Postgres, Stripe' });
  const row = await resolveConversation(p, 'u', proj.id);
  assert.deepEqual(workModeFor(row), { projectName: 'E-commerce Backend', description: 'Node, Postgres, Stripe' });
  assert.equal(workModeFor(await resolveConversation(p, 'u', undefined)), null);
  assert.equal(workModeFor(null), null);
  const block = buildWorkModeBlock(workModeFor(row));
  assert.match(block, /WORK MODE ACTIVE — PROJECT: "E-commerce Backend"/);
  assert.match(block, /Node, Postgres, Stripe/);
  assert.match(block, /SEARCH\/REPLACE/);
  assert.match(block, /OVERRIDES any earlier brevity/);
  assert.doesNotMatch(buildWorkModeBlock({ projectName: 'a"\nINJECT' }), /\nINJECT/);   // names can't break out of their line
});

test('system prompt: Work mode replaces the friend-mode overlay; the companion prompt is unchanged', () => {
  const parts = { base: 'BASE', persona: 'CORE CHARACTER', policyOverlay: '\nFRIEND MODE POLICY MaxSentences: 3', responseInstruction: 'RESPONSE_INSTRUCTION', memory: 'MEMORY: likes Node' };
  const friend = composeSystemPrompt(parts);
  assert.equal(friend, 'BASE\n\nCORE CHARACTER\nFRIEND MODE POLICY MaxSentences: 3\n\nRESPONSE_INSTRUCTION\n\nMEMORY: likes Node');
  const work = composeSystemPrompt({ ...parts, workMode: { projectName: 'Shop', description: '' } });
  assert.match(work, /WORK MODE ACTIVE — PROJECT: "Shop"/);
  assert.match(work, /CORE CHARACTER/);                                // honesty / independent judgment stays
  assert.match(work, /MEMORY: likes Node/);                            // long-term memory stays
  assert.doesNotMatch(work, /FRIEND MODE POLICY/);
  assert.doesNotMatch(work, /MaxSentences: \d/);
  assert.doesNotMatch(work, /RESPONSE_INSTRUCTION/);
});

test('guest merge: guest + account companion threads end up as one thread with all messages (in time order)', async () => {
  const p = mkdb(); p.$transaction = async (fn) => fn(p);
  const gp = await createProject(p, 'guest_abc', { title: 'Guest project' });
  await turn(p, 'guest_abc', undefined, 'mehmon savoli', 'javob');
  await turn(p, 'real', undefined, 'akkaunt savoli', 'javob 2');
  await mergeGuestIntoUser(p, 'guest_abc', 'real');
  const list = await listConversations(p, 'real');
  assert.deepEqual(list.map((c) => c.title), [COMPANION_TITLE, 'Guest project']);
  assert.equal(p.T.conv.filter((c) => c.kind === 'companion').length, 1);
  const comp = list[0];
  assert.deepEqual((await fetchPage(p, 'real', { conversationId: comp.id })).messages.map((m) => m.text), ['mehmon savoli', 'javob', 'akkaunt savoli', 'javob 2']);
  assert.ok(p.T.msg.every((m) => m.userId === 'real'));
  assert.equal(list[1].id, gp.id);
});

test('cleanTitle collapses whitespace and caps length', () => {
  assert.equal(cleanTitle('  a   b \n c '), 'a b c');
  assert.equal(cleanTitle('x'.repeat(300)).length, 80);
});

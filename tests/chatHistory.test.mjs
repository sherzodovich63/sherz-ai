import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPage, fetchContextForLLM, decodeCursor } from '../lib/chatHistory.js';

// in-memory message table implementing just the query shape chatHistory uses
function mk(rows) {
  const eq = (a, b) => new Date(a).getTime() === new Date(b).getTime();
  return { message: { findMany: async ({ where, orderBy, take }) => {
    let r = rows.filter((m) => m.userId === where.userId);
    if (where.OR) r = r.filter((m) => where.OR.some((c) =>
      c.createdAt.lt ? m.createdAt < c.createdAt.lt : eq(m.createdAt, c.createdAt) && m.id < c.id.lt));
    r.sort((a, b) => (b.createdAt - a.createdAt) || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0));
    return r.slice(0, take);
  } } };
}
const T0 = 1_760_000_000_000;
const mkRows = (n, userId = 'u') => Array.from({ length: n }, (_, i) => ({
  id: 'm' + String(i).padStart(4, '0'), userId, role: i % 2 ? 'assistant' : 'user', text: `msg ${i}`, createdAt: new Date(T0 + i * 1000),
}));

test('first page = the NEWEST 25, oldest->newest', async () => {
  const r = await fetchPage(mk(mkRows(100)), 'u', {});
  assert.equal(r.messages.length, 25);
  assert.equal(r.messages[0].text, 'msg 75');
  assert.equal(r.messages.at(-1).text, 'msg 99');
  assert.ok(r.hasMore && r.nextCursor);
});

test('walking cursors reaches every message exactly once, then stops', async () => {
  const p = mk(mkRows(60));
  const seen = []; let cursor = null, pages = 0;
  do {
    const r = await fetchPage(p, 'u', { before: cursor, limit: 25 });
    seen.unshift(...r.messages.map((m) => m.text)); cursor = r.nextCursor; pages++;
  } while (cursor && pages < 10);
  assert.equal(pages, 3);
  assert.deepEqual(seen, Array.from({ length: 60 }, (_, i) => `msg ${i}`));
});

test('same-millisecond messages are not skipped or duplicated at a page boundary', async () => {
  const rows = mkRows(10).map((m) => ({ ...m, createdAt: new Date(T0) })); // all identical timestamp
  const p = mk(rows); const seen = []; let cursor = null;
  for (let i = 0; i < 6; i++) {
    const r = await fetchPage(p, 'u', { before: cursor, limit: 3 });
    seen.push(...r.messages.map((m) => m.id)); cursor = r.nextCursor; if (!cursor) break;
  }
  assert.equal(new Set(seen).size, 10);
  assert.equal(seen.length, 10);
});

test('exactly one page of messages -> hasMore false, no cursor; users are isolated', async () => {
  const other = mkRows(5, 'other').map((m) => ({ ...m, id: 'o' + m.id }));
  const p = mk([...mkRows(25), ...other]);
  const r = await fetchPage(p, 'u', { limit: 25 });
  assert.equal(r.messages.length, 25);
  assert.equal(r.hasMore, false);
  assert.equal(r.nextCursor, null);
  assert.ok(r.messages.every((m) => !m.id.startsWith('om')));
});

test('limit is clamped; malformed cursor is rejected', async () => {
  assert.equal((await fetchPage(mk(mkRows(300)), 'u', { limit: 99999 })).messages.length, 100);
  assert.equal((await fetchPage(mk(mkRows(3)), 'u', { limit: -5 })).messages.length, 1);
  assert.throws(() => decodeCursor("1'; DROP"), RangeError);
  await assert.rejects(() => fetchPage(mk([]), 'u', { before: 'garbage' }), RangeError);
});

test('LLM context = latest turns (not oldest), size-capped', async () => {
  const ctx = await fetchContextForLLM(mk(mkRows(500)), 'u', { maxMessages: 20 });
  assert.equal(ctx.length, 20);
  assert.equal(ctx[0].content, 'msg 480');
  assert.equal(ctx.at(-1).content, 'msg 499');
  const big = mkRows(20).map((m) => ({ ...m, text: 'x'.repeat(1000) }));
  const capped = await fetchContextForLLM(mk(big), 'u', { maxMessages: 20, maxChars: 5000 });
  assert.ok(capped.reduce((n, t) => n + t.content.length, 0) <= 5000);
  assert.ok(capped.length >= 1);
});

test('LLM context: a huge older paste is shrunk (head+tail) before whole turns are dropped; the newest turn stays whole', async () => {
  const { fetchContextForLLM } = await import('../lib/chatHistory.js');
  const rows = [
    { role: 'user', text: 'first question' },
    { role: 'assistant', text: 'first answer' },
    { role: 'user', text: 'START' + 'x'.repeat(30000) + 'END' },
    { role: 'assistant', text: 'ok, read it' },
    { role: 'user', text: 'what was at the end of it?' },
  ].map((r, i) => ({ ...r, id: 'm' + i, createdAt: new Date(1_700_000_000_000 + i * 1000) }));
  const p = { message: { findMany: async () => rows.slice().reverse() } };
  const t = await fetchContextForLLM(p, 'u', { maxMessages: 30, maxChars: 4000 });
  assert.equal(t.length, 5, 'no turn was dropped');
  assert.ok(t[2].content.startsWith('START') && t[2].content.endsWith('END') && t[2].content.length < 1700 && /characters left out/.test(t[2].content));
  assert.equal(t[4].content, 'what was at the end of it?');
  const big = await fetchContextForLLM({ message: { findMany: async () => [{ role: 'user', text: 'y'.repeat(50000), id: 'z', createdAt: new Date() }] } }, 'u', { maxChars: 4000 });
  assert.equal(big[0].content.length, 50000, 'the newest turn is never shortened');
});

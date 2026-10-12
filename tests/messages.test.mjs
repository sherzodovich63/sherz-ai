import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deleteMessages, parseIds, MAX_DELETE_BATCH } from '../lib/messages.js';
import { fetchPage, fetchContextForLLM } from '../lib/chatHistory.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// in-memory Prisma: just the shapes lib/messages.js + chatHistory.js use
function db(rows) {
  const T = { msg: rows.map((r, i) => ({ createdAt: new Date(1_760_000_000_000 + i * 1000), conversationId: 'c1', ...r })) };
  const ok = (m, w) => (!w.userId || m.userId === w.userId) && (!w.id?.in || w.id.in.includes(m.id)) && (!('conversationId' in w) || m.conversationId === w.conversationId);
  return {
    T,
    message: {
      findMany: async ({ where, orderBy, take, select }) => {
        let r = T.msg.filter((m) => ok(m, where));
        if (orderBy) r = r.sort((a, b) => (b.createdAt - a.createdAt) || (b.id < a.id ? -1 : 1));
        if (take) r = r.slice(0, take);
        return select ? r.map((m) => Object.fromEntries(Object.keys(select).map((k) => [k, m[k]]))) : r;
      },
      deleteMany: async ({ where }) => { const before = T.msg.length; T.msg = T.msg.filter((m) => !ok(m, where)); return { count: before - T.msg.length }; },
    },
  };
}
const seed = () => db([
  { id: 'm1', userId: 'u1', role: 'user', text: 'a' }, { id: 'm2', userId: 'u1', role: 'assistant', text: 'b' },
  { id: 'm3', userId: 'u1', role: 'user', text: 'c' }, { id: 'x1', userId: 'u2', role: 'user', text: 'other user secret' },
]);

test('parseIds: validates, de-duplicates, caps', () => {
  assert.deepEqual(parseIds(['a', 'a', 'b-1_2']), ['a', 'b-1_2']);
  assert.deepEqual(parseIds(['ok', 5, null, '../x', 'a b', '']), ['ok']);
  assert.throws(() => parseIds('m1'), RangeError);
  assert.throws(() => parseIds([]), RangeError);
  assert.throws(() => parseIds([1, {}]), RangeError);
  assert.throws(() => parseIds(Array.from({ length: MAX_DELETE_BATCH + 1 }, (_, i) => `id${i}`)), /too many/);
  assert.equal(parseIds(Array.from({ length: MAX_DELETE_BATCH }, (_, i) => `id${i}`)).length, MAX_DELETE_BATCH);
});

test('deleteMessages: removes exactly the owner’s rows and reports them', async () => {
  const p = seed();
  assert.deepEqual(await deleteMessages(p, 'u1', ['m2']), ['m2']);
  assert.deepEqual(p.T.msg.map((m) => m.id), ['m1', 'm3', 'x1']);
  assert.deepEqual((await deleteMessages(p, 'u1', ['m1', 'm3'])).sort(), ['m1', 'm3']);
  assert.deepEqual(p.T.msg.map((m) => m.id), ['x1']);
});

test('deleteMessages: someone else’s id and unknown ids are ignored — nothing leaks, nothing is touched', async () => {
  const p = seed();
  assert.deepEqual(await deleteMessages(p, 'u1', ['x1']), []);
  assert.deepEqual(await deleteMessages(p, 'u1', ['nope', 'x1', 'm1']), ['m1']);
  assert.ok(p.T.msg.some((m) => m.id === 'x1'), 'u2 message survives');
});

test('deleteMessages: second delete of the same id is a no-op (idempotent)', async () => {
  const p = seed();
  assert.deepEqual(await deleteMessages(p, 'u1', ['m1']), ['m1']);
  assert.deepEqual(await deleteMessages(p, 'u1', ['m1']), []);
});

test('deleted messages vanish from the history page AND from the model context', async () => {
  const p = seed();
  await deleteMessages(p, 'u1', ['m2']);
  const page = await fetchPage(p, 'u1', { conversationId: 'c1' }).catch(() => null);
  const ctx = await fetchContextForLLM(p, 'u1', { conversationId: 'c1' });
  assert.deepEqual(ctx.map((t) => t.content), ['a', 'c']);
  if (page) assert.ok(!page.messages.some((m) => m.id === 'm2'));
});

// ── the real routes, produced by the real patch script, over real HTTP ──
test('apply_server_patch_messages.mjs → DELETE /api/messages/:id and POST /api/messages/delete work end to end', async (t) => {
  let express; try { express = (await import('express')).default; } catch { t.skip('express not installed in this sandbox'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'msgsrv-'));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.copyFileSync(path.join(ROOT, 'lib/messages.js'), path.join(dir, 'lib/messages.js'));
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  const stub = `import express from 'express';\nimport { fetchPage, fetchContextForLLM } from './lib/chatHistory.js';\nexport const app = express();\napp.use(express.json());\nexport const ctx = { prisma: null };\nconst isProd = true;\nconst prisma = new Proxy({}, { get: (_t, k) => ctx.prisma[k] });\napp.use((req, _res, next) => { const h = req.headers['x-user']; if (h) req.user = { id: h }; next(); });\napp.post('/api/chat', async (req, res) => { res.json({ ok: true }); });\n`;
  fs.writeFileSync(path.join(dir, 'lib/chatHistory.js'), 'export const fetchPage = 1, fetchContextForLLM = 2;');
  fs.writeFileSync(path.join(dir, 'server.mjs'), stub);
  execFileSync('node', [path.join(ROOT, 'apply_server_patch_messages.mjs'), path.join(dir, 'server.mjs')], { stdio: 'pipe' });
  const { app, ctx } = await import(pathToFileURL(path.join(dir, 'server.mjs')).href);
  const p = seed(); ctx.prisma = p;
  const srv = http.createServer(app); await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = (method, url, user, body) => fetch(base + url, { method, headers: { 'content-type': 'application/json', ...(user ? { 'x-user': user } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ s: r.status, j: await r.json() }));
  try {
    assert.equal((await call('DELETE', '/api/messages/m1')).s, 401, 'no login → 401 (production)');
    assert.equal((await call('POST', '/api/messages/delete', null, { ids: ['m1'] })).s, 401);
    assert.equal((await call('DELETE', '/api/messages/x1', 'u1')).s, 404, 'foreign id looks like "not found"');
    assert.ok(p.T.msg.some((m) => m.id === 'x1'));
    const one = await call('DELETE', '/api/messages/m1', 'u1');
    assert.deepEqual([one.s, one.j.ok, one.j.deleted], [200, true, ['m1']]);
    assert.equal((await call('DELETE', '/api/messages/m1', 'u1')).s, 404, 'already gone');
    const bulk = await call('POST', '/api/messages/delete', 'u1', { ids: ['m2', 'm3', 'x1', 'zzz'] });
    assert.deepEqual([bulk.s, bulk.j.count, bulk.j.deleted.sort()], [200, 2, ['m2', 'm3']]);
    assert.deepEqual(p.T.msg.map((m) => m.id), ['x1'], 'only the other user’s message is left');
    assert.equal((await call('POST', '/api/messages/delete', 'u1', { ids: 'm1' })).s, 400);
    assert.equal((await call('POST', '/api/messages/delete', 'u1', {})).s, 400);
    assert.equal((await call('POST', '/api/messages/delete', 'u1', { ids: Array.from({ length: 201 }, (_, i) => `a${i}`) })).s, 400);
    assert.equal((await call('POST', '/api/chat', 'u1', {})).s, 200, 'other routes untouched');
  } finally { srv.close(); }
});

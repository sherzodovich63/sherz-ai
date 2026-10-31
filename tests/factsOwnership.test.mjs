// The /api/facts routes are patched into server.js by apply_server_patch_facts.mjs. This test applies the patch to a copy of the
// repo's own server.js text, lifts the patched route code out, and runs it against a fake database with two users.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = path.resolve(new URL('..', import.meta.url).pathname);
function buildApp() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'facts-'));
  const copy = path.join(tmp, 'server.js'); fs.copyFileSync(path.join(root, 'server.js'), copy);
  execFileSync('node', [path.join(root, 'apply_server_patch_facts.mjs'), copy]);
  const src = fs.readFileSync(copy, 'utf8');
  const a = src.indexOf('/* facts-owner-fix */'), b = src.indexOf("app.get('/api/facts/search'");
  const routes = src.slice(a, b);
  const post = src.slice(src.indexOf("app.post('/api/facts'"), src.indexOf("app.get('/api/facts/:userId'"));
  const list = src.slice(src.indexOf("app.get('/api/facts/:userId'"), a);
  const harness = `
    import express from 'express';
    export function make({ isProd, rows }) {
      const app = express(); app.use(express.json());
      app.use((req, _res, next) => { const u = req.get('x-user'); if (u) req.user = { id: u }; next(); });
      const hasModel = () => true;
      const prisma = { fact: {
        update: async ({ where, data }) => Object.assign(rows.find((r) => r.id === where.id), data),
        create: async ({ data }) => { const r = { id: 'n' + rows.length, ...data }; rows.push(r); return r; },
      }, factTag: { upsert: async () => ({ id: 't' }) } };
      const factFindManySafe = async ({ where, take }) => { globalThis.__lastWhere = where; return rows.filter((r) => (!where.id || r.id === where.id) && (!where.userId || r.userId === where.userId)).slice(0, take || 999); };
      const factDeleteSafe = async ({ where }) => { rows.splice(rows.findIndex((r) => r.id === where.id), 1); };
      const factCreateSafe = async (x) => x;
      ${post}
      ${list}
      ${routes}
      return app;
    }`;
  const f = path.join(root, 'tests', `.facts-harness-${process.pid}-${Math.random().toString(36).slice(2)}.mjs`); fs.writeFileSync(f, harness);
  return import(pathToFileURL(f).href + '?' + Date.now()).finally(() => fs.rmSync(f, { force: true }));
}
const call = async (app, method, url, user, body) => {
  const srv = app.listen(0); const port = srv.address().port;
  try {
    const r = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { 'content-type': 'application/json', ...(user ? { 'x-user': user } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { code: r.status, body: await r.json().catch(() => ({})) };
  } finally { srv.close(); }
};

test('facts: only the owner can edit or delete; a body userId cannot plant facts on someone else', async () => {
  const { make } = await buildApp();
  const rows = [{ id: 'a1', userId: 'alice', key: 'pet', value: 'cat' }, { id: 'b1', userId: 'bob', key: 'city', value: 'Tashkent' }];
  const app = make({ isProd: true, rows });
  assert.equal((await call(app, 'DELETE', '/api/facts/b1', 'alice')).code, 404);          // someone else's fact
  assert.equal((await call(app, 'DELETE', '/api/facts/b1', null)).code, 401);             // not signed in
  assert.equal(rows.length, 2);
  assert.equal((await call(app, 'PUT', '/api/facts/b1', 'alice', { value: 'x' })).code, 404);
  assert.equal(rows.find((r) => r.id === 'b1').value, 'Tashkent');
  assert.equal((await call(app, 'PUT', '/api/facts/a1', 'alice', { value: '  dog  ' })).body.fact.value, 'dog');
  assert.equal((await call(app, 'PUT', '/api/facts/a1', 'alice', { value: '   ' })).code, 400);
  const planted = await call(app, 'POST', '/api/facts', 'alice', { userId: 'bob', key: 'evil', value: 'x' });
  assert.equal(planted.code, 201); assert.equal(rows.find((r) => r.key === 'evil').userId, 'alice');
  assert.equal((await call(app, 'DELETE', '/api/facts/a1', 'alice')).body.ok, true);
  assert.ok(!rows.some((r) => r.id === 'a1'));
});

test('facts list: ?only=user makes the SERVER skip internal rows (so they cannot crowd out real memories); without it nothing changes', async () => {
  const { make } = await buildApp();
  const app = make({ isProd: true, rows: [{ id: 'a1', userId: 'alice', key: 'pet', value: 'cat' }] });
  await call(app, 'GET', '/api/facts/alice?only=user', 'alice');
  const w = globalThis.__lastWhere;
  assert.equal(w.userId, 'alice');
  const prefixes = w.AND[0].NOT.map((c) => c.key.startsWith);
  for (const p of ['proactive_', 'last_', 'learn:', 'state_', 'tone_', '_', 'conversation_summary']) assert.ok(prefixes.includes(p), p);
  assert.ok(w.AND[0].NOT.every((c) => c.key.mode === 'insensitive'));
  assert.deepEqual(w.AND[1], { OR: [{ type: null }, { type: { not: 'state' } }] });   // rows with no type must stay visible
  await call(app, 'GET', '/api/facts/alice', 'alice');
  assert.equal(globalThis.__lastWhere.AND, undefined);
  assert.equal((await call(app, 'GET', '/api/facts/bob?only=user', 'alice')).code, 403);   // still only your own list
});

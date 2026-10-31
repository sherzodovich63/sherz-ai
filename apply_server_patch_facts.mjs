// node apply_server_patch_facts.mjs [path/to/server.js]
// Memory ownership fix + editing (surgical, safe to run twice):
//   1) DELETE /api/facts/:id  — only the owner can delete a fact (before: any id, any user)
//   2) POST   /api/facts      — the fact is saved for the signed-in user, never for a userId taken from the request body
//   3) PUT    /api/facts/:id  — NEW: the owner can edit the text of a fact
//   4) GET    /api/facts/:userId — list up to 100 (was 20); with ?only=user the server hides internal rows itself
import fs from 'node:fs';
const file = process.argv[2] || 'server.js';
let s = fs.readFileSync(file, 'utf8');
const fail = (m) => { console.error(m); process.exit(1); };
const once = (from, to, what) => { const n = s.split(from).length - 1; if (n !== 1) fail(`${what}: expected the code once, found ${n}x — send me that part of your server.js`); s = s.replace(from, () => to); };
const ownerDone = s.includes('/* facts-owner-fix */'), filterDone = s.includes('/* facts-user-filter */'), logDone = s.includes('/* memory-log */');
if (ownerDone && filterDone && logDone) { console.log('already patched: ' + file); process.exit(0); }

if (!ownerDone) {
// 1 + 3) delete with ownership, and the new edit route in front of it
once(`app.delete('/api/facts/:id', async (req, res) => {
  try {
    await factDeleteSafe({ where: { id: req.params.id } });
    res.json({ ok: true });`,
`/* facts-owner-fix */
const factMe = (req) => req.user?.id || (!isProd ? String(req.query?.userId || req.body?.userId || 'u1') : null);
async function factOwned(req, res) {                    // the fact must exist AND belong to the signed-in user (404 either way: nobody learns that another user's id exists)
  const me = factMe(req); if (!me) { res.status(401).json({ ok: false, error: 'login required' }); return null; }
  const list = await factFindManySafe({ where: { id: String(req.params.id), userId: me }, ...(hasModel('fact') ? { take: 1 } : {}) });
  const row = list.find((f) => String(f.id) === String(req.params.id) && String(f.userId) === me);   // (the in-memory fallback ignores the id filter, so check again here)
  if (!row) { res.status(404).json({ ok: false, error: 'not found' }); return null; }
  return row;
}
app.put('/api/facts/:id', async (req, res) => {
  try {
    const value = String(req.body?.value ?? '').trim().slice(0, 2000);
    if (!value) return res.status(400).json({ ok: false, error: 'value required' });
    const row = await factOwned(req, res); if (!row) return;
    if (!hasModel('fact')) { row.value = value; return res.json({ ok: true, fact: row }); }
    const fact = await prisma.fact.update({ where: { id: row.id }, data: { value } });
    res.json({ ok: true, fact });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'fact update failed' });
  }
});

app.delete('/api/facts/:id', async (req, res) => {
  try {
    const row = await factOwned(req, res); if (!row) return;
    await factDeleteSafe({ where: { id: row.id } });
    res.json({ ok: true });`, 'DELETE /api/facts/:id');

// 2) POST: the owner is the signed-in user
once(`      const { userId, key, value } = it || {};
      if (!userId || !key || !value) return res.status(400).json({ error: 'userId, key, value required' });`,
`      const { key, value } = it || {};
      const userId = req.user?.id || (!isProd ? it?.userId : null);          // never trust a userId from the body when signed in
      if (!userId || !key || !value) return res.status(400).json({ error: 'userId, key, value required' });`, 'POST /api/facts (prisma branch)');
once(`          userId: it.userId,
          key: it.key,`, `          userId,
          key: it.key,`, 'POST /api/facts (create data)');
once(`        const { userId = req.user?.id || 'unknown', key, value, type = null, time = null, rating = null } = it || {}; // ✅`,
`        const { key, value, type = null, time = null, rating = null } = it || {};
        const userId = req.user?.id || (!isProd ? it?.userId : null) || 'unknown';`, 'POST /api/facts (memory branch)');

}

// 4) list: up to 100, and with ?only=user the server itself leaves out internal bookkeeping (proactive_*, last_state, learn:*, type "state"…)
//    so those rows can never push a person's real memories out of the newest-N window (before: only the newest 20 rows, mostly internal ones)
if (!filterDone) {
  const re = /    const facts = await factFindManySafe\(\{\n      where: \{ userId: req\.params\.userId \},\n      orderBy: \{ createdAt: 'desc' \},\n      take: (?:20|100)\n    \}\);/;
  if (!re.test(s)) fail('GET /api/facts/:userId: the list call was not found as expected — send me that route from your server.js');
  s = s.replace(re, () => `    /* facts-user-filter */
    const where = { userId: req.params.userId };
    if (req.query?.only === 'user' && hasModel('fact')) {
      const names = ['proactive', 'learn', 'last', 'skill', 'system', 'internal', 'tmp', 'cache', 'state', 'tone'];
      const prefixes = [...names.flatMap((n) => [n + '_', n + ':']), 'conversation_summary', 'conversation:summary', 'conversationsummary', '_'];
      where.AND = [
        { NOT: prefixes.map((p) => ({ key: { startsWith: p, mode: 'insensitive' } })) },
        { OR: [{ type: null }, { type: { not: 'state' } }] },          // (a plain NOT would also drop rows whose type is empty)
      ];
    }
    const facts = await factFindManySafe({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100
    });`);
}

// 5) memory extraction used to fail silently (every error swallowed, nothing logged). Now the terminal shows, per message, how many facts were found / saved.
if (!logDone) {
  const from = `    const nlu = await runNluForMemory(text);
    if (!nlu.facts || !nlu.facts.length) return;

    await saveMemoryFactsForUser(prisma, userId, nlu.facts);`;
  if (s.split(from).length - 1 !== 1) console.warn('step 5 skipped: processUserMemory looks different in your server.js (the rest was applied). Send me that function if you want the memory log.');
  else s = s.replace(from, () => `    /* memory-log */
    const nlu = await runNluForMemory(text);
    const found = (nlu && nlu.facts) ? nlu.facts.length : 0;
    console.log('[memory] ' + found + ' fact(s) found' + (found ? ': ' + nlu.facts.map((f) => (f && (f.key || f.type)) || '?').join(', ') : ''));
    if (!found) return;

    await saveMemoryFactsForUser(prisma, userId, nlu.facts);
    console.log('[memory] saved ' + found + ' fact(s)');`);
}

fs.writeFileSync(file, s); console.log('patched ' + file);

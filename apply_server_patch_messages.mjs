// apply_server_patch_messages.mjs — adds message deletion to server.js, safely.
//   node apply_server_patch_messages.mjs [path/to/server.js]      (default ./server.js)
// Adds:  DELETE /api/messages/:id            (one message)
//        POST   /api/messages/delete         { ids: [...] }  (bulk, max 200)
// - needs lib/messages.js next to your other lib files (it is in the ZIP)
// - checks every edit first; writes nothing unless all of them match exactly once
// - makes a backup (server.js.bak-<time>); re-running is safe (already-applied edits are skipped)
import fs from 'node:fs';
const file = process.argv[2] || 'server.js';

const IMPORT_A = "import { fetchPage, fetchContextForLLM } from './lib/chatHistory.js';";
const IMPORT_B = IMPORT_A + "\nimport { deleteMessages, parseIds } from './lib/messages.js'; // ✅ delete chat messages";

const ROUTE_A = "app.post('/api/chat', async (req, res) => {";
const ROUTES = `// ── Delete chat messages: one (DELETE /api/messages/:id) or many (POST /api/messages/delete {ids}) ──
// Only the signed-in owner's rows can ever match; unknown / foreign ids are ignored, not reported.
const msgUser = (req) => req.user?.id || (!isProd ? (req.query?.userId || req.body?.userId || 'u1') : null);

app.delete('/api/messages/:id', async (req, res) => {
  try {
    const userId = msgUser(req);
    if (!userId) return res.status(401).json({ ok: false, error: 'login required' });
    const deleted = await deleteMessages(prisma, userId, [req.params.id]);
    if (!deleted.length) return res.status(404).json({ ok: false, error: 'not found' });
    return res.json({ ok: true, deleted });
  } catch (e) {
    if (e instanceof RangeError) return res.status(400).json({ ok: false, error: e.message });
    console.error('/api/messages delete error:', e);
    return res.status(500).json({ ok: false, error: 'delete failed' });
  }
});

app.post('/api/messages/delete', async (req, res) => {
  try {
    const userId = msgUser(req);
    if (!userId) return res.status(401).json({ ok: false, error: 'login required' });
    const deleted = await deleteMessages(prisma, userId, req.body?.ids);
    return res.json({ ok: true, deleted, count: deleted.length });
  } catch (e) {
    if (e instanceof RangeError) return res.status(400).json({ ok: false, error: e.message });
    console.error('/api/messages bulk delete error:', e);
    return res.status(500).json({ ok: false, error: 'delete failed' });
  }
});

` + ROUTE_A;

let src = fs.readFileSync(file, 'utf8');
const crlf = src.includes('\r\n'); if (crlf) src = src.replace(/\r\n/g, '\n');
const IMPORT_LINE = "import { deleteMessages, parseIds } from './lib/messages.js'; // ✅ delete chat messages";
const EDITS = [['2) routes (before /api/chat)', ROUTE_A, ROUTES, "app.delete('/api/messages/:id'"]];
if (src.includes("from './lib/messages.js'")) console.log('  SKIP   1) import  (already applied)');
else if (src.split(IMPORT_A).length === 2) EDITS.unshift(['1) import', IMPORT_A, IMPORT_B, "from './lib/messages.js'"]);
else { // unusual file layout: an ES import may sit anywhere at the top level, so put it right above the routes
  EDITS[0][2] = IMPORT_LINE + '\n\n' + EDITS[0][2]; console.log('  NOTE   chatHistory import line not found; adding the import next to the routes instead');
}
let bad = 0, applied = 0, skipped = 0;
for (const [title, a, b, marker] of EDITS) {
  if (src.includes(marker)) { skipped++; console.log('  SKIP   ' + title + '  (already applied)'); continue; }
  const n = src.split(a).length - 1;
  if (n === 1) { src = src.replace(a, () => b); applied++; console.log('  APPLY  ' + title); }
  else { bad++; console.log('  FAIL   ' + title + '  (' + (n === 0 ? 'SEARCH text not found in your server.js' : 'SEARCH text found ' + n + ' times') + ')'); }
}
if (bad) { console.log('\n' + bad + ' edit(s) did not match. NOTHING was written. Send me the FAIL lines above.'); process.exit(1); }
if (!applied) { console.log('\nNothing to do.'); process.exit(0); }
const bak = file + '.bak-' + Date.now(); fs.copyFileSync(file, bak);
fs.writeFileSync(file, crlf ? src.replace(/\n/g, '\r\n') : src);
console.log('\nDone: ' + applied + ' applied, ' + skipped + ' already there. Backup: ' + bak);
console.log('Restart the server. No database migration is needed.');

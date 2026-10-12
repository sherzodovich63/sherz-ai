// apply_server_patch_multimodal.mjs — lets the chat endpoints receive a picture + text (multipart/form-data).
//   node apply_server_patch_multimodal.mjs [path/to/server.js]      (default ./server.js)
// - needs lib/chatImage.js next to your other lib files, and `multer` (already used by /api/stt)
// - checks every edit first; writes nothing unless all of them match exactly once
// - keeps a backup (server.js.bak-<time>); re-running is safe (applied edits are skipped)
import fs from 'node:fs';
const file = process.argv[2] || 'server.js';

const IMPORTS = "import { chatImageMiddleware, normalizeImage, chatImageNote, IMAGE_ONLY_PROMPT } from './lib/chatImage.js'; // ✅ picture + text turns\nconst chatImage = chatImageMiddleware();\n\n";
const EDITS = [
  ["1) /api/chat accepts multipart (+ import)", "app.post('/api/chat', async (req, res) => {", IMPORTS + "app.post('/api/chat', chatImage, async (req, res) => {", "const chatImage = chatImageMiddleware();"],
  ["2) /api/chat-stream accepts multipart", "app.post('/api/chat-stream', async (req, res) => {", "app.post('/api/chat-stream', chatImage, async (req, res) => {", "app.post('/api/chat-stream', chatImage,"],
  ["3) /api/chat: a picture alone is a valid message", "    let said;\n    let conversationId;\n    let conversation;\n    if (!clean) {", "    let said;\n    let conversationId;\n    let conversation;\n    if (!clean && !req.body?.image) {", "if (!clean && !req.body?.image) {\n      said"],
  ["4) /api/chat: skills never swallow a picture", "      const skillResult = await runSkillCandidates(clean, lower, userId);\n      if (skillResult) {\n        said = skillResult.said;", "      const skillResult = req.body?.image ? null : await runSkillCandidates(clean, lower, userId);\n      if (skillResult) {\n        said = skillResult.said;", "const skillResult = req.body?.image ? null : await runSkillCandidates(clean, lower, userId);\n      if (skillResult) {\n        said"],
  ["5) stream: a picture alone is a valid message", "    if (!clean) {\n      const said = runSkillGreeting().said;", "    if (!clean && !req.body?.image) {\n      const said = runSkillGreeting().said;", "if (!clean && !req.body?.image) {\n      const said = runSkillGreeting"],
  ["6) stream: skills never swallow a picture", "    const skillResult = await runSkillCandidates(clean, lower, userId);\n    if (skillResult) {\n      send('chunk'", "    const skillResult = req.body?.image ? null : await runSkillCandidates(clean, lower, userId);\n    if (skillResult) {\n      send('chunk'", "const skillResult = req.body?.image ? null : await runSkillCandidates(clean, lower, userId);\n    if (skillResult) {\n      send('chunk'"],
  ["7) stream: expertMode also arrives as text in a form", "const expertMode = Boolean(req.body?.expertMode);", "const expertMode = req.body?.expertMode === true || req.body?.expertMode === 'true';", "req.body?.expertMode === 'true'"],
  ["8) runBrainFlow: only a real image data URL reaches the model", "async function runBrainFlow(userId, clean, image, { onToken, expertMode = false, conversationId, conversation } = {}) {\n  console.log(", "async function runBrainFlow(userId, clean, image, { onToken, expertMode = false, conversationId, conversation } = {}) {\n  image = normalizeImage(image);   // null unless it is a genuine jpeg/png/webp/gif data URL within the size limit\n  console.log(", "image = normalizeImage(image);"],
  ["9) runBrainFlow: picture-only turn gets a prompt", "      { role: 'user', content: clean },", "      { role: 'user', content: clean || (image ? IMAGE_ONLY_PROMPT : clean) },", "clean || (image ? IMAGE_ONLY_PROMPT : clean)"],
  ["10) runBrainFlow: history keeps a marker that a picture was sent", "await saveTurn(prisma, { userId, conversationId, userText: clean, aiText: said });", "await saveTurn(prisma, { userId, conversationId, userText: image ? chatImageNote(clean) : clean, aiText: said });", "userText: image ? chatImageNote(clean) : clean"],
  ["11) runBrainFlow: no memory extraction from an empty text", "processUserMemory(userId, clean).catch(() => {});", "if (clean) processUserMemory(userId, clean).catch(() => {});", "if (clean) processUserMemory(userId, clean)"],
];

let src = fs.readFileSync(file, 'utf8');
const crlf = src.includes('\r\n'); if (crlf) src = src.replace(/\r\n/g, '\n');
if (!/multer/.test(src)) console.log('  NOTE   multer is not imported in this server.js — run: npm i multer   (lib/chatImage.js imports it)');
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

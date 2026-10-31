// node apply_stt_router.mjs [path/to/server.js]      (after apply_stt_fix.mjs and apply_stt_vocab.mjs)
// Mounts the new voice → text route (routes/stt.js + lib/stt.js) in front of the old inline /api/stt route. Nothing is deleted: the old route stays below as unused code.
// Two inserts, safe to run twice:  1) the import   2) app.use('/api/stt', …) right above the "// STT ping" comment
import fs from 'node:fs';
const file = process.argv[2] || 'server.js';
let s = fs.readFileSync(file, 'utf8'); const crlf = s.includes('\r\n'); if (crlf) s = s.replace(/\r\n/g, '\n');
const fail = (m) => { console.error(m); process.exit(1); };
if (s.includes('sttRouter')) { console.log('already patched: ' + file); process.exit(0); }
const IMP = 'import { loadWorkMode';
const ii = s.indexOf(IMP); if (ii < 0) fail('an import line starting with "import { loadWorkMode" was not found in ' + file + ' — send me your import block');
s = s.slice(0, ii) + "import { sttRouter } from './routes/stt.js';                      // voice → text: provider choice, Uzbek script fix, fallback\n" + s.slice(ii);
const A = '// STT ping\n';
if (s.split(A).length !== 2) fail('the comment line "// STT ping" was not found exactly once in ' + file + ' — send me the lines around app.get(\'/api/stt/ping\')');
s = s.replace(A, "app.use('/api/stt', sttRouter({ upload, getVocab: (uid) => (typeof sttVocab === 'function' ? sttVocab(uid) : '') }));   // before the old inline route below\n\n" + A);
if (crlf) s = s.replace(/\n/g, '\r\n');
fs.writeFileSync(file, s); console.log('patched ' + file);

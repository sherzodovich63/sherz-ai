// node apply_server_patch_remember.mjs [path/to/server.js]
// Surgical edits in server.js (nothing else is touched). Works on the ORIGINAL runSkillRemember and on the first version of this patch (it is replaced):
//   1) an import of lib/rememberNote.js (only parseRemember is used now)   2) the body of runSkillRemember(): save quietly, say nothing — the brain answers
import fs from 'node:fs';
const file = process.argv[2] || 'server.js';
let s = fs.readFileSync(file, 'utf8');
const IMPORT_LINE = "import { parseRemember } from './lib/rememberNote.js';";
const NEW_FN = `async function runSkillRemember({ clean, lower, userId }) {
  const p = parseRemember(clean);                                   // keeps the real tip, drops "eslab qol …" and the "why I'm telling you" clauses
  if (!p || p.ask) return null;                                     // nothing to save → the brain answers normally
  try { await factCreateSafe({ userId, key: p.key, value: p.value, type: 'tip' }); } catch (e) { console.warn('remember: save failed:', e.message); }
  return null;                                                      // saved quietly: NO canned reply — SHERZ's answer comes from the brain like any other message
}`;
const a = s.indexOf('async function runSkillRemember(');
const b = s.indexOf('\nasync function runSkillFactsList', a);
if (a < 0 || b < 0) { console.error('runSkillRemember (or the function after it, runSkillFactsList) not found — send me the function as it is in your server.js'); process.exit(1); }
s = s.slice(0, a) + NEW_FN + '\n' + s.slice(b);
s = s.replace(/import \{ parseRemember[^}]*\} from '\.\/lib\/rememberNote\.js';\n?/, '');            // the first version imported more names
const ANCHOR = "import { langFromBody } from './lib/locale.js';";
if (!s.includes(ANCHOR)) { fs.writeFileSync(file, s); console.error('function patched, but the locale import anchor was not found — add this line near the other imports by hand:\n' + IMPORT_LINE); process.exit(1); }
s = s.replace(ANCHOR, ANCHOR + '\n' + IMPORT_LINE);
fs.writeFileSync(file, s); console.log('patched ' + file);

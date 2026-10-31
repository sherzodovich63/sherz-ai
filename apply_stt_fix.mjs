// node apply_stt_fix.mjs [path/to/server.js]
// Fixes "Language 'uz' is not supported" (HTTP 400 from /api/stt). Surgical, safe to run twice; nothing else in server.js is touched.
//   • the server no longer sends a `language` to Whisper (it rejects 'uz', and forcing one breaks mixed Uzbek / Russian / English speech) — Whisper auto-detects
//   • when the app language is Uzbek, a short Uzbek (Latin) sample is sent as `prompt`, which nudges spelling toward Latin script
//   • the response now reports the language Whisper actually detected
import fs from 'node:fs';
const file = process.argv[2] || 'server.js';
let s = fs.readFileSync(file, 'utf8'); const crlf = s.includes('\r\n'); if (crlf) s = s.replace(/\r\n/g, '\n');
const fail = (m) => { console.error(m); process.exit(1); };
if (s.includes('stt-no-language')) { console.log('already patched: ' + file); process.exit(0); }
const swap = (a, b, what) => { if (s.split(a).length !== 2) fail('could not find ' + what + ' exactly once in ' + file + ' — send me the /api/stt route'); s = s.replace(a, b); };
swap("    const lang = (req.body?.lang || 'uz').toString().slice(0, 5);\n",
     "    const lang = (req.body?.lang || '').toString().slice(0, 5);\n    const hint = (req.body?.hint || '').toString().slice(0, 5).toLowerCase();   // app language, only used to bias spelling\n", "the `const lang = …` line");
swap("    fd.append('language', lang);\n",
     "    // stt-no-language: never send `language` — whisper-1 rejects 'uz' (HTTP 400) and a forced language breaks mixed speech; Whisper auto-detects\n    fd.append('response_format', 'verbose_json');\n    if (hint === 'uz') fd.append('prompt', 'Assalomu alaykum. Bugun qanday ishlar qildik? Yaxshi, rahmat.');   // short Uzbek (Latin) sample → Latin spelling\n", "the `fd.append('language', lang)` line");
swap("    return res.json({ ok: true, text: (j?.text || '').trim(), lang });\n",
     "    return res.json({ ok: true, text: (j?.text || '').trim(), lang: (j?.language || lang || '').toString() });\n", "the STT success response");
if (crlf) s = s.replace(/\n/g, '\r\n');
fs.writeFileSync(file, s); console.log('patched ' + file);

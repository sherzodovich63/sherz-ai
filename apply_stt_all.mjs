// node apply_stt_all.mjs [path/to/server.js]
// Runs the three voice patches in the right order (each one is safe to repeat) and then checks that server.js really has them.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] || 'server.js';
for (const step of ['apply_stt_fix.mjs', 'apply_stt_vocab.mjs', 'apply_stt_router.mjs']) {
  const script = path.join(here, step);
  if (!fs.existsSync(script)) { console.error('missing ' + step + ' — unzip it into the project folder first'); process.exit(1); }
  console.log('→ ' + step);
  const r = spawnSync(process.execPath, [script, file], { stdio: 'inherit' });
  if (r.status !== 0) { console.error('\nstopped at ' + step + ' — send me the message above'); process.exit(1); }
}
const s = fs.readFileSync(file, 'utf8');
const ok = { 'no forced language': s.includes('stt-no-language'), 'names hint': s.includes('stt-vocab'), 'new /api/stt route': s.includes("app.use('/api/stt', sttRouter") };
for (const [k, v] of Object.entries(ok)) console.log((v ? '✔ ' : '✘ ') + k);
if (Object.values(ok).every(Boolean)) console.log('\nAll in place. Now RESTART the server (Ctrl+C, then npm run dev) and try the microphone.\nIn the terminal you should then see a line like:  [stt] openai/whisper-1 850ms lang=uzbek "…"');
else process.exit(1);

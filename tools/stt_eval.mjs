// Compare speech-to-text engines on YOUR voice. Run from the project root:
//   node --env-file=.env tools/stt_eval.mjs stt-samples
//   node --env-file=.env tools/stt_eval.mjs stt-samples --engines=openai:whisper-1,openai:gpt-transcribe,elevenlabs:scribe_v1
// The folder holds pairs:  1.webm + 1.txt,  2.m4a + 2.txt …   (audio, and the text you actually said, written the way you want it spelled)
// Record 15-20 short clips the way you really talk (accent, slang, names, a mix of Uzbek / Russian / English); the phone's voice recorder is fine.
// It prints, per engine: average word error rate (WER), character error rate (CER), speed, and every clip's result — lower is better.
import fs from 'node:fs';
import path from 'node:path';
import { transcribe } from '../lib/stt.js';
import { errorRates } from '../lib/uzbekText.js';

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) { console.error('usage: node --env-file=.env tools/stt_eval.mjs <folder> [--engines=provider:model,…]'); process.exit(1); }
const arg = process.argv.find((a) => a.startsWith('--engines='));
const engines = (arg ? arg.slice(10) : 'openai:whisper-1,elevenlabs:scribe_v1').split(',').map((e) => { const [provider, model] = e.split(':'); return { provider, model, id: e }; });
const AUDIO = /\.(webm|wav|mp3|m4a|mp4|ogg|mpeg|mpga)$/i;
const MIME = { webm: 'audio/webm', wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', ogg: 'audio/ogg', mpeg: 'audio/mpeg', mpga: 'audio/mpeg' };
const clips = fs.readdirSync(dir).filter((f) => AUDIO.test(f)).sort().map((f) => {
  const ref = path.join(dir, f.replace(AUDIO, '.txt'));
  return fs.existsSync(ref) ? { file: f, buffer: fs.readFileSync(path.join(dir, f)), ref: fs.readFileSync(ref, 'utf8').trim() } : null;
}).filter(Boolean);
if (!clips.length) { console.error('no audio + .txt pairs found in ' + dir); process.exit(1); }

const quiet = { warn() {}, log() {}, error() {} };
const rows = [];
for (const e of engines) {
  const per = [];
  for (const c of clips) {
    const ext = c.file.split('.').pop().toLowerCase();
    try {
      const out = await transcribe({ buffer: c.buffer, mime: MIME[ext], filename: c.file, hint: 'uz', provider: e.provider, model: e.model, fallback: '', log: quiet });
      per.push({ file: c.file, ref: c.ref, hyp: out.text, lang: out.lang, ms: out.ms, ...errorRates(c.ref, out.text) });
    } catch (err) { per.push({ file: c.file, ref: c.ref, hyp: '', error: err.message, ms: 0, wer: 1, cer: 1 }); }
  }
  const avg = (k) => per.reduce((n, p) => n + p[k], 0) / per.length;
  rows.push({ engine: e.id, wer: avg('wer'), cer: avg('cer'), ms: avg('ms'), errors: per.filter((p) => p.error).length, per });
}
const pct = (x) => (x * 100).toFixed(1).padStart(5) + '%';
console.log('\n' + 'engine'.padEnd(30) + 'WER'.padStart(8) + 'CER'.padStart(8) + '  avg ms  errors');
for (const r of rows.sort((a, b) => a.wer - b.wer)) console.log(r.engine.padEnd(30) + pct(r.wer).padStart(8) + pct(r.cer).padStart(8) + String(Math.round(r.ms)).padStart(8) + String(r.errors).padStart(8));
console.log('\nPer clip (lowest WER engine first):');
for (const r of rows) { console.log('\n── ' + r.engine); for (const p of r.per) console.log(`  ${p.file}  WER ${pct(p.wer)}  ${p.error ? 'ERROR ' + p.error : ''}\n     said: ${p.ref}\n     got : ${p.hyp}`); }
fs.writeFileSync(path.join(dir, 'stt_eval_results.json'), JSON.stringify(rows, null, 2));
console.log('\nSaved: ' + path.join(dir, 'stt_eval_results.json'));

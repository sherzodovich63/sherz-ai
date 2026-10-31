// node apply_stt_vocab.mjs [path/to/server.js]      (run AFTER apply_stt_fix.mjs)
// Voice → text accuracy: short capitalised facts from the person's memory (names, places, brands) are sent to Whisper as a spelling hint,
// so "Dilnoza" / "Samarqand" are written correctly. Read-only, cached 60 s per user, waits at most 0.4 s for the database, never blocks or breaks a transcription.
import fs from 'node:fs';
const file = process.argv[2] || 'server.js';
let s = fs.readFileSync(file, 'utf8'); const crlf = s.includes('\r\n'); if (crlf) s = s.replace(/\r\n/g, '\n');
const fail = (m) => { console.error(m); process.exit(1); };
if (s.includes('stt-vocab')) { console.log('already patched: ' + file); process.exit(0); }
const swap = (a, b, what) => { if (s.split(a).length !== 2) fail('could not find ' + what + ' exactly once in ' + file + (what.includes('prompt') ? ' — run apply_stt_fix.mjs first' : ' — send me the line `// STT endpoint (OpenAI Whisper)` with the lines around it')); s = s.replace(a, b); };
swap("// STT endpoint (OpenAI Whisper)\n", `// stt-vocab: names / places from the person's memory help Whisper spell them right
const sttVocabCache = new Map();   // userId -> { at, text }
async function sttVocab(userId) {
  try {
    if (!userId || !prisma?.fact) return '';
    const hit = sttVocabCache.get(userId); if (hit && Date.now() - hit.at < 60000) return hit.text;
    const rows = await Promise.race([
      prisma.fact.findMany({ where: { userId, OR: [{ type: null }, { type: { notIn: ['state', 'conversation_summary'] } }] }, orderBy: { updatedAt: 'desc' }, take: 60, select: { key: true, value: true } }),
      new Promise((r) => setTimeout(() => r(null), 400)),
    ]);
    if (!rows) return '';
    const SYS = /^(proactive|learn|last|skill|system|internal|tmp|cache|state|tone|memory_compaction)[_:]/i;
    const words = [];
    for (const f of rows) {
      if (SYS.test(String(f.key || ''))) continue;
      const v = String(f.value || '').trim();
      if (v.length >= 2 && v.length <= 30 && !/[.!?]\\s/.test(v) && /\\p{Lu}/u.test(v) && !words.includes(v)) words.push(v);   // short capitalised values = names, places, brands
    }
    const text = words.slice(0, 20).join(', ').slice(0, 240);
    sttVocabCache.set(userId, { at: Date.now(), text });
    return text;
  } catch { return ''; }
}

// STT endpoint (OpenAI Whisper)
`, "the `// STT endpoint (OpenAI Whisper)` line");
swap("    if (hint === 'uz') fd.append('prompt', 'Assalomu alaykum. Bugun qanday ishlar qildik? Yaxshi, rahmat.');   // short Uzbek (Latin) sample → Latin spelling\n",
`    const promptParts = [hint === 'uz' ? 'Assalomu alaykum. Bugun qanday ishlar qildik? Yaxshi, rahmat.' : '', await sttVocab(req.user?.id)].filter(Boolean);   // Uzbek (Latin) sample + the person's own names
    if (promptParts.length) fd.append('prompt', promptParts.join(' ').slice(0, 400));
`, "the Whisper prompt line");
if (crlf) s = s.replace(/\n/g, '\r\n');
fs.writeFileSync(file, s); console.log('patched ' + file);

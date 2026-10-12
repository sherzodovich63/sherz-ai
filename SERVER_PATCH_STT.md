# server.js — /api/stt: drop Whisper "Subscribe now…" hallucinations (4 SEARCH/REPLACE edits)

(Apply on top of the previous `language` patch. Edit 1 adds a helper; edits 2–4 are inside the /api/stt handler.)

## 1) Add this helper right ABOVE the line `// STT endpoint (OpenAI Whisper)`
```js
// ── Whisper silence hallucinations ──────────────────────────────────────────
const WHISPER_JUNK_RX = [
  /subscri(be|bing|ption)/i,
  /thanks?( you)? for (watching|listening|viewing)/i,
  /(like|share)(,| and| &) (comment|subscribe|share)/i,
  /(if you )?(enjoyed|liked) (the|this) (video|episode)/i,
  /see you (in the )?(next|later)/i,
  /(subtitles?|captions?|transcribed?|translated?) by/i,
  /amara\.org|www\.|https?:\/\//i,
  /(спасибо за (просмотр|внимание)|подписывайтесь|субтитры|продолжение следует)/i,
  /(ご視聴ありがとう|チャンネル登録)/,
  /^\s*[\[(♪*]\s*(music|applause|laughter|silence|noise|музыка)[^\])]*[\])♪*]?\s*$/i,
];
function isWhisperHallucination(text, segments) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (!/[\p{L}\p{N}]/u.test(t)) return true;                       // only punctuation / dots / musical notes
  if (/^(you|bye|okay|ok|thank you|thanks)[.!?\s]*$/i.test(t)) return true;   // classic one-word silence output
  if (WHISPER_JUNK_RX.some((rx) => rx.test(t))) return true;
  // Whisper's own confidence: every segment looks like "no speech"
  if (Array.isArray(segments) && segments.length &&
      segments.every((s) => (s.no_speech_prob > 0.6 && s.avg_logprob < -1) || s.no_speech_prob > 0.85)) return true;
  return false;
}
```

## 2) Skip tiny recordings
SEARCH:
```js
    const fd = new FormData();
    const blob = new Blob([fileBuf]
```
REPLACE:
```js
    // too little audio to contain speech (a click / a few ms of noise) — don't even ask Whisper
    if (fileBuf.length < 2000) return res.json({ ok: true, text: '', lang: 'auto' });

    const fd = new FormData();
    const blob = new Blob([fileBuf]
```

## 3) Ask Whisper for confidence scores
SEARCH:
```js
    fd.append('model', 'whisper-1');
```
REPLACE:
```js
    fd.append('model', 'whisper-1');
    fd.append('response_format', 'verbose_json');   // adds per-segment no_speech_prob / avg_logprob
```

## 4) Blank out hallucinated text
SEARCH:
```js
      return res.status(r.status).json({ ok: false, error: j.error?.message || 'whisper failed' });
    }
```
REPLACE:
```js
      return res.status(r.status).json({ ok: false, error: j.error?.message || 'whisper failed' });
    }

    // Silence / background noise → Whisper invents YouTube captions ("Subscribe now…"). Return empty text instead.
    if (isWhisperHallucination(j?.text, j?.segments)) {
      console.log('[stt] dropped likely hallucination:', JSON.stringify(String(j?.text || '').slice(0, 80)));
      j.text = '';
    }
```
(Your existing `return res.json({ ok: true, text: (j?.text || '').trim(), … })` then returns `text: ''`, and the page ignores empty text.)

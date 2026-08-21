// services/tts.js
// ─────────────────────────────────────────────────────────────────────────────
// SHERZ AI — TTS Service (ElevenLabs primary + OpenAI fallback)
//
// Responsibilities:
//   • streamTTS(text, res, opts) → stream audio directly into an Express Response
//   • getTTSBuffer(text, opts)   → return a Buffer (proactive messages / FCM)
//   • sanitizeForSpeech(t)       → strip markdown/code before sending to any TTS
//   • chunkForTTS(t)             → split long replies into sentence-sized chunks
//   • pingElevenLabs()           → health check for the /api/tts/health endpoint
//
// Provider waterfall:
//   1. ElevenLabs (primary)   — best Uzbek/multilingual quality
//   2. OpenAI TTS (fallback)  — kicks in automatically on 402/403 from ElevenLabs,
//                               or if ELEVENLABS_API_KEY is missing/invalid
//
// Both providers configured entirely from .env — no code changes needed
// when switching keys or upgrading plans.
//
// Bug fix from previous version:
//   _cfg was initialized to `null` and checked against `=== undefined` —
//   those never match, so loadConfig() was never called and every request
//   returned a 503 regardless of a valid key.
//   Fixed by using separate named cache variables initialized to `undefined`.
// ─────────────────────────────────────────────────────────────────────────────

import fetch from 'node-fetch';

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG LOADERS
// ═══════════════════════════════════════════════════════════════════════════════

function loadElevenLabsConfig() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key || key === 'ROTATE_ME' || key.trim() === '') {
    console.warn('[tts] ELEVENLABS_API_KEY not set — ElevenLabs provider disabled');
    return null;
  }
  return {
    apiKey:         key.trim(),
    voiceId:        process.env.ELEVENLABS_VOICE_ID     || 'cgSgspJ2msm6clMCkdW9',
    model:          process.env.ELEVENLABS_MODEL         || 'eleven_multilingual_v2',
    stability:      parseFloat(process.env.ELEVENLABS_STABILITY         || '0.85'),  // ✅ high stability kills hallucinations
    similarityBoost:parseFloat(process.env.ELEVENLABS_SIMILARITY_BOOST  || '0.82'),
    style:          parseFloat(process.env.ELEVENLABS_STYLE              || '0.0'),   // ✅ 0.0 disables style improvisation entirely
    speakerBoost:   process.env.ELEVENLABS_SPEAKER_BOOST !== 'false',
    outputFormat:   process.env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_44100_128',
  };
}

function loadOpenAITTSConfig() {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key === 'ROTATE_ME' || key.trim() === '') {
    console.warn('[tts] OPENAI_API_KEY not set — OpenAI TTS fallback disabled');
    return null;
  }
  return {
    apiKey: key.trim(),
    model:  process.env.OPENAI_TTS_MODEL  || 'tts-1',
    voice:  process.env.OPENAI_TTS_VOICE  || 'alloy',
    format: process.env.OPENAI_TTS_FORMAT || 'mp3',
  };
}

// ✅ FIX: initialized to `undefined` (not null) so the `=== undefined` guard works
let _elCfg  = undefined;
let _oaiCfg = undefined;

function elCfg()  { if (_elCfg  === undefined) _elCfg  = loadElevenLabsConfig(); return _elCfg;  }
function oaiCfg() { if (_oaiCfg === undefined) _oaiCfg = loadOpenAITTSConfig();  return _oaiCfg; }

// ═══════════════════════════════════════════════════════════════════════════════
// STARTUP LOG — resolves + prints the active ElevenLabs voice/model (and OpenAI
// fallback voice/model) the moment this module is imported by server.js, i.e.
// at boot. Never logs the API key itself. This is the ONLY way to know what
// Render is actually using without opening its dashboard.
// ═══════════════════════════════════════════════════════════════════════════════
(function logTTSStartupConfig() {
  const el = elCfg();
  if (el) {
    console.log(`[tts] ElevenLabs configured — voiceId=${el.voiceId}, model=${el.model}`);
  } else {
    console.log('[tts] ElevenLabs NOT configured (ELEVENLABS_API_KEY missing/invalid) — will use OpenAI TTS fallback if available');
  }

  const oai = oaiCfg();
  if (oai) {
    console.log(`[tts] OpenAI TTS fallback configured — voice=${oai.voice}, model=${oai.model}`);
  } else {
    console.log('[tts] OpenAI TTS fallback NOT configured (OPENAI_API_KEY missing/invalid)');
  }

  if (!el && !oai) {
    console.warn('[tts] ⚠️ NO TTS provider configured at all — every /api/tts request will fail until at least one API key is set');
  }
})();

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Returns true for errors that should trigger the OpenAI fallback:
 *   402 / 403 / 401 — payment, permission, or auth issues with ElevenLabs
 *   "not configured" — key missing
 * Returns false for 5xx / network errors — falling back won't help those.
 */
function shouldFallback(err) {
  const msg = String(err?.message || '');
  return (
    msg.includes('402')             ||
    msg.includes('403')             ||
    msg.includes('401')             ||
    msg.includes('not configured')  ||
    msg.includes('payment_required')||
    msg.includes('paid_plan_required')
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEXT SANITIZATION  (unchanged)
// ═══════════════════════════════════════════════════════════════════════════════

export function sanitizeForSpeech(text) {
  return String(text || '')
    // ── Phase labels (SHERZ internal) ──────────────────────────────────────
    .replace(/^(LISTEN|CAUSE|ANALYZE|HELP|COMFORT)\s*:\s*/gmi, '')

    // ── Code blocks (triple + single backtick) ─────────────────────────────
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]+`/g, w => w.slice(1, -1))

    // ── Markdown formatting ────────────────────────────────────────────────
    .replace(/\*{1,3}([^*\n]+)\*{1,3}/g, '$1')   // bold / italic / bold-italic
    .replace(/_{1,2}([^_\n]+)_{1,2}/g,   '$1')   // _italic_ / __bold__
    .replace(/~~([^~\n]+)~~/g,            '$1')   // ~~strikethrough~~
    .replace(/^#{1,6}\s+/gm,             '')      // # headings
    .replace(/^\s*[-*+]\s+/gm,           '')      // - bullet lists
    .replace(/^\s*\d+\.\s+/gm,           '')      // 1. numbered lists
    .replace(/\[([^\]]+)\]\([^)]+\)/g,   '$1')   // [link text](url) → text only
    .replace(/!\[[^\]]*\]\([^)]+\)/g,    '')      // ![image](url) → removed
    .replace(/^>\s+/gm,                  '')      // > blockquotes

    // ── URLs ───────────────────────────────────────────────────────────────
    .replace(/https?:\/\/\S+/g, '')
    .replace(/www\.\S+/g,       '')

    // ── Emojis and all Unicode symbols ────────────────────────────────────
    // This single regex covers the full Unicode emoji range:
    //   Emoticons, Misc symbols, Dingbats, Transport, Supplemental,
    //   Enclosed chars, CJK compatibility, and skin-tone/gender modifiers.
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '')  // emoticons
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')  // misc symbols & pictographs
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')  // transport & map
    .replace(/[\u{1F700}-\u{1F77F}]/gu, '')  // alchemical
    .replace(/[\u{1F780}-\u{1F7FF}]/gu, '')  // geometric shapes extended
    .replace(/[\u{1F800}-\u{1F8FF}]/gu, '')  // supplemental arrows
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')  // supplemental symbols
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '')  // chess + other
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '')  // symbols and pictographs extended
    .replace(/[\u{2600}-\u{26FF}]/gu,   '')  // misc symbols (☀️ ⚡ etc.)
    .replace(/[\u{2700}-\u{27BF}]/gu,   '')  // dingbats
    .replace(/[\u{FE00}-\u{FE0F}]/gu,   '')  // variation selectors
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')  // flag components
    .replace(/[\u{200D}\u{20E3}\u{FE0F}]/gu, '') // ZWJ, combining enclosing keycap

    // ── Problematic punctuation that confuses multilingual TTS ────────────
    // These are the primary triggers for ElevenLabs hallucinations:
    // brackets/parens with content often get read as stage directions,
    // slashes trigger weird prosody, pipes and tildes are non-speech chars.
    .replace(/\([^)]{0,80}\)/g,  '')      // (parenthetical content) → removed
    .replace(/\[[^\]]{0,80}\]/g, '')      // [bracketed content] → removed
    .replace(/[|~^\\]/g,         ' ')     // pipe, tilde, caret, backslash → space
    .replace(/[<>{}]/g,          ' ')     // angle brackets, curly braces → space
    .replace(/\/\//g,            ' ')     // double slash → space
    .replace(/\/{2,}/g,          ' ')     // multiple slashes → space
    .replace(/&[a-z]+;/gi,       ' ')     // HTML entities (&amp; &lt; etc.)
    .replace(/#\w+/g,            '')      // #hashtags → removed (not speakable)
    .replace(/@\w+/g,            '')      // @mentions → removed

    // ── Repeated punctuation (often artifact of LLM output) ───────────────
    .replace(/([.!?,;:])\1{1,}/g, '$1')  // !! → !   ... → .   ,, → ,
    .replace(/\.{2,}/g,          '.')    // ellipsis → single period
    .replace(/\s*-{2,}\s*/g,     ', ')  // -- or --- → pause comma

    // ── Whitespace and newlines ────────────────────────────────────────────
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g,     ' ')
    .replace(/\s{2,}/g, ' ')
    // ── Final safety pass: strip any chars that survived nested patterns ──────
    .replace(/[*_`]/g, '')   // stray asterisks, underscores, backticks
    .replace(/\s{2,}/g, ' ') // re-collapse after removals
    .trim();
}

export function chunkForTTS(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  if (t.length <= 300) return [t];

  const sentences = t.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [t];
  const chunks = [];
  let buf = '';

  for (const s of sentences) {
    const candidate = buf ? buf + ' ' + s.trim() : s.trim();
    if (!buf) {
      if (candidate.length <= 120) { buf = candidate; continue; }
      chunks.push(candidate.slice(0, 120));
      buf = candidate.slice(120).trim();
      continue;
    }
    if (candidate.length <= 500) {
      buf = candidate;
    } else {
      chunks.push(buf);
      buf = s.trim();
    }
  }
  if (buf) chunks.push(buf);
  return chunks.filter(Boolean);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROVIDER: ELEVENLABS
// ═══════════════════════════════════════════════════════════════════════════════

async function callElevenLabs(text, opts = {}) {
  const c = elCfg();
  if (!c) throw new Error('ELEVENLABS_API_KEY not configured');

  const voiceId = opts.voiceId || c.voiceId;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`;

  const response = await fetch(
    `${url}?output_format=${c.outputFormat}&optimize_streaming_latency=3`,
    {
      method:  'POST',
      headers: {
        'xi-api-key':   c.apiKey,
        'Content-Type': 'application/json',
        'Accept':       'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: opts.model || c.model,
        voice_settings: {
          stability:         opts.stability        ?? c.stability,
          similarity_boost:  opts.similarityBoost  ?? c.similarityBoost,
          style:             opts.style            ?? c.style,
          use_speaker_boost: opts.speakerBoost     ?? c.speakerBoost,
        },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text().catch(() => `HTTP ${response.status}`);
    throw new Error(`ElevenLabs ${response.status}: ${errText.slice(0, 300)}`);
  }

  return response; // node-fetch Response — body is a readable stream
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROVIDER: OPENAI TTS
// ═══════════════════════════════════════════════════════════════════════════════

async function callOpenAITTS(text, opts = {}) {
  const c = oaiCfg();
  if (!c) throw new Error('OPENAI_API_KEY not configured — OpenAI TTS fallback unavailable');

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${c.apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model:           opts.openaiModel || c.model,
      voice:           opts.openaiVoice || c.voice,
      input:           text,
      response_format: opts.format      || c.format,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => `HTTP ${response.status}`);
    throw new Error(`OpenAI TTS ${response.status}: ${errText.slice(0, 300)}`);
  }

  const chunks = [];
  for await (const chunk of response.body) chunks.push(chunk);
  return {
    buffer:      Buffer.concat(chunks),
    contentType: response.headers.get('content-type') || 'audio/mpeg',
    provider:    'openai',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// WATERFALL CORE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Try ElevenLabs first; fall back to OpenAI on payment/auth errors.
 *
 * Returns:
 *   ElevenLabs success → { provider: 'elevenlabs', elResponse }
 *   OpenAI success     → { provider: 'openai', buffer, contentType }
 *
 * Throws only if BOTH providers fail.
 */
async function ttsWithFallback(text, opts = {}) {
  // ── Try ElevenLabs ───────────────────────────────────────────────────────
  if (elCfg()) {
    try {
      const elResponse = await callElevenLabs(text, opts);
      return { provider: 'elevenlabs', elResponse };
    } catch (elErr) {
      if (shouldFallback(elErr)) {
        console.warn(`[tts] ElevenLabs error (${elErr.message.slice(0, 80)}) — falling back to OpenAI TTS`);
        // fall through
      } else {
        throw elErr; // 5xx or network — not a fallback situation
      }
    }
  } else {
    console.log('[tts] ElevenLabs not configured — using OpenAI TTS directly');
  }

  // ── Fallback: OpenAI ─────────────────────────────────────────────────────
  if (!oaiCfg()) {
    throw new Error(
      'TTS not configured: ELEVENLABS_API_KEY failed or missing, ' +
      'and OPENAI_API_KEY is also missing. Set at least one in .env.'
    );
  }

  const result = await callOpenAITTS(text, opts);
  return result; // { provider: 'openai', buffer, contentType }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Stream TTS audio into an Express Response.
 * ElevenLabs → true chunked streaming.
 * OpenAI     → buffer written in one shot (client experience is identical).
 */
export async function streamTTS(text, res, opts = {}) {
  const clean = sanitizeForSpeech(text);
  if (!clean) { res.status(204).end(); return; }

  if (!elCfg() && !oaiCfg()) {
    res.status(503).json({ ok: false, error: 'TTS not configured' });
    return;
  }

  let result;
  try {
    result = await ttsWithFallback(clean, opts);
  } catch (err) {
    if (res.headersSent) { res.end(); return; }
    throw err; // routes/tts.js error handler formats the response
  }

  // ── ElevenLabs path: pipe stream ─────────────────────────────────────────
  if (result.provider === 'elevenlabs') {
    const c = elCfg();
    res.setHeader('Content-Type',      'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control',     'no-cache');
    res.setHeader('X-TTS-Provider',    'elevenlabs');
    res.setHeader('X-TTS-Voice',       opts.voiceId || c.voiceId);
    res.setHeader('X-TTS-Model',       opts.model   || c.model);

    result.elResponse.body.pipe(res);
    return new Promise((resolve, reject) => {
      result.elResponse.body.on('end',   resolve);
      result.elResponse.body.on('error', reject);
      res.on('close', () => result.elResponse.body.destroy());
    });
  }

  // ── OpenAI path: write buffer ────────────────────────────────────────────
  res.setHeader('Content-Type',   result.contentType);
  res.setHeader('Content-Length', result.buffer.length);
  res.setHeader('Cache-Control',  'no-cache');
  res.setHeader('X-TTS-Provider', 'openai');
  res.setHeader('X-TTS-Model',    oaiCfg()?.model || 'tts-1');
  res.end(result.buffer);
}

/**
 * Fetch TTS audio as a Buffer (for proactive messages / FCM / caching).
 */
export async function getTTSBuffer(text, opts = {}) {
  const clean = sanitizeForSpeech(text);
  if (!clean) return { buffer: Buffer.alloc(0), contentType: 'audio/mpeg', provider: 'none' };

  const result = await ttsWithFallback(clean, opts);

  if (result.provider === 'elevenlabs') {
    const chunks = [];
    for await (const chunk of result.elResponse.body) chunks.push(chunk);
    return {
      buffer:      Buffer.concat(chunks),
      contentType: result.elResponse.headers.get('content-type') || 'audio/mpeg',
      provider:    'elevenlabs',
    };
  }

  return result; // OpenAI already returns a buffer
}

/**
 * Health check — reports status of both providers.
 * Called by GET /api/tts/health.
 */
export async function pingElevenLabs() {
  const el  = elCfg();
  const oai = oaiCfg();

  const status = {
    elevenlabs: { configured: !!el },
    openai:     { configured: !!oai, model: oai?.model, voice: oai?.voice },
  };

  if (el) {
    try {
      const r = await fetch('https://api.elevenlabs.io/v1/user', {
        headers: { 'xi-api-key': el.apiKey },
      });
      if (r.ok) {
        const data = await r.json();
        status.elevenlabs.ok             = true;
        status.elevenlabs.characterLimit = data.subscription?.character_limit;
        status.elevenlabs.characterCount = data.subscription?.character_count;
        status.elevenlabs.voiceId        = el.voiceId;
        status.elevenlabs.model          = el.model;
      } else {
        status.elevenlabs.ok     = false;
        status.elevenlabs.reason = `HTTP ${r.status}`;
      }
    } catch (e) {
      status.elevenlabs.ok     = false;
      status.elevenlabs.reason = e.message;
    }
  }

  const ok = !!(status.elevenlabs.ok || (oai && status.elevenlabs.ok === false));
  return {
    ok,
    provider: status.elevenlabs.ok ? 'elevenlabs' : (oai ? 'openai_fallback' : 'none'),
    ...status,
  };
}
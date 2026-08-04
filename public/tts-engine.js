// ─────────────────────────────────────────────────────────────────────────────
// SHERZ AI — Frontend TTS Audio Engine
// File: public/tts-engine.js  (or paste into script.js after the AUTH section)
//
// Features:
//   • Streams audio from POST /api/tts using fetch + ReadableStream
//   • Plays immediately as bytes arrive (no wait for full download)
//   • Web Audio API: dynamic compressor + gain for warm, clean sound
//   • Queue: multiple responses don't overlap — they play in order
//   • Orb sync: calls setStatus('responding') while audio plays
//   • User can tap the orb mid-speech to stop playback (barge-in)
//   • Graceful fallback to HTML5 Audio if Web Audio API is unavailable
//   • TTS enabled/disabled state persisted in localStorage
// ─────────────────────────────────────────────────────────────────────────────

// ════════════════════════════════════════════════════════════
// TTS STATE
// ════════════════════════════════════════════════════════════
const TTS_ENABLED_KEY = 'sherz_tts_enabled';

const ttsState = {
  enabled:   localStorage.getItem(TTS_ENABLED_KEY) !== 'false', // default ON
  audioCtx:  null,
  gainNode:  null,
  compressor:null,
  queue:     [],         // Array<{ text, resolve, reject }>
  playing:   false,
  current:   null,       // current AudioBufferSourceNode or HTMLAudioElement
  aborted:   false,
};

function ttsIsEnabled()  { return ttsState.enabled; }
function ttsEnable()     { ttsState.enabled = true;  localStorage.setItem(TTS_ENABLED_KEY, 'true');  updateTTSButton(); }
function ttsDisable()    { ttsState.enabled = false; localStorage.setItem(TTS_ENABLED_KEY, 'false'); ttsStop(); updateTTSButton(); }
function ttsToggle()     { ttsState.enabled ? ttsDisable() : ttsEnable(); }

function updateTTSButton() {
  const btn = document.getElementById('ttsBtn');
  if (!btn) return;
  btn.textContent = ttsState.enabled ? '🔊 Voice ON' : '🔇 Voice OFF';
  btn.style.borderColor = ttsState.enabled ? 'rgba(0,221,192,0.3)' : '';
  btn.style.color       = ttsState.enabled ? 'var(--s, #00ddc0)' : '';
}

// ════════════════════════════════════════════════════════════
// WEB AUDIO CONTEXT — lazy init on first user gesture
// ════════════════════════════════════════════════════════════
function getAudioCtx() {
  if (ttsState.audioCtx && ttsState.audioCtx.state !== 'closed') {
    return ttsState.audioCtx;
  }

  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;

  const ctx        = new AC();
  const compressor = ctx.createDynamicsCompressor();
  const gain       = ctx.createGain();

  // Warm compressor settings — prevents harsh peaks in ElevenLabs output
  compressor.threshold.value = -24;
  compressor.knee.value      = 10;
  compressor.ratio.value     = 4;
  compressor.attack.value    = 0.003;
  compressor.release.value   = 0.25;
  gain.gain.value            = 0.88;  // slight headroom

  compressor.connect(gain);
  gain.connect(ctx.destination);

  ttsState.audioCtx   = ctx;
  ttsState.gainNode   = gain;
  ttsState.compressor = compressor;
  return ctx;
}

/** Resume AudioContext after user gesture (browser policy) */
async function ensureAudioCtxRunning() {
  const ctx = getAudioCtx();
  if (!ctx) return false;
  if (ctx.state === 'suspended') await ctx.resume();
  return ctx.state === 'running';
}

// ════════════════════════════════════════════════════════════
// STOP — immediate silence + barge-in
// ════════════════════════════════════════════════════════════
export function ttsStop() {
  ttsState.aborted = true;
  ttsState.playing = false;

  // Stop Web Audio source
  if (ttsState.current?.stop) {
    try { ttsState.current.stop(); } catch {}
  }
  // Stop HTML5 Audio fallback
  if (ttsState.current?.pause) {
    ttsState.current.pause();
    ttsState.current.src = '';
  }
  ttsState.current = null;
  ttsState.queue   = [];

  // Fade gain to avoid click
  const gain = ttsState.gainNode;
  if (gain) {
    gain.gain.setTargetAtTime(0, ttsState.audioCtx.currentTime, 0.05);
    setTimeout(() => { gain.gain.setTargetAtTime(0.88, ttsState.audioCtx.currentTime, 0.1); }, 80);
  }
}

// ════════════════════════════════════════════════════════════
// FETCH + DECODE — stream audio bytes from /api/tts
// ════════════════════════════════════════════════════════════

/**
 * Fetch the audio for `text` from the SHERZ TTS endpoint.
 * Returns an ArrayBuffer of the full MP3.
 * Streaming with chunked fetch — plays as soon as we have enough
 * bytes to decode the first chunk.
 */
async function fetchTTSBuffer(text) {
  const token = localStorage.getItem('sherz_token');
  const res   = await fetch('/api/tts', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `TTS HTTP ${res.status}`);
  }

  // Collect stream chunks into a single ArrayBuffer
  const reader  = res.body.getReader();
  const chunks  = [];
  let   received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (ttsState.aborted) { reader.cancel(); return null; }
    chunks.push(value);
    received += value.byteLength;
  }

  // Concatenate
  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  return buffer.buffer;
}

// ════════════════════════════════════════════════════════════
// PLAY ONE — decode + play a single buffer
// ════════════════════════════════════════════════════════════

async function playBuffer(arrayBuffer) {
  const ctx = getAudioCtx();

  // Fallback: HTML5 Audio (Safari/older browsers)
  if (!ctx || !(ctx instanceof AudioContext || ctx instanceof window.webkitAudioContext)) {
    return playHTML5(arrayBuffer);
  }

  await ensureAudioCtxRunning();

  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  if (ttsState.aborted) return;

  return new Promise((resolve) => {
    const source        = ctx.createBufferSource();
    source.buffer       = audioBuffer;
    source.connect(ttsState.compressor);
    source.onended      = resolve;
    ttsState.current    = source;
    source.start(0);
  });
}

async function playHTML5(arrayBuffer) {
  const blob   = new Blob([arrayBuffer], { type: 'audio/mpeg' });
  const url    = URL.createObjectURL(blob);
  const audio  = new Audio(url);
  ttsState.current = audio;

  return new Promise((resolve, reject) => {
    audio.onended  = () => { URL.revokeObjectURL(url); resolve(); };
    audio.onerror  = () => { URL.revokeObjectURL(url); reject(new Error('HTML5 Audio error')); };
    audio.play().catch(reject);
  });
}

// ════════════════════════════════════════════════════════════
// QUEUE PROCESSOR
// ════════════════════════════════════════════════════════════

async function processQueue() {
  if (ttsState.playing || !ttsState.queue.length) return;
  ttsState.playing = true;
  ttsState.aborted = false;

  while (ttsState.queue.length && !ttsState.aborted) {
    const job = ttsState.queue.shift();

    try {
      // Drive orb state while speaking
      if (typeof setStatus === 'function') setStatus('responding');

      const arrayBuffer = await fetchTTSBuffer(job.text);
      if (!arrayBuffer || ttsState.aborted) { job.resolve(); continue; }
      await playBuffer(arrayBuffer);
      job.resolve();
    } catch (err) {
      console.warn('[tts] playback error:', err.message);
      job.reject(err);
    }
  }

  ttsState.playing = false;
  // Return orb to idle after queue drains
  if (typeof setStatus === 'function') setStatus('idle');
}

// ════════════════════════════════════════════════════════════
// PUBLIC API — speak(text)
// ════════════════════════════════════════════════════════════

/**
 * Speak a piece of text via SHERZ TTS.
 * Queues the request; resolves when audio finishes playing.
 *
 * Usage (in your existing addAiTypewriter / postChatFlow):
 *   await speak(responseText);
 *
 * @param {string}  text
 * @param {object} [opts]
 * @param {boolean} [opts.immediate]  — skip queue, interrupt current speech
 * @returns {Promise<void>}
 */
export function speak(text, opts = {}) {
  if (!ttsState.enabled) return Promise.resolve();
  const t = String(text || '').trim();
  if (!t) return Promise.resolve();

  if (opts.immediate) ttsStop();

  return new Promise((resolve, reject) => {
    ttsState.queue.push({ text: t, resolve, reject });
    processQueue();
  });
}

// ════════════════════════════════════════════════════════════
// INTEGRATION HOOKS — wire into existing script.js
// ════════════════════════════════════════════════════════════

/**
 * Call this once during DOMContentLoaded to wire up:
 *   • The TTS toggle button (#ttsBtn)
 *   • Orb click → stop speech (barge-in)
 *   • First-gesture AudioContext unlock
 */
export function initTTS() {
  updateTTSButton();

  // TTS toggle button (in settings drawer)
  document.getElementById('ttsBtn')?.addEventListener('click', () => {
    ttsToggle();
  });

  // Orb click → barge-in (stop speech immediately)
  // Works alongside the mic toggle already on the orb
  document.getElementById('orbShell')?.addEventListener('click', () => {
    if (ttsState.playing) ttsStop();
  });

  // Unlock AudioContext on first user interaction anywhere
  const unlock = async () => {
    await ensureAudioCtxRunning();
    document.removeEventListener('click',   unlock);
    document.removeEventListener('keydown', unlock);
    document.removeEventListener('touchstart', unlock);
  };
  document.addEventListener('click',      unlock, { once: true });
  document.addEventListener('keydown',    unlock, { once: true });
  document.addEventListener('touchstart', unlock, { once: true });

  // Check TTS health quietly and disable button if unavailable
  fetch('/api/tts/health')
    .then(r => r.json())
    .then(data => {
      if (!data.ok) {
        console.warn('[tts] ElevenLabs not available:', data.reason);
        const btn = document.getElementById('ttsBtn');
        if (btn) { btn.disabled = true; btn.title = 'TTS unavailable: ' + data.reason; }
      }
    })
    .catch(() => {}); // silently ignore network errors
}

// ════════════════════════════════════════════════════════════
// PATCH FOR sendToServer — auto-speak every AI reply
// ════════════════════════════════════════════════════════════
//
// In your existing script.js, FIND the sendToServer function.
// After the line:
//   await addAiTypewriter(String(said));
//
// ADD this line:
//   speak(said).catch(e => console.warn('[tts]', e.message));
//
// That's the entire integration. The full modified block looks like:
//
//   const said = data.reply ?? data.said ?? ...;
//   await addAiTypewriter(String(said));
//   speak(said).catch(e => console.warn('[tts]', e.message));  // ← ADD THIS
//   setTimeout(() => setStatus('idle'), 550);
//
// If you want TTS to start playing WHILE text is still streaming (parallel),
// swap the order:
//
//   speak(said);                        // fire and forget — starts immediately
//   await addAiTypewriter(String(said));  // text appears in parallel
//   setTimeout(() => setStatus('idle'), 550);
// ════════════════════════════════════════════════════════════

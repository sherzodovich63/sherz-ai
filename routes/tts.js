// routes/tts.js
// ─────────────────────────────────────────────────────────────────────────────
// SHERZ AI — TTS API Routes
//
// POST /api/tts          → stream audio for given text
// GET  /api/tts/health   → check ElevenLabs connectivity (no auth required)
//
// All POST routes require Authorization: Bearer <token> (via authRequired
// applied globally to /api/* in server.js).
// ─────────────────────────────────────────────────────────────────────────────

import { Router }         from 'express';
import { z }              from 'zod';
import rateLimit          from 'express-rate-limit';
import { streamTTS, pingElevenLabs, sanitizeForSpeech } from '../services/tts.js';

// ── TTS-specific rate limiter ──────────────────────────────────────────────
// TTS calls are expensive (ElevenLabs charges per character).
// Limit each user to 40 requests per minute — far more than real usage.
const ttsLimiter = rateLimit({
  windowMs:          60 * 1000,
  max:               40,
  keyGenerator:      (req) => req.user?.id || req.ip,
  standardHeaders:   true,
  legacyHeaders:     false,
  handler: (_req, res) => res.status(429).json({
    ok: false, error: 'Too many TTS requests — slow down',
  }),
});

// ── Zod schema ─────────────────────────────────────────────────────────────
const TTSSchema = z.object({
  text: z.string()
    .min(1,    'Text is required')
    .max(5000, 'Text too long for single TTS request (max 5000 chars)'),
  // Optional per-request voice overrides (all have .env defaults)
  voiceId:        z.string().optional(),
  model:          z.string().optional(),
  stability:      z.number().min(0).max(1).optional(),
  similarityBoost:z.number().min(0).max(1).optional(),
  style:          z.number().min(0).max(1).optional(),
  speakerBoost:   z.boolean().optional(),
});

// ── Router factory ─────────────────────────────────────────────────────────
export function ttsRouter() {
  const router = Router();

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/tts/health
  // Public endpoint — no auth needed, used by frontend to decide whether
  // to show the TTS button at all.
  // ──────────────────────────────────────────────────────────────────────────
  router.get('/health', async (_req, res) => {
    try {
      const result = await pingElevenLabs();
      res.status(result.ok ? 200 : 503).json(result);
    } catch (e) {
      res.status(503).json({ ok: false, reason: e.message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/tts
  //
  // Request:
  //   { text: "...", voiceId?: "...", stability?: 0.45, ... }
  //
  // Response:
  //   Content-Type: audio/mpeg
  //   Transfer-Encoding: chunked
  //   [streaming mp3 bytes]
  //
  // The client should create an <audio> element, set its src to a Blob URL
  // created from this stream, or pipe it via Web Audio API.
  // ──────────────────────────────────────────────────────────────────────────
  router.post('/', ttsLimiter, async (req, res) => {
    // 1. Validate input
    const parsed = TTSSchema.safeParse(req.body);
    if (!parsed.success) {
      const errors = parsed.error.errors.map(e => e.message);
      return res.status(400).json({ ok: false, errors });
    }

    const { text, ...voiceOpts } = parsed.data;

    // 2. Reject empty text after sanitization
    const clean = sanitizeForSpeech(text);
    if (!clean) {
      return res.status(422).json({ ok: false, error: 'Text is empty after sanitization' });
    }

    // 3. Log (without exposing full text)
    console.log(`[tts] user=${req.user?.id} chars=${clean.length} voice=${voiceOpts.voiceId || 'default'}`);

    // 4. Stream to client
    try {
      await streamTTS(clean, res, voiceOpts);
    } catch (err) {
      // If headers already sent (streaming started), we can't send JSON
      if (res.headersSent) {
        console.error('[tts] stream error after headers sent:', err.message);
        res.end();
        return;
      }
      console.error('[tts] error:', err.message);

      // Specific ElevenLabs error codes
      if (err.message.includes('401')) {
        return res.status(502).json({ ok: false, error: 'ElevenLabs auth failed — check ELEVENLABS_API_KEY' });
      }
      if (err.message.includes('429')) {
        return res.status(429).json({ ok: false, error: 'ElevenLabs rate limit hit' });
      }
      if (err.message.includes('not configured')) {
        return res.status(503).json({ ok: false, error: 'TTS service not configured' });
      }
      res.status(502).json({ ok: false, error: 'TTS upstream error' });
    }
  });

  return router;
}

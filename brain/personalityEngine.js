// brain/personalityEngine.js
// ─────────────────────────────────────────────────────────────────────────────
// SHERZ_HEART v2 — Personality Baseline Calculator
//
// Purpose: learn what "normal" communication looks like for THIS specific user,
// so the tone_state system (see toneStateEngine.js, built next) doesn't mistake
// someone's everyday playful/aggressive banter for an actual crisis or insult.
//
// This is NOT called on every message — that would be slow and expensive.
// It's a periodic background job: run it every ~10 user messages, or on a
// cron tick, never inline in the hot chat path.
//
// Design choices:
//   • One LLM call analyzes a batch of messages holistically — cheaper and
//     more accurate than scoring each message individually and averaging.
//   • Falls back to a lightweight heuristic classifier if OPENAI_API_KEY is
//     unavailable or the LLM call fails, so this never blocks on an outage.
//   • Confidence is explicitly modeled — baselineConfidence stays low until
//     enough messages have been observed (gates downstream behavior per the
//     agreed design: nothing acts on baseline below 0.4 confidence).
// ─────────────────────────────────────────────────────────────────────────────

import { openai } from '../llm/openaiClient.js';

const MIN_MESSAGES_FOR_CONFIDENCE = 8;   // below this, confidence stays capped low
const TARGET_SAMPLE_SIZE          = 30;  // how many recent messages we analyze
const MIN_MESSAGES_TO_RUN         = 5;   // don't even bother running below this

const VALID_BASELINES = [
  'playful_aggressive',  // jokes, mock-insults, slang as bonding
  'warm_casual',         // friendly, relaxed, emotionally open
  'formal_transactional',// direct, task-focused, minimal small talk
  'unknown',
];

/**
 * Heuristic fallback classifier — used only if the LLM call fails or
 * OPENAI_API_KEY is missing. Crude but never blocks the system.
 *
 * @param {string[]} texts - array of user message strings
 * @returns {{ tone: string, confidence: number }}
 */
function heuristicClassify(texts) {
  const joined = texts.join(' ').toLowerCase();
  const wordCount = joined.split(/\s+/).filter(Boolean).length;

  // Crude slang/aggressive-banter markers (Uzbek + Russian + English mix)
  const playfulMarkers = /(ahmoq|dude|bro|lol|haha|😂|🤣|jinni|qara-chi|prikol|chert|блин|епта|кек)/gi;
  const formalMarkers  = /(iltimos|please|kerak|qiling|bajaring|hisobot|deadline|todo|task|implement|fix)/gi;
  const warmMarkers    = /(rahmat|thank|sevaman|qadrli|do'stim|jonim|yahshisan|❤️|🥰|qanaqasan)/gi;

  const playfulHits = (joined.match(playfulMarkers) || []).length;
  const formalHits  = (joined.match(formalMarkers)  || []).length;
  const warmHits     = (joined.match(warmMarkers)    || []).length;

  const scores = {
    playful_aggressive:   playfulHits,
    formal_transactional: formalHits,
    warm_casual:          warmHits,
  };

  const top = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  const [tone, hits] = top;

  // Low confidence by design — heuristic is a fallback, not a primary signal
  const confidence = hits === 0 ? 0.15 : Math.min(0.35, 0.15 + hits * 0.03);

  return { tone: hits === 0 ? 'unknown' : tone, confidence };
}

/**
 * LLM-based classifier — the primary path. Sends a batch of the user's
 * recent messages and asks GPT to classify the dominant communication style.
 *
 * @param {string[]} texts
 * @returns {Promise<{ tone: string, confidence: number, reasoning: string } | null>}
 */
async function llmClassify(texts) {
  if (!process.env.OPENAI_API_KEY) return null;

  const sample = texts.slice(-TARGET_SAMPLE_SIZE).join('\n---\n');

  const prompt = `Quyida bir foydalanuvchining so'nggi xabarlari berilgan (Uzbek/Rus/Ingliz aralash bo'lishi mumkin). Vazifang: ularning ODDIY muloqot uslubini aniqlash — bu ularning bazaviy (baseline) tabiati, vaqtinchalik kayfiyat emas.

Quyidagi 4 toifadan birini tanlang:
- "playful_aggressive": hazil, do'stona haqorat, qattiq so'zlar — bu ularning normal muloqot uslubi, jiddiy emas
- "warm_casual": iliq, do'stona, ochiq, emotsional
- "formal_transactional": qisqa, ish-fokus, kam emotsiya, to'g'ridan-to'g'ri buyruq/so'rovlar
- "unknown": aniq belgilanmagan yoki aralash

Xabarlar:
${sample}

FAQAT shu formatda JSON qaytaring, boshqa hech narsa yozmang:
{"tone": "<toifa>", "confidence": <0.0-1.0>, "reasoning": "<bir gapda qisqa izoh>"}`;

  try {
    const response = await openai.chat.completions.create({
      model:           process.env.SHERZ_BRAIN_MODEL || 'gpt-4.1-mini',
      messages:        [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature:     0.2, // low temp — we want consistent classification, not creativity
      max_tokens:      150,
    });

    const raw = response?.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!VALID_BASELINES.includes(parsed.tone)) {
      console.warn('[personalityEngine] LLM returned invalid tone:', parsed.tone);
      return null;
    }

    return {
      tone:       parsed.tone,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      reasoning:  String(parsed.reasoning || '').slice(0, 200),
    };
  } catch (err) {
    console.warn('[personalityEngine] LLM classify failed, falling back:', err.message);
    return null;
  }
}

/**
 * Main entry point — calculates and persists the personality baseline
 * for a given user. Designed to run in the BACKGROUND, never awaited
 * by the main chat response path.
 *
 * @param {object}        prisma  - Prisma client instance
 * @param {string}        userId
 * @returns {Promise<{ ok: boolean, tone?: string, confidence?: number, skipped?: boolean }>}
 */
export async function calculateBaselineTone(prisma, userId) {
  if (!prisma || !userId) return { ok: false, error: 'missing prisma or userId' };

  try {
    // 1. Pull the user's most recent messages (user turns only — we care
    //    about THEIR style, not SHERZ's responses)
    const messages = await prisma.message.findMany({
      where:   { userId, role: 'user' },
      orderBy: { createdAt: 'desc' },
      take:    TARGET_SAMPLE_SIZE,
      select:  { text: true, createdAt: true },
    });

    if (messages.length < MIN_MESSAGES_TO_RUN) {
      // Not enough data yet — don't overwrite existing baseline with noise
      return { ok: true, skipped: true, reason: 'insufficient_messages', count: messages.length };
    }

    const texts = messages.map(m => m.text).filter(Boolean).reverse(); // oldest→newest for context

    // 2. Classify — LLM primary, heuristic fallback
    let result = await llmClassify(texts);
    let source = 'llm';

    if (!result) {
      result = heuristicClassify(texts);
      source  = 'heuristic';
    }

    // 3. Confidence dampening when sample size is small — even a confident
    //    LLM call shouldn't fully commit the baseline after only 5-7 messages
    const sampleSize = texts.length;
    let finalConfidence = result.confidence;
    if (sampleSize < MIN_MESSAGES_FOR_CONFIDENCE) {
      // Scale confidence down proportionally to how far below the threshold we are
      const dampener = sampleSize / MIN_MESSAGES_FOR_CONFIDENCE;
      finalConfidence = finalConfidence * dampener;
    }

    // Heuristic-sourced results are capped — they're a fallback, not authoritative
    if (source === 'heuristic') {
      finalConfidence = Math.min(finalConfidence, 0.35);
    }

    finalConfidence = Math.round(finalConfidence * 100) / 100; // 2 decimal places

    // 4. Persist to UserProfile
    await prisma.userProfile.upsert({
      where:  { userId },
      update: {
        baselineTone:       result.tone,
        baselineConfidence: finalConfidence,
        baselineSampleSize: sampleSize,
      },
      create: {
        userId,
        baselineTone:       result.tone,
        baselineConfidence: finalConfidence,
        baselineSampleSize: sampleSize,
      },
    });

    console.log(
      `[personalityEngine] userId=${userId} baseline=${result.tone} ` +
      `confidence=${finalConfidence} sample=${sampleSize} source=${source}`
    );

    return {
      ok:         true,
      tone:       result.tone,
      confidence: finalConfidence,
      sampleSize,
      source,
      reasoning:  result.reasoning || null,
    };

  } catch (err) {
    console.error('[personalityEngine] calculateBaselineTone error:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Decide whether it's time to recalculate the baseline for this user.
 * Call this cheaply on every message (it's just a count check, no LLM call)
 * and only trigger calculateBaselineTone() when it returns true.
 *
 * Strategy: recalculate every 10 messages, OR if no baseline exists yet
 * and the user has sent at least MIN_MESSAGES_TO_RUN messages.
 *
 * @param {object} prisma
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
export async function shouldRecalculateBaseline(prisma, userId) {
  try {
    const profile = await prisma.userProfile.findUnique({
      where:  { userId },
      select: { baselineSampleSize: true, baselineConfidence: true },
    });

    const totalUserMessages = await prisma.message.count({
      where: { userId, role: 'user' },
    });

    // No baseline yet — run as soon as we have minimum data
    if (!profile || profile.baselineSampleSize === 0) {
      return totalUserMessages >= MIN_MESSAGES_TO_RUN;
    }

    // Recalculate every 10 new messages since last calculation
    const messagesSinceLastCalc = totalUserMessages - profile.baselineSampleSize;
    if (messagesSinceLastCalc >= 10) return true;

    // Or if confidence is still low and we have more data now than last time
    if (profile.baselineConfidence < 0.4 && messagesSinceLastCalc >= 3) return true;

    return false;
  } catch (err) {
    console.warn('[personalityEngine] shouldRecalculateBaseline check failed:', err.message);
    return false;
  }
}

/**
 * Fire-and-forget wrapper — call this from the main chat handler.
 * Never await this in the request/response path; it runs after the
 * response has already been sent to the user.
 *
 * Usage in server.js / brain.js:
 *   maybeRecalculateBaseline(prisma, userId); // no await — fire and forget
 *
 * @param {object} prisma
 * @param {string} userId
 */
export function maybeRecalculateBaseline(prisma, userId) {
  shouldRecalculateBaseline(prisma, userId)
    .then(should => {
      if (should) {
        calculateBaselineTone(prisma, userId).catch(err =>
          console.warn('[personalityEngine] background calc failed:', err.message)
        );
      }
    })
    .catch(err => console.warn('[personalityEngine] should-check failed:', err.message));
}
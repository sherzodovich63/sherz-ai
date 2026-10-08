// brain/systemContext.js
//
// Extracted from runBrain() in brain.js — this is lines 307-452 of that
// file, moved verbatim, with zero logic changes. It existed inline in
// runBrain() only; Expert Mode's runExpertTurn() needs the exact same
// memory/profile/emotion/context assembly (not a reimplementation, which
// is exactly how this project ended up with three separate skill systems
// — see the Sprint 2 audit). Both runBrain() and runExpertTurn() now call
// this one function, so memory integration can only drift in one place,
// not two.
//
// Everything that was BEFORE this block in runBrain() (safety check,
// greeting/continue hard-overrides) and everything AFTER it (model
// selection, the actual OpenAI call) stays exactly where it was in
// brain.js — only this middle section moved.

import { getUserProfile, upsertUserProfile } from '../memory/userProfileRepo.js';
import { getRelevantFacts, formatFactsForPrompt } from '../memory/memoryRag.js';
import { loadProfileSummary, buildProfileSummaryBlock } from '../memory/profileSummary.js';

/**
 * Builds the full memory-aware system prompt: user profile, emotion
 * detection + logging, friend-mode policy, FAZA3 deep-context analysis,
 * and FAZA5 memory/RAG injection — exactly what runBrain() built inline
 * before this extraction.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {object} params.prisma
 * @param {Array} params.messages
 * @param {string} params.userText - already-extracted latest user text
 * @param {boolean} [params.isTrivialGreeting] - skips the RAG/profile
 *   round-trip for cheap greetings, same latency optimization as before
 * @param {object} params.deps - the brain.js-local functions this block
 *   depends on, passed in rather than re-imported, since they're not
 *   memory-specific (extractNameAndStyle, detectEmotion, normalizeEmotion,
 *   writeEmotionLog, getEmotionSummary, decideResponsePolicy,
 *   normalizeRecentMessages, userContextAnalyzer, buildSystemPrompt,
 *   buildResponseInstruction, friendBrainState) — importing them here too
 *   would risk a second copy of brain.js's own helper set drifting from
 *   the original, the exact failure mode this extraction exists to avoid.
 * @returns {Promise<{
 *   systemPrompt: string,
 *   userProfile: object|null,
 *   userEmotion: object,
 *   policy: object,
 *   ctx: object,
 *   emotionSummary: object|null,
 * }>}
 */
export async function buildFullSystemContext({
  userId,
  prisma,
  messages,
  userText,
  isTrivialGreeting = false,
  deps,
}) {
  const {
    extractNameAndStyle,
    detectEmotion,
    normalizeEmotion,
    writeEmotionLog,
    getEmotionSummary,
    decideResponsePolicy,
    normalizeRecentMessages,
    userContextAnalyzer,
    buildSystemPrompt,
    buildResponseInstruction,
    friendBrainState,
  } = deps;

  // ✅ FAZA 4: userProfile read + upsert
  let userProfile = null;
  try {
    const patch = extractNameAndStyle(userText);
    userProfile = await getUserProfile(prisma, userId);

    if (patch && Object.keys(patch).length > 0) {
      userProfile = await upsertUserProfile(prisma, userId, patch);
    }
  } catch (e) {
    console.warn('⚠️ UserProfile read/upsert skipped/error:', e?.message || e);
  }

  // 3) Emotion: real detectEmotion'dan
  const detected = detectEmotion(userText) || { label: 'neutral' };
  const userEmotion = normalizeEmotion(detected);
  console.log('🧠 userEmotion(normalized):', userEmotion);

  // ✅ 3.1) EmotionLog'ni DB'ga yozib qo'yamiz
  try {
    await writeEmotionLog(prisma, { userId, emotion: userEmotion });
  } catch (e) {
    console.warn('⚠️ EmotionLog write skipped/error:', e?.message || e);
  }

  // ✅ 3.2) 7 kunlik emotion history summary
  let emotionSummary = null;
  try {
    emotionSummary = await getEmotionSummary(prisma, userId, 7);
  } catch (e) {
    console.warn('⚠️ EmotionSummary skipped/error:', e?.message || e);
  }

  // 4) Friend policy
  const policy = decideResponsePolicy({ text: userText, emotion: userEmotion });

  // ✅ FAZA 3: Deep Context Analyzer
  const recentMessages = normalizeRecentMessages(messages, 20);
  const emotionHistory = emotionSummary ? [emotionSummary] : [];

  const ctx = userContextAnalyzer({
    userId,
    userMessage: userText,
    recentMessages,
    emotionNow: userEmotion,
    emotionHistory,
    memory: {},
    timezone: process.env.SHERZ_TZ || 'Asia/Tashkent',
  });

  console.log('🧠 FAZA 3 ctx:', ctx?.mode, ctx?.confidence, ctx?.internalSummary);

  // 5) System prompt (+ overlays)
  const baseSystemPrompt = buildSystemPrompt();

  const policyOverlay = [
    '',
    'FAZA 2: FRIEND MODE POLICY (JUDA MUHIM):',
    `- Strategy: ${policy?.strategy || 'support'}`,
    `- Tone: ${policy?.tone || 'calm'}`,
    `- MaxSentences: ${policy?.maxSentences ?? 4}`,
    `- AskQuestions: ${policy?.askQuestions ? 'yes' : 'no'}`,
    '- QOIDALAR:',
    '  • Javobni shu strategiyaga mos yoz.',
    '  • Keraksiz joyda tool tilga olma, oddiy do\'stona javob ber.',
    '  • Juda uzun monolog qilma.',
    '',
    'FAZA 3: DEEP CONTEXT (KONTEKST) — COMFORT GATE:',
    `- Mode: ${ctx?.mode || 'LISTEN'}`,
    `- Confidence: ${typeof ctx?.confidence === 'number' ? ctx.confidence.toFixed(2) : 'n/a'}`,
    `- Summary: ${ctx?.internalSummary || 'n/a'}`,
    '- QOIDALAR:',
    '  • MODE=INQUIRE bo\'lsa: taskin bermaysan, faqat 1–2 ta aniqlashtiruvchi savol berasan.',
    '  • MODE=HELP bo\'lsa: step-by-step yechim berasan, taskin minimal.',
    '  • MODE=COMFORT faqat ruxsat bo\'lsa: real, halol, qisqa taskin.',
    '  • MODE=LISTEN bo\'lsa: gapirtiradigan qisqa javob.',
    '',
    emotionSummary
      ? `EMOTION_HISTORY(7d): dominant=${emotionSummary.dominantEmotion}, trend=${emotionSummary.trend}, avg=${emotionSummary.avgScore.toFixed(
          2
        )}, count=${emotionSummary.count}`
      : 'EMOTION_HISTORY(7d): none',
  ].join('\n');

  const responseInstruction = buildResponseInstruction({
    policy,
    text: userText,
    friendBrainState,
    emotion: userEmotion,
    ctx,
    emotionSummary,
    userProfile,
  });

  // ✅ FAZA 5: Memory RAG + Profile Summary blok
  let faza5MemoryBlock = '';
  try {
    if (prisma && userId && !isTrivialGreeting) {
      const relevantFacts = await getRelevantFacts({
        userId,
        query: userText,
        prisma,
        topK: 6,
      });

      const ragFactsText = formatFactsForPrompt(relevantFacts);

      let aiProfileSummary = '';
      try {
        aiProfileSummary = await loadProfileSummary(prisma, userId);
      } catch (e) {
        aiProfileSummary = '';
      }

      const profileBlock = buildProfileSummaryBlock({
        userProfile,
        facts: relevantFacts,
        emotionHint: userEmotion?.label || null,
        aiProfileSummary,
      });

      faza5MemoryBlock = [
        '',
        'FAZA 5: MEMORY CONTEXT (FACTS + PROFILE) — IMPORTANT RULES:',
        '- Memory faqat kerak bo\'lsa ishlatiladi, uydirma qilinmaydi.',
        '- Agar memory userning hozirgi gapiga zid bo\'lsa, hozirgi gap ustun.',
        '',
        profileBlock || '',
        '',
        ragFactsText || '',
      ]
        .filter(Boolean)
        .join('\n')
        .slice(0, 6000);
    }
  } catch (e) {
    console.warn('⚠️ FAZA5 memory injection skipped/error:', e?.message || e);
    faza5MemoryBlock = '';
  }

  const systemPrompt =
    baseSystemPrompt +
    policyOverlay +
    '\n\n' +
    responseInstruction +
    (faza5MemoryBlock ? '\n\n' + faza5MemoryBlock : '');

  console.log('🧩 policy:', policy);
  console.log('🧾 systemPrompt tail:', systemPrompt.slice(-500));

  // ✅ FIX: brain.js's caller-facing response metadata reports whether
  // memory was actually injected into this turn's prompt (faza5.injected)
  // — that flag lived on the local faza5MemoryBlock variable before this
  // extraction, which no longer exists in brain.js's scope. Returning it
  // explicitly here closes that gap.
  return { systemPrompt, userProfile, userEmotion, policy, ctx, emotionSummary, memoryInjected: !!faza5MemoryBlock };
}
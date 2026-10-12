// src/brain/brain.js

import { openai } from '../llm/openaiClient.js';
import { runSafety } from './safety.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { decideResponsePolicy, updateFriendBrainState } from './policy/responsePolicy.js';
import { buildResponseInstruction } from './responseComposer.js';

// ✅ FAZA 3
import { userContextAnalyzer } from './userContextAnalyzer.js';

// ✅ REAL emotion detector
import { detectEmotion } from '../nlu/detectEmotion.js';

// ✅ FAZA 4: extractor + profile repo
import { extractNameAndStyle } from '../nlu/nameStyleExtractor.js';
import { getUserProfile, upsertUserProfile, markAskedName } from '../memory/userProfileRepo.js';

// ✅ FAZA 5: Memory RAG + ProfileSummary
import { getRelevantFacts, formatFactsForPrompt } from '../memory/memoryRag.js';
import { loadProfileSummary, buildProfileSummaryBlock } from '../memory/profileSummary.js';

// ✅ NEW: extracted memory/context/system-prompt assembly (was inline here,
// lines 307-452 — moved to its own file so runExpertTurn.js can reuse the
// exact same memory integration instead of a third copy of it).
import { buildFullSystemContext } from './systemContext.js';
import { workModelName, WORK_TIMEOUT_MS } from './workMode.js'; // ✅ Project → Work/Engineering mode

// ✅ FAZA 6 LAB1: Continue + BrainState (NEW)
import { detectContinue } from '../nlu/detectContinue.js';
import { loadLastState, saveLastState } from '../memory/lastState.js';

// ✅ SHERZ_HEART v2: personality baseline calculator (background, non-blocking)
import { maybeRecalculateBaseline } from './personalityEngine.js';

// ✅ Friend Brain state is now PER USER (was one module-level object shared by everyone)
import { getFriendBrainState, setFriendBrainState, resetFriendBrainState } from './friendBrainStore.js';

/**
 * SHERZ Brain — Faza 2 (Friend Mode) + Faza 3 (Deep Context) + FAZA 4 (Adaptive Personality Memory) + FAZA 5 (Memory RAG)
 * + ✅ FAZA 6: LAB1 continue_from_last + last_state fix (BrainState)
 */

// ✅ Friend Brain state lives in friendBrainStore.js, keyed by userId. It used to
// be ONE module-level object here, so one user's conversational phase (HELP /
// LISTEN) shaped every other user's replies.
//   getFriendBrainState(userId)   -> that user's state (fresh if none / anonymous)
//   resetFriendBrainState(userId) -> clears one user; no argument clears everyone
//                                    (Sprint 3 admin session reset uses both)
// Re-exported unchanged for runExpertTurn.js and server.js/admin.
export { getFriendBrainState, resetFriendBrainState };

// Oxirgi user xabarini olish
function getLastUserText(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === 'user') return String(m?.content ?? '');
  }
  return '';
}

// ✅ Greeting check (faqat “salom” bo‘lsa)
function isGreetingOnly(text = '') {
  const s = String(text || '').trim().toLowerCase();
  return /^(salom|assalomu\s+alaykum|assalom\s+alaykum|alaykum|hi|hello|hey)\b[!. ]*$/.test(s);
}

// ✅ Greeting bo‘lsa erta “taskin” gaplarni kesish
function stripGreetingComfort(content = '') {
  return String(content || '')
    .replace(/charchag.*$/i, '')
    .replace(/o['’]?zingni asra.*$/i, '')
    .replace(/dam ol.*$/i, '')
    .replace(/xavotir olma.*$/i, '')
    .replace(/hammasi yaxshi bo‘ladi.*$/i, '')
    .trim();
}

// ✅ INQUIRE/LISTEN holatida “erta taskin”larni kesish
function stripEarlyComfort(content = '') {
  return String(content || '')
    .replace(/yolg‘iz emassan.*$/i, '')
    .replace(/hammasi yaxshi bo‘ladi.*$/i, '')
    .replace(/o['’]?zingni asra.*$/i, '')
    .replace(/dam ol.*$/i, '')
    .replace(/xavotir olma.*$/i, '')
    .trim();
}

// FAZA 3 uchun recentMessages ni normalize qilish
export function normalizeRecentMessages(messages = [], limit = 20) {
  const clean = (messages || [])
    .filter((m) => m?.role === 'user' || m?.role === 'assistant')
    .map((m) => ({
      role: m.role,
      content: String(m.content ?? ''),
    }));

  return clean.slice(-limit);
}

/**
 * ✅ EmotionLog uchun: emotion object normalize
 */
export function normalizeEmotion(e) {
  if (!e) return { label: 'neutral', score: 0, reason: null };

  const label = String(e.label || e.emotion || e.name || 'neutral').toLowerCase();

  let score = 0;
  if (typeof e.score === 'number') score = e.score;
  else if (typeof e.intensity === 'number') {
    score = 0;
  }

  const reason = e.reason ? String(e.reason) : null;

  return { ...e, label, score, reason };
}

/**
 * ✅ Emotion history summary (7 kun)
 */
export async function getEmotionSummary(prisma, userId, days = 7) {
  if (!prisma?.emotionLog?.findMany) return null;

  const since = new Date(Date.now() - days * 86400000);

  const logs = await prisma.emotionLog.findMany({
    where: {
      userId,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  if (!logs?.length) return null;

  const avgScore = logs.reduce((s, e) => s + (e.score ?? 0), 0) / logs.length;

  const counts = {};
  for (const l of logs) {
    const key = String(l.emotion || 'neutral').toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
  }

  const dominantEmotion =
    Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'neutral';

  const trend =
    avgScore > 0.7 ? 'improving' : avgScore < -0.7 ? 'declining' : 'stable';

  return {
    days,
    count: logs.length,
    avgScore,
    dominantEmotion,
    trend,
  };
}

/**
 * ✅ Emotion log write (DB)
 */
export async function writeEmotionLog(prisma, { userId, emotion }) {
  if (!prisma?.emotionLog?.create) return;
  // ✅ FIX: skip DB write for anonymous/unresolved users — avoids FK constraint crash
  if (!userId || userId === 'anonymous') return;

  const label = String(emotion?.label || 'neutral').toLowerCase();
  const score = Number.isFinite(emotion?.score) ? emotion.score : 0;
  const reason = emotion?.reason ? String(emotion.reason) : null;

  if (!label) return;

  await prisma.emotionLog.create({
    data: {
      userId,
      emotion: label,
      score,
      reason,
    },
  });
}

/**
 * ✅ FAZA 6 LAB1: Continue responder (BrainState’dan oxirgi javobni qaytaradi)
 */
async function handleContinueFromLast({ prisma, userId }) {
  if (!prisma || !userId) return null;

  const st = await loadLastState(prisma, userId);
  // No saved state / stale / empty → return null so the model answers from the
  // actual conversation instead of a fixed sentence.
  if (!st) return null;

  // Stale guard (30 daqiqa)
  const MAX_AGE_MIN = 30;
  const ageMin = st.updatedAt ? (Date.now() - new Date(st.updatedAt).getTime()) / 60000 : 9999;

  if (ageMin > MAX_AGE_MIN) return null;

  // lastResult’dan content olish
  const last =
    (st?.lastResult && typeof st.lastResult === 'object' && st.lastResult?.content)
      ? String(st.lastResult.content)
      : null;

  if (!last || last.length < 5) return null;

  return {
    type: 'assistant',
    content: last,
    meta: { continued: true, reason: 'OK' },
  };
}

export async function runBrain({ userId, messages, prisma, image, maxToolHops = 3, onToken, workMode = null }) {
  console.log('🧠 SHERZ Brain called (Friend Mode + Deep Context)', {
    userId,
    msgCount: messages.length,
  });

  // 1) Safety
  const safety = await runSafety({ userId, messages });
  if (!safety.ok) {
    return {
      type: 'safety_block',
      content:
        'Kechirasiz, bu so‘rov xavfsizlik qoidalariga zid. Bu mavzuda yordam bera olmayman.',
      safety,
    };
  }

  // 2) User text
  const userText = getLastUserText(messages);

  // ✅ Per-user conversational state (this turn's working copy; saved back below)
  let friendBrainState = getFriendBrainState(userId);

  // ✅ Latency fast-path: a bare greeting/ack ("salom", "rahmat", "ok") gets
  // zero value from RAG fact retrieval or profile-summary loading — those
  // add a full Prisma query + a live OpenAI embeddings round-trip + summary
  // computation before the actual reply even starts generating. Detected
  // here (before FAZA5 runs below) and used to both skip that block and
  // force the fastest model, regardless of what SHERZ_BRAIN_MODEL is set to.
  const trimmedUserText = (userText || '').trim();
  const isTrivialGreeting =
    !workMode &&   // inside a Project every turn gets the full context + the work model
    trimmedUserText.length > 0 &&
    trimmedUserText.length <= 24 &&
    /^(salom|assalomu\s*alaykum|assalomu|salomlar|hi|hey|hello|ok|okay|rahmat|rahmat!|thanks|thank\s*you|ha|yo['’]q|xo['’]p|zo['’]r)[\s!.?]*$/i.test(trimmedUserText);

  // (the image is attached to the last user message further below, right before the model call —
  // doing it here made normalizeRecentMessages() turn the vision array into "[object Object]" for the context analyzer)
  console.log('🧪 LAST USER TEXT:', userText);

  console.log('🧪 detectContinue?', userText, detectContinue(userText));
  
  // ✅ Greeting hard-override (LLMga bormaydi)
  // (removed) Greetings used to return one fixed string without calling the
  // model, so every "salom" got the identical reply. They now go through the
  // normal model path; the prompt's anti-repetition rules keep them varied.

  // ✅ FAZA 6 LAB1: Continue hard-override (LLMga bormaydi)
  // Bu branch last_state’ni 100% deterministik qiladi.
  if (detectContinue(userText)) {
    try {
      const cont = await handleContinueFromLast({ prisma, userId });
      if (cont) {
        return {
          ...cont,
          safety,
          raw: null,
        };
      }
    } catch (e) {
      console.warn('⚠️ Continue handler error:', e?.message || e);
      // fallthrough: LLMga o‘tsin
    }
  }

  // ✅ NEW: userProfile/emotion/policy/context/system-prompt assembly moved
  // to systemContext.js (buildFullSystemContext) — same logic, same
  // behavior, just now shared with runExpertTurn.js. userProfile stays a
  // mutable `let` here (not destructured as const) since it's reassigned
  // again later in this function.
  const fullContext = await buildFullSystemContext({
    userId,
    prisma,
    messages,
    userText,
    isTrivialGreeting,
    workMode,
    deps: {
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
    },
  });
  const { systemPrompt, userEmotion, policy, ctx, emotionSummary, memoryInjected } = fullContext;
  let userProfile = fullContext.userProfile;

  // Oxirgi foydalanuvchi xabarini rasm bilan boyitish (OpenAI Vision formatiga o'tkazamiz)
  if (image && messages.length > 0) {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role === 'user') {
      lastMsg.content = [
        { type: 'text', text: String(lastMsg.content || '') },
        { type: 'image_url', image_url: { url: image } },
      ];
      console.log('🖼️ [brain] image attached to the model call (' + Math.round(image.length / 1024) + ' KB data URL)');
    }
  }

  // 6) Modelga boradigan messages
  const finalMessages = [
    { role: 'system', content: systemPrompt },
    ...messages
      .filter((m) => m?.role === 'user' || m?.role === 'assistant')
      .map((m) => ({
        role: m.role,
        // ✅ FIX: was `String(m.content ?? '')` unconditionally — when an
        // image is attached, m.content is already the OpenAI Vision-format
        // array ([{type:'text',...}, {type:'image_url',...}], set a few
        // lines up at lastMsg.content=[...]). String() on an array of
        // objects produces "[object Object],[object Object]" — silently
        // destroying both the image AND the original text before this ever
        // reaches OpenAI. Only stringify plain string content; pass the
        // Vision array through unchanged.
        content: Array.isArray(m.content) ? m.content : String(m.content ?? ''),
      })),
  ];

  // ✅ Model routing: trivial greetings always get the fastest model,
  // independent of whatever SHERZ_BRAIN_MODEL is configured to for normal
  // conversation — this guarantees the fast path stays fast even if that
  // env var points at something heavier.
  const selectedModel = workMode
    ? workModelName()
    : isTrivialGreeting
      ? (process.env.SHERZ_FAST_MODEL || 'gpt-4o-mini')
      : (process.env.SHERZ_BRAIN_MODEL || 'gpt-4.1-mini');
  const llmTimeoutMs = workMode ? WORK_TIMEOUT_MS : 18000; // engineering answers are long

  try {
    const useStream = typeof onToken === 'function';
    let response;
    let content = '';

    if (useStream) {
      // ✅ Real token-by-token streaming from OpenAI. The tone-engine
      // post-processing below (comfort stripping, forced questions, COMFORT
      // append, etc.) all operates on the FULL text and can't run mid-stream,
      // so onToken only gets the raw generation — the function's return value
      // is still the fully tone-corrected text, exactly as in the
      // non-streaming path below. Callers should treat the streamed tokens as
      // a live preview and the returned `content` as authoritative.
      const stream = await openai.chat.completions.create(
        {
          model: selectedModel,
          messages: finalMessages,
          temperature: 0.6,
          stream: true,
        },
        {
          timeout: llmTimeoutMs,
          maxRetries: 1,
        }
      );

      for await (const part of stream) {
        const delta = part?.choices?.[0]?.delta?.content || '';
        if (delta) {
          content += delta;
          try { onToken(delta); } catch (cbErr) { console.warn('⚠️ onToken callback error:', cbErr?.message || cbErr); }
        }
      }
      response = { choices: [{ message: { content } }], streamed: true };
    } else {
      response = await openai.chat.completions.create(
        {
          model: selectedModel,
          messages: finalMessages,
          temperature: 0.6,
        },
        {
          timeout: llmTimeoutMs,
          maxRetries: 1,
        }
      );

      const choice = response.choices[0];
      content = choice?.message?.content || '';
    }

    // ✅ Greeting bo‘lsa comfort kesib tashlaymiz
    if (isGreetingOnly(userText)) {
      content = stripGreetingComfort(content);
    }

    // (removed) Forced canned follow-up questions ("Nima bo‘ldi o‘zi?" etc.).
    // Whether to ask a question, and which one, is the model's call based on
    // what the user actually said.
    if (policy?.strategy === 'support') {
      content = content.replace(/Agar gaplash.*?bosim qilmayman\.?/i, '').trim();
    }

    // INQUIRE/LISTEN: still trim premature reassurance, but append nothing.
    if (!workMode && (ctx?.mode === 'INQUIRE' || ctx?.mode === 'LISTEN')) {
      content = stripEarlyComfort(content);
    }

    // ✅ HELP berilganini minimal aniqlab state yangilaymiz
    const gaveHelp = /\b(qadam|step|1\)|2\)|3\)|kod|code|patch|copy-?paste|qilib ko['’]?r|yechim|tuzat)\b/i.test(
      content
    );

    friendBrainState = updateFriendBrainState(friendBrainState, {
      phase: gaveHelp ? 'HELP' : 'LISTEN',
      helpProvided: gaveHelp ? true : undefined,
    });
    setFriendBrainState(userId, friendBrainState); // ✅ persist for THIS user only

    // (removed) Fixed "Yolg‘iz emassan. Buni birga hal qilamiz." suffix on COMFORT
    // turns — comfort now comes from the model's own wording.

    // ✅ FAZA 4: “Sizni nima deb chaqiray?” chiqqan bo‘lsa — 1 marta flag
    try {
      if ((content || '').toLowerCase().includes('sizni nima deb chaqiray')) {
        await markAskedName(prisma, userId);
        userProfile = await getUserProfile(prisma, userId);
      }
    } catch (e) {
      console.warn('⚠️ markAskedName skipped/error:', e?.message || e);
    }

    // ─────────────────────────────
    // ✅ FAZA 6 LAB1: BrainState save (REAL last_state)
    // ─────────────────────────────
    try {
      if (prisma && userId) {
        await saveLastState(prisma, userId, {
          lastSkill: null,
          lastArgs: null,
          lastResult: {
            content: String(content || '').slice(0, 4000),
          },
          status: 'done',
        });
      }
    } catch (e) {
      console.warn('⚠️ BrainState save error:', e?.message || e);
    }

    // ─────────────────────────────
    // ✅ BACKWARD COMPAT: Fact last_state save (bitta marta, duplicate emas)
    // ─────────────────────────────
    try {
      if (prisma && userId && prisma.fact?.updateMany && prisma.fact?.create) {
        const short = String(content || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 900);

        if (short.length > 20) {
          const r = await prisma.fact.updateMany({
            where: { userId, key: 'last_state' },
            data: { value: short, type: 'state' },
          });

          if (!r.count) {
            await prisma.fact.create({
              data: { userId, key: 'last_state', value: short, type: 'state' },
            });
          }

          console.log('✅ last_state (Fact) saved:', short.slice(0, 80));
        }
      }
    } catch (e) {
      console.warn('⚠️ last_state(Fact) save error:', e?.message || e);
    }

    // ✅ SHERZ_HEART v2: background personality baseline check.
    // No `await` — this must never delay the user's response. It runs
    // shouldRecalculateBaseline() (cheap COUNT query) and only triggers
    // the actual LLM-based calculateBaselineTone() roughly every 10 messages.
    maybeRecalculateBaseline(prisma, userId);

    return {
      type: 'assistant',
      content,
      safety,
      meta: {
        policy,
        userEmotion,
        friendBrainState,
        ctx,
        emotionSummary,
        userProfile,
        faza5: {
          injected: memoryInjected,
        },
      },
      raw: response,
    };
  } catch (err) {
    const isTimeout =
      err?.name === 'APIConnectionTimeoutError' ||
      err?.code === 'ETIMEDOUT' ||
      err?.message?.toLowerCase().includes('timed out') ||
      err?.message?.toLowerCase().includes('timeout');

    if (isTimeout) {
      console.warn('⚠️ SHERZ Brain timeout — returning Uzbek fallback');
      return {
        type: 'assistant',
        content: "Uzr, hozir serverda kechikish bor. Bir daqiqadan so'ng qayta yozing 🙏",
        safety,
        meta: { timedOut: true },
      };
    }

    console.error('❌ SHERZ Brain error:', err);
    return {
      type: 'error',
      content: err?.message || 'Brain internal error',
      safety,
    };
  }
}
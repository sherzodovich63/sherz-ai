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

// ✅ FAZA 6 LAB1: Continue + BrainState (NEW)
import { detectContinue } from '../nlu/detectContinue.js';
import { loadLastState, saveLastState } from '../memory/lastState.js';

// ✅ SHERZ_HEART v2: personality baseline calculator (background, non-blocking)
import { maybeRecalculateBaseline } from './personalityEngine.js';

/**
 * SHERZ Brain — Faza 2 (Friend Mode) + Faza 3 (Deep Context) + FAZA 4 (Adaptive Personality Memory) + FAZA 5 (Memory RAG)
 * + ✅ FAZA 6: LAB1 continue_from_last + last_state fix (BrainState)
 */

// ✅ Friend Brain state (minimal, in-memory)
let friendBrainState = {
  lastPhase: null,
  lastHelpProvided: false,
  updatedAt: Date.now(),
};

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
function normalizeRecentMessages(messages = [], limit = 20) {
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
function normalizeEmotion(e) {
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
async function getEmotionSummary(prisma, userId, days = 7) {
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
async function writeEmotionLog(prisma, { userId, emotion }) {
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
  if (!st) {
    return {
      type: 'assistant',
      content: "Qayerdan davom ettiray? Oxirgi holat topilmadi.",
      meta: { continued: false, reason: 'NO_STATE' },
    };
  }

  // Stale guard (30 daqiqa)
  const MAX_AGE_MIN = 30;
  const ageMin = st.updatedAt ? (Date.now() - new Date(st.updatedAt).getTime()) / 60000 : 9999;

  if (ageMin > MAX_AGE_MIN) {
    return {
      type: 'assistant',
      content: "Oxirgi holat biroz eskirib ketgan. Qaysi vazifani davom ettiray?",
      meta: { continued: false, reason: 'STALE' },
    };
  }

  // lastResult’dan content olish
  const last =
    (st?.lastResult && typeof st.lastResult === 'object' && st.lastResult?.content)
      ? String(st.lastResult.content)
      : null;

  if (!last || last.length < 5) {
    return {
      type: 'assistant',
      content: "Oxirgi javob topilmadi. Qaysi ishni davom ettiray?",
      meta: { continued: false, reason: 'NO_LAST_RESULT' },
    };
  }

  return {
    type: 'assistant',
    content: `Davom etamiz. Oxirgi joy:\n\n${last}`,
    meta: { continued: true, reason: 'OK' },
  };
}

export async function runBrain({ userId, messages, prisma, image, maxToolHops = 3, onToken }) {
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
  
  // Oxirgi foydalanuvchi xabarini rasm bilan boyitish
   if (image && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === 'user') {
        // Matnni va rasmni OpenAI Vision formatiga o'tkazamiz
        lastMsg.content = [
            { type: "text", text: lastMsg.content },
            { type: "image_url", image_url: { url: image } }
        ];
    }
  }console.log('🧪 LAST USER TEXT:', userText);

  console.log('🧪 detectContinue?', userText, detectContinue(userText));
  
  // ✅ Greeting hard-override (LLMga bormaydi)
  const greetingOnly = isGreetingOnly(userText);
  if (greetingOnly) {
    return {
      type: 'assistant',
      content: 'Salom 🙂 Qalay? Bugun nima gap?',
      safety,
      meta: {
        policy: { strategy: 'greet' },
        ctx: {
          mode: 'LISTEN',
          confidence: 1,
          internalSummary: 'GREETING_ONLY → hard response',
        },
        friendBrainState,
      },
    };
  }

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

  // 3) Emotion: real detectEmotion’dan
  const detected = detectEmotion(userText) || { label: 'neutral' };
  const userEmotion = normalizeEmotion(detected);
  console.log('🧠 userEmotion(normalized):', userEmotion);

  // ✅ 3.1) EmotionLog’ni DB’ga yozib qo‘yamiz
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
    '  • Keraksiz joyda tool tilga olma, oddiy do‘stona javob ber.',
    '  • Juda uzun monolog qilma.',
    '',
    'FAZA 3: DEEP CONTEXT (KONTEKST) — COMFORT GATE:',
    `- Mode: ${ctx?.mode || 'LISTEN'}`,
    `- Confidence: ${typeof ctx?.confidence === 'number' ? ctx.confidence.toFixed(2) : 'n/a'}`,
    `- Summary: ${ctx?.internalSummary || 'n/a'}`,
    '- QOIDALAR:',
    '  • MODE=INQUIRE bo‘lsa: taskin bermaysan, faqat 1–2 ta aniqlashtiruvchi savol berasan.',
    '  • MODE=HELP bo‘lsa: step-by-step yechim berasan, taskin minimal.',
    '  • MODE=COMFORT faqat ruxsat bo‘lsa: real, halol, qisqa taskin.',
    '  • MODE=LISTEN bo‘lsa: gapirtiradigan qisqa javob.',
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
    if (prisma && userId) {
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
        '- Memory faqat kerak bo‘lsa ishlatiladi, uydirma qilinmaydi.',
        '- Agar memory userning hozirgi gapiga zid bo‘lsa, hozirgi gap ustun.',
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

  // 6) Modelga boradigan messages
  const finalMessages = [
    { role: 'system', content: systemPrompt },
    ...messages
      .filter((m) => m?.role === 'user' || m?.role === 'assistant')
      .map((m) => ({
        role: m.role,
        content: String(m.content ?? ''),
      })),
  ];

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
          model: process.env.SHERZ_BRAIN_MODEL || 'gpt-4.1-mini',
          messages: finalMessages,
          temperature: 0.6,
          stream: true,
        },
        {
          timeout: 18000,
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
          model: process.env.SHERZ_BRAIN_MODEL || 'gpt-4.1-mini',
          messages: finalMessages,
          temperature: 0.6,
        },
        {
          timeout: 18000,
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

    // ✅ SUPPORT bo‘lsa savol majburiy
    if (policy?.strategy === 'support') {
      const hasQuestion =
        /[?？]/.test(content) || /\b(nima bo‘ldi|qaysi|nimasi|nega|qachon|kim|qanday)\b/i.test(content);

      if (!hasQuestion) {
        const q =
          ctx?.mode === 'INQUIRE'
            ? "Nimadan shunaqa bo‘lib qolding — aynan nima sabab bo‘lyapti?"
            : 'Nima bo‘ldi o‘zi?';
        content = content.trim() + '\n\n' + q;
      }

      content = content.replace(/Agar gaplash.*?bosim qilmayman\.?/i, '').trim();
    }

    // ✅ INQUIRE/LISTEN bo‘lsa erta taskinlarni kesamiz + savol qo‘shamiz
    if (ctx?.mode === 'INQUIRE' || ctx?.mode === 'LISTEN') {
      content = stripEarlyComfort(content);

      const hasQ = /[?？]/.test(content);
      if (
        !hasQ &&
        ctx?.mode === 'INQUIRE' &&
        Array.isArray(ctx?.suggestedQuestions) &&
        ctx.suggestedQuestions[0]
      ) {
        content = (content ? content.trim() + '\n\n' : '') + ctx.suggestedQuestions[0];
      }
    }

    // ✅ HELP berilganini minimal aniqlab state yangilaymiz
    const gaveHelp = /\b(qadam|step|1\)|2\)|3\)|kod|code|patch|copy-?paste|qilib ko['’]?r|yechim|tuzat)\b/i.test(
      content
    );

    friendBrainState = updateFriendBrainState(friendBrainState, {
      phase: gaveHelp ? 'HELP' : 'LISTEN',
      helpProvided: gaveHelp ? true : undefined,
    });

    // ✅ COMFORT qo‘shish: faqat ctx.mode COMFORT bo‘lsa
    const emo = String(userEmotion?.label || 'neutral').toLowerCase();
    const comfortFriendly = ['sad', 'sadness', 'anxious', 'fear', 'tired', 'stress', 'stressed'].includes(emo);
    const isAnger = ['angry', 'anger', 'mad'].includes(emo);

    if (ctx?.mode === 'COMFORT' && comfortFriendly && !isAnger) {
      content = content.trim() + "\n\nYolg‘iz emassan. Buni birga hal qilamiz.";
    }

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
          injected: !!faza5MemoryBlock,
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
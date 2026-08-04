// mvp_endpoints.js

import { runNluForMemory } from './nlu/runNluForMemory.js';
import { saveMemoryFactsForUser } from './nlu/saveMemoryFacts.js';
import { getMemoryContextForUser } from './nlu/memoryRag.js';
import { loadRecentChatHistory, saveChatTurn, getChatHistoryForUser } from './memory/chatHistory.js';
import { loadProfileSummary } from './memory/profileSummary.js';
import { detectContinue } from './nlu/detectContinue.js';
import { buildPersonalityContext } from "./personality/personalityEngine.js";
import { touchInteraction } from "./memory/interactionStore.js";

// 🔥 SHERZ Brain V1 (hozircha ishlatilmayapti, lekin importni qoldirdik)
import { runBrain } from './brain/brain.js';

// ⭐ SKILL ROUTER (eski rule-based skilllar hali ham ishlaydi)
import { detectSkill, runSkill } from './brain/skillsRouter.js';

// ⭐ YANGI: OpenAI client + tools
import OpenAI from 'openai';
import { getToolSchemas, executeTool } from './brain/tools.js';
import { buildSystemPrompt } from './brain/systemPrompt.js';
import { detectEmotion } from './nlu/detectEmotion.js';

// ✅ LAB6: permission + policy adapt
// Pathni o'zingda qayerda turganiga qarab moslashtir.
import { applyBoundaryOutcomeToPolicy } from './proactive/boundary/boundaryIntelligence.js';

// ─────────────────────────────────────────────────────────────
// ✅ LAB6 HELPERS (permission interception + reply marking)
// ─────────────────────────────────────────────────────────────

function normalizeYesNo(txt) {
  const t = (txt || '').toLowerCase().trim();

  const yes = [
    'ha', 'xa', 'haa', 'yes', 'ok', 'mayli',
    'jim tur', 'tinch qoy', 'tinch qo‘y', 'bo‘ldi', 'xo‘p jim',
  ];

  const no = [
    'yoq', "yo'q", 'no',
    'davom et', 'gapir', 'yoz', 'yozaver', 'gaplash', 'gaplashamiz',
    'yozib tur', 'davom',
  ];

  if (yes.some((x) => t.includes(x))) return 'granted'; // user: "ha, jim tur"
  if (no.some((x) => t.includes(x))) return 'deny';     // user: "yo‘q, yozaver"
  return null;
}

function inferFriendStyleFromText(lastUserText) {
  const txt = (lastUserText || '').toLowerCase();

  const broSignals = ['bro', 'brat', 'aka', 'uka', 'qalesan', 'gap yo', '😂', '😄'];
  const bestieSignals = ['bestie', 'dugon', 'jonim', '🥺', '🤍', '✨', '😘'];
  const formalSignals = ['assalomu alaykum', 'iltimos', 'marhamat', 'rahmat'];

  const hasBro = broSignals.some((s) => txt.includes(s));
  const hasBestie = bestieSignals.some((s) => txt.includes(s));
  const hasFormal = formalSignals.some((s) => txt.includes(s));

  if (hasFormal) return 'neutral';
  if (hasBestie && !hasBro) return 'bestie';
  if (hasBro && !hasBestie) return 'bro';
  return 'neutral';
}

async function getStyleContext(prisma, userId) {
  let profile = null;
  let lastUserMessage = '';

  try {
    if (prisma?.userProfile?.findUnique) {
      profile = await prisma.userProfile.findUnique({ where: { userId } });
    }
  } catch {}

  try {
    if (prisma?.message?.findFirst) {
      const last = await prisma.message.findFirst({
        where: { userId, role: 'user' },
        orderBy: { createdAt: 'desc' },
      });
      lastUserMessage = last?.text || '';
    }
  } catch {}

  return { profile, lastUserMessage };
}

/**
 * ✅ LAB6: Permission javobini ushlab qolish
 * - user "ha/yo‘q" desa va pending permission event bo‘lsa:
 *   - ProactiveEvent update (permissionResult, gotReply, replyAt, awaitingReply=false)
 *   - Policy adapt (respect window / tuning)
 *   - Do‘stona reply qaytaradi
 */
async function handleBoundaryPermission({ prisma, userId, userText }) {
  const yn = normalizeYesNo(userText);
  if (!yn) return { handled: false };

  if (!prisma?.proactiveEvent?.findFirst || !prisma?.proactiveEvent?.update) {
    return { handled: false };
  }

  // pending permission event topamiz
  let lastPerm = null;
  try {
    lastPerm = await prisma.proactiveEvent.findFirst({
      where: { userId, kind: 'permission', awaitingReply: true },
      orderBy: { createdAt: 'desc' },
    });
  } catch {
    lastPerm = null;
  }

  if (!lastPerm) return { handled: false };

  const now = new Date();
  const createdAt = new Date(lastPerm.createdAt);
  const latencyS = Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 1000));

  // event update
  try {
    await prisma.proactiveEvent.update({
      where: { id: lastPerm.id },
      data: {
        awaitingReply: false,
        gotReply: true,
        replyAt: now,
        replyLatencyS: latencyS,
        permissionResult: yn,
      },
    });
  } catch {}

  const styleCtx = await getStyleContext(prisma, userId);
  const style = inferFriendStyleFromText(styleCtx.lastUserMessage);

  // do‘stona reply
  let replyText = 'Xo‘p 🙂';

  if (yn === 'granted') {
    // user: "ha, jim tur"
    replyText =
      style === 'bro'
        ? "Bo‘ldi bro 🤍 jim turaman. O‘zing xohlaganingda yoz."
        : style === 'bestie'
          ? "Xo‘p 🤍 men jim turaman. Qachon tayyor bo‘lsang, yozasan."
          : "Tushunarli 🤍 men jim turaman. Xohlaganingizda davom etamiz.";

    // policy adapt: user wants silence => treat as deny-to-proactive
    try {
      await applyBoundaryOutcomeToPolicy(
        userId,
        {
          boundaryDecision: 'respect',
          permissionResult: 'deny',
          cause: { cause: lastPerm.noReplyCause, confidence: lastPerm.noReplyConfidence },
        },
        prisma, // extra param safe (agar fn 2 param bo‘lsa ignore qiladi)
      );
    } catch {}

    // event boundaryDecision set (safe)
    try {
      await prisma.proactiveEvent.update({
        where: { id: lastPerm.id },
        data: { boundaryDecision: 'respect' },
      });
    } catch {}

    return { handled: true, replyText };
  }

  // yn === 'deny' => user: "yo‘q, yozaver"
  replyText =
    style === 'bro'
      ? "Ha endi gaplashamiz 😄 Nimadan boshlaymiz?"
      : style === 'bestie'
        ? "Xo‘p 😊 Unda gaplashamiz. Nima bo‘lyapti?"
        : "Mayli 🙂 Unda davom etamiz. Nima haqida gaplashamiz?";

  try {
    await applyBoundaryOutcomeToPolicy(
      userId,
      {
        boundaryDecision: 'normal',
        permissionResult: 'granted',
        cause: { cause: lastPerm.noReplyCause, confidence: lastPerm.noReplyConfidence },
      },
      prisma,
    );
  } catch {}

  try {
    await prisma.proactiveEvent.update({
      where: { id: lastPerm.id },
      data: { boundaryDecision: 'normal' },
    });
  } catch {}

  return { handled: true, replyText };
}

/**
 * ✅ LAB6: User har qanday xabar yozsa, oxirgi awaitingReply proactive eventni "gotReply" qilib belgilash.
 * - Permission eventni bu yerda yopmaymiz (u alohida handleBoundaryPermission’da).
 */
async function markLastAwaitingProactiveReplied({ prisma, userId }) {
  if (!prisma?.proactiveEvent?.findFirst || !prisma?.proactiveEvent?.update) return null;

  let ev = null;
  try {
    ev = await prisma.proactiveEvent.findFirst({
      where: {
        userId,
        awaitingReply: true,
        // permission eventni bu matcherga kiritmaymiz
        NOT: { kind: 'permission' },
      },
      orderBy: { createdAt: 'desc' },
    });
  } catch {
    ev = null;
  }

  if (!ev) return null;

  const now = new Date();
  const createdAt = new Date(ev.createdAt);
  const latencyS = Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 1000));

  try {
    await prisma.proactiveEvent.update({
      where: { id: ev.id },
      data: {
        awaitingReply: false,
        gotReply: true,
        replyAt: now,
        replyLatencyS: latencyS,
      },
    });
  } catch {}

  return ev.id;
}

// endi prisma server.js dan keladi
export default function registerMvpEndpoints(app, prisma) {
  console.log('✅ MVP endpoints loaded: /api/chat, /api/tts, /debug/memory-nlu');
  console.log('🔥 LOADED: mvp_endpoints.js VERSION WITH BRAIN SUPPORT + TOOLS');

  // --- CHAT: POST /api/chat ---
  // body = { userId?, message, temperature?, locale? }
  app.post('/api/chat', async (req, res) => {
    console.log('🟢 ENTER /api/chat HANDLER', req.body);

    try {
      const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
      if (!OPENAI_API_KEY) {
        return res.status(501).json({
          ok: false,
          error: 'OPENAI_API_KEY yo‘q (chat o‘chirilgan)',
        });
      }

      const body = req.body || {};
      const userText = (body.message || '').toString().trim();

      if (!userText) {
        return res.status(400).json({ ok: false, error: 'message is required' });
      }

      const userId = (body.userId || '').toString().trim() || 'LOCAL_USER';
      
      touchInteraction(userId);
      console.log("[touch] userId=", userId);
      
      // ✅ LAB6: 1) permission interception (LLM chaqirishdan oldin)
      const perm = await handleBoundaryPermission({ prisma, userId, userText });
      if (perm.handled) {
        // chat historyga yozamiz (user + assistant)
        try {
          await saveChatTurn(prisma, userId, userText, perm.replyText);
        } catch (saveErr) {
          console.error('Chat history save error (permission intercept):', saveErr);
        }

        return res.json({
          ok: true,
          reply: perm.replyText,
          usage: null,
          meta: {
            intercepted: 'permission',
            userId,
          },
        });
      }
      
  // ✅ CHAT HISTORY: GET /api/chat/history
  // UI refresh bo‘lganda eski chatlarni qaytaradi
  // GET /api/chat/history?userId=LOCAL_USER&limit=80
  app.get('/api/chat/history', async (req, res) => {
    try {
      const userId = (req.query.userId || 'LOCAL_USER').toString().trim() || 'LOCAL_USER';
      const limit = req.query.limit ?? 80;
      const cursor = req.query.cursor ? String(req.query.cursor) : null;

      const { items, nextCursor } = await getChatHistoryForUser(prisma, userId, { limit, cursor });

      return res.json({ ok: true, userId, items, nextCursor });
    } catch (e) {
      console.error('GET /api/chat/history error:', e);
      return res.status(500).json({ ok: false, error: 'chat history failed' });
    }
  });


      // ✅ LAB6: 2) general proactive reply matcher (soft_presence/normal proactive javobini belgilash)
      // (user har qanday xabar yozsa, oxirgi awaitingReply eventni yopamiz)
      try {
        await markLastAwaitingProactiveReplied({ prisma, userId });
      } catch (e) {
        console.error('markLastAwaitingProactiveReplied error:', e);
      }

      // locale/temperature
      const locale = (body.locale || 'uz').toString();
      const temperature = typeof body.temperature === 'number' ? body.temperature : 0.6;

      // ✅ FAZA 6 LAB1: continue_from_last (ERTA RETURN YO‘Q!)
      const isContinue = detectContinue(userText);
      console.log('🧪 CONTINUE DETECTED?', isContinue, '| text =', userText);

      let continueState = null;
      if (isContinue && prisma && userId) {
        try {
          const last = await prisma.fact.findFirst({
            where: { userId, key: 'last_state' },
            orderBy: { updatedAt: 'desc' },
          });
          continueState = last?.value || null;
        } catch (e) {
          console.error('❌ continue last_state read error:', e);
          continueState = null;
        }
      }

      // 🎭 Emotion aniqlash (NLU)
      const emotionResult = await detectEmotion({
        userId,
        text: userText,
      });

      console.log('🎭 Emotion detected:', emotionResult);

      const emotionContext =
        emotionResult?.ok && emotionResult.confidence >= 0.55
          ? `UserEmotion: ${emotionResult.emotion} (intensity=${emotionResult.intensity}, confidence=${emotionResult.confidence}).`
          : `UserEmotion: neutral or unknown.`;

      console.log('💬 /api/chat request:', {
        userId,
        locale,
        userText,
      });

      // ⭐ SKILL ROUTER: foydalanuvchi xabaridan skill aniqlash (rule-based eski layer)
      let skillDetection = null;
      let skillResult = null;

      try {
        skillDetection = await detectSkill({ userId, text: userText });

        if (skillDetection) {
          console.log('🧩 Skill detection:', skillDetection);

          skillResult = await runSkill({
            userId,
            name: skillDetection.name,
            args: skillDetection.args,
            prisma,
          });

          console.log('⚙️ Skill result:', skillResult);
        } else {
          console.log('🧩 Skill detection: none');
        }
      } catch (skillErr) {
        console.error('Skill router error:', skillErr);
      }

      let nluResult = null;

      // ⭐ 0) QISQA MUDDATLI CHAT TARIXINI OLAMIZ (Message jadvalidan)
      let recentHistory = [];
      try {
        recentHistory = await loadRecentChatHistory(prisma, userId, 20);
        console.log('💬 [CHAT] Loaded recent history messages:', recentHistory.length);
      } catch (histErr) {
        console.error('Chat history load error:', histErr);
      }

      // ⭐ 1) Memory NLU pipeline — yangi faktlarni saqlaymiz
      try {
        nluResult = await runNluForMemory(userText);
        if (nluResult?.facts?.length) {
          await saveMemoryFactsForUser(prisma, userId, nluResult.facts);
          console.log(
            '🧠 [NLU] New facts saved for user',
            userId,
            JSON.stringify(nluResult.facts, null, 2),
          );
        } else {
          console.log('🧠 [NLU] No facts detected for this message');
        }
      } catch (memErr) {
        console.error('Memory NLU pipeline error:', memErr);
        // xato bo'lsa ham chatni to'xtatmaymiz
      }

      // ⭐ 2) RAG: foydalanuvchining eng tegishli factlarini olish
      let memoryContext = '';
      try {
        memoryContext = await getMemoryContextForUser(prisma, userId, userText, {
          limit: 8,
          minSim: 0.25,
        });
        console.log('🧠 [RAG] memoryContext for', userId, '\n', memoryContext || '(empty)');
      } catch (ragErr) {
        console.error('RAG memory error:', ragErr);
      }

      // ⭐ 2.5) Profil xulosasini yuklaymiz
      let profileSummary = '';
      try {
        profileSummary = await loadProfileSummary(prisma, userId);
        console.log('🧠 [ProfileSummary] length =', profileSummary?.length || 0);
      } catch (profErr) {
        console.error('Profile summary error:', profErr);
      }

      // ⭐ 3) SHERZ Brain V1 uchun messages massivini tayyorlaymiz
      const brainMessages = [];

      // ✅ CONTINUE system injection (LLM shuni ko‘rib chiroyli davom ettiradi)
      if (isContinue) {
        if (continueState) {
          brainMessages.push({
            role: 'system',
            content: [
              'CONTINUE_FROM_LAST: User asked to continue from where we left off.',
              'Use the LAST_STATE below as the most recent context and continue naturally.',
              'Do NOT dump JSON. Answer like SHERZ friend mode (short + clear).',
              '',
              '--- LAST_STATE ---',
              continueState,
            ].join('\n'),
          });
        } else {
          brainMessages.push({
            role: 'system',
            content: [
              'CONTINUE_FROM_LAST: User asked to continue, but LAST_STATE is missing.',
              'Ask ONE short clarifying question: which topic/part to continue.',
              'Do NOT sound robotic.',
            ].join('\n'),
          });
        }
      }

      // 3.0) Agar skill ishlagan bo'lsa — natijani system message sifatida beramiz
      if (skillResult && skillResult.ok) {
        brainMessages.push({
          role: 'system',
          content:
            "SkillResult (foydalanuvchiga ko'rsatilmaydigan texnik maʼlumot): " +
            JSON.stringify(skillResult),
        });
      }

      // 3.1) Agar memory / profil bo'lsa, buni bitta system xabarida beramiz
      if (memoryContext || profileSummary) {
        brainMessages.push({
          role: 'system',
          content: [
            'Quyida foydalanuvchini yaxshiroq tushunishing uchun qo‘shimcha maʼlumotlar:',
            '',
            '--- MEMORY FACTS ---',
            memoryContext || '(hech narsa topilmadi)',
            '',
            '--- PROFILE SUMMARY ---',
            profileSummary || '(profil xulosasi yo‘q)',
          ].join('\n'),
        });
      }

      // 3.2) Oldingi chat tarixini qo‘shamiz
      if (recentHistory?.length) {
        for (const msg of recentHistory) {
          brainMessages.push({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: String(msg.content ?? ''),
          });
        }
      }

      // 3.3) Yangi user xabarini qo‘shamiz
      brainMessages.push({
        role: 'user',
        content: userText,
      });

      // ✅ SYSTEM PROMPT (ReferenceError bo‘lmasligi uchun)
      let systemPrompt = '';
      try {
        systemPrompt = buildSystemPrompt({ locale, userId });
      } catch (e) {
        systemPrompt = buildSystemPrompt();
      }

      // 🎭 Emotion reflect
      let reflectText = null;

      if (emotionResult?.ok && emotionResult.confidence >= 0.55) {
        try {
          const r = await executeTool(
            'emotion_reflect',
            {
              emotion: emotionResult.emotion,
              intensity: emotionResult.intensity,
              confidence: emotionResult.confidence,
              locale,
            },
            { userId, prisma },
          );

          if (r?.ok && r?.result?.text) reflectText = r.result.text;
        } catch (err) {
          console.error('emotion_reflect tool error:', err);
        }
      }
         // 🧠 Personality injection
 const personalityContext = buildPersonalityContext({
  user: { id: userId },
  detectedEmotion: emotionResult?.emotion || null,
  userPreference: null,
});



      const messagesForModel = [
        { role: 'system', content: `${personalityContext}\n\n${systemPrompt}` },
        ...(reflectText ? [{ role: 'system', content: `EmotionReflect: ${reflectText}` }] : []),
        ...brainMessages,
      ];

      // ⭐ 4) OpenAI + tools
      const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
      const tools = getToolSchemas();

      let messages = [...messagesForModel];
      let lastAssistantMessage = null;
      let usage = null;
      const maxToolHops = 4;

      for (let hop = 0; hop < maxToolHops; hop++) {
        const completion = await openai.chat.completions.create({
          model: process.env.SHERZ_BRAIN_MODEL || 'gpt-4.1-mini',
          messages,
          tools,
          tool_choice: 'auto',
          temperature,
        });

        const choice = completion.choices[0];
        const msg = choice.message;

        console.log('🔧 Brain tool_calls:', msg.tool_calls?.map((t) => t.function?.name));

        if (!msg.tool_calls || msg.tool_calls.length === 0) {
          lastAssistantMessage = msg;
          usage = completion.usage || null;
          break;
        }

        messages.push({
          role: 'assistant',
          content: msg.content || '',
          tool_calls: msg.tool_calls,
        });

        for (const toolCall of msg.tool_calls) {
          const toolName = toolCall.function?.name;
          let args = {};

          try {
            args = toolCall.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};
          } catch (e) {
            console.error('❌ Tool args JSON.parse error:', e);
            args = {};
          }

          console.log('🔧 Executing tool:', toolName, 'args:', args);

          const toolResult = await executeTool(toolName, args, {
            userId,
            prisma,
          });

          console.log('🔧 Tool result:', toolResult);

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: JSON.stringify(toolResult),
          });
        }
      }

      if (!lastAssistantMessage) {
        console.error('❌ NO_ASSISTANT_RESPONSE from Brain/tools');
        return res.status(500).json({
          ok: false,
          error: 'NO_ASSISTANT_RESPONSE',
        });
      }

      const assistantText = lastAssistantMessage.content || '';

      // ⭐ 5) Chat tarixini DB ga saqlash (user + assistant)
      try {
        await saveChatTurn(prisma, userId, userText, assistantText);
      } catch (saveErr) {
        console.error('Chat history save error:', saveErr);
      }

      return res.json({
        ok: true,
        reply: assistantText,
        usage,
        meta: {
          usedMemory: Boolean(memoryContext),
          userId,
          nluFacts: nluResult?.facts || [],
          safety: null,
          skillDetection,
          skillResult,
          continue: {
            detected: !!isContinue,
            hasState: !!continueState,
          },
        },
      });
    } catch (e) {
      console.error('CHAT endpoint error:', e);
      return res.status(500).json({ ok: false, error: 'chat endpoint failed' });
    }
  });

  // --- TTS: POST /api/tts --- (o'zgarishsiz)
  app.post('/api/tts', async (req, res) => {
    try {
      const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
      if (!OPENAI_API_KEY) {
        return res.status(501).json({
          ok: false,
          error: 'OPENAI_API_KEY yo‘q (tts o‘chirilgan)',
        });
      }

      const text = (req.body?.text || '').toString();
      if (!text) {
        return res.status(400).json({ ok: false, error: 'text kerak' });
      }

      const voice = (req.body?.voice || process.env.OPENAI_TTS_VOICE || 'alloy').toString();
      const format = (req.body?.format || process.env.OPENAI_TTS_FORMAT || 'mp3').toString();
      const model = process.env.OPENAI_TTS_MODEL || 'tts-1';

      const r = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          voice,
          input: text,
          format,
        }),
      });

      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        console.error('OpenAI TTS error:', j);
        return res.status(r.status).json({ ok: false, error: j.error?.message || 'tts failed' });
      }

      const buf = Buffer.from(await r.arrayBuffer());
      const b64 = buf.toString('base64');
      const mime = `audio/${
        format === 'mp3'
          ? 'mpeg'
          : format === 'wav'
          ? 'wav'
          : format === 'ogg'
          ? 'ogg'
          : format
      }`;
      const dataUrl = `data:${mime};base64,${b64}`;
      return res.json({ ok: true, audio: dataUrl });
    } catch (e) {
      console.error('TTS endpoint error:', e);
      return res.status(500).json({ ok: false, error: 'tts endpoint failed' });
    }
  });

  // --- MEMORY NLU TEST ROUTES ---
  app.post('/debug/memory-nlu', async (req, res) => {
    try {
      const text = req.body?.text || '';
      const result = await runNluForMemory(text);
      return res.json({ ok: true, facts: result.facts });
    } catch (err) {
      console.error('Memory NLU error:', err);
      return res.status(500).json({ ok: false, error: 'memory-nlu failed' });
    }
  });

  app.get('/debug/memory-nlu', async (req, res) => {
    try {
      const text =
        req.query.text || "Mening eng sevimli taomim osh. Odatda ertalab 7:30 da uyg'onaman.";
      const result = await runNluForMemory(String(text));
      return res.json({ ok: true, facts: result.facts });
    } catch (err) {
      console.error('Memory NLU GET error:', err);
      return res.status(500).json({ ok: false, error: 'memory-nlu GET failed' });
    }
  });

  // --- MEMORY CONTEXT DEBUG ---
  app.get('/debug/memory-context', async (req, res) => {
    try {
      const userId = (req.query.userId || 'LOCAL_USER').toString();
      const text = (req.query.text || '').toString();

      const ctx = await getMemoryContextForUser(prisma, userId, text, {
        limit: 8,
        minSim: 0.25,
      });

      return res.json({
        ok: true,
        userId,
        text,
        memoryContext: ctx,
      });
    } catch (err) {
      console.error('memory-context debug error:', err);
      return res.status(500).json({ ok: false, error: 'memory-context failed' });
    }
  });
}

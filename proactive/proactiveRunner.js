import { runProactiveDecisionOnce } from './proactiveDecisionEngine.js';

// ✅ LAB5: realtime SSE push
import { ssePushToUser } from '../realtime/sseHub.js';
import eventBus from '../lib/eventBus.js';

// ✅ LAB6: Boundary Intelligence
import { decideBoundaryForUser, applyBoundaryOutcomeToPolicy } from './boundary/boundaryIntelligence.js';
import { buildSoftPresenceMessage } from './boundary/softPresence.js';
import { buildPermissionMessage } from './boundary/permission.js';
import { logBoundaryDecision } from './boundary/boundaryLogger.js';

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * ✅ helper: UserProfile + last user message (for style/vibe)
 */
async function getStyleContext({ prisma, userId }) {
  let profile = null;
  let lastUserMsg = null;

  try {
    if (prisma?.userProfile?.findUnique) {
      profile = await prisma.userProfile.findUnique({ where: { userId } });
    }
  } catch {}

  try {
    // Prefer Message model (your prisma schema has Message)
    if (prisma?.message?.findFirst) {
      lastUserMsg = await prisma.message.findFirst({
        where: { userId, role: 'user' },
        orderBy: { createdAt: 'desc' },
      });
    } else if (prisma?.chatMessage?.findFirst) {
      // fallback if your project uses chatMessage model
      lastUserMsg = await prisma.chatMessage.findFirst({
        where: { userId, role: 'user' },
        orderBy: { createdAt: 'desc' },
      });
    }
  } catch {}

  return {
    profile,
    lastUserMessage: lastUserMsg?.text || lastUserMsg?.content || '',
  };
}

/**
 * ✅ LAB5 helper: ProactiveEvent log (decision)
 * - shouldMessage true/false bo‘lsa ham yozadi
 * - LAB6: kind, boundary fields ham safe update qilamiz (migrate bo‘lmasa crash qilmaydi)
 */
async function logProactiveDecision({ prisma, userId, decision, now, signals }) {
  if (!prisma?.proactiveEvent?.create) return null;

  const d = decision || {};
  const hourLocal = signals?.time?.hour ?? null;
  const dayOfWeek = signals?.time?.dow ?? null;

  try {
    return await prisma.proactiveEvent.create({
      data: {
        userId,
        // LAB6: kind optional (schema updated bo‘lsa yoziladi)
        kind: d.kind || null,

        shouldMessage: !!d.shouldMessage,
        reason: d.reason || null,
        tone: d.tone || null,
        message: d.message || null,

        delivered: false,
        sentAt: null,

        gotReply: false,
        replyAt: null,
        replyLatencyS: null,

        hourLocal,
        dayOfWeek,

        // LAB6 fields (if exist in schema)
        awaitingReply: !!d.awaitingReply,
        replyDeadlineAt: d.replyDeadlineAt || null,

        noReplyCause: d.noReplyCause || null,
        noReplyConfidence: typeof d.noReplyConfidence === 'number' ? d.noReplyConfidence : null,
        boundaryDecision: d.boundaryDecision || null,

        permissionAsked: !!d.permissionAsked,
        permissionResult: d.permissionResult || null,

        softPresenceSent: !!d.softPresenceSent,
        respectUntil: d.respectUntil || null,

        metaJson: d.metaJson || null,
      },
    });
  } catch (e) {
    // migrate bo‘lmasa: extra fields error bo‘lishi mumkin. Minimal create qilib qaytamiz.
    try {
      return await prisma.proactiveEvent.create({
        data: {
          userId,
          shouldMessage: !!d.shouldMessage,
          reason: d.reason || null,
          tone: d.tone || null,
          message: d.message || null,
          delivered: false,
          sentAt: null,
          gotReply: false,
          replyAt: null,
          replyLatencyS: null,
          hourLocal,
          dayOfWeek,
        },
      });
    } catch (e2) {
      console.error('logProactiveDecision error:', e2);
      return null;
    }
  }
}

/**
 * ✅ LAB5 helper: sent mark
 */
async function markProactiveSent({ prisma, proactiveEventId }) {
  if (!proactiveEventId) return null;
  if (!prisma?.proactiveEvent?.update) return null;

  try {
    return await prisma.proactiveEvent.update({
      where: { id: proactiveEventId },
      data: { delivered: true, sentAt: new Date() },
    });
  } catch (e) {
    console.error('markProactiveSent error:', e);
    return null;
  }
}

/**
 * ✅ LAB6 helper: ProactiveEvent update (safe)
 */
async function safeUpdateProactiveEvent({ prisma, proactiveEventId, data }) {
  if (!proactiveEventId) return null;
  if (!prisma?.proactiveEvent?.update) return null;
  try {
    return await prisma.proactiveEvent.update({
      where: { id: proactiveEventId },
      data,
    });
  } catch {
    return null;
  }
}

/**
 * ✅ LAB5 helper: chatga yozish + SSE push
 * (UI’da proactive message ko‘rinishi uchun)
 */
async function deliverProactiveToUser({ prisma, userId, text, meta }) {
  let msgRow = null;

  // 1) DB chat log
  // Prefer your Message model from schema; keep chatMessage fallback
try {
    if (prisma?.message?.create) {
      msgRow = await prisma.message.create({
        data: {
          userId,
          role: 'assistant',
          content: text,
          meta: { proactive: true, ...(meta || {}) },
        },
      });
    } else if (prisma?.chatMessage?.create) {
      msgRow = await prisma.chatMessage.create({
        data: {
          userId,
          role: 'assistant',
          content: text,
          meta: meta || {},
        },
      });
    }
  } catch {}

// 2) REALTIME SSE push
// REPLACE the entire SSE push block (the try block under "2) REALTIME SSE push"):

  try {
    ssePushToUser(userId, 'message', {
      id: msgRow?.id || `pro_${Date.now()}`,
      role: 'assistant',
      content: text,          // frontend reads msg.content not msg.text
      meta: {
        ...(meta || {}),
        proactive: true,
        tone: meta?.tone || 'neutral',
      },
      ts: Date.now(),
    });

    eventBus.emit('proactive-message', { userId, text, meta, ts: Date.now() });
    console.log('📡 SSE proactive sent to:', userId);
  } catch (e) {
      console.log('❌ SSE proactive error:', e?.message || e);
    }

  return msgRow;
}

/**

/**
 * ✅ LAB6: decide & deliver boundary-based proactive (permission / soft_presence / normal / respect)
 *
 * This wraps your existing LAB5 runProactiveDecisionOnce() and overrides delivery when needed.
 */
async function runBoundaryAwareProactiveOnce({ prisma, userId, timezone, eventName = null, eventMeta = null }) {
  // 0) Get vibe context for friend-style messages
  const styleCtx = await getStyleContext({ prisma, userId });

  // 1) First run LAB5 decision to get signals + decision logged via onDecision
  let proactiveEventId = null;
  let latestDecision = null;
  let latestSignals = null;

  // We will NOT let LAB5 auto-deliver; we intercept deliverFn.
  await runProactiveDecisionOnce({
    userId,
    prisma,
    timezone,

    onDecision: async ({ decision, signals }) => {
      latestDecision = decision || {};
      latestSignals = signals || {};

      const now = signals?.now ? new Date(signals.now) : new Date();

      // Base decision event log (LAB5)
      const ev = await logProactiveDecision({
        prisma,
        userId,
        decision: {
          ...latestDecision,
          // Tag event in meta
          kind: latestDecision?.kind || 'proactive_decision',
        },
        now,
        signals,
      });

      proactiveEventId = ev?.id || null;
    },

    // Intercept actual delivery: we'll decide via LAB6 boundary
    deliverFn: async () => {
      // Intentionally empty: LAB6 decides delivery route below.
    },
  });

  // If we couldn't log event, we still proceed (but no DB updates)
  // 2) Run LAB6 boundary decision (based on history)
  // ✅ DEMO: policy snapshot (before action)
const policyBefore = await prisma.userProactivePolicy?.findUnique?.({
  where: { userId }
}).catch(() => null);

// ✅ LAB6 boundary decision
const boundary = await decideBoundaryForUser(userId, prisma);

// ✅ Log boundary (policyAfter'ni keyinroq yana olamiz)
logBoundaryDecision({ userId, boundary, policyBefore, policyAfter: null });


  
  // Some projects implement decideBoundaryForUser(userId) without prisma param.
  // If your function signature is decideBoundaryForUser(userId) — it will ignore prisma anyway.

  const cause = boundary?.cause?.cause || null;
  const conf = boundary?.cause?.confidence ?? null;

  // 3) Permission check path
  if (boundary?.permissionNeeded) {
    const msg = buildPermissionMessage(styleCtx);

    // Update existing event record with LAB6 boundary info (safe)
    await safeUpdateProactiveEvent({
      prisma,
      proactiveEventId,
      data: {
        kind: 'permission',
        shouldMessage: true,
        message: msg,
        tone: 'calm',
        reason: 'permission_check',

        awaitingReply: true,
        replyDeadlineAt: new Date(Date.now() + 24 * 3600 * 1000),

        noReplyCause: cause,
        noReplyConfidence: typeof conf === 'number' ? conf : null,
        boundaryDecision: 'respect',

        permissionAsked: true,
        metaJson: boundary?.cause?.evidence || null,
      },
    });

    const finalMeta = {
      proactive: true,
      proactiveEventId,
      boundaryDecision: 'permission',
      noReplyCause: cause,
      eventName,
      eventMeta,
    };

    await deliverProactiveToUser({ prisma, userId, text: msg, meta: finalMeta });
    await markProactiveSent({ prisma, proactiveEventId });

    await applyBoundaryOutcomeToPolicy(userId, {
      boundaryDecision: 'respect',
      cause: boundary?.cause,
    }, prisma);

    return { sent: true, mode: 'permission', proactiveEventId };
  }

  // 4) Respect mode path (no message)
  if (boundary?.boundaryDecision === 'respect') {
    await safeUpdateProactiveEvent({
      prisma,
      proactiveEventId,
      data: {
        kind: 'boundary_respect',
        shouldMessage: false,
        reason: 'respect_mode',

        noReplyCause: cause,
        noReplyConfidence: typeof conf === 'number' ? conf : null,
        boundaryDecision: 'respect',
        metaJson: boundary?.cause?.evidence || null,

        respectUntil: boundary?.respectUntil || null,
      },
    });

    await applyBoundaryOutcomeToPolicy(userId, {
      boundaryDecision: 'respect',
      cause: boundary?.cause,
    }, prisma);

    return { sent: false, mode: 'respect', proactiveEventId };
  }

  // 5) Soft presence path
  if (boundary?.boundaryDecision === 'soft_presence') {
    const msg = buildSoftPresenceMessage({
      cause: cause || 'busy',
      ...styleCtx,
    });

    await safeUpdateProactiveEvent({
      prisma,
      proactiveEventId,
      data: {
        kind: 'soft_presence',
        shouldMessage: true,
        message: msg,
        tone: 'soft',
        reason: 'soft_presence_mode',

        awaitingReply: true,
        replyDeadlineAt: new Date(Date.now() + 24 * 3600 * 1000),

        noReplyCause: cause,
        noReplyConfidence: typeof conf === 'number' ? conf : null,
        boundaryDecision: 'soft_presence',

        softPresenceSent: true,
        metaJson: boundary?.cause?.evidence || null,
      },
    });

    const finalMeta = {
      proactive: true,
      proactiveEventId,
      boundaryDecision: 'soft_presence',
      noReplyCause: cause,
      eventName,
      eventMeta,
    };

    await deliverProactiveToUser({ prisma, userId, text: msg, meta: finalMeta });
    await markProactiveSent({ prisma, proactiveEventId });

    await applyBoundaryOutcomeToPolicy(userId, {
      boundaryDecision: 'soft_presence',
      cause: boundary?.cause,
    }, prisma);

    return { sent: true, mode: 'soft_presence', proactiveEventId };
  }

  // 6) Normal path: use LAB5 decision if shouldMessage true
  if (latestDecision?.shouldMessage) {
    const msg = latestDecision.message;

    // Update boundary fields if available
    await safeUpdateProactiveEvent({
      prisma,
      proactiveEventId,
      data: {
        kind: 'proactive',
        boundaryDecision: 'normal',
        noReplyCause: cause,
        noReplyConfidence: typeof conf === 'number' ? conf : null,

        // For tracking reply:
        awaitingReply: true,
        replyDeadlineAt: new Date(Date.now() + 24 * 3600 * 1000),
      },
    });

    const finalMeta = {
      proactive: true,
      proactiveEventId,
      boundaryDecision: 'normal',
      noReplyCause: cause,
      eventName,
      eventMeta,
    };

    await deliverProactiveToUser({ prisma, userId, text: msg, meta: finalMeta });
    await markProactiveSent({ prisma, proactiveEventId });

    return { sent: true, mode: 'normal', proactiveEventId };
  }

  // 7) Skip path
  await safeUpdateProactiveEvent({
    prisma,
    proactiveEventId,
    data: {
      kind: 'proactive_skip',
      boundaryDecision: 'normal',
    },
  });

  return { sent: false, mode: 'skip', proactiveEventId };
}

/**
 * Runner: interval tick -> users ro‘yxati -> per user qaror
 * Jitter: 5–15 min oralig‘ida
 */
export function startProactiveRunner({ prisma, timezone }) {
  const baseMin = 5;
  const maxMin = 15;

  let nextTickMs = randInt(baseMin, maxMin) * 60 * 1000;
  let stopped = false;

  async function tick() {
    if (stopped) return;

    console.log("🔥 PROACTIVE TICK", new Date().toISOString());

    try {
      const users = prisma?.message?.findMany
        ? await prisma.message.findMany({
            distinct: ["userId"],
            select: { userId: true },
          })
        : [{ userId: "LOCAL_USER" }];

      for (const u of users) {
        const userId = u.userId; // ✅ u.id emas!

        console.log("[proactive] checking userId =", userId);

        await runBoundaryAwareProactiveOnce({
          prisma,
          userId,
          timezone,
        });
      }
    } catch (e) {
      console.error("Proactive tick error:", e);
    } finally {
      nextTickMs = randInt(baseMin, maxMin) * 60 * 1000;
      setTimeout(tick, nextTickMs);
    }
  }

  setTimeout(tick, nextTickMs);

  return {
    stop() {
      stopped = true;
      console.log("Proactive runner stopped.");
    },
  };
}

/**
 * Event trigger:
 * Masalan: emotionLog yozilganda yoki last_state o‘zgarganda
 * runner kutmasdan ham tekshirsa bo‘ladi.
 */
export async function triggerProactiveEvent({
  prisma,
  userId,
  timezone,
  eventName,
  meta,
}) {
  return await runBoundaryAwareProactiveOnce({
    prisma,
    userId,
    timezone,
    eventName,
    eventMeta: meta,
  });
}

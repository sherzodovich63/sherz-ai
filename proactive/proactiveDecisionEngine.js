import { collectSignals } from './proactiveSignals.js';
import { decideProactive } from './proactivePolicy.js';
import { generateProactiveMessage } from './proactiveMessageGenerator.js';

/**
 * Bu funksiya:
 * 1) signal yig‘adi
 * 2) shouldMessage? => yes/no + reason
 * 3) yes bo‘lsa tone/length tanlab message generatsiya qiladi
 * 4) fact sifatida proactive_last_ping_at + ping_count_day update qiladi
 *
 * “Yuborish” qismi sizning chat pipeline’ga bog‘liq:
 * - prisma.chatMessage create(role='assistant', meta.proactive=true)
 * - yoki websocket push
 * - yoki notification system
 */
export async function runProactiveDecisionOnce({
  userId,
  prisma,
  timezone,
  now = new Date(),
  config,
  deliverFn, // async ({ userId, text, meta }) => void
}) {
  const tickId = `P_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const t0 = Date.now();

  console.log(`🧠 [${tickId}] runProactiveDecisionOnce START`, {
    userId,
    now: new Date(now).toISOString(),
    timezone,
    hasDeliverFn: Boolean(deliverFn),
  });

  let signals;
  try {
    signals = await collectSignals({ userId, prisma, now, timezone });

    console.log(`📡 [${tickId}] signals collected`, {
      userId,
      idleMin: signals?.idleMin,
      timeHour: signals?.time?.hour,
      last_state: signals?.last_state,
      hasProfile: Boolean(signals?.profile),
    });
  } catch (e) {
    console.log(`❌ [${tickId}] collectSignals ERROR`, e?.message || e);
    return { ok: false, error: 'COLLECT_SIGNALS_FAILED' };
  }

  let decision;
  try {
    decision = await decideProactive({ userId, prisma, signals, config });

    console.log(`🧾 [${tickId}] decision`, {
      shouldMessage: decision?.shouldMessage,
      tone: decision?.tone,
      length: decision?.length,
      reason: decision?.reason,
    });
  } catch (e) {
    console.log(`❌ [${tickId}] decideProactive ERROR`, e?.message || e);
    return { ok: false, error: 'DECIDE_PROACTIVE_FAILED' };
  }

  if (!decision.shouldMessage) {
    console.log(`🛑 [${tickId}] shouldMessage=false`, { reason: decision?.reason });
    return { ok: true, shouldMessage: false, reason: decision.reason };
  }

  let text;
  try {
    text = await generateProactiveMessage({ signals, decision });

    console.log(`✉️ [${tickId}] message generated`, {
      hasText: Boolean(text),
      preview: String(text || '').slice(0, 120),
    });
  } catch (e) {
    console.log(`❌ [${tickId}] generateProactiveMessage ERROR`, e?.message || e);
    return { ok: false, shouldMessage: true, error: 'MESSAGE_GENERATION_FAILED', reason: decision.reason };
  }

  if (!text) {
    console.log(`⚠️ [${tickId}] EMPTY_MESSAGE_FROM_LLM`, { reason: decision?.reason });
    return { ok: false, shouldMessage: true, error: 'EMPTY_MESSAGE_FROM_LLM', reason: decision.reason };
  }

  // deliver
  if (deliverFn) {
    try {
      console.log(`📤 [${tickId}] deliverFn CALLING...`);
      await deliverFn({
        userId,
        text,
        meta: {
          proactive: true,
          tone: decision.tone,
          length: decision.length,
          reason: decision.reason,
        },
      });
      console.log(`✅ [${tickId}] deliverFn DONE`);
    } catch (e) {
      console.log(`❌ [${tickId}] deliverFn ERROR`, e?.message || e);
      // deliver xato bo‘lsa ham cooldown yozishni xohlasang: davom ettiramiz.
      // Agar deliver bo‘lmasa cooldown yozilmasin desang: return qilib yuboramiz.
      // Hozircha davom ettiraman (minimal invasive).
    }
  } else {
    console.log(`⚠️ [${tickId}] deliverFn MISSING -> message not pushed to UI`);
  }

  // persist cooldown state
  const isoNow = new Date(now).toISOString();

  try {
    await prisma.fact.create({
      data: { userId, key: 'proactive_last_ping_at', value: isoNow, type: 'state' },
    });
    console.log(`💾 [${tickId}] fact saved: proactive_last_ping_at`, isoNow);
  } catch (e) {
    console.log(`❌ [${tickId}] fact save ERROR (proactive_last_ping_at)`, e?.message || e);
  }

  // daily count
  let countFact;
  try {
    countFact = await prisma.fact.findFirst({
      where: { userId, key: 'proactive_ping_count_day' },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, value: true, updatedAt: true },
    });

    console.log(`🔢 [${tickId}] countFact loaded`, {
      exists: Boolean(countFact),
      value: countFact?.value,
      updatedAt: countFact?.updatedAt ? new Date(countFact.updatedAt).toISOString() : null,
    });
  } catch (e) {
    console.log(`❌ [${tickId}] countFact load ERROR`, e?.message || e);
  }

  let nextCount = 1;
  if (countFact?.updatedAt) {
    const sameDay =
      countFact.updatedAt.getUTCFullYear() === now.getUTCFullYear() &&
      countFact.updatedAt.getUTCMonth() === now.getUTCMonth() &&
      countFact.updatedAt.getUTCDate() === now.getUTCDate();

    nextCount = sameDay ? Number(countFact.value || 0) + 1 : 1;
  }

  try {
    await prisma.fact.create({
      data: { userId, key: 'proactive_ping_count_day', value: String(nextCount), type: 'state' },
    });
    console.log(`💾 [${tickId}] fact saved: proactive_ping_count_day`, nextCount);
  } catch (e) {
    console.log(`❌ [${tickId}] fact save ERROR (proactive_ping_count_day)`, e?.message || e);
  }

  console.log(`🏁 [${tickId}] DONE in ${Date.now() - t0}ms`);

  return {
    ok: true,
    shouldMessage: true,
    reason: decision.reason,
    tone: decision.tone,
    length: decision.length,
    message: text,
  };
}

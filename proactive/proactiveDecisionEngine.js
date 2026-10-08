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
  onDecision, // ✅ FIX: async ({ decision, signals }) => void — called right after
              // decideProactive() resolves, regardless of shouldMessage. Added
              // because proactiveRunner.js's runBoundaryAwareProactiveOnce()
              // already calls this function passing onDecision, relying on it
              // to capture latestDecision/latestSignals for its own LAB6
              // boundary-aware delivery logic and event logging — but this
              // parameter never existed, so that whole hand-off was silently
              // doing nothing (no crash — onDecision just isn't a param here,
              // so passing it was a no-op) and latestDecision stayed null
              // forever, permanently blocking the "normal" proactive path
              // (runner's step 6: `if (latestDecision?.shouldMessage)`).
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

  // ✅ FIX: fire onDecision as soon as we have decision+signals, before the
  // shouldMessage branch below — the runner needs this regardless of
  // whether this function's own deliverFn path ends up doing anything.
  if (onDecision) {
    try {
      await onDecision({ decision, signals });
    } catch (e) {
      console.log(`❌ [${tickId}] onDecision ERROR`, e?.message || e);
    }
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

  // ✅ FIX: cooldown/daily-cap facts (proactive_last_ping_at,
  // proactive_ping_count_day) are now written by proactiveRunner.js, only
  // at its actual delivery points (permission/soft_presence/normal paths),
  // not here — this function's deliverFn is always a no-op in the real
  // wiring (LAB6 intercepts real delivery), so writing cooldown state here
  // meant it fired on every shouldMessage=true regardless of whether LAB6
  // later suppressed the message via respect mode. Per decision: the
  // cooldown/cap budget should only be spent on messages that actually
  // reach the user.

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
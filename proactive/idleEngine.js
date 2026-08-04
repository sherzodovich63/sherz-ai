// proactive/idleEngine.js
// ─────────────────────────────────────────────────────────────────────────────
// SHERZ AI — Proactive Idle Engine
//
// SHERZ checks in on users who have gone quiet for a while.
// It reads emotional baseline, time of day, and last activity,
// then asks GPT to decide whether to say something — and what.
//
// Architecture:
//   • Exported as startIdleEngine() — wired once into startProactiveRunner()
//   • Runs on setInterval every TICK_MINUTES (default 5)
//   • Only fires for users with an open SSE connection (frontend is visible)
//   • GPT decides whether to speak at all — usually stays silent
//   • When it speaks: SSE push → frontend plays via existing speak() in script.js
//   • Rate-limited: MAX one message per user per MIN_INTERVAL_MINUTES
//   • Respects proactiveMuteUntil from UserProactivePolicy
// ─────────────────────────────────────────────────────────────────────────────

import { openai }         from '../llm/openaiClient.js';
import { ssePushToUser }  from '../realtime/sseHub.js';
import dayjs              from 'dayjs';
import utc                from 'dayjs/plugin/utc.js';
import tz                 from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(tz);

// ── Tuneable constants ───────────────────────────────────────────────────────
const IDLE_THRESHOLD_MINUTES = 25;   // user quiet for this long → check-in candidate
const MIN_INTERVAL_MINUTES   = 40;   // min gap between two proactive messages per user
const TICK_MINUTES           = 5;    // scan frequency
const MAX_PROACTIVE_CHARS    = 200;  // keep messages short and human
const DEFAULT_TZ             = 'Asia/Tashkent';

// ── Time context ─────────────────────────────────────────────────────────────
function getTimeContext(timezone = DEFAULT_TZ) {
  const now  = dayjs().tz(timezone);
  const hour = now.hour();
  const day  = now.day();
  let period;
  if      (hour >= 5  && hour < 12) period = 'morning';
  else if (hour >= 12 && hour < 18) period = 'afternoon';
  else if (hour >= 18 && hour < 22) period = 'evening';
  else                               period = 'late_night';
  return {
    hour, period,
    isWeekend: day === 0 || day === 6,
    label: `${now.format('dddd')} soat ${now.format('HH:mm')}`,
  };
}

// ── SSE payload ──────────────────────────────────────────────────────────────
function buildSsePayload(text, tone = 'warm') {
  return JSON.stringify({
    role: 'assistant', content: text,
    proactive: true, tone, ts: Date.now(),
  });
}

// ── GPT decides whether and what to say ─────────────────────────────────────
async function generateProactiveMessage({ baselineTone, toneState, timeCtx, idleMinutes }) {
  const restrictive = toneState === 'guarded' || toneState === 'direct';

  const prompt = `Sen SHERZ — foydalanuvchining sun'iy intellekt do'sti.
Hozir foydalanuvchi ${idleMinutes} daqiqadan beri jim.
Vaqt: ${timeCtx.label}. Davr: ${timeCtx.period}.${timeCtx.period === 'late_night' ? ' Kechasi juda kech!' : ''}
Foydalanuvchi uslubi: ${baselineTone || 'unknown'}. Hozirgi ton: ${toneState || 'warm'}.
${restrictive ? 'DIQQAT: Foydalanuvchi hozir biroz sovuq. Qisqa va professional bo\'l.' : ''}

Qoida: Ko'p hollarda jim turish to'g'ri. Faqat HAQIQATAN kerak bo'lsa gapir.
- late_night + uzoq jimlik → muloyim tekshir (charchadimi?)
- afternoon + ish kuni + 60 daqiqadan kam → GAPIRMA
- evening/morning + 30+ daqiqa → engil, qisqa so'ra
- Hech qachon reklama yoki uzoq gap aytma

JSON formatida javob: {"speak": true/false, "text": "...", "tone": "warm|gentle|professional"}
Faqat JSON.`;

  try {
    const response = await openai.chat.completions.create({
      model:           process.env.SHERZ_BRAIN_MODEL || 'gpt-4.1-mini',
      messages:        [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature:     0.65,
      max_tokens:      100,
    });

    const raw    = response?.choices?.[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.speak) return null;
    const text = String(parsed.text || '').slice(0, MAX_PROACTIVE_CHARS).trim();
    if (!text) return null;
    return { text, tone: parsed.tone || 'warm' };
  } catch (err) {
    console.warn('[idleEngine] GPT failed:', err.message);
    return null;
  }
}

// ── Per-user check ────────────────────────────────────────────────────────────
async function checkUser({ prisma, userId, timezone }) {
  try {
    const now = new Date();

    // Load profile + policy
    const [profile, policy] = await Promise.all([
      prisma.userProfile.findUnique({
        where:  { userId },
        select: { baselineTone: true, toneState: true, baselineConfidence: true },
      }),
      prisma.userProactivePolicy.findUnique({
        where:  { userId },
        select: { enabled: true, proactiveMuteUntil: true, lastProactiveAt: true },
      }),
    ]);

    // Hard gates
    if (policy && !policy.enabled)                                  return;
    if (policy?.proactiveMuteUntil && policy.proactiveMuteUntil > now) return;

    // Rate limit
    if (policy?.lastProactiveAt) {
      const minsAgo = (now - new Date(policy.lastProactiveAt)) / 60000;
      if (minsAgo < MIN_INTERVAL_MINUTES) return;
    }

    // Idle check
    const lastMsg = await prisma.message.findFirst({
      where:   { userId },
      orderBy: { createdAt: 'desc' },
      select:  { createdAt: true },
    });

    const idleMinutes = lastMsg
      ? (now - new Date(lastMsg.createdAt)) / 60000
      : 999;

    if (idleMinutes < IDLE_THRESHOLD_MINUTES) return;

    const timeCtx      = getTimeContext(timezone);
    const toneState    = profile?.toneState    ?? 'warm';
    const baselineTone = profile?.baselineTone ?? 'unknown';

    // Don't interrupt afternoon work-hours unless very idle
    if (timeCtx.period === 'afternoon' && !timeCtx.isWeekend && idleMinutes < 60) return;

    // GPT decision
    const decision = await generateProactiveMessage({
      baselineTone, toneState, timeCtx,
      idleMinutes: Math.round(idleMinutes),
    });
    if (!decision) return;

    // Push via SSE — returns false if user has no open connection
    // idleEngine.js — find this line in checkUser():

    // WITH:
const pushed = ssePushToUser(userId, 'message', JSON.stringify({
  role: 'assistant',
  content: decision.text,
  meta: { proactive: true, tone: decision.tone },
  ts: Date.now(),
}));
    if (!pushed) return; // tab is closed — don't update lastProactiveAt

    // Update rate-limit timestamp
    await prisma.userProactivePolicy.upsert({
      where:  { userId },
      update: { lastProactiveAt: now },
      create: { userId, lastProactiveAt: now, enabled: true },
    });

    // Log ActivitySignal (non-fatal)
    prisma.activitySignal.create({
      data: {
        userId, kind: 'proactive_initiated', occurredAt: now,
        metadata: { idleMinutes: Math.round(idleMinutes), period: timeCtx.period, toneState },
      },
    }).catch(() => {});

    console.log(`[idleEngine] ✅ sent to ${userId} (idle=${Math.round(idleMinutes)}m, ${timeCtx.period}, tone=${decision.tone})`);

  } catch (err) {
    console.error(`[idleEngine] checkUser(${userId}):`, err.message);
  }
}

// ── Scan all active users ────────────────────────────────────────────────────
async function runScan({ prisma, timezone, getActiveUserIds }) {
  try {
    const userIds = typeof getActiveUserIds === 'function' ? getActiveUserIds() : [];
    if (!userIds.length) return;

    // Process in batches of 3 to avoid hammering GPT
    for (let i = 0; i < userIds.length; i += 3) {
      await Promise.allSettled(
        userIds.slice(i, i + 3).map(uid => checkUser({ prisma, userId: uid, timezone }))
      );
    }
  } catch (err) {
    console.error('[idleEngine] runScan:', err.message);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Start the idle engine. Call this once from startProactiveRunner().
 *
 * @param {object}   prisma
 * @param {string}   timezone           — 'Asia/Tashkent'
 * @param {Function} getActiveUserIds   — () => string[] of userIds with open SSE
 * @returns {Function}                  — stop() function for graceful shutdown
 */
export function startIdleEngine({ prisma, timezone = DEFAULT_TZ, getActiveUserIds }) {
  console.log(`[idleEngine] started — idle=${IDLE_THRESHOLD_MINUTES}m, interval=${MIN_INTERVAL_MINUTES}m, tick=${TICK_MINUTES}m`);

  const args = { prisma, timezone, getActiveUserIds };

  // Fire once at startup (catches users already idle when server restarts)
  setTimeout(() => runScan(args), 10_000);

  const handle = setInterval(() => runScan(args), TICK_MINUTES * 60 * 1000);
  return () => { clearInterval(handle); console.log('[idleEngine] stopped'); };
}
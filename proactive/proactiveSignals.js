import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import tz from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(tz);

const DEFAULT_TZ = process.env.SHERZ_DEFAULT_TZ || 'Asia/Tashkent';

// ✅ NEW: interactionStore (touchInteraction yozgan timestampni olish)
let getLastInteraction = null;
try {
  const mod = await import('../memory/interactionStore.js');
  if (typeof mod.getLastInteraction === 'function') {
    getLastInteraction = mod.getLastInteraction;
  }
} catch {}

/**
 * ✅ Last interaction timestamp:
 * Priority:
 *  1) interactionStore (touchInteraction)
 *  2) prisma.message (role='user')
 *  3) prisma.chatMessage (role='user') [fallback]
 *  4) prisma.fact key='last_interaction_at' [legacy fallback]
 */
async function getLastInteractionAt({ userId, prisma }) {
  // 1) interactionStore (RAM)
  try {
    if (getLastInteraction) {
      const ts = getLastInteraction(userId); // number (ms) bo‘lishi kerak
      if (ts && Number.isFinite(ts)) return new Date(ts);
    }
  } catch {}

  // 2) prisma.message (SENDA BOR)
  try {
    if (prisma?.message?.findFirst) {
      const last = await prisma.message.findFirst({
        where: { userId, role: 'user' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      if (last?.createdAt) return last.createdAt;
    }
  } catch {}

  // 3) prisma.chatMessage fallback
  try {
    if (prisma?.chatMessage?.findFirst) {
      const last = await prisma.chatMessage.findFirst({
        where: { userId, role: 'user' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      if (last?.createdAt) return last.createdAt;
    }
  } catch {}

  // 4) Fact fallback (agar fact modeli bor bo‘lsa)
  try {
    if (prisma?.fact?.findFirst) {
      const fact = await prisma.fact.findFirst({
        where: { userId, key: 'last_interaction_at' },
        orderBy: { updatedAt: 'desc' },
        select: { value: true },
      });

      const iso = fact?.value;
      if (!iso) return null;

      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  } catch {}

  return null;
}

async function getLastState({ userId, prisma }) {
  try {
    if (!prisma?.fact?.findFirst) return { value: null, updatedAt: null };

    const fact = await prisma.fact.findFirst({
      where: { userId, key: 'last_state' },
      orderBy: { updatedAt: 'desc' },
      select: { value: true, updatedAt: true },
    });

    return {
      value: fact?.value || null,
      updatedAt: fact?.updatedAt || null,
    };
  } catch {
    return { value: null, updatedAt: null };
  }
}

/**
 * ProfileSummary v2 sizda tayyor:
 * ../memory/profileSummary.js -> getProfileSummaryV2({ userId, prisma })
 */
async function getProfileSummary({ userId, prisma }) {
  const mod = await import('../memory/profileSummary.js');
  if (!mod.getProfileSummaryV2) {
    throw new Error('getProfileSummaryV2 export topilmadi (../memory/profileSummary.js)');
  }
  return await mod.getProfileSummaryV2({ userId, prisma });
}

function getLocalTimeMeta({ now = new Date(), timezone = DEFAULT_TZ }) {
  const t = dayjs(now).tz(timezone);
  return {
    timezone,
    iso: t.toISOString(),
    hour: t.hour(),
    dow: t.day(), // 0=Sunday
    isNight: t.hour() >= 23 || t.hour() < 7,
  };
}

function minutesSince(date, now = new Date()) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / 60000));
}

export async function collectSignals({ userId, prisma, now = new Date(), timezone }) {
  const [profile, lastState, lastInteractionAt] = await Promise.all([
    getProfileSummary({ userId, prisma }).catch(() => null),
    getLastState({ userId, prisma }),
    getLastInteractionAt({ userId, prisma }),
  ]);

  const time = getLocalTimeMeta({ now, timezone: timezone || DEFAULT_TZ });
  const idleMin = minutesSince(lastInteractionAt, now);

  return {
    now,
    time,
    idleMin, // ✅ endi null bo‘lib qolmasligi kerak (user yozgan bo‘lsa)
    lastInteractionAt,
    last_state: lastState.value,
    last_state_updatedAt: lastState.updatedAt,
    profile,
  };
}

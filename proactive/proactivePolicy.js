/**
 * Proactive policy:
 * - Quiet hours (default 23:00–07:00) => NO (faqat emergency bo‘lsa)
 * - Cooldown: oxirgi proactive pingdan keyin kamida 90 min (config)
 * - Idle-based: user uzoq bo‘lsa (>= 180 min) => tekshir
 * - Emotion trend: stress/high negative => supportive check-in
 * - Goals/habits: agar ma’lum “goal/habit” bo‘lsa, yumshoq reminder (spamy emas)
 *
 * ✅ LAB5 qo‘shimcha:
 * - DB'dagi UserProactivePolicy (cooldownMinutes, maxPerDay, toneWeights, hourPenalty, blockedHours)
 * - hourPenalty katta bo‘lsa: yozmaydi (time penalty)
 * - toneWeights bo‘lsa: tone tanlashda weight hisobga olinadi
 */

const DEFAULTS = {
  quietHours: { start: 23, end: 7 },
  cooldownMin: 90,
  minIdleToPingMin: 120,
  hardIdleMin: 360,
  maxPingsPerDay: 10,
};

function inQuietHours(hour, quietHours) {
  const { start, end } = quietHours;
  // 23..24 or 0..7
  if (start > end) return hour >= start || hour < end;
  return hour >= start && hour < end;
}

function parseEmotionTrend(profile) {
  const t = profile?.emotionTrend7d || profile?.emotionTrend || null;
  return {
    dominant: t?.dominant || null,
    avg: typeof t?.avg === 'number' ? t.avg : null,
    volatility: typeof t?.volatility === 'number' ? t.volatility : null,
    stressFlag: Boolean(t?.stressFlag || t?.dominant === 'stressed'),
  };
}

// ✅ NEW: interprets signals.relationshipToneState into a simple boolean.

function parseRelationshipToneSignal(signals) {
  const rt = signals.relationshipToneState;
  const empty = { current: null, isGuarded: false, isDirect: false, minutesSinceShift: null, trigger: null };
  if (!rt || !rt.current) return empty;

  const state = String(rt.current).toLowerCase();
  const mins = rt.minutesSinceShift;
  const inWindow = mins != null && mins >= 45 && mins <= 1440;

  return {
    current: rt.current,
    isGuarded: inWindow && state === 'guarded',
    isDirect: inWindow && state === 'direct',
    minutesSinceShift: mins,
    trigger: rt.trigger,
  };
}

/** ✅ LAB5: DB policy o‘qish (bo‘lmasa null) */
async function getAdaptivePolicy(prisma, userId) {
  try {
    // Prisma model nomi: userProactivePolicy (schema’dagi nomga mos bo‘lishi kerak)
    // Agar sendagi model boshqa nom bo‘lsa, shu yerini moslab qo‘yamiz.
    const row = await prisma.userProactivePolicy?.findUnique?.({
      where: { userId },
      select: {
        cooldownMinutes: true,
        maxPerDay: true,
        toneWeights: true,
        hourPenalty: true,
        blockedHours: true,
        updatedAt: true,
      },
    });

    return row || null;
  } catch (e) {
    // Model hali migrate bo‘lmagan bo‘lsa ham LAB4 ishlashda davom etsin:
    return null;
  }
}

/** ✅ LAB5: blocked hours tekshirish (policy.blockedHours) */
function isBlockedHour(hour, blockedHours) {
  if (!blockedHours) return false;
  // blockedHours: [0,1,2] yoki {"0":true} kabi bo‘lishi mumkin
  if (Array.isArray(blockedHours)) return blockedHours.includes(hour);
  if (typeof blockedHours === 'object') return Boolean(blockedHours[String(hour)]);
  return false;
}

/** ✅ LAB5: hour penalty olish */
function getHourPenalty(hour, hourPenalty) {
  if (!hourPenalty) return 1.0;
  if (typeof hourPenalty === 'object') {
    const v = Number(hourPenalty[String(hour)]);
    return Number.isFinite(v) ? v : 1.0;
  }
  return 1.0;
}

function toneFromSignals({ profile, emotion }) {
  const pref = profile?.preferredTone || null; // "direct" | "supportive" | "playful"
  if (emotion.stressFlag || emotion.dominant === 'sad' || emotion.relationshipGuarded) return 'supportive';
  if (emotion.dominant === 'happy') return pref || 'playful';
  return pref || 'direct';
}

/** ✅ LAB5: toneWeights bilan tone tanlash */
function pickToneWithWeights(baseTone, emotion, toneWeights) {
  // Stress bo‘lsa supportive har doim 1-o‘rinda qoladi (oldingi logikaga zarar bermaymiz)
  if (emotion?.stressFlag || emotion?.dominant === 'sad' || emotion?.relationshipGuarded) return 'supportive';

  if (!toneWeights || typeof toneWeights !== 'object') return baseTone;

  // Agar baseTone weight yaxshi bo‘lsa, shu qoladi. Aks holda best tone tanlaymiz.
  const baseW = Number(toneWeights[baseTone]);
  let bestTone = baseTone;
  let bestW = Number.isFinite(baseW) ? baseW : -Infinity;

  for (const [t, w] of Object.entries(toneWeights)) {
    const nw = Number(w);
    if (Number.isFinite(nw) && nw > bestW) {
      bestW = nw;
      bestTone = t;
    }
  }

  return bestTone || baseTone;
}

function lengthFromSignals({ idleMin, emotion }) {
  if (emotion.stressFlag || emotion.relationshipGuarded) return 'short';
  if (idleMin != null && idleMin >= 360) return 'medium';
  return 'short';
}

export async function decideProactive({ userId, prisma, signals, config = {} }) {
  const cfg = { ...DEFAULTS, ...config };

  // ✅ LAB5: user policy ni olib kelamiz (bo‘lsa)
  const adaptive = await getAdaptivePolicy(prisma, userId);

  // ✅ LAB5: cooldown & maxPerDay override (agar policy bo‘lsa)
  const cooldownMin =
    adaptive?.cooldownMinutes != null ? Number(adaptive.cooldownMinutes) : cfg.cooldownMin;

  const maxPingsPerDay =
    adaptive?.maxPerDay != null ? Number(adaptive.maxPerDay) : cfg.maxPingsPerDay;

  // --- cooldown & daily rate limit state (fact orqali)
  const [lastPingFact, dayCountFact] = await Promise.all([
    prisma.fact.findFirst({
      where: { userId, key: 'proactive_last_ping_at' },
      orderBy: { updatedAt: 'desc' },
      select: { value: true },
    }),
    prisma.fact.findFirst({
      where: { userId, key: 'proactive_ping_count_day' },
      orderBy: { updatedAt: 'desc' },
      select: { value: true, updatedAt: true },
    }),
  ]);

  const now = signals.now;
  const lastPingAt = lastPingFact?.value ? new Date(lastPingFact.value) : null;
  const sinceLastPingMin = lastPingAt ? Math.floor((now - lastPingAt) / 60000) : null;

  // daily count reset (oddiy)
  let dayCount = 0;
  if (dayCountFact?.value) {
    const lastCountDay = dayCountFact.updatedAt ? new Date(dayCountFact.updatedAt) : null;
    const sameDay =
      lastCountDay &&
      lastCountDay.getUTCFullYear() === now.getUTCFullYear() &&
      lastCountDay.getUTCMonth() === now.getUTCMonth() &&
      lastCountDay.getUTCDate() === now.getUTCDate();
    dayCount = sameDay ? Number(dayCountFact.value || 0) : 0;
  }

  // --- quiet hours
  const isQuiet = inQuietHours(signals.time.hour, cfg.quietHours);

  // ✅ LAB5: blockedHours (policy) — kuchli “yozma” qoidasi
  const blocked = isBlockedHour(signals.time.hour, adaptive?.blockedHours);

  // ✅ LAB5: hour penalty (time penalty)
  const hourPenalty = getHourPenalty(signals.time.hour, adaptive?.hourPenalty);

  // --- emotion trend
  const emotion = parseEmotionTrend(signals.profile);
  
  // ✅ NEW: fold relationship-tone signal into `emotion`
  const relTone = parseRelationshipToneSignal(signals);
  emotion.relationshipGuarded = relTone.isGuarded || relTone.isDirect;

  // --- rules/score
  const reasons = [];
  let score = 0;
  // --- idle time signal (activity)
  if (signals.idleMin != null) {
  if (signals.idleMin >= 60) {
    score += 2;
    reasons.push(`Idle ${signals.idleMin}min >= 60.`);
  } else if (signals.idleMin >= 30) {
    score += 1;
    reasons.push(`Idle ${signals.idleMin}min >= 30.`);
  }
}

// ✅ NEW: standing guarded/direct tone that hasn't naturally recovered —
// weighted similarly to "long idle", less than an active stress trend
if (emotion.relationshipGuarded) {
  score += 2;
  reasons.push(`Relationship tone still ${relTone.current} after ${relTone.minutesSinceShift}m (trigger: ${relTone.trigger || 'unknown'}).`);
}

// ✅ NEW: rhythm-gap from ActivitySignal — only counts alongside the
// existing idle signal (deliberately conservative; a bounded histogram is
// noisier than a direct idle timestamp, so it corroborates rather than
// triggers independently)
if (signals.activity?.typicalHour != null && signals.activity.typicalHourConfidence >= 0.3) {
  const rawDiff = Math.abs(signals.time.hour - signals.activity.typicalHour);
  const hourDiff = Math.min(rawDiff, 24 - rawDiff); // wrap around midnight
  const nearTypicalHour = hourDiff <= 1;
  if (nearTypicalHour && signals.idleMin != null && signals.idleMin >= 60) {
    score += 1;
    reasons.push(`Near typical activity hour (${signals.activity.typicalHour}) but idle ${signals.idleMin}m.`);
  }
}

  // if (signals.idleMin == null) {
//   reasons.push('No interaction timestamp; staying silent.');
//   return { shouldMessage: false, reason: reasons.join(' ') };
// }

  // ✅ LAB5: hard time-block (blockedHours)
  if (blocked && !emotion.stressFlag) {
    return {
      shouldMessage: false,
      reason: `Blocked hour (${signals.time.hour}); no urgent emotional signal.`,
    };
  }

  // ✅ LAB5: time penalty katta bo‘lsa yozmaymiz (stress bo‘lsa bypass)
  if (hourPenalty >= 1.4 && !emotion.stressFlag) {
    return {
      shouldMessage: false,
      reason: `Time penalty active (hour=${signals.time.hour}, p=${hourPenalty}).`,
    };
  }

  // spam guard
  if (dayCount >= maxPingsPerDay) {
    return { shouldMessage: false, reason: `Daily cap reached (${dayCount}/${maxPingsPerDay}).` };
  }

  if (sinceLastPingMin != null && sinceLastPingMin < cooldownMin) {
    return { shouldMessage: false, reason: `Cooldown active (${sinceLastPingMin}m < ${cooldownMin}m).` };
  }

  if (isQuiet && !emotion.stressFlag) {
    return { shouldMessage: false, reason: 'Quiet hours; no urgent emotional signal.' };
  }

  // activity
  if (signals.idleMin >= cfg.minIdleToPingMin) {
    score += 2;
    reasons.push(`User idle ${signals.idleMin}m.`);
  }
  if (signals.idleMin >= cfg.hardIdleMin) {
    score += 2;
    reasons.push(`Long idle ${signals.idleMin}m.`);
  }

  // emotion
  if (emotion.stressFlag) {
    score += 3;
    reasons.push('Stress trend detected (7d).');
  }

  // last_state nudge
  const ls = (signals.last_state || '').toLowerCase();
  if (ls.includes('continue') || ls.includes('todo') || ls.includes('goal')) {
    score += 1;
    reasons.push('Last_state suggests unfinished thread.');
  }

  // time-of-day bias
  if (!isQuiet && signals.time.hour >= 18 && signals.time.hour <= 22) {
    score += 1;
    reasons.push('Evening check-in window.');
  }

  // ✅ LAB5: hourPenalty score’ga ham ta’sir qilsin (soft penalty)
  // (p=1.0 -> 0, p=1.3 -> -1, p=1.6 -> -2)
  if (!emotion.stressFlag && hourPenalty > 1.0) {
    const penaltyPoints = Math.min(2, Math.floor((hourPenalty - 1.0) / 0.25));
    if (penaltyPoints > 0) {
      score -= penaltyPoints;
      reasons.push(`Hour penalty applied (-${penaltyPoints}, p=${hourPenalty}).`);
    }
  }

  const shouldMessage = score >= 1;

  if (!shouldMessage) {
    return { shouldMessage: false, reason: `Score ${score}/>=3. ${reasons.join(' ')}` };
  }

  // tone/length
  const baseTone = toneFromSignals({ profile: signals.profile, emotion });

  // ✅ LAB5: toneWeights (adaptive) bilan final tone
  const tone = pickToneWithWeights(baseTone, emotion, adaptive?.toneWeights);

  const length = lengthFromSignals({ idleMin: signals.idleMin, emotion });

  // ✅ LAB5: policy snapshot ham qaytaramiz (runner/log uchun foydali)
  return {
    shouldMessage: true,
    reason: `Score ${score}. ${reasons.join(' ')}`,
    tone,
    length,
    emotion,
    policy: adaptive
      ? {
          cooldownMinutes: adaptive.cooldownMinutes ?? null,
          maxPerDay: adaptive.maxPerDay ?? null,
          hourPenalty,
          blockedHour: blocked,
        }
      : null,
  };
}
/**
 * ✅ Recompute and persist a user's adaptive proactive policy.
 * Called from chatRoute.js after a user replies to a proactive ping,
 * so cooldown/maxPerDay/toneWeights can adapt based on recent feedback.
 */
export async function recomputeUserProactivePolicy({ prisma, userId }) {
  try {
    const existing = await prisma.userProactivePolicy?.findUnique?.({
      where: { userId },
    });

    // If no row exists yet, create a baseline policy using DEFAULTS
    if (!existing) {
      await prisma.userProactivePolicy?.create?.({
        data: {
          userId,
          cooldownMinutes: DEFAULTS.cooldownMin,
          maxPerDay: DEFAULTS.maxPingsPerDay,
          toneWeights: {},
          hourPenalty: {},
          blockedHours: [],
        },
      });
      return { updated: true, created: true };
    }

    // Policy already exists — for now this is a no-op pass-through.
    // Plug in real adaptive logic here later (e.g. widen cooldown
    // if user keeps ignoring proactive pings, narrow it if they
    // reply quickly and positively).
    await prisma.userProactivePolicy?.update?.({
      where: { userId },
      data: { updatedAt: new Date() },
    });

    return { updated: true, created: false };
  } catch (e) {
    // Model not migrated yet or DB error — don't crash the chat flow
    return { updated: false, error: e?.message || String(e) };
  }
}
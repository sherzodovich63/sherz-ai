// proactive/relationshipTone.js
//
// Built from the real ToneEvent model in schema.prisma — trigger /
// fromState / toState / messageRef / createdAt, an append-only log of
// state TRANSITIONS, not a stored "current tone" column. "Current"
// relationship tone is derived as the toState of the most recent
// ToneEvent row.
//
// ✅ FIX: field names below were renamed to match the real consumer,
// proactivePolicy.js's parseRelationshipToneSignal(), now that it's been
// seen directly — this file's original header flagged these as an
// unverified guess pending that file. The real contract reads:
// rt.current, rt.minutesSinceShift, rt.trigger (checking rt.current
// against the literal strings 'guarded'/'direct'). Previously this
// returned currentState/sinceMinutes/lastTrigger, which meant
// parseRelationshipToneSignal()'s `if (!rt || !rt.current) return empty`
// guard was always true — the whole signal was silently discarded on
// every proactive tick, no crash, just permanently inert.
//
// Also async (queries Prisma) — the caller MUST `await` it.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// trigger values per schema.prisma's ToneEvent comment:
// "harsh_language" | "tension_dissolved" | "manual_reset" | "decay_timeout"
const NEGATIVE_TRIGGERS = new Set(['harsh_language']);
const RECOVERY_TRIGGERS = new Set(['tension_dissolved', 'manual_reset']);

/**
 * Summarizes a user's recent ToneEvent rows for the proactive engine's
 * relationship-tone scoring (e.g. "are we currently in a guarded/direct
 * state, and for how long").
 * @param {object} params
 * @param {string} params.userId
 * @param {import('@prisma/client').PrismaClient} [params.prisma] — reuses
 *   the caller's Prisma client if given, falls back to this module's own
 *   instance otherwise.
 * @param {Date} [params.now]
 * @param {number} [params.lookbackDays=14] how far back to count
 *   negative/recovery triggers for the recent-window counts
 * @returns {Promise<{
 *   current: string|null,
 *   trigger: string|null,
 *   lastEventAt: Date|null,
 *   minutesSinceShift: number|null,
 *   recentNegativeCount: number,
 *   recentRecoveryCount: number
 * }>}
 */
export async function getRelationshipToneSignal({ userId, prisma: prismaArg, now = new Date(), lookbackDays = 14 } = {}) {
  const db = prismaArg || prisma;
  const empty = {
    current: null,
    trigger: null,
    lastEventAt: null,
    minutesSinceShift: null,
    recentNegativeCount: 0,
    recentRecoveryCount: 0,
  };

  if (!userId || !db?.toneEvent) return empty;

  try {
    const since = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

    const [latest, recentEvents] = await Promise.all([
      db.toneEvent.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }),
      db.toneEvent.findMany({
        where: { userId, createdAt: { gte: since } },
        select: { trigger: true },
      }),
    ]);

    if (!latest) return empty;

    const minutesSinceShift = Math.max(0, Math.round((now.getTime() - latest.createdAt.getTime()) / 60000));

    let recentNegativeCount = 0;
    let recentRecoveryCount = 0;
    for (const ev of recentEvents) {
      if (NEGATIVE_TRIGGERS.has(ev.trigger)) recentNegativeCount++;
      else if (RECOVERY_TRIGGERS.has(ev.trigger)) recentRecoveryCount++;
    }

    return {
      current: latest.toState,
      trigger: latest.trigger,
      lastEventAt: latest.createdAt,
      minutesSinceShift,
      recentNegativeCount,
      recentRecoveryCount,
    };
  } catch (err) {
    // Non-fatal — matches the try/catch-and-warn pattern already used in
    // activitySignal.js and throughout proactiveSignals.js. A failed tone
    // summary should never crash the proactive check-in cycle.
    console.warn('[getRelationshipToneSignal] failed (non-fatal):', err.message);
    return empty;
  }
}
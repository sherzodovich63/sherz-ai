// proactive/relationshipTone.js
//
// ⚠️ Built the same way activitySignal.js was: from the real ToneEvent
// model in schema.prisma — trigger / fromState / toState / messageRef /
// createdAt, an append-only log of state TRANSITIONS, not a stored
// "current tone" column. "Current" relationship tone is therefore derived
// as the toState of the most recent ToneEvent row, the standard way to
// read current state out of an event-sourced log.
//
// ⚠️ I do NOT have proactiveDecisionEngine.js / proactivePolicy.js (the
// actual consumers of collectSignals()'s relationshipToneState), so I
// cannot confirm the exact property names they expect back. The shape
// below is a reasonable, documented guess — mirroring activitySignal.js's
// own return-shape style (current value + how-long-since + recent-window
// counts) — not a verified contract. Check what the consumer actually
// destructures and adjust the field names below if they don't line up;
// this is the same caveat activitySignal.js's own header already flags.
//
// ⚠️ Also async (queries Prisma) — the caller MUST `await` it.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// trigger values per schema.prisma's ToneEvent comment:
// "harsh_language" | "tension_dissolved" | "manual_reset" | "decay_timeout"
const NEGATIVE_TRIGGERS = new Set(['harsh_language']);
const RECOVERY_TRIGGERS = new Set(['tension_dissolved', 'manual_reset']);

/**
 * Summarizes a user's recent ToneEvent rows for the proactive engine's
 * relationship-tone scoring (e.g. "are we currently in a tense state, and
 * for how long").
 * @param {object} params
 * @param {string} params.userId
 * @param {import('@prisma/client').PrismaClient} [params.prisma] — reuses
 *   the caller's Prisma client if given, falls back to this module's own
 *   instance otherwise.
 * @param {Date} [params.now]
 * @param {number} [params.lookbackDays=14] how far back to count
 *   negative/recovery triggers for the recent-window counts
 * @returns {Promise<{
 *   currentState: string|null,
 *   lastTrigger: string|null,
 *   lastEventAt: Date|null,
 *   sinceMinutes: number|null,
 *   recentNegativeCount: number,
 *   recentRecoveryCount: number
 * }>}
 */
export async function getRelationshipToneSignal({ userId, prisma: prismaArg, now = new Date(), lookbackDays = 14 } = {}) {
  const db = prismaArg || prisma;
  const empty = {
    currentState: null,
    lastTrigger: null,
    lastEventAt: null,
    sinceMinutes: null,
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

    const sinceMinutes = Math.max(0, Math.round((now.getTime() - latest.createdAt.getTime()) / 60000));

    let recentNegativeCount = 0;
    let recentRecoveryCount = 0;
    for (const ev of recentEvents) {
      if (NEGATIVE_TRIGGERS.has(ev.trigger)) recentNegativeCount++;
      else if (RECOVERY_TRIGGERS.has(ev.trigger)) recentRecoveryCount++;
    }

    return {
      currentState: latest.toState,
      lastTrigger: latest.trigger,
      lastEventAt: latest.createdAt,
      sinceMinutes,
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
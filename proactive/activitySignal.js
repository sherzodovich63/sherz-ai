// proactive/activitySignal.js
//
// ⚠️ Built from the ONE piece of hard evidence available: the confirmed
// write in server.js —
//   await prisma.activitySignal.create({ data: { userId, kind, metadata } })
// — which tells us the real model fields (userId, kind, metadata, plus the
// standard Prisma id/createdAt). I do NOT have proactiveSignals.js itself,
// so I cannot confirm the exact shape collectSignals() expects back from
// getActivitySignalSummary(). The property names below (lastSignalAt,
// signalCount, lastKind, sinceMinutes) are a reasonable guess for a
// "rhythm-gap detection" use case, not a verified contract — check what
// collectSignals() actually destructures and adjust the return shape below
// to match if the names don't line up.
//
// ⚠️ This is async (it queries Prisma) — the caller MUST `await` it, or
// `summary` will be a pending Promise instead of the object below, which
// would surface as a *different* bug (e.g. "summary.lastSignalAt is
// undefined") rather than this one.

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Summarizes a user's recent ActivitySignal rows for the proactive engine's
 * rhythm-gap detection (e.g. "how long since they last did something").
 * @param {string} userId
 * @param {number} [lookbackDays=14] how far back to consider signals
 * @returns {Promise<{
 *   lastSignalAt: Date|null,
 *   sinceMinutes: number|null,
 *   signalCount: number,
 *   lastKind: string|null,
 *   kinds: Record<string, number>
 * }>}
 */
export async function getActivitySignalSummary(userId, lookbackDays = 14) {
  if (!userId) {
    return { lastSignalAt: null, sinceMinutes: null, signalCount: 0, lastKind: null, kinds: {} };
  }

  try {
    const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

    const signals = await prisma.activitySignal.findMany({
      where: { userId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 200, // safety cap, same spirit as the /api/chat/history cap elsewhere
    });

    if (!signals.length) {
      return { lastSignalAt: null, sinceMinutes: null, signalCount: 0, lastKind: null, kinds: {} };
    }

    const kinds = {};
    for (const s of signals) {
      kinds[s.kind] = (kinds[s.kind] || 0) + 1;
    }

    const last = signals[0]; // most recent, since ordered desc
    const sinceMinutes = Math.round((Date.now() - last.createdAt.getTime()) / 60000);

    return {
      lastSignalAt: last.createdAt,
      sinceMinutes,
      signalCount: signals.length,
      lastKind: last.kind,
      kinds,
    };
  } catch (err) {
    // Non-fatal — matches the try/catch-and-warn pattern already used around
    // every other activitySignal call in server.js. A failed summary should
    // never crash the proactive check-in cycle.
    console.warn('[getActivitySignalSummary] failed (non-fatal):', err.message);
    return { lastSignalAt: null, sinceMinutes: null, signalCount: 0, lastKind: null, kinds: {} };
  }
}
// services/rateLimiter.js
// In-memory token bucket rate limiter — per-minute burst guard + daily cost cap

const minuteBuckets = new Map(); // userId -> { count, resetAt }
const dailyBuckets   = new Map(); // userId -> { count, resetAt }

const MINUTE_WINDOW_MS = 60_000;       // 1 minute
const MINUTE_MAX        = 12;           // burst guard

const DAY_WINDOW_MS    = 24 * 60 * 60_000; // 24 hours
const DAY_MAX           = 150;          // cost guardrail

function checkBucket(map, userId, windowMs, maxRequests) {
  const now = Date.now();
  let b = map.get(userId);

  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    map.set(userId, b);
  }

  b.count++;
  return {
    allowed: b.count <= maxRequests,
    remaining: Math.max(0, maxRequests - b.count),
    resetAt: b.resetAt,
  };
}

/**
 * Checks both the per-minute burst limit and the daily cost cap.
 * Returns { allowed, reason, resetAt } — reason is 'minute' | 'day' | null
 */
export function checkRateLimit(userId) {
  if (!userId) return { allowed: true, reason: null, resetAt: null };

  const minute = checkBucket(minuteBuckets, userId, MINUTE_WINDOW_MS, MINUTE_MAX);
  if (!minute.allowed) {
    return { allowed: false, reason: 'minute', resetAt: minute.resetAt };
  }

  const day = checkBucket(dailyBuckets, userId, DAY_WINDOW_MS, DAY_MAX);
  if (!day.allowed) {
    return { allowed: false, reason: 'day', resetAt: day.resetAt };
  }

  return { allowed: true, reason: null, resetAt: null };
}

/**
 * Optional: periodic cleanup so the Maps don't grow unbounded
 * with stale entries from users who never come back.
 * Call this once from server.js on an interval (e.g. every hour).
 */
export function cleanupRateLimitBuckets() {
  const now = Date.now();
  for (const [userId, b] of minuteBuckets) {
    if (now > b.resetAt) minuteBuckets.delete(userId);
  }
  for (const [userId, b] of dailyBuckets) {
    if (now > b.resetAt) dailyBuckets.delete(userId);
  }
}
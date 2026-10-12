// proactive/sendGuard.js
//
// Last-line send guard for proactive messages. Called from
// deliverProactiveToUser() in proactiveRunner.js — the single point where a
// proactive message can reach the user — so it covers EVERY branch
// (permission / soft_presence / normal) and both the tick loop and
// triggerProactiveEvent().
//
// Why it lives here and not in proactiveDecisionEngine.js: the engine's
// deliverFn is a no-op in the real wiring (LAB6 intercepts delivery), and the
// permission / soft_presence branches never look at the decision's cooldown at
// all. Only a check at the actual delivery point sees every send.
//
// Two independent layers, so one failing cannot reopen the loop:
//   1) in-memory per-user record (works even if every DB write is failing)
//   2) ProactiveEvent history (survives restarts)
// FAIL CLOSED: if the DB lookup throws, the send is skipped, not allowed.
//
// Rules (all tunable by env):
//   - empty text is never sent
//   - min gap between ANY two proactive messages to one user
//       PROACTIVE_MIN_GAP_MIN   (default 60 minutes)
//   - same normalized text, or same boundary intent (permission /
//     soft_presence), not repeated inside the dedupe window
//       PROACTIVE_DEDUPE_HOURS  (default 24 hours)

import crypto from 'node:crypto';

function envMs(name, def, unitMs) {
  const n = Number(process.env[name]);
  return (Number.isFinite(n) && n > 0 ? n : def) * unitMs;
}

const MIN_GAP_MS = envMs('PROACTIVE_MIN_GAP_MIN', 60, 60_000);
const DEDUPE_MS = envMs('PROACTIVE_DEDUPE_HOURS', 24, 3_600_000);
const PRUNE_ABOVE = 5000;

// ProactiveEvent.reason values the runner writes for the two boundary intents
// (base-schema field, so this works even if the LAB6 columns aren't migrated).
const INTENT_REASON = {
  permission: 'permission_check',
  soft_presence: 'soft_presence_mode',
};

// userId -> { lastAt, texts: Map(hash -> at), intents: Map(intent -> at) }
const mem = new Map();

export function normalizeProactiveText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[‘’ʻʼʹ`´]/g, "'") // Uzbek o‘/g‘ apostrophe variants
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function hashText(text) {
  return crypto.createHash('sha1').update(normalizeProactiveText(text)).digest('hex');
}

const deny = (reason) => ({ allow: false, reason });

export async function checkProactiveSend({ prisma, userId, text, intent = 'normal', now = new Date() }) {
  if (!normalizeProactiveText(text)) return deny('empty_text');

  const nowMs = new Date(now).getTime();
  const hash = hashText(text);
  const reasonKey = INTENT_REASON[intent] || null;

  // 1) in-memory layer
  const m = mem.get(userId);
  if (m) {
    if (nowMs - m.lastAt < MIN_GAP_MS) return deny('cooldown_mem');
    const tAt = m.texts.get(hash);
    if (tAt && nowMs - tAt < DEDUPE_MS) return deny('duplicate_text');
    if (reasonKey) {
      const iAt = m.intents.get(intent);
      if (iAt && nowMs - iAt < DEDUPE_MS) return deny('duplicate_intent');
    }
  }

  // 2) DB layer (only base ProactiveEvent fields: userId, delivered, sentAt, message, reason)
  if (prisma?.proactiveEvent?.findMany) {
    try {
      const since = new Date(nowMs - Math.max(DEDUPE_MS, MIN_GAP_MS));
      const rows = await prisma.proactiveEvent.findMany({
        where: { userId, delivered: true, sentAt: { gte: since } },
        orderBy: { sentAt: 'desc' },
        take: 25,
        select: { sentAt: true, message: true, reason: true },
      });
      for (const r of rows) {
        const at = r.sentAt ? new Date(r.sentAt).getTime() : 0;
        if (nowMs - at < MIN_GAP_MS) return deny('cooldown_db');
        if (nowMs - at < DEDUPE_MS) {
          if (r.message && hashText(r.message) === hash) return deny('duplicate_text');
          if (reasonKey && r.reason === reasonKey) return deny('duplicate_intent');
        }
      }
    } catch (e) {
      console.log('❌ sendGuard DB lookup failed -> failing closed:', e?.message || e);
      return deny('guard_error');
    }
  }

  return { allow: true, reason: 'ok' };
}

export function rememberProactiveSend({ userId, text, intent = 'normal', now = new Date() }) {
  const nowMs = new Date(now).getTime();

  if (mem.size > PRUNE_ABOVE) {
    for (const [k, v] of mem) if (nowMs - v.lastAt > DEDUPE_MS) mem.delete(k);
  }

  let m = mem.get(userId);
  if (!m) {
    m = { lastAt: 0, texts: new Map(), intents: new Map() };
    mem.set(userId, m);
  }
  m.lastAt = nowMs;
  m.texts.set(hashText(text), nowMs);
  if (INTENT_REASON[intent]) m.intents.set(intent, nowMs);

  for (const [h, at] of m.texts) if (nowMs - at > DEDUPE_MS) m.texts.delete(h);
}

export function _resetSendGuardForTests() {
  mem.clear();
}
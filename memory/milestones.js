// src/memory/milestones.js
// ✅ Conversational milestones — no points/badges/streak counters. SHERZ
// occasionally notices and warmly mentions a relationship milestone when the
// user asks about it, phrased by a small LLM call rather than a template so
// it doesn't read like an app notification.

import { openai } from '../llm/openaiClient.js';

const DAY_THRESHOLDS = [7, 30, 100, 365];
const MESSAGE_THRESHOLDS = [50, 100, 500, 1000, 5000];
const RECOVERY_RECENCY_MS = 7 * 24 * 3600 * 1000; // "recent" = within the last week

function pickHighestCrossedThreshold(value, thresholds) {
  let picked = null;
  for (const t of thresholds) {
    if (value >= t) picked = t;
  }
  return picked;
}

/**
 * Gathers the raw data a milestone decision is based on. No LLM calls here —
 * pure data aggregation, safe to call cheaply.
 */
export async function computeMilestones({ userId, prisma }) {
  const [earliestMsg, messageCount, toneEvents] = await Promise.all([
    prisma.message.findFirst({
      where: { userId, role: 'user' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
    prisma.message.count({ where: { userId, role: 'user' } }),
    prisma.toneEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: { fromState: true, toState: true, createdAt: true },
    }).catch(() => []),
  ]);

  const daysSinceStart = earliestMsg
    ? Math.max(0, Math.floor((Date.now() - earliestMsg.createdAt.getTime()) / 86400000))
    : 0;

  const roughPatches = toneEvents.filter(e => e.toState === 'guarded' || e.toState === 'direct').length;
  const recoveryEvents = toneEvents.filter(
    e => e.toState === 'warm' && (e.fromState === 'guarded' || e.fromState === 'direct')
  );

  const lastRecovery = recoveryEvents.length ? recoveryEvents[recoveryEvents.length - 1] : null;

  return {
    daysSinceStart,
    messageCount,
    roughPatches,
    recoveries: recoveryEvents.length,
    lastRecoveryAt: lastRecovery?.createdAt || null,
  };
}

/**
 * Picks ONE milestone to actually talk about — priority: a recent resilience
 * recovery > a longevity threshold just crossed > a message-count threshold
 * > a generic fallback (not treated as a "special moment").
 */
export function selectMilestone(data) {
  const { daysSinceStart, messageCount, roughPatches, recoveries, lastRecoveryAt } = data;

  const recentRecovery = lastRecoveryAt && (Date.now() - new Date(lastRecoveryAt).getTime()) <= RECOVERY_RECENCY_MS;
  if (recoveries >= 1 && recentRecovery) {
    return { tier: `resilience_${recoveries}`, kind: 'resilience', data: { recoveries, roughPatches } };
  }

  const dayTier = pickHighestCrossedThreshold(daysSinceStart, DAY_THRESHOLDS);
  if (dayTier) {
    return { tier: `days_${dayTier}`, kind: 'longevity_days', data: { daysSinceStart, dayTier } };
  }

  const msgTier = pickHighestCrossedThreshold(messageCount, MESSAGE_THRESHOLDS);
  if (msgTier) {
    return { tier: `messages_${msgTier}`, kind: 'longevity_messages', data: { messageCount, msgTier } };
  }

  return { tier: 'generic', kind: 'generic', data: { daysSinceStart, messageCount } };
}

async function wasTierAlreadyShown({ prisma, userId, tier }) {
  try {
    const fact = await prisma.fact.findFirst({ where: { userId, key: `milestone_shown:${tier}` } });
    return !!fact;
  } catch {
    return false;
  }
}

async function markTierShown({ prisma, userId, tier }) {
  try {
    await prisma.fact.create({
      data: { userId, key: `milestone_shown:${tier}`, value: new Date().toISOString(), type: 'state' },
    });
  } catch (e) {
    console.warn('[milestones] markTierShown failed (non-fatal):', e.message);
  }
}

function buildFactsForPrompt(milestone) {
  const { kind, data } = milestone;
  if (kind === 'resilience') {
    return `The user and SHERZ have had ${data.roughPatches} tense/guarded moment(s) in their conversation history, and found their way back to a warm tone ${data.recoveries} time(s), most recently within the last week.`;
  }
  if (kind === 'longevity_days') {
    return `The user has been talking with SHERZ for ${data.daysSinceStart} days now (just crossed the ${data.dayTier}-day mark).`;
  }
  if (kind === 'longevity_messages') {
    return `The user has exchanged ${data.messageCount} messages with SHERZ (just crossed the ${data.msgTier}-message mark).`;
  }
  return `The user has been talking with SHERZ for ${data.daysSinceStart} days and exchanged ${data.messageCount} messages so far — no specific milestone threshold crossed yet, just answer warmly and honestly.`;
}

async function generateMilestoneMessage({ milestone, alreadyShown }) {
  const factsForPrompt = buildFactsForPrompt(milestone);
  const toneInstruction = alreadyShown
    ? 'The user has asked about this before — acknowledge it warmly but briefly, without re-treating it as a big new reveal.'
    : 'This is a genuine small milestone worth warmly acknowledging, the way a close friend would notice and mention it in conversation — never like an app celebrating a streak or awarding a badge.';

  try {
    const r = await openai.chat.completions.create({
      model: process.env.SHERZ_MILESTONE_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are SHERZ, a warm, emotionally intelligent AI companion. Respond in Uzbek, in 1-3 short sentences, natural conversational voice — never like a notification, badge, or streak counter. Use emojis only if it feels genuinely natural, not decoratively. ${toneInstruction}`,
        },
        { role: 'user', content: factsForPrompt },
      ],
      temperature: 0.7,
      max_tokens: 150,
    });
    return r?.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error('[milestones] LLM phrasing generation failed:', e.message);
    return null;
  }
}

/**
 * The actual skill entry point, matching the {said} shape every other skill
 * in runSkillCandidates returns. Returns null (not a thrown error) if
 * generation fails — the candidates loop already treats a null/no-.said
 * result as "this skill didn't match," so the turn falls through to the next
 * candidate (eventually brain.llm) instead of failing the whole request.
 */
export async function runSkillMilestone({ userId, prisma }) {
  try {
    const data = await computeMilestones({ userId, prisma });
    const milestone = selectMilestone(data);

    const isRealMilestone = milestone.kind !== 'generic';
    const alreadyShown = isRealMilestone
      ? await wasTierAlreadyShown({ prisma, userId, tier: milestone.tier })
      : false;

    const said = await generateMilestoneMessage({ milestone, alreadyShown });
    if (!said) return null;

    if (isRealMilestone && !alreadyShown) {
      await markTierShown({ prisma, userId, tier: milestone.tier });
    }

    return { said };
  } catch (e) {
    console.error('[milestones] runSkillMilestone error:', e.message);
    return null;
  }
}
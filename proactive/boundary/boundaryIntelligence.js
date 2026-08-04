// src/proactive/boundary/boundaryIntelligence.js
// ✅ NO prisma import here. Prisma is injected from runner/endpoints.

function clamp01(x) {
  if (typeof x !== 'number') return null;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Heuristic: reply yo‘q holatini taxmin qilish (busy / avoiding / overwhelmed)
 * Minimal MVP version (keyin kuchaytiramiz).
 */
export async function decideBoundaryForUser(userId, prisma) {
  // Default fallback
  const out = {
    cause: { cause: 'busy', confidence: 0.55, evidence: {} },
    boundaryDecision: 'normal', // normal | soft_presence | respect
    permissionNeeded: false,
    respectUntil: null,
  };

  if (!prisma?.proactiveEvent?.findMany) return out;

  // Oxirgi 24-48 soatdagi eventlar
  const since = new Date(Date.now() - 48 * 3600 * 1000);

  let events = [];
  try {
    events = await prisma.proactiveEvent.findMany({
      where: { userId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  } catch {
    return out;
  }

  const sent = events.filter(e => e.delivered);
  const noReply = sent.filter(e => !e.gotReply);

  // agar umuman proactive yo‘q bo‘lsa
  if (!sent.length) return out;

  // signals
  const noReplyCount = noReply.length;
  const last = sent[0];

  // oddiy heuristika:
  // - noReply ko‘p bo‘lsa overwhelmed ehtimoli oshadi
  // - 1-2ta noReply: busy
  // - agar oldin permissionResult deny bo‘lgan bo‘lsa: respect
  const lastPerm = events.find(e => e.kind === 'permission' && e.permissionResult);

  if (lastPerm?.permissionResult === 'granted') {
    // user: "ha jim tur" degan => respect
    out.cause = { cause: 'overwhelmed', confidence: 0.75, evidence: { lastPerm: true } };
    out.boundaryDecision = 'respect';
    out.permissionNeeded = false;
    out.respectUntil = new Date(Date.now() + 24 * 3600 * 1000);
    return out;
  }

  if (noReplyCount >= 3) {
    out.cause = { cause: 'overwhelmed', confidence: 0.72, evidence: { noReplyCount } };
    out.boundaryDecision = 'respect';
    out.permissionNeeded = true; // noaniq holatda permission so‘rasin
    out.respectUntil = new Date(Date.now() + 24 * 3600 * 1000);
    return out;
  }

  if (noReplyCount === 2) {
    out.cause = { cause: 'busy', confidence: 0.62, evidence: { noReplyCount } };
    out.boundaryDecision = 'soft_presence';
    out.permissionNeeded = false;
    return out;
  }

  if (noReplyCount === 1) {
    out.cause = { cause: 'busy', confidence: 0.58, evidence: { noReplyCount } };
    out.boundaryDecision = 'normal';
    out.permissionNeeded = false;
    return out;
  }

  // hammasi joyida => normal
  return out;
}

/**
 * ✅ Policy adapt (UserProactivePolicy)
 * - boundaryDecision ga qarab cooldown/maxPerDay ni moslaydi
 * - migrate bo‘lmasa ham crash qilmaydi
 */
export async function applyBoundaryOutcomeToPolicy(userId, outcome, prisma) {
  if (!prisma?.userProactivePolicy?.upsert) return null;

  const decision = outcome?.boundaryDecision || 'normal';
  const perm = outcome?.permissionResult || null;

  // defaults
  let patch = {};

  if (decision === 'respect') {
    patch = {
      cooldownMinutes: 240,
      maxPerDay: 1,
      respectModeUntil: new Date(Date.now() + 24 * 3600 * 1000),
    };
  } else if (decision === 'soft_presence') {
    patch = {
      cooldownMinutes: 180,
      maxPerDay: 2,
      lastSoftPresenceAt: new Date(),
    };
  } else {
    // normal
    patch = {
      cooldownMinutes: 120,
      maxPerDay: 4,
    };
  }

  // agar user "yo‘q jim turma" desa => normalga qaytar
  if (perm === 'granted') {
    patch = { cooldownMinutes: 120, maxPerDay: 4, respectModeUntil: null };
  }

  try {
    return await prisma.userProactivePolicy.upsert({
      where: { userId },
      create: { userId, ...patch },
      update: { ...patch },
    });
  } catch (e) {
    // schema fieldlar yo‘q bo‘lsa (respectModeUntil/lastSoftPresenceAt) — minimal update
    try {
      const minimal = { cooldownMinutes: patch.cooldownMinutes, maxPerDay: patch.maxPerDay };
      return await prisma.userProactivePolicy.upsert({
        where: { userId },
        create: { userId, ...minimal },
        update: { ...minimal },
      });
    } catch {
      return null;
    }
  }
}

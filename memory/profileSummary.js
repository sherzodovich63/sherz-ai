// src/memory/profileSummary.js
// LAB 3 — ProfileSummary v2 (One-liner + Bullets + Emotion trend)
// Cache update trigger: latestFactAt + latestEmotionLogAt
//
// IMPORTANT: loadProfileSummary(prisma, userId) export saqlandi (old flow buzilmasin).

const DEFAULTS = {
  takeFacts: 200,
  habitsLimit: 4,
  goalsLimit: 4,
  triggersLimit: 4,
  days: 7,
  debug: true,
};

/**
 * ✅ Backward-compatible API (old code shuni chaqiradi).
 * Endi UserPref emas, ProfileSummaryCache ishlatadi.
 */
export async function loadProfileSummary(prisma, userId, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  if (!prisma || !userId) return "";

  const latestFactAt = await getLatestFactAt(prisma, userId);
  const latestEmotionLogAt = await getLatestEmotionLogAtSafe(prisma, userId);

  // Cache HIT?
  const cached = await getCacheSafe(prisma, userId);
  if (
    cached?.summary &&
    sameStamp(cached.latestFactAt, latestFactAt) &&
    sameStamp(cached.latestEmotionLogAt, latestEmotionLogAt)
  ) {
    if (cfg.debug) console.log("🧾 ProfileSummary v2 cache HIT", { userId });
    return cached.summary;
  }

  if (cfg.debug) {
    console.log("🧾 ProfileSummary v2 cache MISS", {
      userId,
      latestFactAt,
      latestEmotionLogAt,
    });
  }

  // Build fresh summary
  const summary = await buildProfileSummaryV2(prisma, userId, cfg);

  // Save cache
  await upsertCacheSafe(prisma, userId, summary, latestFactAt, latestEmotionLogAt);

  if (cfg.debug) console.log("🧾 ProfileSummary v2 length:", summary.length);
  return summary;
}

/**
 * ✅ FAZA 5: Prompt uchun kuchli ProfileSummary blok
 * (eski funksiyang saqlandi)
 */
export function buildProfileSummaryBlock({
  userProfile = null,
  facts = [],
  emotionHint = null,
  aiProfileSummary = "",
} = {}) {
  const name = (userProfile?.nickname || userProfile?.name || "USER").toString();
  const style = (userProfile?.style || "default").toString();

  const askedNameAt = userProfile?.askedNameAt
    ? new Date(userProfile.askedNameAt).toISOString().slice(0, 10)
    : null;

  const factLines = (facts || []).slice(0, 6).map((f) => {
    const key = (f?.key ?? "").toString();
    const val = (f?.value ?? f?.text ?? "").toString();
    const tag = f?.type ? `[${f.type}] ` : "";
    const line = `- ${tag}${key ? key + ": " : ""}${val}`;
    return line.slice(0, 300);
  });

  const emoLine = emotionHint ? `Emotion (latest): ${emotionHint}` : null;

  const aiSum = (aiProfileSummary || "").trim();
  const aiSumBlock = aiSum ? `ProfileSummary v2:\n${aiSum}` : null;

  return [
    "PROFILE CONTEXT (use carefully, prefer user latest message if conflict):",
    `Name: ${name}`,
    `Style: ${style}`,
    askedNameAt ? `askedNameAt: ${askedNameAt}` : null,
    emoLine,
    factLines.length ? `Relevant Facts:\n${factLines.join("\n")}` : null,
    aiSumBlock,
  ]
    .filter(Boolean)
    .join("\n");
}

// ----------------------
// Core: ProfileSummary v2
// ----------------------
async function buildProfileSummaryV2(prisma, userId, cfg) {
  // facts
  const facts = await prisma.fact.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: cfg.takeFacts,
  });

  const oneLiner = buildOneLiner(facts);
  const habits = pickHabits(facts, cfg.habitsLimit);
  const goals = pickGoalsOrProjects(facts, cfg.goalsLimit);
  const triggers = pickStressTriggers(facts, cfg.triggersLimit);
  const tone = pickPreferredTone(facts);

  // emotion trend 7d
  const emo = await getEmotionTrend7dSafe(prisma, userId, cfg.days);

  return formatSummary({
    oneLiner,
    habits,
    goals,
    triggers,
    tone,
    emo,
    days: cfg.days,
  });
}

function formatSummary({ oneLiner, habits, goals, triggers, tone, emo, days }) {
  const lines = [];

  lines.push(`Identity: ${oneLiner || "No strong identity facts yet."}`);

  lines.push("Top habits:");
  if (habits.length) habits.forEach((x) => lines.push(`- ${x}`));
  else lines.push("- (none yet)");

  lines.push("Goals / Projects:");
  if (goals.length) goals.forEach((x) => lines.push(`- ${x}`));
  else lines.push("- (none yet)");

  lines.push("Stress triggers:");
  if (triggers.length) triggers.forEach((x) => lines.push(`- ${x}`));
  else lines.push("- (unknown)");

  lines.push(`Preferred tone: ${tone || "Clear, supportive, direct."}`);

  if (emo?.summaryLine) {
    lines.push(`Emotion trend (${days}d): ${emo.summaryLine}`);
    if (emo.bullets?.length) emo.bullets.forEach((b) => lines.push(`- ${b}`));
  } else {
    lines.push(`Emotion trend (${days}d): (no data)`);
  }

  return lines.join("\n");
}

// ----------------------
// Fact parsing helpers
// ----------------------
function norm(s) {
  return String(s || "").trim();
}
function low(s) {
  return norm(s).toLowerCase();
}

function buildOneLiner(facts) {
  // priority: name/title + main focus/project + current vibe
  const nameFact = findByKeyHints(facts, ["name", "user_name", "full_name", "nickname"]);
  const focusFact = findByKeyHints(facts, ["goal_", "project", "sherz", "uzbetube", "startup", "v1", "demo", "launch"]);
  const vibeFact = findByKeyHints(facts, ["state_", "mood", "status", "last_state"]);

  const name = nameFact ? norm(nameFact.value) : "";
  const focus = focusFact ? shorten(norm(focusFact.value), 70) : "";
  const vibe = vibeFact ? shorten(norm(vibeFact.value), 60) : "";

  const parts = [];
  if (name) parts.push(name);
  if (focus) parts.push(`focused on ${focus}`);
  if (vibe) parts.push(`currently ${vibe}`);
  return parts.join(", ");
}

function pickHabits(facts, limit) {
  const out = [];
  for (const f of facts) {
    const k = low(f.key);
    if (k.startsWith("habit_") || k.includes("routine") || k.includes("habit")) {
      out.push(`${cleanKey(f.key)}: ${norm(f.value)}`);
    }
    if (out.length >= limit) break;
  }
  return unique(out);
}

function pickGoalsOrProjects(facts, limit) {
  const out = [];
  for (const f of facts) {
    const k = low(f.key);
    if (k.startsWith("goal_") || k.includes("goal") || k.includes("project") || k.includes("launch") || k.includes("demo")) {
      out.push(`${cleanKey(f.key)}: ${norm(f.value)}`);
    }
    if (out.length >= limit) break;
  }
  return unique(out);
}

function pickStressTriggers(facts, limit) {
  const out = [];
  for (const f of facts) {
    const k = low(f.key);
    const v = low(f.value);

    if (
      k.includes("stress") ||
      k.includes("trigger") ||
      k.includes("anxiety") ||
      k.includes("worry") ||
      v.includes("stress") ||
      v.includes("charch") ||
      v.includes("bezovta") ||
      v.includes("anx")
    ) {
      out.push(`${cleanKey(f.key)}: ${shorten(norm(f.value), 120)}`);
    }
    if (out.length >= limit) break;
  }
  return unique(out);
}

function pickPreferredTone(facts) {
  const toneFact = findByKeyHints(facts, ["pref_tone", "tone", "style", "response_style", "friend_mode"]);
  if (toneFact) return shorten(norm(toneFact.value), 80);

  // fallback: qisqa/uzun haqida fact bo‘lsa
  const shortFact = findByKeyHints(facts, ["qisqa", "uzun", "concise", "short"]);
  if (shortFact) return shorten(norm(shortFact.value), 80);

  return "";
}

function findByKeyHints(facts, hints) {
  for (const f of facts) {
    const k = low(f.key);
    if (hints.some((h) => k.includes(low(h)))) return f;
  }
  for (const f of facts) {
    const v = low(f.value);
    if (hints.some((h) => v.includes(low(h)))) return f;
  }
  return null;
}

function cleanKey(k) {
  return norm(k).replace(/_/g, " ");
}

function shorten(s, n) {
  s = norm(s);
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function unique(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const t = low(x);
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(x);
  }
  return out;
}

// ----------------------
// Emotion trend (7d) — SAFE
// ----------------------
async function getEmotionTrend7dSafe(prisma, userId, days = 7) {
  // Agar emotionLog modeli yo‘q bo‘lsa — crash qilmaydi
  if (!prisma?.emotionLog) return null;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await prisma.emotionLog.findMany({
    where: { userId, createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    take: 500,
  });

  if (!rows.length) return null;

  const counts = {};
  const valences = [];

  for (const r of rows) {
    const emo = (r.emotion || "unknown").toLowerCase();
    counts[emo] = (counts[emo] || 0) + 1;
    valences.push(mapEmotionToValence(emo));
  }

  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([e, c]) => `${e}(${c})`);

  const mid = Math.floor(valences.length / 2) || 1;
  const firstAvg = avg(valences.slice(0, mid));
  const secondAvg = avg(valences.slice(mid));

  let trendWord = "stable";
  if (secondAvg - firstAvg > 0.12) trendWord = "improving";
  else if (firstAvg - secondAvg > 0.12) trendWord = "worsening";

  const summaryLine = `${trendWord}; top: ${top.join(", ")}`;
  const bullets = [
    `logs: ${rows.length} in last ${days} days`,
    `valence avg: ${round2(firstAvg)} → ${round2(secondAvg)}`,
  ];

  return { summaryLine, bullets };
}

function mapEmotionToValence(emo) {
  if (["happy", "joy", "excited", "calm", "relaxed", "confident"].includes(emo)) return 0.8;
  if (["ok", "neutral"].includes(emo)) return 0.0;
  if (["sad", "tired", "angry", "anxious", "stress", "stressed", "fear"].includes(emo)) return -0.7;
  return 0.0;
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function round2(x) {
  return Math.round(Number(x) * 100) / 100;
}

// ----------------------
// Cache trigger helpers
// ----------------------
async function getLatestFactAt(prisma, userId) {
  const row = await prisma.fact.findFirst({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });
  return row?.updatedAt || null;
}

async function getLatestEmotionLogAtSafe(prisma, userId) {
  if (!prisma?.emotionLog) return null;
  const row = await prisma.emotionLog.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return row?.createdAt || null;
}

function sameStamp(a, b) {
  const ta = a ? new Date(a).getTime() : 0;
  const tb = b ? new Date(b).getTime() : 0;
  return ta === tb;
}

// ProfileSummaryCache (prisma model) — SAFE access
async function getCacheSafe(prisma, userId) {
  if (!prisma?.profileSummaryCache) return null;
  return prisma.profileSummaryCache.findUnique({ where: { userId } });
}

async function upsertCacheSafe(prisma, userId, summary, latestFactAt, latestEmotionLogAt) {
  if (!prisma?.profileSummaryCache) return;

  await prisma.profileSummaryCache.upsert({
    where: { userId },
    update: { summary, latestFactAt, latestEmotionLogAt },
    create: { userId, summary, latestFactAt, latestEmotionLogAt },
  });
}

// ✅ New name for Proactive Engine compatibility
export async function getProfileSummaryV2({ userId, prisma, options = {} }) {
  return await loadProfileSummary(prisma, userId, options);
}

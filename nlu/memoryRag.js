// nlu/memoryRag.js
// Memory RAG v2 (LAB 2): Rank + Filter + Recency + Dedup
// Pipeline: facts -> ensure embeddings -> cosine sim -> score fusion -> top 5–10

import crypto from "crypto";

const EMBEDDING_MODEL =
  process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";

const DEFAULTS = {
  // candidates
  takeFacts: 200,

  // base similarity
  minSim: 0.25,

  // output count (talab: 5–10)
  limit: 8,

  // recency
  recentDays: 14,

  // negative filter (overlap)
  overlapMin: 0.08,

  // debug
  debug: true,
};

/**
 * Matnga embedding olish (OpenAI /v1/embeddings).
 * @param {string} text
 * @returns {Promise<Float32Array>}
 */
async function embedText(text) {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY yo'q (embedding)");

  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
    }),
  });

  const j = await r.json();
  if (!r.ok) {
    console.error("Embedding error:", j);
    throw new Error(j.error?.message || "embedding failed");
  }

  const arr = j.data?.[0]?.embedding || [];
  return new Float32Array(arr);
}

/**
 * Bitta Fact uchun embeddingni bazaga yozish (agar yo'q bo'lsa).
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {import('@prisma/client').Fact & { embedding?: import('@prisma/client').FactEmbedding | null }} fact
 * @returns {Promise<import('@prisma/client').FactEmbedding>}
 */
export async function ensureFactEmbedding(prisma, fact) {
  if (!fact || !fact.id) throw new Error("fact kerak");

  if (fact.embedding) return fact.embedding;

  const text = `${fact.key}: ${fact.value}`;
  const vec = await embedText(text);
  const buffer = Buffer.from(vec.buffer);

  const created = await prisma.factEmbedding.create({
    data: {
      factId: fact.id,
      vector: buffer,
    },
  });

  return created;
}

/**
 * Cosine similarity.
 * @param {Float32Array} a
 * @param {Float32Array} b
 */
function cosineSim(a, b) {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (!na || !nb) return 0;
  return dot / Math.sqrt(na * nb);
}

// -------------------------
// LAB 2 HELPERS
// -------------------------

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function clampInt(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, Math.round(x)));
}

function round3(x) {
  return Math.round(Number(x) * 1000) / 1000;
}

function stableHash(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex");
}

function truncate(s, n = 90) {
  s = String(s || "");
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

/**
 * Query/fact uchun tokenlar (overlap filter uchun)
 */
function tokenize(text) {
  const s = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04FF]+/gi, " "); // latin + kirill
  const raw = s.split(" ").map((x) => x.trim()).filter(Boolean);

  // minimal stopwords (uz/en/ru aralash)
  const stop = new Set([
    "the","a","an","and","or","to","of","in","on","for","with","is","are","was","were",
    "i","you","we","they","he","she","it",
    "bu","shu","mana","qanaqa","qanday","nima","nega","ham","bilan","uchun","emas","bor","yoq",
    "men","sen","u","biz","siz","ular","menga","senga","unga"
  ]);

  const out = new Set();
  for (const t of raw) {
    if (t.length < 3) continue;
    if (stop.has(t)) continue;
    out.add(t);
  }
  return out;
}

/**
 * userText tokens ∩ fact(key+value) tokens
 * 0..1
 */
function overlapScore(qTokens, fact) {
  if (!qTokens || qTokens.size === 0) return 0;
  const fTokens = tokenize(`${fact.key || ""} ${fact.value || ""}`);
  if (fTokens.size === 0) return 0;

  let hit = 0;
  for (const tok of qTokens) {
    if (fTokens.has(tok)) hit++;
  }

  const denom = Math.max(4, qTokens.size); // kichkina querylarda shovqin kamayadi
  return clamp01(hit / denom);
}

/**
 * type inference: fact.type bo‘lsa o‘sha, bo‘lmasa key nomidan taxmin.
 * Talab: state/goal/habit > preference > note
 */
function inferMemoryType(fact) {
  const t = (fact.type || "").toLowerCase().trim();
  if (t && ["state", "goal", "habit", "preference", "note"].includes(t)) return t;

  const k = String(fact.key || "").toLowerCase();
  if (k.startsWith("state_") || k.includes("mood") || k.includes("status")) return "state";
  if (k.startsWith("goal_") || k.includes("goal") || k.includes("plan")) return "goal";
  if (k.startsWith("habit_") || k.includes("habit") || k.includes("routine")) return "habit";
  if (k.startsWith("pref_") || k.includes("like") || k.includes("favorite")) return "preference";

  // detectContinue saqlagan last_state ham “state” deb ko‘rish mumkin:
  if (k === "last_state" || k.includes("last_state")) return "state";

  return "note";
}

function typeWeight(type) {
  switch (type) {
    case "state":
    case "goal":
    case "habit":
      return 1.0;
    case "preference":
      return 0.65;
    case "note":
    default:
      return 0.4;
  }
}

/**
 * Recency boost 0..1
 * so‘nggi recentDays (default 14) ichida kuchliroq
 */
function recencyBoost(updatedAt, nowMs, recentDays) {
  const t = updatedAt ? new Date(updatedAt).getTime() : 0;
  if (!t) return 0;

  const ageDays = (nowMs - t) / (1000 * 60 * 60 * 24);
  if (ageDays <= 0) return 1;

  if (ageDays <= recentDays) {
    const x = ageDays / recentDays; // 0..1
    return 1 - x * 0.6; // 1..0.4
  }

  const extra = ageDays - recentDays;
  const k = 0.08;
  return 0.4 * Math.exp(-k * extra);
}

/**
 * Dedup: bir xil key/value qaytmasin
 */
function dedupScored(list) {
  const seen = new Set();
  const out = [];
  for (const it of list) {
    const key = String(it.fact.key || "").trim().toLowerCase();
    const val = String(it.fact.value || "").trim().toLowerCase();
    const h = stableHash(`${key}||${val}`);
    if (seen.has(h)) continue;
    seen.add(h);
    out.push(it);
  }
  return out;
}

// -------------------------
// 기존 API (yangilangan)
// -------------------------

/**
 * Foydalanuvchi uchun eng tegishli Factlarni topish (v2 pipeline uchun candidate list).
 * Bunda biz ALLAQACHON cosine score qaytaramiz.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} userId
 * @param {string} userText
 * @param {{ limit?: number, minSim?: number, takeFacts?: number }} [options]
 */
export async function getTopFactsForUser(prisma, userId, userText, options = {}) {
  const takeFacts = options.takeFacts ?? DEFAULTS.takeFacts;

  const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
  if (!OPENAI_API_KEY) return [];

  if (!userId) return [];
  if (!userText || !userText.trim()) return [];

  // Oxirgi N ta factni olamiz
  let facts = await prisma.fact.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: takeFacts,
    include: { embedding: true },
  });

  if (!facts.length) return [];

  // Embedding yo'q bo'lganlar uchun yaratib chiqamiz
  const withEmbeddings = [];
  for (const f of facts) {
    try {
      const emb = await ensureFactEmbedding(prisma, f);
      withEmbeddings.push({ ...f, embedding: emb });
    } catch (e) {
      console.error("ensureFactEmbedding error:", e);
    }
  }

  if (!withEmbeddings.length) return [];

  // Hozirgi xabar embedding
  const qVec = await embedText(userText);

  // Cosine similarity
  const scored = withEmbeddings.map((f) => {
    const buf = f.embedding.vector; // Buffer
    const v = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    const score = cosineSim(qVec, v);
    return { fact: f, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored; // endi bu candidate list
}

/**
 * Chat promptga qo'shish uchun formatlangan memory context (LAB 2).
 *
 * @returns {Promise<string>} "- [type] (key) value" ko'rinishida text
 */
export async function getMemoryContextForUser(
  prisma,
  userId,
  userText,
  options = {}
) {
  const cfg = {
    ...DEFAULTS,
    ...options,
  };

  // talab: output 5–10
  const limit = clampInt(cfg.limit ?? 8, 5, 10);
  const minSim = cfg.minSim ?? DEFAULTS.minSim;
  const recentDays = cfg.recentDays ?? DEFAULTS.recentDays;
  const overlapMin = cfg.overlapMin ?? DEFAULTS.overlapMin;
  const debug = Boolean(cfg.debug);

  const q = (userText || "").trim();
  if (!q) return "";

  const candidates = await getTopFactsForUser(prisma, userId, q, cfg);
  if (!candidates.length) return "";

  const qTokens = tokenize(q);
  const nowMs = Date.now();

  // Rank + Filter
  const scored2 = [];
  for (const item of candidates) {
    const baseSim = clamp01(Number(item.score ?? 0));
    if (baseSim < minSim) continue;

    const fact = item.fact;
    const type = inferMemoryType(fact);
    const tW = typeWeight(type);
    const rW = recencyBoost(fact.updatedAt, nowMs, recentDays);
    const ov = overlapScore(qTokens, fact);

    // negative filter threshold: state/goal/habit uchun yengilroq
    const minOv =
      type === "state" || type === "goal" || type === "habit"
        ? overlapMin * 0.6
        : overlapMin;

    if (ov < minOv) continue;

    // Final scoring (tuning oson bo‘lsin)
    const finalScore = baseSim * 1.0 + tW * 0.35 + rW * 0.3 + ov * 0.55;

    scored2.push({
      fact,
      baseSim,
      type,
      typeW: tW,
      recW: rW,
      overlap: ov,
      finalScore,
    });
  }

  // sort
  scored2.sort((a, b) => b.finalScore - a.finalScore);

  // dedup
  const deduped = dedupScored(scored2);

  // top 5–10
  const top = deduped.slice(0, limit);

  // debug log
  if (debug) {
    const dbg = {
      version: "MemoryRAG_v2",
      params: { limit, minSim, recentDays, overlapMin, takeFacts: cfg.takeFacts ?? DEFAULTS.takeFacts },
      counts: {
        candidates: candidates.length,
        afterFilter: scored2.length,
        afterDedup: deduped.length,
        returned: top.length,
      },
      top: top.map((x) => ({
        id: x.fact.id,
        key: x.fact.key,
        value: truncate(x.fact.value, 80),
        type: x.type,
        updatedAt: x.fact.updatedAt,
        baseSim: round3(x.baseSim),
        typeW: round3(x.typeW),
        recW: round3(x.recW),
        overlap: round3(x.overlap),
        finalScore: round3(x.finalScore),
      })),
    };

    console.log("🧠 MemoryRAG v2 debug:", JSON.stringify(dbg, null, 2));
  }

  // prompt text (score ko‘rsatishni xohlamasang olib tashlaysan)
  const lines = top.map(
    (x) => `- [${x.type}] (${x.fact.key}) ${x.fact.value}`
  );

  return lines.join("\n");
}

import crypto from 'crypto';
import { openai } from '../llm/openaiClient.js';

function tokenize(text = '') {
  return (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 200);
}

function keywordScore(query, factText) {
  const q = new Set(tokenize(query));
  const f = tokenize(factText);
  let hit = 0;
  for (const w of f) if (q.has(w)) hit++;
  return hit;
}

function cosine(a = [], b = []) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const EMBED_TIMEOUT_MS = 1500;   // this call sits in front of every reply: a slow embeddings API must never stall the chat (falls back to keywords)
async function embedText(text, model) {
  const input = (text || '').slice(0, 1500);
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('embed timeout')), EMBED_TIMEOUT_MS); });
  try {
    const r = await Promise.race([openai.embeddings.create({ model, input }), timeout]);
    return r?.data?.[0]?.embedding || null;
  } finally { clearTimeout(timer); }
}

// ── candidate pool ──────────────────────────────────────────────────────────────────────────
// Before: the 80 most recently UPDATED facts of any kind. Internal rows (watermarks, skill / proactive bookkeeping) are rewritten all the time, so
// they crowded real facts out, and an old conversation summary fell out of the pool for good — `pinned` only boosted the score of facts that were
// already in it. Now: recent real facts + the conversation summaries are fetched separately.
const SUMMARY_TYPE = 'conversation_summary';
const SYSTEM_KEY = /^(proactive|learn|last|skill|system|internal|tmp|cache|state|tone|memory_compaction)[_:]/i;
const RECENT_FACTS = 100, SUMMARY_POOL = 120;
const SUMMARY_MIN_SIM = 0.2;   // text-embedding-3-small: unrelated text sits around 0.05-0.15
/** 'conversation_summary_2026-10-27_<id>~w' → 'w' (Work Space / project), '~c' → 'c' (Companion); old summaries without a tag → null = shown everywhere */
const summaryScope = (key) => { const m = /~([cw])$/.exec(String(key || '')); return m ? m[1] : null; };
const isSummary = (f) => f?.type === SUMMARY_TYPE;

// ✅ FIX: decode a Fact's related FactEmbedding.vector (Bytes) back into a
// plain number[]. Copies into a fresh, guaranteed-4-byte-aligned buffer
// first — a Buffer handed back by the DB driver can be a slice of a larger
// pooled allocation with an arbitrary byteOffset, which Float32Array's
// constructor requires and throws on otherwise (verified empirically).
function decodeEmbeddingVector(bytesField) {
  if (!bytesField) return null;
  try {
    const buf = Buffer.isBuffer(bytesField) ? bytesField : Buffer.from(bytesField);
    if (!buf.length || buf.length % 4 !== 0) return null;
    const aligned = Buffer.alloc(buf.length);
    buf.copy(aligned);
    const floatArr = new Float32Array(aligned.buffer, aligned.byteOffset, aligned.length / 4);
    return Array.from(floatArr);
  } catch {
    return null;
  }
}

export async function getRelevantFacts({
  userId,
  query,
  prisma,
  topK = 6,
  summaryK = 2,            // extra slots reserved for older conversation summaries, so they never compete with ordinary facts for the topK slots
  scope = null,            // 'companion' | 'work' — a Work Space chat and the personal thread do not see each other's summaries
  useEmbeddings = true,
}) {
  if (!prisma) return [];
  const want = scope === 'work' ? 'w' : scope === 'companion' ? 'c' : null;

  // ✅ FIX: was missing `include: { embedding: true }` — f.embedding was
  // always undefined before, so the entire semantic-similarity path was
  // silently dead code; every call fell through to keyword-only scoring.
  const [recent, summaries] = await Promise.all([
    prisma.fact.findMany({
      where: { userId, OR: [{ type: null }, { type: { notIn: ['state', SUMMARY_TYPE] } }] },
      orderBy: { updatedAt: 'desc' },
      take: RECENT_FACTS,
      include: { embedding: true },
    }),
    prisma.fact.findMany({
      where: { userId, type: SUMMARY_TYPE },
      orderBy: { createdAt: 'desc' },
      take: SUMMARY_POOL,
      include: { embedding: true },
    }).catch(() => []),
  ]);
  const facts = [
    ...(recent || []).filter((f) => !SYSTEM_KEY.test(String(f.key || ''))),
    ...(summaries || []).filter((f) => { const sc = summaryScope(f.key); return !want || !sc || sc === want; }),
  ];

  if (!facts.length) return [];
  // top ordinary facts as before (topK), plus at most summaryK relevant summaries
  const pick = (scored) => {
    const ordinary = scored.filter((x) => !isSummary(x.f)).slice(0, topK).map((x) => x.f);
    const sums = scored.filter((x) => isSummary(x.f) && x.relevant).slice(0, summaryK).map((x) => x.f);
    return [...ordinary, ...sums];
  };

  const embModel = process.env.SHERZ_EMBED_MODEL || 'text-embedding-3-small';
  const canEmbed = useEmbeddings && !!process.env.OPENAI_API_KEY;

  if (canEmbed) {
    let qEmb = null;
    try {
      qEmb = await embedText(query, embModel);
    } catch (e) {
      qEmb = null;
    }

    if (qEmb) {
      const scored = facts.map(f => {
        // ✅ FIX: f.embedding is now the included FactEmbedding row (or
        // null) — decode its Bytes vector; anything that doesn't decode
        // cleanly just falls back to sim=0 (same as before this fix, no
        // regression for any fact type that never got an embedding written)
        const fVec = decodeEmbeddingVector(f.embedding?.vector);
        const sim = fVec ? cosine(qEmb, fVec) : 0;
        const kw = keywordScore(query, `${f.key || ''} ${f.value || f.text || ''}`);
        // ✅ NEW: pinned facts (e.g. compacted conversation summaries) get a
        // flat boost so they don't get crowded out by recency alone
        const pinBoost = f.pinned ? 5 : 0;
        const score = (sim * 1000) + kw + pinBoost;
        return { f, score, sim, kw, relevant: sim >= SUMMARY_MIN_SIM || kw >= 2 };
      });

      scored.sort((a, b) => b.score - a.score);
      return pick(scored);
    }
  }

  // Fallback: keyword overlap (now also respects pinned)
  const scored2 = facts.map(f => {
    const text = `${f.key || ''} ${f.value || f.text || ''}`;
    const pinBoost = f.pinned ? 5 : 0;
    const kw = keywordScore(query, text);
    return { f, score: kw + pinBoost, relevant: kw >= 2 };
  });
  scored2.sort((a, b) => b.score - a.score);
  return pick(scored2);
}

export function formatFactsForPrompt(facts = []) {
  if (!facts.length) return '';
  const lines = facts.map(f => {
    const v = (f.value ?? f.text ?? '').toString();
    if (isSummary(f)) {                                   // an earlier stretch of conversation: show its date, not the internal key (and allow its longer text)
      const d = /conversation_summary_(\d{4}-\d{2}-\d{2})/.exec(f.key || '');
      return `- [earlier conversation${d ? ' ' + d[1] : ''}] ${v}`.slice(0, 700);
    }
    const k = f.key ? `[${f.key}] ` : '';
    return `- ${k}${v}`.slice(0, 300);
  });
  return [
    "RELEVANT MEMORY FACTS (use only if helpful, never hallucinate):",
    ...lines
  ].join('\n');
}
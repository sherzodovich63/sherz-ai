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

async function embedText(text, model) {
  const input = (text || '').slice(0, 1500);
  const r = await openai.embeddings.create({ model, input });
  return r?.data?.[0]?.embedding || null;
}

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
  useEmbeddings = true,
}) {
  if (!prisma) return [];

  // ✅ FIX: was missing `include: { embedding: true }` — f.embedding was
  // always undefined before, so the entire semantic-similarity path was
  // silently dead code; every call fell through to keyword-only scoring.
  const facts = await prisma.fact.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    take: 80,
    include: { embedding: true },
  });

  if (!facts?.length) return [];

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
        return { f, score, sim, kw };
      });

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, topK).map(x => x.f);
    }
  }

  // Fallback: keyword overlap (now also respects pinned)
  const scored2 = facts.map(f => {
    const text = `${f.key || ''} ${f.value || f.text || ''}`;
    const pinBoost = f.pinned ? 5 : 0;
    return { f, score: keywordScore(query, text) + pinBoost };
  });
  scored2.sort((a, b) => b.score - a.score);
  return scored2.slice(0, topK).map(x => x.f);
}

export function formatFactsForPrompt(facts = []) {
  if (!facts.length) return '';
  const lines = facts.map(f => {
    const k = f.key ? `[${f.key}] ` : '';
    const v = (f.value ?? f.text ?? '').toString();
    return `- ${k}${v}`.slice(0, 300);
  });
  return [
    "RELEVANT MEMORY FACTS (use only if helpful, never hallucinate):",
    ...lines
  ].join('\n');
}
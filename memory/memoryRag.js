// src/memory/memoryRag.js (ESM)
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
  const r = await openai.embeddings.create({
    model,
    input,
  });
  return r?.data?.[0]?.embedding || null;
}

/**
 * prisma.fact (yoki prisma.memoryFact) bor deb faraz qilamiz:
 *   - userId
 *   - key (optional)
 *   - value/text
 *   - updatedAt/createdAt
 *   - embedding (optional: Float[] / json)
 */
export async function getRelevantFacts({
  userId,
  query,
  prisma,
  topK = 6,
  useEmbeddings = true,
}) {
  if (!prisma) return [];

  // 1) Facts ni olib kelamiz (limit qo‘yib turamiz)
  const facts = await prisma.fact.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    take: 80,
  });

  if (!facts?.length) return [];

  // 2) Embedding yo‘li (agar fact.embedding saqlanayotgan bo‘lsa)
  const embModel = process.env.SHERZ_EMBED_MODEL || 'text-embedding-3-small';
  const canEmbed = useEmbeddings && !!process.env.OPENAI_API_KEY;

  if (canEmbed) {
    // query embedding
    let qEmb = null;
    try {
      qEmb = await embedText(query, embModel);
    } catch (e) {
      qEmb = null;
    }

    if (qEmb) {
      // fact.embedding bo‘lmasa fallback score ishlaydi
      const scored = facts.map(f => {
        const fEmb = f.embedding || null;
        const sim = Array.isArray(fEmb) ? cosine(qEmb, fEmb) : 0;
        const kw = keywordScore(query, `${f.key || ''} ${f.value || f.text || ''}`);
        const score = (sim * 1000) + kw; // sim asosiy, kw qo‘shimcha
        return { f, score, sim, kw };
      });

      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, topK).map(x => x.f);
    }
  }

  // 3) Fallback: keyword overlap
  const scored2 = facts.map(f => {
    const text = `${f.key || ''} ${f.value || f.text || ''}`;
    return { f, score: keywordScore(query, text) };
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

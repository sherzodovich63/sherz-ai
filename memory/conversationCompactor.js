// src/memory/conversationCompactor.js
// ✅ Periodic conversation-chunk summarization into durable Fact rows
// (type: 'conversation_summary'), retrieved later via the existing
// getRelevantFacts() RAG path — no new tables, no new retrieval mechanism.
//
// Self-contained: writes both the Fact and its FactEmbedding directly, so it
// doesn't depend on nlu/saveMemoryFacts.js's (unseen) embedding behavior for
// other fact types.

import { openai } from '../llm/openaiClient.js';

const CHUNK_SIZE = 20;       // messages summarized per compaction run
const MIN_TRIGGER = 30;      // don't compact until at least this many are eligible
const LIVE_WINDOW = 20;      // must match runBrainFlow's history window — never
                              // compact messages still inside live context
const WATERMARK_KEY = 'memory_compaction_watermark_at';
const CHUNK_TEXT_BUDGET = 6000;   // characters of chunk text sent to the summarizer
const FAIL_BACKOFF_MS = 5 * 60 * 1000;
const inFlight = new Set();       // one compaction per user at a time (fire-and-forget calls from quick consecutive turns used to race and write the same chunk twice)
const failedUntil = new Map();    // userId -> time before which a failed summary is not retried

// One watermark per conversation (key "memory_compaction_watermark_at:<conversationId>"), so the personal thread and every Work Space
// are summarized on their own. A conversation without a marker starts from the old per-user marker, so nothing is summarized twice.
const wmKey = (convId) => (convId ? `${WATERMARK_KEY}:${convId}` : WATERMARK_KEY);

async function getCompactionWatermark(prisma, userId, convId) {
  try {
    for (const key of convId ? [wmKey(convId), WATERMARK_KEY] : [WATERMARK_KEY]) {
      const fact = await prisma.fact.findFirst({ where: { userId, key }, orderBy: { updatedAt: 'desc' }, select: { value: true } });
      if (fact?.value) return new Date(fact.value);
    }
    return null;
  } catch {
    return null;
  }
}

async function setCompactionWatermark(prisma, userId, isoDate, convId) {
  try {
    const key = wmKey(convId);
    const row = await prisma.fact.findFirst({ where: { userId, key }, select: { id: true } });
    if (row) await prisma.fact.update({ where: { id: row.id }, data: { value: isoDate } });   // update in place: no new row per chunk
    else await prisma.fact.create({ data: { userId, key, value: isoDate, type: 'state' } });
  } catch (e) {
    console.warn('[memory-compaction] watermark save failed (non-fatal):', e.message);
  }
}

// The conversation the person was last active in is the one worth compacting now (the others are done when they are next used).
async function latestConversationId(prisma, userId) {
  try {
    const m = await prisma.message.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { conversationId: true } });
    return m?.conversationId || null;
  } catch { return null; }
}
// 'c' = the Companion thread, 'w' = a Work Space / project. Recall (memoryRag.js) shows each side only its own summaries.
async function scopeOfConversation(prisma, convId) {
  if (!convId) return 'c';
  try {
    const c = await prisma.conversation.findUnique({ where: { id: convId }, select: { kind: true } });
    return !c || c.kind === 'companion' ? 'c' : 'w';
  } catch { return 'c'; }
}

// Shrinks every message so the WHOLE chunk fits the summarizer's budget. (Before: the text was cut at 6000 characters, so on long chunks the
// newest messages never reached the summary — yet the watermark moved past them, and they were lost for good.)
// The person's own turns keep a bigger share than the assistant's: they carry the facts.
function clipMsg(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const head = Math.floor(max * 0.65);
  return t.slice(0, head) + ' … ' + t.slice(-(max - head - 3));
}
export function buildChunkText(chunk, budget = CHUNK_TEXT_BUDGET) {
  let userMax = 700, botMax = 350, lines;
  for (;;) {
    lines = chunk.map(m => `${m.role}: ${clipMsg(m.text, m.role === 'user' ? userMax : botMax)}`);
    if (lines.join('\n').length <= budget || (userMax <= 120 && botMax <= 60)) break;
    userMax = Math.floor(userMax * 0.8); botMax = Math.floor(botMax * 0.8);
  }
  return lines.join('\n');
}

async function summarizeChunkWithLLM(chunkText) {
  try {
    const r = await openai.chat.completions.create({
      model: process.env.SHERZ_SUMMARY_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Summarize this conversation excerpt in 3-4 concise sentences. Keep the concrete specifics: names, numbers, dates, places, decisions, plans, commitments and anything left unresolved, plus the emotional context. Say only what was actually said; never invent. Write in the same language as the conversation. No commentary, no meta-text, just the summary.',
        },
        { role: 'user', content: chunkText.slice(0, 6000) },
      ],
      temperature: 0.3,
      max_tokens: 260,
    });
    return r?.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error('[memory-compaction] summarization LLM call failed:', e.message);
    return null;
  }
}

function encodeEmbeddingVector(floatArray) {
  return Buffer.from(Float32Array.from(floatArray).buffer);
}

async function createFactEmbedding(prisma, factId, text) {
  try {
    const embModel = process.env.SHERZ_EMBED_MODEL || 'text-embedding-3-small';
    const r = await openai.embeddings.create({ model: embModel, input: text.slice(0, 1500) });
    const vec = r?.data?.[0]?.embedding;
    if (!vec) return null;
    await prisma.factEmbedding.upsert({
      where: { factId },
      update: { vector: encodeEmbeddingVector(vec) },
      create: { factId, vector: encodeEmbeddingVector(vec) },
    });
    return true;
  } catch (e) {
    console.warn('[memory-compaction] embedding creation failed (non-fatal):', e.message);
    return null;
  }
}

/**
 * Call this fire-and-forget after a turn, same pattern as processUserMemory.
 * Internally bails cheaply (1-2 queries) if there isn't enough to compact yet,
 * so it's safe to call on every turn without meaningful overhead in the
 * common case.
 */
export async function maybeCompactOldMessages({ userId, prisma }) {
  if (!userId) return { compacted: false, reason: 'no_user' };
  if (inFlight.has(userId)) return { compacted: false, reason: 'in_progress' };
  if ((failedUntil.get(userId) || 0) > Date.now()) return { compacted: false, reason: 'backoff' };
  inFlight.add(userId);
  try {
    return await compactOnce({ userId, prisma });
  } finally {
    inFlight.delete(userId);
  }
}

async function compactOnce({ userId, prisma }) {
  try {
    const convId = await latestConversationId(prisma, userId);
    const watermark = await getCompactionWatermark(prisma, userId, convId);
    const where = { userId, ...(convId ? { conversationId: convId } : {}), ...(watermark ? { createdAt: { gt: watermark } } : {}) };

    const uncompacted = await prisma.message.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: 200, // safety bound
    });

    // Never touch messages still inside runBrainFlow's live 20-message window
    const compactable = uncompacted.slice(0, Math.max(0, uncompacted.length - LIVE_WINDOW));

    if (compactable.length < MIN_TRIGGER) {
      return { compacted: false, reason: 'not_enough_messages', pending: compactable.length };
    }

    const chunk = compactable.slice(0, CHUNK_SIZE);
    const chunkText = buildChunkText(chunk);

    const summaryText = await summarizeChunkWithLLM(chunkText);
    if (!summaryText) { failedUntil.set(userId, Date.now() + FAIL_BACKOFF_MS); return { compacted: false, reason: 'summary_generation_failed' }; }

    const dateLabel = chunk[0].createdAt.toISOString().slice(0, 10);
    const scope = await scopeOfConversation(prisma, convId);
    const summaryKey = `conversation_summary_${dateLabel}_${chunk[0].id}~${scope}`; // unique per chunk start; ~c / ~w = Companion or Work Space
    // never write the same chunk twice (a crash after the summary was saved but before the watermark moved, or a second server instance)
    let summaryFact = await prisma.fact.findFirst({ where: { userId, key: summaryKey } });
    if (!summaryFact) {
      summaryFact = await prisma.fact.create({
        data: {
          userId,
          key: summaryKey,
          value: summaryText,
          type: 'conversation_summary',
          pinned: true, // resist aging out of the RAG top-80 pool as new facts accumulate
        },
      });
      await createFactEmbedding(prisma, summaryFact.id, summaryText);
    }

    const newWatermark = chunk[chunk.length - 1].createdAt.toISOString();
    await setCompactionWatermark(prisma, userId, newWatermark, convId);

    return { compacted: true, factId: summaryFact.id, messagesCompacted: chunk.length, newWatermark };
  } catch (e) {
    console.error('[memory-compaction] error:', e);
    return { compacted: false, error: e.message };
  }
}
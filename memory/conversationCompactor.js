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

async function getCompactionWatermark(prisma, userId) {
  try {
    const fact = await prisma.fact.findFirst({
      where: { userId, key: WATERMARK_KEY },
      orderBy: { updatedAt: 'desc' },
      select: { value: true },
    });
    return fact?.value ? new Date(fact.value) : null;
  } catch {
    return null;
  }
}

async function setCompactionWatermark(prisma, userId, isoDate) {
  try {
    await prisma.fact.create({
      data: { userId, key: WATERMARK_KEY, value: isoDate, type: 'state' },
    });
  } catch (e) {
    console.warn('[memory-compaction] watermark save failed (non-fatal):', e.message);
  }
}

async function summarizeChunkWithLLM(chunkText) {
  try {
    const r = await openai.chat.completions.create({
      model: process.env.SHERZ_SUMMARY_MODEL || 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Summarize this conversation excerpt in 2-3 concise sentences, capturing specific topics, decisions, or emotional context discussed. Write in the same language as the conversation. No commentary, no meta-text, just the summary.',
        },
        { role: 'user', content: chunkText.slice(0, 6000) },
      ],
      temperature: 0.3,
      max_tokens: 200,
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
  try {
    const watermark = await getCompactionWatermark(prisma, userId);
    const where = watermark ? { userId, createdAt: { gt: watermark } } : { userId };

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
    const chunkText = chunk.map(m => `${m.role}: ${m.text}`).join('\n');

    const summaryText = await summarizeChunkWithLLM(chunkText);
    if (!summaryText) return { compacted: false, reason: 'summary_generation_failed' };

    const dateLabel = chunk[0].createdAt.toISOString().slice(0, 10);
    const summaryFact = await prisma.fact.create({
      data: {
        userId,
        key: `conversation_summary_${dateLabel}_${chunk[0].id}`, // unique per chunk start
        value: summaryText,
        type: 'conversation_summary',
        pinned: true, // resist aging out of the RAG top-80 pool as new facts accumulate
      },
    });

    await createFactEmbedding(prisma, summaryFact.id, summaryText);

    const newWatermark = chunk[chunk.length - 1].createdAt.toISOString();
    await setCompactionWatermark(prisma, userId, newWatermark);

    return { compacted: true, factId: summaryFact.id, messagesCompacted: chunk.length, newWatermark };
  } catch (e) {
    console.error('[memory-compaction] error:', e);
    return { compacted: false, error: e.message };
  }
}
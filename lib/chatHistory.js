// lib/chatHistory.js
//
// Messages are grouped into conversations (see conversations.js); pass conversationId to read ONE of them,
// or omit it to read the user's whole history. Two different reads over the same Message table:
//   fetchPage()          -> what the UI shows: newest page first, older pages on demand
//   fetchContextForLLM() -> what the model sees: only the most recent turns, size-capped
// Long-term continuity comes from Facts/profile memory, not from replaying old chat.

const MAX_PAGE = 100;
const ELIDE_TO = 1500;
const elide = (t) => (t.length <= ELIDE_TO ? t : `${t.slice(0, 900)}\n…[${t.length - 1400} characters left out]…\n${t.slice(-500)}`);

export function encodeCursor(m) {
  return `${new Date(m.createdAt).getTime()}_${m.id}`;
}

/** Returns {t:Date,id:string} or null for empty; throws RangeError for a malformed cursor. */
export function decodeCursor(c) {
  if (c === undefined || c === null || c === '') return null;
  const m = /^(\d{10,15})_([A-Za-z0-9_-]{1,64})$/.exec(String(c));
  if (!m) throw new RangeError('bad cursor');
  return { t: new Date(Number(m[1])), id: m[2] };
}

const toClient = (m) => ({
  id: m.id,
  role: m.role === 'assistant' ? 'ai' : 'user',
  text: m.text,
  ts: new Date(m.createdAt).getTime(),
});

/**
 * Cursor pagination, newest first. `before` = nextCursor from the previous page.
 * (createdAt, id) is the cursor so messages created in the same millisecond never
 * get skipped or repeated. Messages come back oldest->newest, ready to render.
 */
export async function fetchPage(prisma, userId, { before, limit = 25, conversationId } = {}) {
  const take = Math.min(Math.max(parseInt(limit, 10) || 25, 1), MAX_PAGE);
  const cur = decodeCursor(before);
  const scope = conversationId ? { userId, conversationId: String(conversationId) } : { userId };
  const where = cur
    ? { ...scope, OR: [{ createdAt: { lt: cur.t } }, { createdAt: cur.t, id: { lt: cur.id } }] }
    : scope;

  const rows = await prisma.message.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: take + 1, // one extra row tells us whether older messages exist
  });

  const hasMore = rows.length > take;
  const page = rows.slice(0, take).reverse();
  return {
    messages: page.map(toClient),
    hasMore,
    nextCursor: hasMore && page.length ? encodeCursor(page[0]) : null,
  };
}

/** Latest turns for the model: newest `maxMessages`, trimmed from the old end to `maxChars`. */
export async function fetchContextForLLM(prisma, userId, { maxMessages = 20, maxChars = 12000, conversationId } = {}) {
  const rows = await prisma.message.findMany({
    where: conversationId ? { userId, conversationId: String(conversationId) } : { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: maxMessages,
  });
  const turns = rows
    .reverse()
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text)
    .map((m) => ({ role: m.role, content: String(m.text) }));

  let total = turns.reduce((n, t) => n + t.content.length, 0);
  while (turns.length > 1 && total > maxChars) {
    // over budget: first shrink the biggest OLDER turn (a long paste / log) to its head + tail, so the conversation around it survives;
    // only when nothing big is left to shrink does the oldest turn drop out. The newest turn is never touched.
    let big = -1;
    for (let i = 0; i < turns.length - 1; i++) if (turns[i].content.length > ELIDE_TO && (big < 0 || turns[i].content.length > turns[big].content.length)) big = i;
    if (big >= 0) {
      const before = turns[big].content.length;
      turns[big].content = elide(turns[big].content);
      total -= before - turns[big].content.length;
    } else total -= turns.shift().content.length;
  }
  return turns;
}

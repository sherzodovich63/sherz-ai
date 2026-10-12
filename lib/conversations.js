// lib/conversations.js
//
// Two kinds of conversation per user, on top of the Message table:
//   companion  - exactly ONE per user: the endless personal thread (casual talk, life, general memory).
//                It is created on demand, can't be renamed or deleted, and adopts every message that has no
//                conversation yet (old history, proactive messages written by the proactive runner).
//   project    - any number: a focused workspace the user creates by name ("E-commerce Backend").
//                Turns inside a project run in Work/Engineering mode (see brain/workMode.js).
// Long-term memory (Facts / profile) stays PER USER; only the short-term LLM context (last N turns) is per
// conversation. Every function takes the verified userId and only ever touches that user's rows.

export const COMPANION_TITLE = 'Companion';
export const KIND_COMPANION = 'companion';
export const KIND_PROJECT = 'project';
const MAX_TITLE = 80;
const MAX_DESC = 400;
const MAX_PROJECTS = 200;

export function cleanTitle(t) {
  return String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
}
export function cleanDescription(t) {
  return String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_DESC);
}

const toClient = (c) => ({
  id: c.id,
  kind: c.kind === KIND_PROJECT ? KIND_PROJECT : KIND_COMPANION,
  title: c.kind === KIND_PROJECT ? c.title : COMPANION_TITLE,
  description: c.description || '',
  createdAt: new Date(c.createdAt).getTime(),
  updatedAt: new Date(c.updatedAt).getTime(),
});

/** Work mode settings for a conversation row, or null for the companion thread. */
export function workModeFor(conv) {
  if (!conv || conv.kind !== KIND_PROJECT) return null;
  return { projectName: conv.title || 'Project', description: conv.description || '' };
}

// ── the companion thread (created on demand; legacy/orphan messages and duplicates are folded in) ──
const ensuring = new Map();
export function ensureCompanion(prisma, userId) {
  if (ensuring.has(userId)) return ensuring.get(userId);
  const p = (async () => {
    const all = await prisma.conversation.findMany({ where: { userId, kind: KIND_COMPANION }, take: 50 });
    all.sort((a, b) => (new Date(a.createdAt) - new Date(b.createdAt)) || (a.id < b.id ? -1 : 1));
    let main = all[0];
    if (!main) {
      main = await prisma.conversation.create({ data: { userId, kind: KIND_COMPANION, title: COMPANION_TITLE } });
    } else {
      // older builds allowed many chats: fold them into the one thread (nothing is lost, order is by timestamp)
      for (const extra of all.slice(1)) {
        await prisma.message.updateMany({ where: { userId, conversationId: extra.id }, data: { conversationId: main.id } });
        await prisma.conversation.delete({ where: { id: extra.id } });
      }
    }
    // messages written without a conversation (pre-conversation history, proactive pings) belong to the thread
    await prisma.message.updateMany({ where: { userId, conversationId: null }, data: { conversationId: main.id } });
    return main;
  })().finally(() => ensuring.delete(userId));
  ensuring.set(userId, p);
  return p;
}

/** Creates a project. `title` is required. */
export async function createProject(prisma, userId, { title, description } = {}) {
  const t = cleanTitle(title);
  if (!t) throw new RangeError('project name required');
  const count = await prisma.conversation.findMany({ where: { userId, kind: KIND_PROJECT }, take: MAX_PROJECTS + 1 });
  if (count.length >= MAX_PROJECTS) throw new RangeError('too many projects');
  const c = await prisma.conversation.create({
    data: { userId, kind: KIND_PROJECT, title: t, description: cleanDescription(description) || null },
  });
  return toClient(c);
}

/**
 * [companion, ...projects newest-activity first]. `q` matches name/goal OR any message text; the companion
 * thread is listed whenever the thread's messages match (or when not searching). Empty projects are shown.
 */
export async function listConversations(prisma, userId, { q, limit = 200 } = {}) {
  const companion = await ensureCompanion(prisma, userId);
  const term = String(q ?? '').trim().slice(0, 100);
  const take = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500);

  const textHit = { messages: { some: { text: { contains: term, mode: 'insensitive' } } } };
  const where = { userId, kind: KIND_PROJECT };
  if (term) where.OR = [{ title: { contains: term, mode: 'insensitive' } }, { description: { contains: term, mode: 'insensitive' } }, textHit];
  const projects = await prisma.conversation.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take });
  projects.sort((a, b) => (new Date(b.updatedAt) - new Date(a.updatedAt)) || (b.id < a.id ? -1 : 1));

  let showCompanion = true;
  if (term) {
    showCompanion = !!(await prisma.conversation.findFirst({
      where: { id: companion.id, userId, OR: [{ title: { contains: term, mode: 'insensitive' } }, textHit] },
    })) || COMPANION_TITLE.toLowerCase().includes(term.toLowerCase());
  }
  return [...(showCompanion ? [toClient(companion)] : []), ...projects.map(toClient)];
}

/**
 * Renames a project and/or edits its goal. Returns null if it isn't this user's.
 * The companion thread can't be changed (RangeError).
 */
export async function updateConversation(prisma, userId, id, { title, description } = {}) {
  const owned = await prisma.conversation.findFirst({ where: { id: String(id), userId } });
  if (!owned) return null;
  if (owned.kind !== KIND_PROJECT) throw new RangeError('the companion thread cannot be renamed');
  const data = {};
  if (title !== undefined) { const t = cleanTitle(title); if (!t) throw new RangeError('project name required'); data.title = t; }
  if (description !== undefined) data.description = cleanDescription(description) || null;
  if (!Object.keys(data).length) throw new RangeError('nothing to update');
  return toClient(await prisma.conversation.update({ where: { id: owned.id }, data }));
}

/** Deletes a project and its messages. false = not this user's. The companion thread can't be deleted (RangeError). */
export async function deleteConversation(prisma, userId, id) {
  const owned = await prisma.conversation.findFirst({ where: { id: String(id), userId } });
  if (!owned) return false;
  if (owned.kind !== KIND_PROJECT) throw new RangeError('the companion thread cannot be deleted');
  await prisma.message.deleteMany({ where: { conversationId: owned.id, userId } });
  await prisma.conversation.delete({ where: { id: owned.id } });
  return true;
}

/**
 * Which conversation does this turn belong to?
 *   an owned id                     -> that one (a project, or the companion thread)
 *   anything else (omitted, 'new',
 *   unknown, someone else's id)     -> the companion thread (never reveals or writes into foreign rows)
 */
export async function resolveConversation(prisma, userId, conversationId) {
  if (typeof conversationId === 'string' && conversationId && conversationId !== 'new') {
    const own = await prisma.conversation.findFirst({ where: { id: conversationId, userId } });
    if (own) return own;
  }
  return ensureCompanion(prisma, userId);
}

/** Saves both sides of a turn into the conversation and bumps it to the top of the list. Returns its id. */
export async function saveTurn(prisma, { userId, conversationId, userText, aiText }) {
  const conv = await resolveConversation(prisma, userId, conversationId);
  await prisma.message.create({ data: { userId, conversationId: conv.id, role: 'user', text: userText } });
  await prisma.message.create({ data: { userId, conversationId: conv.id, role: 'assistant', text: aiText } });
  await prisma.conversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });
  return conv.id;
}

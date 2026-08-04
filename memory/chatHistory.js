// memory/chatHistory.js

/**
 * Oxirgi N ta chat xabarni (user + assistant) olib kelish.
 * Natija OpenAI messages formatida: { role, content }[]
 */
export async function loadRecentChatHistory(prisma, userId, limit = 20) {
  if (!userId) return [];

  const rows = await prisma.message.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      role: true,
      text: true,
      createdAt: true,
    },
  });

  // Eng eski xabar boshida bo‘lishi uchun teskari qilib qaytaramiz
  return rows.reverse().map((m) => ({
    role: m.role,
    content: m.text,
  }));
}

/**
 * Bitta turn (userMessage + assistantMessage) ni saqlash
 */
export async function saveChatTurn(prisma, userId, userMessage, assistantMessage) {
  if (!userId) return;

  const data = [];

  if (userMessage?.trim()) {
    data.push({
      userId,
      role: 'user',
      text: userMessage.trim(),
    });
  }

  if (assistantMessage?.trim()) {
    data.push({
      userId,
      role: 'assistant',
      text: assistantMessage.trim(),
    });
  }

  if (data.length === 0) return;

  await prisma.message.createMany({ data });
}

/**
 * ✅ UI uchun chat history olish
 * - items: [{ id, role, text, createdAt }]
 * - nextCursor: keyingi page uchun id (yoki null)
 *
 * Params:
 *  - limit: 1..200
 *  - cursor: message.id (optional) — pagination uchun
 */
export async function getChatHistoryForUser(prisma, userId, { limit = 50, cursor = null } = {}) {
  if (!userId) return { items: [], nextCursor: null };

  const take = Math.min(Math.max(Number(limit) || 50, 1), 200);

  const rows = await prisma.message.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: take + 1, // 1 ta ortiq olamiz (cursor aniqlash uchun)
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      role: true,
      text: true,
      createdAt: true,
    },
  });

  let nextCursor = null;
  if (rows.length > take) {
    const extra = rows.pop();
    nextCursor = extra.id;
  }

  // UI uchun eski -> yangi tartib
  const items = rows.reverse();

  return { items, nextCursor };
}

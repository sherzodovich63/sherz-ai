// ✅ Reply-tracking fix: the "Xohlasangiz hozircha jim turaymi? (Ha / Yo'q)" ask
// was never recorded as answered (nothing ever set permissionResult), so the
// boundary logic could not tell a user who said "Ha"/"Yo'q" from one who ignored it.
// Conservative on purpose: only a clear yes/no at the START of the message counts;
// anything else returns null and is treated as an ordinary reply.
//   'granted' = yes, stay quiet     'deny' = no, don't go quiet
export function classifyPermissionAnswer(text) {
  const t = String(text || '')
    .toLowerCase()
    .replace(/[‘’ʻʼ`´]/g, "'")
    .trim();
  if (!t) return null;
  if (/^(yo'?q|yoq|no|nope|kerak emas)\b/.test(t)) return 'deny';
  if (/^(ha+|xa+|xo'?p|mayli|ok|okay|yes|jim tur\w*|tur\w*)\b/.test(t)) return 'granted';
  return null;
}

export async function recordReplyToLastProactive({ prisma, userId, text = '' }) {
  // 1) An unanswered permission ask (24h reply window) + a clear yes/no -> record the answer.
  // Wrapped: if the LAB6 columns aren't migrated this throws, and we fall through
  // to the original behavior below instead of breaking the chat turn.
  try {
    const answer = classifyPermissionAnswer(text);
    if (answer) {
      const ask = await prisma.proactiveEvent.findFirst({
        where: {
          userId,
          delivered: true,
          permissionAsked: true,
          permissionResult: null,
          sentAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        orderBy: { sentAt: 'desc' },
      });
      if (ask) {
        const at = new Date();
        return await prisma.proactiveEvent.update({
          where: { id: ask.id },
          data: {
            gotReply: true,
            replyAt: at,
            replyLatencyS: Math.max(0, Math.floor((at.getTime() - new Date(ask.sentAt).getTime()) / 1000)),
            awaitingReply: false,
            permissionResult: answer,
          },
        });
      }
    }
  } catch (e) {
    console.log('⚠️ permission answer not recorded:', e?.message || e);
  }

  const last = await prisma.proactiveEvent.findFirst({
    where: {
      userId,
      delivered: true,
      sentAt: { not: null },
      gotReply: false,
      // 6 soat window
      sentAt: { gte: new Date(Date.now() - 6 * 60 * 60 * 1000) }
    },
    orderBy: { sentAt: 'desc' }
  });

  if (!last) return null;

  const now = new Date();
  const latencyS = Math.max(
    0,
    Math.floor((now.getTime() - new Date(last.sentAt).getTime()) / 1000)
  );

  return prisma.proactiveEvent.update({
    where: { id: last.id },
    data: {
      gotReply: true,
      replyAt: now,
      replyLatencyS: latencyS
    }
  });
}
export async function recordReplyToLastProactive({ prisma, userId }) {
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

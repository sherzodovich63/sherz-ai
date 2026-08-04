export async function logProactiveDecision({ prisma, userId, decision, nowLocal }) {
  const d = decision || {};
  const hourLocal = typeof nowLocal?.hour === 'function' ? nowLocal.hour() : null;
  const dayOfWeek = typeof nowLocal?.day === 'function' ? nowLocal.day() : null;

  return prisma.proactiveEvent.create({
    data: {
      userId,
      shouldMessage: !!d.shouldMessage,
      reason: d.reason || null,
      tone: d.tone || null,
      message: d.message || null,
      hourLocal,
      dayOfWeek,
    }
  });
}

export async function markProactiveSent({ prisma, eventId }) {
  return prisma.proactiveEvent.update({
    where: { id: eventId },
    data: { delivered: true, sentAt: new Date() }
  });
}

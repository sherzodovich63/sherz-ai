export function messagesRoute(app, prisma) {
  app.get('/api/messages', async (req, res) => {
    const userId = String(req.query.userId || 'u1');

    const rows = await prisma.message.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      take: 200
    });

    res.json({ ok: true, messages: rows });
  });
}

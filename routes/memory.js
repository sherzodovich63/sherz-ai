export function memoryRoute(app, prisma) {
  // System-fact filter: ichki tizim xotiralarini ajratib olish
  const isSystemFact = (f) =>
    f.type === 'learning' ||
    f.type === 'state' ||
    String(f.key || '').startsWith('learn:') ||
    String(f.key || '').startsWith('proactive_') ||
    String(f.key || '').startsWith('last_state') ||
    String(f.key || '').startsWith('feedback:');

  // GET /api/memory/:userId — pinned + recent facts + preferences
  app.get('/api/memory/:userId', async (req, res) => {
    try {
      const userId = String(req.params.userId);

      const allFacts = await prisma.fact.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      const userFacts = allFacts.filter(f => !isSystemFact(f));
      const pinned = userFacts.filter(f => f.pinned).slice(0, 8);
      const recent = userFacts.filter(f => !f.pinned).slice(0, 20);

      const profile = await prisma.userProfile.findUnique({ where: { userId } });

      res.json({
        ok: true,
        pinned,
        recent,
        preferences: {
          preferredName: profile?.preferredName || profile?.displayName || '',
          lengthPref: profile?.lengthPref || 'auto',
          tonePref: profile?.tonePref || 'friendly',
          energyPref: profile?.energyPref || 'balanced',
        },
      });
    } catch (err) {
      console.error('[memory] GET error:', err.message);
      res.status(500).json({ ok: false, error: 'MEMORY_LOAD_FAILED' });
    }
  });

  // POST /api/memory/:userId/facts/:factId/pin — pin tugmasini bosganda
  app.post('/api/memory/:userId/facts/:factId/pin', async (req, res) => {
    try {
      const { factId } = req.params;
      const fact = await prisma.fact.findUnique({ where: { id: factId } });
      if (!fact) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

      const updated = await prisma.fact.update({
        where: { id: factId },
        data: { pinned: !fact.pinned },
      });

      res.json({ ok: true, pinned: updated.pinned });
    } catch (err) {
      console.error('[memory] pin error:', err.message);
      res.status(500).json({ ok: false, error: 'PIN_FAILED' });
    }
  });

  // DELETE /api/memory/:userId/facts/:factId — xotirani o'chirish
  app.delete('/api/memory/:userId/facts/:factId', async (req, res) => {
    try {
      await prisma.fact.delete({ where: { id: req.params.factId } });
      res.json({ ok: true });
    } catch (err) {
      console.error('[memory] delete error:', err.message);
      res.status(500).json({ ok: false, error: 'DELETE_FAILED' });
    }
  });

  // PATCH /api/memory/:userId/preferences — sozlamalarni yangilash
  app.patch('/api/memory/:userId/preferences', async (req, res) => {
    try {
      const userId = String(req.params.userId);
      const { lengthPref, tonePref, energyPref, preferredName } = req.body || {};

      const data = {};
      if (lengthPref) data.lengthPref = String(lengthPref);
      if (tonePref) data.tonePref = String(tonePref);
      if (energyPref) data.energyPref = String(energyPref);
      if (preferredName !== undefined) data.preferredName = String(preferredName).slice(0, 60);

      const updated = await prisma.userProfile.upsert({
        where: { userId },
        update: data,
        create: { userId, ...data },
      });

      res.json({ ok: true, preferences: updated });
    } catch (err) {
      console.error('[memory] preferences update error:', err.message);
      res.status(500).json({ ok: false, error: 'PREFS_UPDATE_FAILED' });
    }
  });
}
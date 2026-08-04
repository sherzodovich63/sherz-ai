// src/memory/lastState.js  (ESM)

export async function loadLastState(prisma, userId) {
  if (!prisma || !userId) return null;
  return prisma.brainState.findUnique({ where: { userId } });
}

export async function saveLastState(prisma, userId, patch = {}) {
  if (!prisma || !userId) return null;

  return prisma.brainState.upsert({
    where: { userId },
    create: { userId, ...patch },
    update: { ...patch },
  });
}

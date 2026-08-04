// memory/userProfileRepo.js (ESM)

/**
 * UserProfile — FAZA 4
 * prisma.userProfile jadvali bilan ishlaydi
 */

export async function getUserProfile(prisma, userId) {
  if (!prisma) return null;
  if (!userId) return null;

  return prisma.userProfile.findUnique({
    where: { userId },
  });
}

export async function upsertUserProfile(prisma, userId, patch = {}) {
  if (!prisma) return null;
  if (!userId) return null;

  const data = patch && typeof patch === "object" ? patch : {};
  const keys = Object.keys(data);

  // patch bo‘sh bo‘lsa update qilmaymiz
  if (keys.length === 0) {
    return getUserProfile(prisma, userId);
  }

  return prisma.userProfile.upsert({
    where: { userId },
    create: { userId, ...data },
    update: { ...data },
  });
}

/**
 * SHERZ userdan “Sizni nima deb chaqiray?”
 * degan savolni berganini belgilash (faqat 1 marta)
 */
export async function markAskedName(prisma, userId) {
  if (!prisma) return null;
  if (!userId) return null;

  const now = new Date();

  return prisma.userProfile.upsert({
    where: { userId },
    create: {
      userId,
      askedNameAt: now,
    },
    update: {
      askedNameAt: now,
    },
  });
}

/**
 * preferredName bo‘lsa o‘sha,
 * bo‘lmasa displayName,
 * bo‘lmasa null
 */
export function getBestName(profile) {
  const p = profile || {};
  const name = (p.preferredName || p.displayName || "").trim();
  return name || null;
}

// nlu/saveMemoryFacts.js
// SHERZ-AI Memory NLU → Prisma Fact integratsiyasi

/**
 * Memory NLU faktlarini Prisma Fact jadvaliga saqlash.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} userId
 * @param {Array<{ key: string; value: string; confidence: number; source: string; sourceText: string }>} facts
 */
export async function saveMemoryFactsForUser(prisma, userId, facts) {
  if (!userId || !facts || !Array.isArray(facts) || facts.length === 0) return;

  for (const f of facts) {
    const key = sanitize(f.key);
    const value = sanitize(f.value);

    if (!key || !value) continue;

    const type = inferFactType(key);
    const rating = inferRating(key);

    // Avval DBda bormi tekshiramiz (duplicate oldini olish)
    const existing = await prisma.fact.findFirst({
      where: { userId, key, value },
    });

    if (existing) {
      // Faqat type yoki rating o‘zgarsa yangilanadi
      await prisma.fact.update({
        where: { id: existing.id },
        data: {
          type,
          rating,
        },
      });
    } else {
      // Yangi fact yaratamiz
      await prisma.fact.create({
        data: {
          userId,
          key,
          value,
          type,
          time: null,
          rating,
        },
      });
    }
  }
}

/*-----------------------------------------
 🔍 QO‘SHIMCHA FUNKSIYALAR
------------------------------------------*/

// Matnni tozalash
function sanitize(s) {
  if (!s) return "";
  return String(s).trim();
}

// Fact turini aniqlash
function inferFactType(key) {
  if (key.startsWith("favorite_")) return "memory:preference";
  if (key === "like") return "memory:preference";
  if (key === "dislike") return "memory:preference";

  if (key === "goal" || key === "fear") return "memory:meta";

  return "memory"; // umumiy holat
}

// Bahoni (rating) aniqlash
function inferRating(key) {
  if (key === "dislike") return -1;
  if (key === "like") return 1;
  if (key.startsWith("favorite_")) return 1;
  return null;
}

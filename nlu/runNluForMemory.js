// src/nlu/runNluForMemory.js
import OpenAI from "openai";
import { MEMORY_KEYS } from "./memoryTypes.js";

/** @type {OpenAI} */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * @param {string} userText
 * @returns {Promise<import("./memoryTypes.js").MemoryNluResult>}
 */
export async function runNluForMemory(userText) {
  if (!userText || !userText.trim()) {
    return { facts: [] };
  }

  const systemPrompt = `
Sen SHERZ-AI uchun maxsus yaratilgan "Memory NLU" modulsan.
Vazifang: foydalanuvchi matnidan uzoq muddatli xotira uchun kerakli faktlarni chiqarish.

Muhim qoidalar:
- Faqat aniq aytilgan narsalarni ol, taxmin qilma.
- Agar fakt aniq bo'lmasa, uni umuman qo'shma.
- Har bir fakt uchun 0.0 dan 1.0 gacha "confidence" (ishonch darajasi) ber.
- Matn o'zbek, rus yoki ingliz tilida bo'lishi mumkin — hammasini tushunasan.

JSON format quyidagicha bo'lishi SHART:

{
  "facts": [
    {
      "key": "favorite_food",
      "value": "osh",
      "confidence": 0.95,
      "source": "user_message",
      "sourceText": "Mening eng sevimli taomim osh."
    }
  ]
}

Ruxsat etilgan "key" lar (MemoryFieldKey) faqat quyidagilar:

- "favorite_food"
- "favorite_drink"
- "wake_time"
- "sleep_time"
- "favorite_music"
- "favorite_artist"
- "favorite_person"
- "home_city"
- "work_schedule"
- "interest"
- "like"
- "dislike"
- "goal"
- "fear"
- "birthday"

Qoidalar:
- Agar foydalanuvchi matnida bir xil kategoriya bo'yicha bir nechta narsa bo'lsa
  (masalan, bir nechta sevimli taom) — har biri uchun alohida "fact" yoz.
- Sanalarni imkon qadar "YYYY-MM-DD" formatiga standartlashtirishga harakat qil,
  lekin foydalanuvchi aynan shunday yozmagan bo'lsa ham, original matn "value"da saqlanadi.
- "confidence" ni aniq gaplar uchun 0.9+ qil, noaniqroq bo'lsa 0.5–0.8 atrofida.
- Agar foydalanuvchi hazillashayotgan bo'lsa ham, ohangdan kelib chiqib
  haqiqatga o'xshasa, fact sifatida olishing mumkin.

Faqat bitta JSON obyektini qaytar, boshqa izoh, matn yoki sharhlar qo'shma.
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",   // Xohlasang katta modelga almashtirasan
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userText },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content ?? "{}";

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("runNluForMemory JSON parse error:", err, raw);
    return { facts: [] };
  }

  // Basic validatsiya + filtr
  let facts = Array.isArray(parsed.facts) ? parsed.facts : [];

  // Filtrlash: noto'g'ri key'larni olib tashlash, confidence normalizatsiya
  facts = facts
    .filter((f) => f && MEMORY_KEYS.includes(f.key))
    .map((f) => ({
      key: f.key,
      value: String(f.value ?? "").trim(),
      confidence: clampNumber(f.confidence, 0, 1),
      source: "user_message",
      sourceText: String(f.sourceText ?? "").trim() || userText,
    }))
    .filter((f) => f.value.length > 0);

  return { facts };
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 */
function clampNumber(value, min, max) {
  const n = typeof value === "number" ? value : 0;
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

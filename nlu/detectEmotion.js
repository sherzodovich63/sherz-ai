//nlu/detectEmotion.js (ESM)

import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

/**
 * Foydalanuvchi matnidan emotion aniqlaydi
 *
 * @param {Object} params
 * @param {string} params.userId - foydalanuvchi ID (optional)
 * @param {string} params.text - foydalanuvchi yozgan matn
 */
export async function detectEmotion({ userId = 'LOCAL_USER', text }) {
  const cleanText = (text || '').trim();

  // Matn bo'sh bo'lsa — emotion aniqlamaymiz
  if (!cleanText) {
    return {
      ok: false,
      reason: 'EMPTY_TEXT',
      emotion: 'neutral',
      intensity: 'low',
      confidence: 0,
    };
  }

  if (!process.env.OPENAI_API_KEY) {
    console.warn('⚠️ detectEmotion: OPENAI_API_KEY yo‘q');
    return {
      ok: false,
      reason: 'NO_API_KEY',
      emotion: 'neutral',
      intensity: 'low',
      confidence: 0,
    };
  }

  try {
    // Model nomini istasang env orqali boshqarishing mumkin
    const model =
      process.env.SHERZ_EMOTION_MODEL ||
      process.env.SHERZ_BRAIN_MODEL ||
      'gpt-4.1-mini';

    const response = await openai.chat.completions.create({
      model,
      response_format: { type: 'json_object' },
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: [
            'Sen SHERZ-AI uchun kichik NLU modulsan.',
            'Faqat foydalanuvchi matnidan HISSIY HOLAT (emotion) va unga ishonch darajasini aniqlaysan.',
            'Faqat JSON obyekt qaytarasan.',
            '',
            'Ruxsat etilgan emotion label’lar:',
            '- "happy"',
            '- "sad"',
            '- "tired"',
            '- "stressed"',
            '- "angry"',
            '- "calm"',
            '- "anxious"',
            '- "neutral"',
            '',
            'Ruxsat etilgan intensity:',
            '- "low"',
            '- "medium"',
            '- "high"',
            '',
            'Natija JSON formatida bo‘lishi shart:',
            '{',
            '  "emotion": "sad",       // yuqoridagi ro‘yxatdan',
            '  "intensity": "high",    // "low" | "medium" | "high"',
            '  "confidence": 0.92,     // 0 dan 1 gacha raqam',
            '  "reason": "User mentions headache and feeling bad all day."',
            '}',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `User ID: ${userId}\nMatn: """${cleanText}"""`,
        },
      ],
    });

    let parsed;
    try {
      const raw = response.choices[0]?.message?.content || '{}';
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error('❌ detectEmotion: JSON parse error', e);
      parsed = {};
    }

    const emotion = normalizeEmotion(parsed.emotion);
    const intensity = normalizeIntensity(parsed.intensity);
    const confidence =
      typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.0;

    const result = {
      ok: true,
      userId,
      text: cleanText,
      emotion,
      intensity,
      confidence,
      reason: parsed.reason || null,
      raw: parsed,
    };

    console.log('🎭 detectEmotion result:', result);

    return result;
  } catch (err) {
    console.error('❌ detectEmotion error:', err);
    return {
      ok: false,
      reason: 'OPENAI_ERROR',
      emotion: 'neutral',
      intensity: 'low',
      confidence: 0,
      error: String(err?.message || err),
    };
  }
}

/**
 * Kelayotgan emotion qiymatini standarlashtiramiz
 */
function normalizeEmotion(value) {
  const v = String(value || '').toLowerCase().trim();

  const allowed = [
    'happy',
    'sad',
    'tired',
    'stressed',
    'angry',
    'calm',
    'anxious',
    'neutral',
  ];

  if (allowed.includes(v)) return v;

  // Sinonimlarni ham qamrab olish uchun oddiy mapping
  if (['depressed', 'down', 'unhappy'].includes(v)) return 'sad';
  if (['mad', 'furious'].includes(v)) return 'angry';
  if (['worried', 'nervous'].includes(v)) return 'anxious';
  if (['ok', 'fine', 'normal'].includes(v)) return 'neutral';
  if (['relaxed', 'chill'].includes(v)) return 'calm';

  return 'neutral';
}

/**
 * Intensity qiymatini standarlashtirish
 */
function normalizeIntensity(value) {
  const v = String(value || '').toLowerCase().trim();
  if (['low', 'medium', 'high'].includes(v)) return v;
  return 'medium';
}

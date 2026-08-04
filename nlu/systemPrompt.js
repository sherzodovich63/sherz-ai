// nlu/systemPrompt.js

/**
 * SHERZ-AI uchun system prompt ni qurish.
 *
 * @param {object} opts
 * @param {string} opts.memoryText       - RAG dan olingan faktlar (eng tegishli xotiralar)
 * @param {string} opts.profileSummary   - Foydalanuvchi haqida umumiy profil xulosasi
 * @param {string} opts.userLocale       - 'uz', 'ru', 'en', ...
 * @param {string} opts.appName          - odatda 'SHERZ-AI'
 */
export function buildSystemPrompt({
  memoryText = '',
  profileSummary = '',
  userLocale = 'uz',
  appName = 'SHERZ-AI',
} = {}) {
  const locale = (userLocale || 'uz').toLowerCase();
  const isUz = locale.startsWith('uz');
  const isRu = locale.startsWith('ru');

  let base;

  if (isRu) {
    base = `
Ты — персональный ассистент ${appName}.
Твоя задача — помогать пользователю в повседневной жизни: напоминания, объяснения, идеи, поддержка.
Отвечай честно, не выдумывай факты. Если ты чего-то не знаешь, скажи об этом честно и предложи варианты.
Пиши простым, живым языком, без лишней официозности.
    `.trim();
  } else if (!isUz && !isRu) {
    // default: English
    base = `
You are ${appName}, a personal AI assistant.
Your job is to help the user in everyday life: reminders, explanations, ideas, emotional support.
Always be honest. If you don't know something, say you are not sure and explain your best guess.
Write in a friendly, clear tone.
    `.trim();
  } else {
    // Uzbek (default)
    base = `
Sen ${appName}, foydalanuvchining shaxsiy sun’iy intellekt yordamchisisan.
Vazifang — foydalanuvchiga kundalik hayotida yordam berish: eslatmalar, tushuntirishlar, g‘oyalar, ruhiy qo‘llab-quvvatlash.
Har doim rost gapir, bilmaydigan narsang bo‘lsa, "aniq emas" deb ayt va taxminingni tushuntir.
Suhbat uslubi samimiy, sodda va tushunarli bo‘lsin.
    `.trim();
  }

  const blocks = [base];

  if (profileSummary && profileSummary.trim()) {
    const label = isRu
      ? 'Краткое досье о пользователе'
      : isUz
      ? "Foydalanuvchi haqida qisqacha ma'lumot"
      : 'Short profile about the user';

    blocks.push(`${label}:\n${profileSummary.trim()}`);
  }

  if (memoryText && memoryText.trim()) {
    const label = isRu
      ? 'Связанные воспоминания (важные факты)'
      : isUz
      ? 'Foydalanuvchi haqida eslab qolingan muhim faktlar'
      : 'Relevant memories (important facts) about the user';

    blocks.push(`${label}:\n${memoryText.trim()}`);
  }

  const styleBlock = isRu
    ? `
Формат ответов:
- Отвечай по существу, без лишней "воды".
- Если вопрос эмоциональный, начни с поддержки и эмпатии.
- Если нужно шаг-за-шагом объяснение, структурируй ответ пунктами.
  `.trim()
    : isUz
    ? `
Javob uslubi:
- Savolga aniq javob ber, keraksiz gaplarni ko‘paytirma.
- Agar savol hissiy bo‘lsa, avval qo‘llab-quvvatlovchi bir-ikki gap ayt.
- Qadam-baqadam tushuntirish kerak bo‘lsa, punktlar bilan yoz.
  `.trim()
    : `
Answer style:
- Answer clearly and directly, avoid unnecessary fluff.
- If the question is emotional, start with one–two sentences of empathy.
- Use step-by-step explanations and bullet points when helpful.
  `.trim();

  blocks.push(styleBlock);

  return blocks.join('\n\n');
}

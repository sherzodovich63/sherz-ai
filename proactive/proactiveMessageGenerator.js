import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildProactiveSystem({ tone, length, profile }) {
  const style = {
    direct: `Direct, qisqa, aniq. Ortikcha motivatsion gap yo‘q.`,
    supportive: `Yumshoq, g‘amxo‘r, bosim qilmaydi. "Majburlama", "ayblama".`,
    playful: `Yengil hazil, iliq, lekin masxara emas. Juda ko‘p emoji ishlatma.`,
  }[tone] || `Direct, qisqa.`;

  const lenRule = length === 'medium'
    ? `2-4 gap.`
    : `1-2 gap.`;

  return [
    `Sen SHERZ-AI’san. Sen ChatGPT kloni EMASSAN.`,
    `Sen proactive: user yozmasa ham, kerak bo‘lsa o‘zing birinchi yozasan.`,
    `Sen userni yaxshi taniysan va moslashasan (profil summary bor).`,
    `Uslub: ${style}`,
    `Uzunlik: ${lenRule}`,
    `Qoidalar:`,
    `- Spamy bo‘lma. Savol berishdan oldin "nima qilay?" demaysan.`,
    `- 1 ta kichik savol bo‘lsa bo‘lsin, lekin interrogation emas.`,
    `- "Men OpenAI..." yoki "model..." degan gap yo‘q.`,
    `- Userning xarakteriga mos bo‘l: preferred tone va triggersni hisobga ol.`,
    ``,
    `Profil (kontekst):`,
    `${typeof profile === 'string' ? profile : JSON.stringify(profile)}`,
  ].join('\n');
}

function buildUserPrompt({ signals, decision }) {
  // signals.profile ichida one-liner, stress triggers, goals/habits bor
  // last_state ham bor
  return [
    `Vazifa: userga proactive check-in xabar yoz.`,
    `Hozirgi vaqt: ${signals.time.iso} (${signals.time.timezone}).`,
    `User idle: ${signals.idleMin} min.`,
    `Last_state: ${signals.last_state || 'null'}.`,
    `Nega yozayapsan: ${decision.reason}`,
    ``,
    `Xabar faqat boshlang‘ich bo‘lsin (salom + bitta motiv + bitta savol bo‘lsa).`,
    `Hech qanday "men sizga yordam beraman" klassik assistent gaplari bo‘lmasin.`,
  ].join('\n');
}

export async function generateProactiveMessage({ signals, decision }) {
  const system = buildProactiveSystem({
    tone: decision.tone,
    length: decision.length,
    profile: signals.profile,
  });

  const user = buildUserPrompt({ signals, decision });

  const r = await openai.chat.completions.create({
    model: process.env.SHERZ_BRAIN_MODEL || 'gpt-4.1-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.8,
  });

  const text = r.choices?.[0]?.message?.content?.trim() || '';
  return text;
}

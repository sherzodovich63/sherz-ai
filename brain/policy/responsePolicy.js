// src/brain/policy/responsePolicy.js

export const PHASES = Object.freeze({
  LISTEN: "LISTEN",
  CAUSE: "CAUSE",
  ANALYZE: "ANALYZE",
  HELP: "HELP",
  COMFORT: "COMFORT",
});

// ─────────────────────────────
// 1) ESKI API (saqlanadi) — strategy/tone tanlaydi
// ─────────────────────────────
export function decideResponsePolicy({ text, emotion }) {
  const t = (text || "").toLowerCase();

  const emo = (emotion?.label || emotion?.emotion || "neutral").toLowerCase();
  const intensity = emotion?.intensity ?? emotion?.score ?? 0.5;

  // ✅ wantsSpace faqat user aniq “gapirmayman / hozir emas / tegma” desa
  // ❌ "charchadim" ni bu yerga qo‘shmaymiz, chunki u LISTEN talab qiladi.
  const wantsSpace =
    /\b(leave me|alone|gapirma|tegma|keyinroq|hozir emas|gaplashmayman|hozir gapirmayman)\b/.test(t);

  if (wantsSpace) {
    return {
      strategy: "silence",
      tone: "soft",
      maxSentences: 2,
      askQuestions: false,
      allowEmotionReflect: false,
      useTools: false,
    };
  }

  // ✅ “charchadim / jonim yo‘q” — SUPPORT (LISTEN + 1 savol)
  const tiredSignal = /\b(charchadim|jonim yo['’]?q|holdan toydim)\b/.test(t);
  if (tiredSignal) {
    return {
      strategy: "support",
      tone: "warm",
      maxSentences: 3,
      askQuestions: true,
      allowEmotionReflect: true,
      useTools: false,
    };
  }

  const heavyEmotion =
    ["sad", "sadness", "angry", "anger", "stress", "stressed", "anxious", "fear"].includes(emo) &&
    intensity >= 0.55;

  if (heavyEmotion) {
    return {
      strategy: "support",
      tone: "warm",
      maxSentences: 4,
      askQuestions: true,
      allowEmotionReflect: true,
      useTools: false,
    };
  }

  const wantsProgress =
    /boshlaylik|qadam|reja|plan|davom|qilamiz|maqsad|ish qilaylik/.test(t);

  if (wantsProgress) {
    return {
      strategy: "motivate",
      tone: "energetic",
      maxSentences: 5,
      askQuestions: true,
      allowEmotionReflect: false,
      useTools: false,
    };
  }

  return {
    strategy: "support",
    tone: "calm",
    maxSentences: 3,
    askQuestions: true,
    allowEmotionReflect: false,
    useTools: false,
  };
}

// ─────────────────────────────
// 2) Phase Engine (Faza 2.2) — LISTEN → CAUSE → ANALYZE → HELP → (oxirida) COMFORT
// ─────────────────────────────
const DISTRESS = [
  "charchadim",
  "tushkun",
  "umid yo'q",
  "eplolmayman",
  "asabiym",
  "stress",
  "xafa",
  "qo'rqyapman",
  "qo'rqaman",
];

const COMFORT_REQ = ["taskin ber", "tasalli ber", "dalda ber", "meni tinchlantir", "meni ovut"];
const HELP_REQ = ["qanday", "nima qilay", "tuzat", "xato", "error", "qayerga", "qadam", "reja", "plan"];

function hasAny(text, arr) {
  const t = (text || "").toLowerCase();
  return arr.some((x) => t.includes(x));
}

/**
 * ✅ COMFORT gate:
 * - User aniq comfort so‘rasa → ALLOWED
 * - Aks holda: faqat distress + helpDone + comfort-friendly emotion bo‘lsa → ALLOWED
 * - Jahlda (anger) default comfort yo‘q → faqat user aniq so‘rasa
 */
export function buildPhasePlan({ text, state = {}, policy, emotion } = {}) {
  const t = text || "";

  const intent = {
    distress: hasAny(t, DISTRESS),
    comfortRequested: hasAny(t, COMFORT_REQ),
    helpRequested: hasAny(t, HELP_REQ),
  };

  const helpDone = Boolean(state?.lastHelpProvided);

  const emo = (emotion?.label || emotion?.emotion || "neutral").toLowerCase();

  const isAnger = ["angry", "anger", "mad"].includes(emo);
  const comfortFriendly = ["sad", "sadness", "anxious", "fear", "tired", "stress", "stressed"].includes(emo);

  const comfortAllowed =
    intent.comfortRequested ||
    (!isAnger && intent.distress && helpDone && comfortFriendly);

  const phases = [PHASES.LISTEN, PHASES.CAUSE, PHASES.ANALYZE, PHASES.HELP];
  if (comfortAllowed) phases.push(PHASES.COMFORT);

  return {
    phases,
    intent,
    gates: {
      comfortAllowed,
      maxComfortLines: policy?.maxComfortLines ?? 2,
      maxClarifyingQuestions: policy?.maxClarifyingQuestions ?? 2,
    },
  };
}

// (ixtiyoriy) composer promptiga qo‘shish uchun
export function buildPolicyDirectives({ phases, gates } = {}) {
  const list = Array.isArray(phases) ? phases : [];

  const PHASE_VOICE = {
    LISTEN: [
      "LISTEN bosqichi: Aynan user nima aytganiga ishora qil — umumiy 'tushunaman' emas.",
      "Masalan, user 'ish charchatdi' desa — 'charchading' deb qaytarma, 'ish seni charchatgan ekan' kabi aniq gapir.",
    ].join(" "),
    CAUSE: [
      "CAUSE bosqichi: Sababni ochish uchun ANIQ savol ber — mavhum 'nega bunday his qilyapsan' emas.",
      "Voqea, odam yoki vaqtga ishora qiluvchi savol ber: 'Bugun aniq nima bo'ldi?' yoki 'Kim bilan gaplashgandan keyin shunday bo'lding?'",
    ].join(" "),
    ANALYZE: [
      "ANALYZE bosqichi: Eshitganlaringni bir-biriga bog'la — pattern ko'rsat, lekin tashxis qo'yma.",
      "'Menimcha bu ... bilan bog'liq' shaklida taklif qil, 'Sizda ... bor' deb hukm chiqarma.",
    ].join(" "),
    HELP: [
      "HELP bosqichi: Bitta aniq, kichik va bajarilishi mumkin bo'lgan qadam taklif qil.",
      "Uzun ro'yxat berma — eng muhim BITTA narsani ayt, keyin 'shuni sinab ko'ramizmi?' deb so'ra.",
    ].join(" "),
    COMFORT: [
      "COMFORT bosqichi: Halol bo'l — 'hammasi yaxshi bo'ladi' kabi umumiy va’dalarni berma.",
      "Aynan nima yaxshi ketayotganini yoki nima o'zgartirilishi mumkinligini ayt — soxta optimizm emas, real asos.",
    ].join(" "),
  };

  const phaseLines = list.map(p => `- [${p}] ${PHASE_VOICE[p] || ""}`).filter(Boolean);

  return [
    `PHASE_ENGINE: ${list.join(" -> ")}`,
    ...phaseLines,
    `RULE: Hech qachon taskin/ovutish yozma, agar PHASE_ENGINE ichida COMFORT bo‘lmasa.`,
    `RULE: Savol soni — max ${gates?.maxClarifyingQuestions ?? 2} ta. Ko'proq so'ramagin.`,
    gates?.comfortAllowed
      ? `RULE: COMFORT max ${gates?.maxComfortLines ?? 2} gap — cho'zib yuborma.`
      : "",
  ].filter(Boolean).join("\n");
}


// ─────────────────────────────
// 3) Friend Brain State updater (Faza 2.2)
// ─────────────────────────────
export function updateFriendBrainState(prev = {}, { phase, helpProvided } = {}) {
  return {
    ...prev,
    lastPhase: phase || prev.lastPhase || null,
    lastHelpProvided:
      typeof helpProvided === "boolean" ? helpProvided : prev.lastHelpProvided || false,
    updatedAt: Date.now(),
  };
}

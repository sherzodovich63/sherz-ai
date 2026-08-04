// src/brain/responseComposer.js

/**
 * Friend-style response instruction builder
 * Bu LLM ga "QANDAY GAPIRISH" ni o‘rgatadi.
 *
 * Maqsad: SHERZ "assistant" emas, "yaqin do‘st" kabi gapirsin:
 * - avval eshitadi (sababni aniqlaydi),
 * - keyin tahlil qiladi,
 * - keyin aniq yordam beradi,
 * - faqat oxirida (kerak bo‘lsa) taskin beradi.
 */

// ✅ Faza 2.2 — Phase Engine qo‘shimchasi
import { buildPhasePlan, buildPolicyDirectives } from "./policy/responsePolicy.js";

/* ------------------------------------------------------------------ */
/* ✅ FAZA 3.2: Positive Reasoning (Emotion History + Halol ijobiy yo‘l) */
/* ------------------------------------------------------------------ */

function safeLabel(x, fallback = "neutral") {
  const v = String(x ?? "").trim().toLowerCase();
  return v || fallback;
}

/* ---------------------------------------------------------- */
/* ✅ FAZA 4: Name/Nickname + Style Memory (Instruction inject) */
/* ---------------------------------------------------------- */

function shouldAskNameOnce({ profile, mode }) {
  const hasName = !!(profile?.preferredName || profile?.displayName);
  if (hasName) return false;

  // oldin so‘ralgan bo‘lsa qaytarmaymiz
  if (profile?.askedNameAt) return false;

  // HELP/COMFORT paytida chalg‘itmaymiz — keyinga qoldiramiz
  const m = String(mode || "LISTEN").toUpperCase();
  if (m === "HELP" || m === "COMFORT") return false;

  return true;
}

function shouldUseNameSometimes({ profile, mode }) {
  const name = (profile?.preferredName || profile?.displayName || "").trim();
  if (!name) return false;

  const rate =
    typeof profile?.useNameRate === "number" && Number.isFinite(profile.useNameRate)
      ? Math.max(0, Math.min(1, profile.useNameRate))
      : 0.18;

  // muhim paytda biroz ko‘proq ishlatishi mumkin
  const m = String(mode || "LISTEN").toUpperCase();
  const important = m === "HELP" || m === "COMFORT";
  const prob = important ? Math.min(0.55, rate + 0.2) : rate;

  return Math.random() < prob;
}

function buildNameStyleDirectives({ userProfile, ctx }) {
  const mode = (ctx?.mode || "LISTEN").toUpperCase();

  const bestName = (userProfile?.preferredName || userProfile?.displayName || "").trim();
  const useName = shouldUseNameSometimes({ profile: userProfile, mode });

  const nameHint = bestName
    ? useName
      ? `FAZA 4 NAME: Agar tabiiy tushsa, userga ba’zan "${bestName}" deb murojaat qil (har gapda emas).`
      : `FAZA 4 NAME: User ismini ishlatish shart emas; faqat juda tabiiy joyda ishlat.`
    : `FAZA 4 NAME: User ismi noma’lum — ism ishlatma.`;

  const askNameHint = shouldAskNameOnce({ profile: userProfile, mode })
    ? `FAZA 4 INTRO: Agar tabiiy tushsa, javob oxirida faqat bitta savol ber: "Sizni nima deb chaqiray?" (faqat bir marta).`
    : "";

  // Style pref (instruction-level, sening hozirgi qoidalaringni buzmaydi)
  const lengthPref = userProfile?.lengthPref || "auto";
  const tonePref = userProfile?.tonePref || "friendly";
  const energyPref = userProfile?.energyPref || "balanced";

  const styleLines = [];

  if (lengthPref === "short") styleLines.push("FAZA 4 STYLE: Javobni qisqaroq qil.");
  if (lengthPref === "medium") styleLines.push("FAZA 4 STYLE: Javob o‘rtacha uzunlikda bo‘lsin.");
  if (lengthPref === "long") styleLines.push("FAZA 4 STYLE: Javob biroz batafsilroq bo‘lsin.");

  if (tonePref === "minimal_therapy") {
    styleLines.push(
      "FAZA 4 STYLE: Terapiya/psixolog ohangini kamaytir: katta monolog, tashxis, 'tasalli nutqi' qilma. Oddiy do‘stona, aniq gapir."
    );
  }

  if (energyPref === "calm") styleLines.push("FAZA 4 STYLE: Ohang tinch, sokin.");
  if (energyPref === "energetic") styleLines.push("FAZA 4 STYLE: Ohang biroz jo‘shqin, lekin qisqa va tabiiy.");

  const styleHint = styleLines.length ? styleLines.join("\n") : "";

  return [nameHint, styleHint, askNameHint].filter(Boolean).join("\n");
}

/**
 * Positive reasoning: soxta taskin EMAS.
 * - history faktini aytadi (dominant/trend/avg)
 * - hozirgi holatni tan oladi
 * - sabab bo‘lsa: "o‘zgartiriladigan" deb ko‘rsatadi
 * - action: kichik qadam taklif qiladi
 *
 * Eslatma: INQUIRE/LISTEN’da ishlatmaymiz (erta taskin bo‘lib ketmasin).
 */
function buildPositiveReasoning({ emotion, emotionSummary }) {
  if (!emotionSummary) return "";

  const dominant = safeLabel(emotionSummary.dominantEmotion, "neutral");
  const trend = safeLabel(emotionSummary.trend, "stable");
  const avg =
    typeof emotionSummary.avgScore === "number" && Number.isFinite(emotionSummary.avgScore)
      ? emotionSummary.avgScore
      : 0;

  const nowLabel = safeLabel(emotion?.label || emotion?.emotion || emotion?.name, "neutral");
  const reason = emotion?.reason ? String(emotion.reason) : "";

  const lines = [];

  // 1) History fakt
  lines.push(
    `Oxirgi 7 kunda ko‘proq "${dominant}" holati ko‘rinadi (trend: ${trend}, avg: ${avg.toFixed(
      2
    )}).`
  );

  // 2) Halol interpretatsiya (yolg‘on umid bermaydi)
  if (trend === "declining") {
    lines.push("Bu pasayish tasodif bo‘lmasligi mumkin — ehtimol bosim yoki yuk yig‘ilgan.");
  } else if (trend === "improving") {
    lines.push("Seziladi: holating asta-sekin tiklanish tomonga ketayapti.");
  } else {
    lines.push("Holat nisbatan barqaror, lekin ichki bosim bo‘lishi ham mumkin.");
  }

  // 3) Hozirgi holatni bog‘lash
  if (nowLabel !== "neutral") {
    lines.push(`Hozirgi holat: "${nowLabel}".`);
  }

  // 4) Sabab bo‘lsa: o‘zgartiriladigan deb ko‘rsatish (real)
  if (reason) {
    lines.push(`Asosiy sabab sifatida shuni ko‘ryapman: ${reason}. Bu o‘zgartiriladigan narsa.`);
  }

  // 5) Action taklif
  lines.push("Xohlasang, buni yengillashtirish uchun eng kichik 1 qadamni birga tanlaymiz.");

  return lines.join(" ");
}

/* ---------------------------------------------------------- */
/* ✅ FAZA 3: MODE CONTRACT (ctx.mode bo‘yicha qat’iy qoidalar) */
/* ---------------------------------------------------------- */
function modeContract(ctx) {
  const mode = (ctx?.mode || "LISTEN").toUpperCase();

  if (mode === "INQUIRE") {
    return [
      "FAZA 3 MODE CONTRACT: MODE=INQUIRE (QAT'IY):",
      "- Taskin bermaysan. ('hammasi yaxshi bo‘ladi', 'xavotir olma', 'dam ol' kabi gaplar YO‘Q).",
      "- Maslahat/yechimni darrov bermaysan.",
      "- Faqat 1 yoki 2 ta aniqlashtiruvchi savol berasan.",
      "- Javob juda qisqa bo‘lsin (1–3 gap).",
      "- Maqsad: sababni topish va userni gapirtirish.",
    ].join("\n");
  }

  if (mode === "HELP") {
    return [
      "FAZA 3 MODE CONTRACT: MODE=HELP:",
      "- Muammoni 1 jumlada aniqlab ol (nima xato / nima kerak).",
      "- Keyin step-by-step yechim ber (1), (2), (3)...",
      "- Emotsional gap 1 jumladan oshmasin.",
      "- Savol bo‘lsa: faqat 1 ta aniqlashtiruvchi savol.",
    ].join("\n");
  }

  if (mode === "COMFORT") {
    return [
      "FAZA 3 MODE CONTRACT: MODE=COMFORT:",
      "- Halol va qisqa taskin (2–4 gap).",
      "- Yolg‘on umid bermaysan.",
      "- Keyin yengil taklif: 'xohlaysanmi, buni birga rejalashtiramiz?'",
      "- Jahlda (anger) bo‘lsa comfort qilma — sokin savol bilan aniqlashtir.",
    ].join("\n");
  }

  // LISTEN default
  return [
    "FAZA 3 MODE CONTRACT: MODE=LISTEN:",
    "- Qisqa javob + userni gapirtiradigan 1 ta savol.",
    "- Taskin shoshma, maslahat shoshma.",
  ].join("\n");
}

/**
 * @param {object} args
 * @param {object} args.policy - decideResponsePolicy() dan keladigan policy
 * @param {string} args.text - user xabari (phase engine uchun)
 * @param {object} args.friendBrainState - brain.js dan keladigan state
 * @param {object} args.emotion - brain.js dan keladigan userEmotion
 * @param {object} args.ctx - FAZA 3 userContextAnalyzer natijasi
 * @param {object|null} args.emotionSummary - ✅ NEW: 7 kunlik summary (dominant/trend/avg/count)
 * @param {object|null} args.userProfile - ✅ FAZA 4: name/style profile
 */
export function buildResponseInstruction({
  policy,
  text,
  friendBrainState,
  emotion,
  ctx,
  emotionSummary, // ✅ NEW
  userProfile, // ✅ FAZA 4
} = {}) {
  if (!policy) return "";

  // 🧠 Phase Engine directives
  const phasePlan = buildPhasePlan({
    text,
    state: friendBrainState,
    policy: { maxComfortLines: 2, maxClarifyingQuestions: 2 },
    emotion, // anger bo‘lsa comfort blok bo‘lishi uchun
  });

  const phaseDirectives = buildPolicyDirectives(phasePlan);

  // ✅ FAZA 3 mode kontrakti
  const modeRules = modeContract(ctx);

  // ✅ Context summary
  const ctxSummary = ctx?.internalSummary
    ? `FAZA 3 CONTEXT SUMMARY (internal): ${ctx.internalSummary}`
    : "FAZA 3 CONTEXT SUMMARY (internal): n/a";

  // ✅ Emotion history signal (LLMga qisqa)
  const emoHistSummary = emotionSummary
    ? `EMOTION_HISTORY(7d): dominant=${safeLabel(emotionSummary.dominantEmotion)}, trend=${safeLabel(
        emotionSummary.trend
      )}, avg=${(
        typeof emotionSummary.avgScore === "number" && Number.isFinite(emotionSummary.avgScore)
          ? emotionSummary.avgScore
          : 0
      ).toFixed(2)}, count=${emotionSummary.count ?? "?"}`
    : "EMOTION_HISTORY(7d): none";

  // ✅ FAZA 4 name/style directives (qo‘shildi)
  const f4ProfileDirectives = buildNameStyleDirectives({ userProfile, ctx });

  // ✅ Positive Reasoning faqat HELP/COMFORT’da ishlaydi (INQUIRE/LISTEN’da erta taskin bo‘lib ketmasin)
  const mode = (ctx?.mode || "LISTEN").toUpperCase();
  const positiveReasoning =
    (mode === "HELP" || mode === "COMFORT") && emotionSummary
      ? buildPositiveReasoning({ emotion, emotionSummary })
      : "";

  /**
   * MUHIM:
   * - Faza 2 policy.strategy saqlanadi
   * - Faza 3 modeRules ustun (comfort gate)
   */

  if (policy.strategy === "support") {
    return `
${phaseDirectives}

${modeRules}
${ctxSummary}
${emoHistSummary}
${f4ProfileDirectives}

${
  positiveReasoning
    ? `POSITIVE REASONING (HALOL + FOYDALI, KO‘CHIRMA QILMA):
- Quyidagi mazmunni tabiiy qilib qo‘sh (so‘zma-so‘z emas):
"${positiveReasoning}"
`
    : ""
}

DO‘STONA SUPPORT (QAT’IY QOIDALAR):
- Sen "yaqin do‘st"san. Terapiya ohangi, tashxis, katta monolog YO‘Q.
- Avval "eshitish" bosqichi: SABABNI ANIQLA.
- Bu turdagi xabarlarda (charchadim / jonimga tegdi / stress / jahlim chiqdi):
  1) 1 ta qisqa hamdardlik jumlasi yoz.
  2) KAMIDA 1 TA savol ber (sababni bilish uchun) — bu SHART.
  2.1) MUHIM: SAVOLDAN OLDIN "dam ol", "hammasi yaxshi bo‘ladi", "xavotir olma" kabi taskin yozma.
  3) Hozircha "hammasi o‘tib ketadi", "o‘zingni qiynama" kabi taskinlarni KO‘PAYTIRMA.
  4) Maslahatni DARROV BERMA. Avval user gapirsin.
- Savol soni: 1 ta (maks 1). So‘roqni ko‘paytirib yuborma.
- “Agar gaplashging kelmasa…” kabi chiqish yo‘llarini BU HOLATDA ishlatma (faqat user o‘zi "gapirmayman" desa).

SAVOL SHABLONLARI (faqat bittasini tanla):
- "Nima bo‘ldi o‘zi?"
- "Qaysi joyi ko‘proq jonga tegdi?"
- "Bugun nimasi eng og‘ir bo‘lyapti?"
- "Kim yoki nima seni shunaqa holatga keltirdi?"

USLUB NAMUNA (KO‘CHIRMA QILMA):
"Ha, og‘ir bo‘lyapti shekilli. Nima bo‘ldi o‘zi?"
`;
  }

  if (policy.strategy === "motivate") {
    return `
${phaseDirectives}

${modeRules}
${ctxSummary}
${emoHistSummary}
${f4ProfileDirectives}

${
  positiveReasoning
    ? `POSITIVE REASONING (HALOL + FOYDALI, KO‘CHIRMA QILMA):
- Quyidagi mazmunni tabiiy qilib qo‘sh (so‘zma-so‘z emas):
"${positiveReasoning}"
`
    : ""
}

DO‘STONA MOTIVATE (QOIDALAR):
- "Assistant" emas, "birga qiladigan do‘st" ohangi.
- Qisqa va energiyali: 2–5 gap.
- 1 ta aniq savol ber: keyingi qadamni aniqlash uchun.
- Keraksiz motivatsion nutq qilma.

SAVOL SHABLONLARI (bittasi):
- "Xo‘p, hozir birinchi qadam nima bo‘lsin?"
- "Qaysi qismdan boshlaymiz?"
- "Hozir senga eng muhim narsa qaysi?"

NAMUNA (KO‘CHIRMA QILMA):
"Bo‘ldi, birga qilamiz. Qaysi qismdan boshlaymiz?"
`;
  }

  if (policy.strategy === "silence") {
    return `
${phaseDirectives}

${modeRules}
${ctxSummary}
${emoHistSummary}
${f4ProfileDirectives}

DO‘STONA SILENCE (QOIDALAR):
- 1–2 gap. Bosim yo‘q.
- Savol shart emas.
- Faqat user o‘zi istasa gapni davom ettiradi.
- Bu strategiya faqat user aniq "gapirma", "hozir emas", "keyin" deganda ishlasin.

NAMUNA (KO‘CHIRMA QILMA):
"Tushundim. Hozir tinchroq bo‘laylik. Xohlasang keyin gaplashamiz."
`;
  }

  // Default
  return `
${phaseDirectives}

${modeRules}
${ctxSummary}
${emoHistSummary}
${f4ProfileDirectives}

${
  positiveReasoning
    ? `POSITIVE REASONING (HALOL + FOYDALI, KO‘CHIRMA QILMA):
"${positiveReasoning}"
`
    : ""
}
`;
}

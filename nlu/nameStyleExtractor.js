// nlu/nameStyleExtractor.js (ESM)

function clean(s) {
  return (s || "")
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(0, Math.min(1, x));
}

function detectUseNameRate(text) {
  const t = (text || "").toLowerCase();

  if (/(har doim|tez-?tez|ko['’]?p ishlat|ko['’]?proq ishlat)/i.test(t)) return 0.35;
  if (/(kamroq|ko['’]?p aytma|har gapda emas|tez aytma|ortiqcha aytma)/i.test(t)) return 0.12;
  if (/(umuman.*ismimni.*(ishlatma|aytma)|ismimni.*(ishlatma|aytma))/i.test(t)) return 0.0;

  return null;
}

export function extractNameAndStyle(userText = "") {
  const text = (userText || "").trim();
  if (!text) return {};

  const patch = {};

  // 1) displayName: "Ismim Bekzod", "Mening ismim Bekzod"
  let m =
    text.match(/\b(?:ismim|mening ismim)\s*[:\-]?\s*([A-Za-zÀ-žʻ’`-]{2,40}(?:\s+[A-Za-zÀ-žʻ’`-]{2,40})?)\b/i) ||
    text.match(/\b(?:my name is|i am|i'm)\s*([A-Za-zÀ-žʻ’`-]{2,40}(?:\s+[A-Za-zÀ-žʻ’`-]{2,40})?)\b/i);

  if (m?.[1]) patch.displayName = clean(m[1]);

  // 2) preferredName: "Meni Bek deb chaqir"
  m = text.match(/\bmeni\s+(.{1,30}?)\s+deb\s+chaqir\b/i);
  if (m?.[1]) patch.preferredName = clean(m[1]);

  // "Do‘stlarim Bek deydi / deb chaqiradi"
  m = text.match(/\bdo['’]stlarim\s+(.{1,30}?)\s+(?:deydi|deb ataydi|deb chaqiradi)\b/i);
  if (m?.[1]) patch.preferredName = clean(m[1]);

  // 3) lengthPref
  if (/(qisqa(roq)? yoz|kaminroq yoz|short(er)?)/i.test(text)) patch.lengthPref = "short";
  else if (/(o['’]?rtacha|medium|ortacha yoz)/i.test(text)) patch.lengthPref = "medium";
  else if (/(batafsil(roq)?|uzunroq yoz|long(er)?)/i.test(text)) patch.lengthPref = "long";

  // 4) tonePref: terapiya kamaytir
  if (
    /(terapiya|psixolog|therap)/i.test(text) &&
    /(kamroq|qilma|kerak emas|yo['’]?q|gapirma|pasaytir)/i.test(text)
  ) {
    patch.tonePref = "minimal_therapy";
  }

  // 5) energyPref
  if (/(tinch|xotirjam|calm|sokin)/i.test(text)) patch.energyPref = "calm";
  else if (/(jo['’]?shqin|energiya|energetic|baquvvat|tetik)/i.test(text))
    patch.energyPref = "energetic";

  // 6) useNameRate
  const rate = detectUseNameRate(text);
  if (rate !== null) patch.useNameRate = clamp01(rate);

  return patch;
}

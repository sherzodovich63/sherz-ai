// src/brain/userContextAnalyzer.js (ESM)

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import tz from 'dayjs/plugin/timezone.js';
dayjs.extend(utc);
dayjs.extend(tz);

// small helpers
const clamp01 = (n) => Math.max(0, Math.min(1, n));

function countMatches(text, arr) {
  const t = (text || '').toLowerCase();
  let c = 0;
  for (const k of arr) if (t.includes(k)) c++;
  return c;
}

function lastNUserMessages(recentMessages, n = 6) {
  const msgs = (recentMessages || []).filter(m => m?.role === 'user' && m?.content);
  return msgs.slice(-n);
}

function rollingNegativity(emotionHistory, days = 7) {
  // emotionHistory item example: { at, emotion, valence, arousal }
  // valence: -1..+1 (negative..positive) optional
  const since = dayjs().subtract(days, 'day');
  const list = (emotionHistory || []).filter(e => e?.at && dayjs(e.at).isAfter(since));
  if (!list.length) return { score: 0, samples: 0 };
  const vals = list.map(e => typeof e.valence === 'number' ? e.valence : 0);
  const avg = vals.reduce((a,b)=>a+b,0) / vals.length; // -1..+1
  const neg = clamp01((-avg) / 1); // avg -0.5 => 0.5
  return { score: neg, samples: list.length };
}

export function userContextAnalyzer({
  userId,
  userMessage,
  recentMessages = [],
  emotionNow = null,         // detectEmotion(userMessage) natijasi (optional)
  emotionHistory = [],
  memory = {},               // habits, facts
  timezone = 'Asia/Tashkent',
  nowISO = null,
}) {
  const now = nowISO ? dayjs(nowISO) : dayjs().tz(timezone);
  const hour = now.hour();

  // ---- keyword signals (tez va oddiy) ----
  const t = (userMessage || '').toLowerCase();

  const fatigueWords = [
  // negative / tired
  'charchadim','toliqdim','siqildim','stress','stressed','jahlim chiqdi','asabim buzildi',
  'xafa','yomonman','qo‘rqyapman','havotirdaman','tushkun','zerikdim','holdan toydim',

  // positive
  'xursandman','hursandman','baxtliman','zo‘r','ajoyib','super','kayfiyat zo‘r',
  'yahshi','yaxshiman','gap yo‘q','shodman'
];

  const helpWords = ['qanday','nima qilay','help','yordam','qanday qilib','muammo','xato','error','debug'];
  const comfortWords = ['yomonman','yig‘lagim keladi','tushkun','depress','yolg‘izman','hech kim yo‘q','qo‘rqyapman'];
  const urgencyWords = ['tez','hoziroq','bugun','kech','deadline','shoshilinch'];

  const fatigueK = countMatches(t, fatigueWords);
  const helpK = countMatches(t, helpWords);
  const comfortK = countMatches(t, comfortWords);
  const urgencyK = countMatches(t, urgencyWords);

  // ---- context-based boosting ----
  const lastUsers = lastNUserMessages(recentMessages, 6);
  const lastText = lastUsers.map(m => (m.content||'')).join(' \n').toLowerCase();

  const fatigueContext = clamp01(countMatches(lastText, fatigueWords) / 6);
  const helpContext = clamp01(countMatches(lastText, helpWords) / 6);

  // emotion trend (history)
  const trend = rollingNegativity(emotionHistory, 7); // 0..1

  // time context (kechasi stress ko‘proq bo‘lishi mumkin)
  const lateNightBoost = (hour >= 0 && hour <= 5) ? 0.15 : 0;

  // ---- scoring ----
  const fatigueScore = clamp01(
    (fatigueK * 0.20) +
    (fatigueContext * 0.35) +
    (trend.score * 0.30) +
    lateNightBoost
  );

  const helpNeedScore = clamp01(
    (helpK * 0.18) +
    (helpContext * 0.30) +
    (urgencyK * 0.15)
  );

  const comfortNeedScore = clamp01(
    (comfortK * 0.25) +
    (trend.score * 0.35) +
    (fatigueScore * 0.25)
  );

  // missing info logic:
  // agar “charchadim” deyilgan bo‘lsa-yu “nimadan” degan sabab yo‘q bo‘lsa — aniqlash kerak
  const mentionsFatigue = fatigueK > 0;
  const hasCause = /(ish|o‘qish|dars|kod|project|uyqu|oil(a)?|pul|sog‘liq|relationship|qiz|ota|ona)/i.test(userMessage || '');

  const missingInfo = [];
  if (mentionsFatigue && !hasCause) missingInfo.push('FATIGUE_CAUSE');

  // ---- confidence ----
  // ko‘proq manba bo‘lsa confidence oshadi
  let confidence = 0.35;
  if (recentMessages.length >= 8) confidence += 0.15;
  if (trend.samples >= 3) confidence += 0.15;
  if (emotionNow?.emotion) confidence += 0.10;
  if (fatigueK + comfortK + helpK >= 2) confidence += 0.15;
  if (missingInfo.length) confidence -= 0.15;
  confidence = clamp01(confidence);

  // ---- mode decision (Comfort gate!) ----
  // qoidalar:
  // - HELP: helpNeed yuqori va user aniq muammo so‘ragan
  // - COMFORT: faqat comfortNeed yuqori + confidence yuqori + missingInfo yo‘q (yoki minimal)
  // - INQUIRE: fatigue/comfort bor, lekin sabab noaniq yoki confidence past
  // - LISTEN: hammasi past bo‘lsa (neutral)
  let mode = 'LISTEN';

  if (helpNeedScore >= 0.55) {
    mode = 'HELP';
  } else if (comfortNeedScore >= 0.60 && confidence >= 0.65 && missingInfo.length === 0) {
    mode = 'COMFORT';
  } else if ((fatigueScore >= 0.45 || comfortNeedScore >= 0.45) && (confidence < 0.65 || missingInfo.length)) {
    mode = 'INQUIRE';
  }

  const suggestedQuestions = [];
  if (mode === 'INQUIRE') {
    if (missingInfo.includes('FATIGUE_CAUSE')) {
      suggestedQuestions.push("Hozir eng ko‘p nimadan charchayapsan: ish/oqish, kod, uyqu yetishmasligi, yoki odamlar tomoni?");
    }
    suggestedQuestions.push("Bugun kayfiyatingni 1–10 baholasan, nechchi?");
    if (helpNeedScore >= 0.35) suggestedQuestions.push("Xohlaysanmi, avval muammoni (xato/masala) aniq qilib ajratib olaylik?");
  }

  const reasons = [];
  if (fatigueScore >= 0.45) reasons.push('fatigue_high');
  if (trend.score >= 0.45) reasons.push('negativity_trend');
  if (helpNeedScore >= 0.55) reasons.push('help_request');
  if (lateNightBoost > 0) reasons.push('late_night');

  const internalSummary =
    `Signals: fatigue=${fatigueScore.toFixed(2)}, help=${helpNeedScore.toFixed(2)}, comfort=${comfortNeedScore.toFixed(2)}, trendNeg=${trend.score.toFixed(2)}; mode=${mode}, conf=${confidence.toFixed(2)}; reasons=${reasons.join(',') || 'none'}`;

  return {
    ok: true,
    userId,
    mode,
    confidence,
    fatigue: { score: fatigueScore, reasons },
    signals: {
      fatigueScore,
      helpNeedScore,
      comfortNeedScore,
      urgencyK,
      trendNegativity: trend,
    },
    missingInfo,
    suggestedQuestions,
    internalSummary,
  };
}

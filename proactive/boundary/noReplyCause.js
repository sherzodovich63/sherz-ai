// src/proactive/boundary/noReplyCause.js
import { prisma } from '../../db/prisma.js';

function clamp01(x){ return Math.max(0, Math.min(1, x)); }

export async function detectNoReplyCause(userId){
  // So‘nggi 30 ta event, 14 kun ichida
  const since = new Date(Date.now() - 14*24*3600*1000);

  const events = await prisma.proactiveEvent.findMany({
    where: { userId, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    take: 30
  });

  // If nothing to learn from:
  if (!events.length){
    return {
      cause: 'busy',
      confidence: 0.45,
      evidence: { note: 'no_history_default_busy' }
    };
  }

  // 1) Oxirgi “awaitingReply” event topamiz
  const lastAwait = events.find(e => e.awaitingReply);
  if (!lastAwait){
    // hali reply kutayotgan holat yo‘q → default busy
    return { cause:'busy', confidence:0.4, evidence:{ note:'no_await_event' } };
  }

  const now = Date.now();
  const lastTime = new Date(lastAwait.createdAt).getTime();
  const silenceHours = (now - lastTime) / 3600000;

  // 2) User odatiy reply vaqtini taxmin qilamiz (oddiy median o‘rniga robust avg)
  const replied = events.filter(e => e.awaitingReply && e.gotReply && e.replyDeadlineAt);
  // Agar sizda user reply timestamp boshqa joyda bo‘lsa, shu yerga moslashtirasiz.
  // Hozircha: gotReply true bo‘lsa, "replyDeadlineAt - createdAt" ni o‘rtacha deb olamiz (placeholder).
  let typicalHours = 6; // fallback
  if (replied.length >= 4){
    const samples = replied
      .map(e => (new Date(e.replyDeadlineAt).getTime() - new Date(e.createdAt).getTime())/3600000)
      .filter(x => x > 0 && x < 72);
    if (samples.length){
      samples.sort((a,b)=>a-b);
      typicalHours = samples[Math.floor(samples.length/2)] || typicalHours;
    }
  }

  // 3) Pattern signals
  const last7 = events.slice(0, 7);
  const recentRespect = last7.some(e => e.boundaryDecision === 'respect');
  const recentSoft = last7.some(e => e.boundaryDecision === 'soft_presence');

  // “avoidance” signal: user reply berganda ham qisqa, sovuq, yoki permission deny bo‘lsa
  const denies = last7.filter(e => e.permissionAsked && e.permissionResult === 'deny').length;
  const noAnswersToPermission = last7.filter(e => e.permissionAsked && e.permissionResult === 'no_answer').length;

  // “overwhelmed” signal: ketma-ket ko‘p proactive + user “charchadim/ko‘p” trend bo‘lishi mumkin
  const proactiveCount24h = events.filter(e => (now - new Date(e.createdAt).getTime()) < 24*3600*1000).length;
  const highFreq = proactiveCount24h >= 5;

  // Heuristic scoring:
  let busy = 0.35;
  let avoiding = 0.25;
  let overwhelmed = 0.25;

  // Silence vs typical:
  const ratio = typicalHours ? (silenceHours / typicalHours) : 1.0;

  if (ratio < 1.2) busy += 0.25;              // hali normal kechikish
  if (ratio >= 1.2 && ratio < 2.5) busy += 0.15;
  if (ratio >= 2.5) avoiding += 0.25;         // juda uzoq → avoiding ehtimoli oshadi

  if (denies >= 1) avoiding += 0.25;
  if (noAnswersToPermission >= 1) avoiding += 0.1;

  if (highFreq) overwhelmed += 0.35;
  if (recentSoft) overwhelmed += 0.1;         // soft_presence ham javobsiz qolsa → overwhelmed bo‘lishi mumkin
  if (recentRespect) busy += 0.05;            // respectdan keyin jim bo‘lsa — band bo‘lishi tabiiy

  // Normalize & choose
  const sum = busy + avoiding + overwhelmed;
  busy /= sum; avoiding /= sum; overwhelmed /= sum;

  let cause = 'busy';
  let confidence = busy;
  if (avoiding > confidence){ cause='avoiding'; confidence=avoiding; }
  if (overwhelmed > confidence){ cause='overwhelmed'; confidence=overwhelmed; }

  confidence = clamp01(confidence);

  return {
    cause,
    confidence,
    evidence: {
      silenceHours: Number(silenceHours.toFixed(2)),
      typicalHours: Number(typicalHours.toFixed(2)),
      proactiveCount24h,
      denies,
      noAnswersToPermission,
      recentSoft,
      recentRespect
    }
  };
}

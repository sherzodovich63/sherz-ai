export function applyPolicyToDecision({ decision, policy, nowLocal }) {
  const d = { ...decision };
  const hour = nowLocal.hour();

  const hp = policy?.hourPenalty || {};
  const hourPenalty = Number(hp[String(hour)] || 1.0);

  // TIME PENALTY: penalty katta bo‘lsa yozmaymiz
  if (hourPenalty >= 1.4) {
    return {
      shouldMessage: false,
      reason: `TIME_PENALTY_HOUR_${hour} p=${hourPenalty}`,
      tone: null,
      message: null
    };
  }

  // tone tanlash: agar decision tone bermagan bo‘lsa best tone
  if (!d.tone && policy?.toneWeights) {
    const best = Object.entries(policy.toneWeights)
      .sort((a, b) => (b[1] || 0) - (a[1] || 0))[0];
    if (best) d.tone = best[0];
  }

  return d;
}

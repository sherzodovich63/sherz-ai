// src/proactive/boundary/boundaryLogger.js

function pct(x) {
  if (typeof x !== 'number') return 'n/a';
  return `${Math.round(x * 100)}%`;
}

export function logBoundaryDecision({ userId, boundary, policyBefore, policyAfter }) {
  const cause = boundary?.cause?.cause || 'unknown';
  const conf = boundary?.cause?.confidence;
  const decision = boundary?.boundaryDecision || 'normal';
  const perm = !!boundary?.permissionNeeded;

  console.log('🧠 [LAB6] Boundary Intelligence');
  console.log('   userId:', userId);
  console.log(`   noReplyCause=${cause} (${pct(conf)})`);
  console.log('   boundaryDecision=', decision);
  console.log('   permissionNeeded=', perm);

  if (boundary?.cause?.evidence) {
    console.log('   evidence=', boundary.cause.evidence);
  }

  // policy diff (agar bor bo‘lsa)
  const b = policyBefore || {};
  const a = policyAfter || {};
  const diffs = [];

  const keys = [
    'cooldownMinutes',
    'maxPerDay',
    'softPresenceCooldownHours',
    'respectCooldownHours',
    'permissionSensitivity',
  ];

  for (const k of keys) {
    if (b[k] != null && a[k] != null && b[k] !== a[k]) diffs.push(`${k} ${b[k]}→${a[k]}`);
  }

  if (diffs.length) console.log('   policy:', diffs.join(', '));

  console.log('—'.repeat(56));
}

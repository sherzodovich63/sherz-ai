// src/proactive/boundary/permission.js
// Goal: friendly permission check, not robotic, still clear (Ha/Yo'q).

function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

function inferStyle({ profile, lastUserMessage }){
  const txt = (lastUserMessage || "").toLowerCase();

  const broSignals = ['bro', 'brat', 'aka', 'uka', 'qalesan', '😂', '😄'];
  const softGirlSignals = ['dugon', 'bestie', 'jonim', '🥺', '🤍', '✨', '😘'];
  const formalSignals = ['assalomu alaykum', 'iltimos', 'marhamat', 'rahmat'];

  const hasBro = broSignals.some(s => txt.includes(s));
  const hasSoft = softGirlSignals.some(s => txt.includes(s));
  const hasFormal = formalSignals.some(s => txt.includes(s));

  if (hasFormal) return 'neutral';
  if (hasSoft && !hasBro) return 'bestie';
  if (hasBro && !hasSoft) return 'bro';
  return 'neutral';
}

const TEMPLATES = {
  bro: [
    "Hey bro 🙂 xohlasang hozircha jim turaymi? (Ha / Yo‘q)",
    "Bro, bezovta qilmeyeymi? 🙂 (Ha / Yo‘q)",
    "Hey aka 🙂 hozircha tinch qo‘yaymi? (Ha / Yo‘q)"
  ],
  bestie: [
    "Heyy 🤍 xohlasang hozircha jim turaymi? (Ha / Yo‘q)",
    "Jonim 🙂 bezovta qilmeyeymi? (Ha / Yo‘q)",
    "Hey 🤍 hozir tinch qo‘yaymi? (Ha / Yo‘q)"
  ],
  neutral: [
    "Xohlasangiz hozircha jim turaymi? (Ha / Yo‘q)",
    "Hozir tinch qo‘yaymi? (Ha / Yo‘q)",
    "Bezovta qilmay turaymi? (Ha / Yo‘q)"
  ]
};

export function buildPermissionMessage({ profile = null, lastUserMessage = '' } = {}){
  const style = inferStyle({ profile, lastUserMessage });

  // Optional: tiny name prefix (no cringe)
  const name = (profile?.preferredName || profile?.displayName || '').trim();
  const base = pick(TEMPLATES[style]);

  if (!name || style === 'bro') return base;

  const prefix = pick([`${name}, `, `${name} 🙂 `, '']);
  return prefix + base;
}

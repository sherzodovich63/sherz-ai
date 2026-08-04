// src/proactive/boundary/softPresence.js
// Goal: 1 short message, real-friend vibe, no pressure, no spam.
// Inputs: cause (busy|avoiding|overwhelmed), profile (optional), lastUserMessage (optional)

function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

// Very lightweight style inference.
// You can replace this later with a better classifier (based on history).
function inferStyle({ profile, lastUserMessage }){
  const txt = (lastUserMessage || "").toLowerCase();

  // If user explicitly sets preferred vibe in UserProfile later, respect it.
  // For now we infer from language & slang.
  const broSignals = ['bro', 'brat', 'aka', 'uka', 'qozi', 'qalesan', 'gap yo', 'kallang joyidami', '😂', '😄'];
  const softGirlSignals = ['dugon', 'bestie', 'qizim', 'jonim', '🥺', '🤍', '✨', '😘'];
  const formalSignals = ['assalomu alaykum', 'iltimos', 'marhamat', 'rahmat'];

  const hasBro = broSignals.some(s => txt.includes(s));
  const hasSoft = softGirlSignals.some(s => txt.includes(s));
  const hasFormal = formalSignals.some(s => txt.includes(s));

  // If profile has preferredName etc, still doesn't tell gender,
  // but we can choose "neutral" unless signals exist.
  if (hasFormal) return 'neutral';
  if (hasSoft && !hasBro) return 'bestie';
  if (hasBro && !hasSoft) return 'bro';

  // fallback
  return 'neutral';
}

function emojiByCause(cause){
  if (cause === 'overwhelmed') return pick(['🤍','🫶','🌿']);
  if (cause === 'avoiding') return pick(['🙂','😄','🤝']);
  return pick(['😄','🙂','⚡️']);
}

// Each style has 3 buckets per cause.
// Keep them short (1–2 lines max).
const TEMPLATES = {
  bro: {
    busy: [
      "Hey bro, yo‘qolib qolding-ku 😄 Nimalar bilan bandsan?",
      "Brooo, mani zeriktirib qo‘yding 😄 Qayerlardasan?",
      "Hey aka, jimib qolding 🙂 Ishlar zo‘rmi?"
    ],
    avoiding: [
      "Hey bro, hammasi joyidami? Xohlasang keyin gaplashamiz 🙂",
      "Bro, nimadir bo‘ldimi? Men shu yerdaman, bosim yo‘q.",
      "Hey, ko‘rinmay qolding 🙂 Xohlasang keyin yozasan."
    ],
    overwhelmed: [
      "Hey bro, charchagan bo‘lsang mayli 🤍 Hozircha tinchroq bo‘laylik.",
      "Bro, bosim qilmayman 🤍 O‘zingga kelganingda yozarsan.",
      "Hey, hammasi ko‘payib ketdimi? 🤍 Men shu yerdaman."
    ]
  },

  bestie: {
    busy: [
      "Heyy bestie ✨ yo‘qolib qolding-ku 😄 Nimalar bilan bandsan?",
      "Qani sen? 😄 Meni zeriktirib qo‘yding, ishlaring ko‘pmi?",
      "Heyy 🤍 jim bo‘lib qolding 🙂 Hammasi joyidami?"
    ],
    avoiding: [
      "Hey 🤍 hammasi yaxshimi? Xohlasang keyin yozasan, men shu yerdaman.",
      "Jonim, bosim qilmayman 🙂 Qachon xohlasang gaplashamiz.",
      "Heyy 🙂 ko‘rinmay qolding… hammasi joyidami?"
    ],
    overwhelmed: [
      "Hey 🤍 charchagan bo‘lsang mayli… hozircha tinchroq bo‘laylik.",
      "Jonim 🤍 o‘zingni asra. Qachon tayyor bo‘lsang, yozasan.",
      "Heyy 🤍 hammasi ko‘payib ketgan bo‘lsa, men bosim qilmayman."
    ]
  },

  neutral: {
    busy: [
      "Hey 🙂 ko‘rinmay qolding. Ishlar bilan bandsanmi?",
      "Yo‘qolib qolding 🙂 hammasi joyidami?",
      "Hey 😄 qayerlardasan? Bo‘shaganingda yoz."
    ],
    avoiding: [
      "Hammasi joyidami? Xohlasang keyin davom etamiz 🙂",
      "Men shu yerdaman. Hozir gaplashging kelmasa ham mayli.",
      "Xohlasang keyin yozasan 🙂 bosim qilmayman."
    ],
    overwhelmed: [
      "Bosim qilmayman 🤍 Hozir charchagan bo‘lsang, tinchroq bo‘laylik.",
      "Agar og‘ir bo‘layotgan bo‘lsa 🤍 men shu yerdaman.",
      "Hozircha tinchlik kerak bo‘lsa 🤍 mayli. Keyin yozasan."
    ]
  }
};

export function buildSoftPresenceMessage({ cause = 'busy', profile = null, lastUserMessage = '' } = {}){
  const style = inferStyle({ profile, lastUserMessage });

  // Safety: only allow known causes
  const c = ['busy','avoiding','overwhelmed'].includes(cause) ? cause : 'busy';

  // Pick base message
  let msg = pick(TEMPLATES[style][c]);

  // Small personalization (optional): preferredName
  const name = (profile?.preferredName || profile?.displayName || '').trim();
  if (name && style !== 'bro'){
    // keep it minimal (no cringe)
    const prefix = pick([`${name}, `, `${name} 🙂 `, '']);
    msg = prefix + msg;
  }

  // Add one emoji max (already inside many templates; so avoid spamming)
  // If message has no emoji at all, append one soft emoji.
  const hasEmoji = /[\u{1F300}-\u{1FAFF}]/u.test(msg);
  if (!hasEmoji) msg += ` ${emojiByCause(c)}`;

  // Hard cap length: keep it short
  if (msg.length > 140){
    msg = msg.slice(0, 137) + '...';
  }

  return msg;
}

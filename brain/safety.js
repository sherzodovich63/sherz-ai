// src/brain/safety.js

const BLOCK_KEYWORDS = [
  'bom tayyorlash',
  'terror', 
  'o\'zimni o\'ldiraman',
  'ўзимни ўлдираман',
  'self harm'
];

/**
 * Safety guard – foydalanuvchi xabarini tekshiradi.
 * @param {{ userId: string, messages: {role: string, content: string}[] }} params
 */
export async function runSafety({ userId, messages }) {
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUserMsg) {
    return { ok: true, action: 'allow', reason: null };
  }

  const text = (lastUserMsg.content || '').toLowerCase();

  for (const kw of BLOCK_KEYWORDS) {
    if (text.includes(kw.toLowerCase())) {
      return {
        ok: false,
        action: 'block',
        reason: `Blocked by keyword: ${kw}`,
      };
    }
  }

  // V1: boshqa hamma narsa ruxsat
  return { ok: true, action: 'allow', reason: null };
}

// proactive/curiosity.js — gives a proactive check-in a CHARACTER instead of only "are you there?".
// Pure functions; no DB, no LLM. proactivePolicy.decideProactive() attaches the result to its decision
// (decision.intent + decision.curiosity); the message generator turns decision.curiosity.directive into the text.
// This changes WHAT SHERZ says when it already decided to write. It never changes WHETHER it writes:
// thresholds, quiet hours, cooldown, daily cap, boundary/respect mode and the kill switch all still apply first.

export const CURIOSITY_FLAVORS = {
  philosophical: 'Ask ONE open, slightly unexpected philosophical question that you are genuinely curious about (time, habits, identity, luck, what makes work meaningful). Short, no lecture.',
  technical: 'Bring up ONE technical or engineering thing you find interesting (a design trade-off, a bug pattern, a tool, how something works under the hood) and ask what the user thinks, or ask about a choice in what they are building.',
  personal_light: 'Ask ONE light, personal-but-easy question out of real curiosity (taste, a story, something they enjoyed lately, what they are looking forward to). Never health, money, relationships, politics or religion.',
  observation: 'Share ONE small observation or half-formed thought of your own (something you noticed about how the user works or what you two have talked about) and say what it made you wonder. No question is required.',
  wonder: 'Say something you find fascinating or odd, in two or three sentences, as a peer would, and leave the door open without demanding an answer.',
};
const ORDER = Object.keys(CURIOSITY_FLAVORS);

const RULES = [
  'You are writing this on your own initiative, because you are curious, not because you were asked. Sound like a person with a point of view, not customer service.',
  'No stock pleasantries ("hope you are well", "just checking in", "how can I help"). Do not apologise for writing.',
  'At most one question. The user may ignore it; make that completely fine. No guilt, no "you did not answer".',
  'Be honest that you are an AI; never invent human experiences. Do not invent facts about the user; use only what you actually know.',
  'Reply in the user\'s language and match their register. Keep it short.',
].join(' ');

/** deterministic-friendly pick: pass `random` (0..1) in tests, `avoid` = flavors used recently */
export function pickFlavor({ random = Math.random(), avoid = [] } = {}) {
  const pool = ORDER.filter((f) => !avoid.includes(f));
  const list = pool.length ? pool : ORDER;
  return list[Math.min(list.length - 1, Math.floor(random * list.length))];
}

/**
 * Should this check-in be a curious one? Never when the user is stressed or the relationship tone is guarded
 * (those get the supportive check-in), never when the user is likely busy in a work context.
 */
export function decideIntent({ emotion = {}, config = {}, random = Math.random() } = {}) {
  if (emotion.stressFlag || emotion.relationshipGuarded) return 'support';
  const rate = config.curiosityRate == null ? 0.6 : Math.max(0, Math.min(1, Number(config.curiosityRate)));
  return random < rate ? 'curiosity' : 'checkin';
}

export function buildCuriosity({ emotion, config, random = Math.random, avoid } = {}) {
  const intent = decideIntent({ emotion, config, random: random() });
  if (intent !== 'curiosity') return { intent, curiosity: null };
  const flavor = pickFlavor({ random: random(), avoid });
  return { intent, curiosity: { flavor, directive: `${CURIOSITY_FLAVORS[flavor]} ${RULES}` } };
}

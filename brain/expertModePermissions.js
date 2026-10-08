// brain/expertModePermissions.js
//
// Dedicated permission gate for Expert Mode tool execution. Deliberately
// its own file rather than reusing boundaryIntelligence.js — that module
// is built for a different judgment call (should SHERZ proactively message
// right now, given relationship/boundary signals), not "is this user
// allowed to run this tool." Different question, different gate, so they
// can evolve independently without one's logic accidentally constraining
// the other.
//
// Per the Sprint 2 decision: Expert Mode has access to BOTH the existing
// companion tools (todos, reminders, journal, mood, briefing, emotion
// reflection) AND the new expert-only tools (code_analysis, web_fetch) —
// so SHERZ can, in one expert turn, add a todo while also analyzing code.
// The tiers below exist for future use (e.g. rate-limiting expert-tier
// tools more strictly than companion ones), not to restrict access today.

const COMPANION_TOOLS = new Set([
  'get_server_time',
  'todo_add',
  'todo_list',
  'reminder_add',
  'reminder_list',
  'mood_log',
  'journal_log',
  'daily_briefing',
  'emotion_reflect',
]);

const EXPERT_TOOLS = new Set([
  'code_analysis',
  'web_fetch',
]);

const ALL_ALLOWED_TOOLS = new Set([...COMPANION_TOOLS, ...EXPERT_TOOLS]);

/**
 * Is Expert Mode itself available to this user right now?
 * Placeholder for future gating (subscription tier, explicit opt-in flag,
 * abuse/rate-limit state, etc.) — currently allows everyone, since no such
 * gating criteria has been defined yet. Kept as its own function so that
 * logic has an obvious home when it's needed, rather than getting bolted
 * onto isToolAllowed() later.
 * @param {object} params
 * @param {string} params.userId
 * @returns {Promise<{ allowed: boolean, reason?: string }>}
 */
export async function isExpertModeAllowed({ userId } = {}) {
  if (!userId) return { allowed: false, reason: 'NO_USER_ID' };
  return { allowed: true };
}

/**
 * Is this specific tool callable in Expert Mode?
 * @param {object} params
 * @param {string} params.toolName
 * @returns {{ allowed: boolean, tier: 'companion'|'expert'|null, reason?: string }}
 */
export function isToolAllowed({ toolName } = {}) {
  if (!toolName || !ALL_ALLOWED_TOOLS.has(toolName)) {
    return { allowed: false, tier: null, reason: `Tool '${toolName}' is not in the Expert Mode allowlist.` };
  }
  const tier = EXPERT_TOOLS.has(toolName) ? 'expert' : 'companion';
  return { allowed: true, tier };
}

export { COMPANION_TOOLS, EXPERT_TOOLS, ALL_ALLOWED_TOOLS };
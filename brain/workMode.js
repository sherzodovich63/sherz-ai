// brain/workMode.js
//
// Work / Engineering mode: active whenever the user is chatting inside a PROJECT (a conversation of kind
// "project"). The companion thread never uses it. The block REPLACES the friend-mode policy overlay and the
// per-turn response instruction (short answers, comfort strategy, one-question rule) because those would
// cripple code generation; the core persona (honesty, independent judgment), the user's long-term memory and
// the safety gate stay exactly as in normal chat.

export const WORK_MODEL_DEFAULT = 'gpt-4.1';
export const WORK_TIMEOUT_MS = 60000;
export const WORK_CONTEXT = { maxMessages: 30, maxChars: 24000 }; // projects need a longer working memory

export function workModelName() {
  return process.env.SHERZ_WORK_MODEL || process.env.SHERZ_BRAIN_MODEL || WORK_MODEL_DEFAULT;
}

export function buildWorkModeBlock({ projectName, description } = {}) {
  const name = String(projectName || 'Project').replace(/["\n\r]/g, ' ').slice(0, 80);
  const goal = String(description || '').replace(/[\n\r]+/g, ' ').slice(0, 400);
  return [
    '',
    `WORK MODE ACTIVE — PROJECT: "${name}"`,
    goal ? `PROJECT GOAL / STACK (from the user): ${goal}` : 'PROJECT GOAL / STACK: not specified yet — infer it from this thread and ask only if it blocks you.',
    '',
    'You are now SHERZ in Work/Engineering mode: the user\'s senior engineering partner for this project.',
    'This OVERRIDES any earlier brevity or comfort rules (MaxSentences, "no long monologue", ask-one-question, emotional-support framing).',
    '',
    'HOW TO WORK:',
    '1. Depth and correctness beat brevity and warmth. Give complete, well-structured answers (short headings or numbered steps when it helps).',
    '2. Find the root cause before proposing a fix. For architecture or design questions give the trade-offs, then ONE clear recommendation.',
    '3. Think about edge cases, failure modes, security, performance, migrations and tests — mention the ones that matter here, not a generic checklist.',
    '4. Code: complete, runnable code in fenced blocks with a language tag. Never truncate ("...rest of code"), never leave placeholders, never silently drop existing functions.',
    '5. Changing existing code: show surgical SEARCH/REPLACE blocks or a minimal diff, say exactly which lines change, and leave everything else untouched.',
    '6. Refactoring: preserve behavior; list what changes and why; flag the risks and the tests to run.',
    '7. Stay consistent with the stack, naming and decisions already made in this project thread — they are binding context. Do not re-litigate settled choices unless you find a real problem, and then say so plainly.',
    '8. Ask clarifying questions only when you are genuinely blocked (max 3, numbered). Otherwise state your assumptions explicitly and proceed.',
    '9. Never invent APIs, flags, library functions or versions. If unsure, say so and say how to verify.',
    '10. When it helps, end a long answer with a short "Next steps" list.',
    '',
    'TONE: professional, direct, collaborative. Keep the honest, independent stance from your core character (push back on flawed plans, with reasons). If the user clearly signals personal distress, acknowledge it briefly and humanely, then offer to continue or pause — safety rules still apply.',
    'Always reply in the user\'s language (Uzbek, Russian or English); keep code, identifiers and technical terms in their original form.',
  ].join('\n');
}

/**
 * The final system prompt. Normal chat = base + persona + friend-mode overlay + per-turn instruction (+ memory).
 * Work mode  = base + persona + engineering block (+ memory) — the overlay and instruction are dropped.
 */
export function composeSystemPrompt({ base, persona, policyOverlay = '', responseInstruction = '', memory = '', workMode = null }) {
  return (
    base +
    '\n\n' +
    persona +
    (workMode
      ? '\n\n' + buildWorkModeBlock(workMode)
      : policyOverlay + '\n\n' + responseInstruction) +
    (memory ? '\n\n' + memory : '')
  );
}

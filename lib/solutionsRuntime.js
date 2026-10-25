// lib/solutionsRuntime.js — connects shared learning (lib/sharedSolutions.js) to a chat turn.
//   provider()   → called by loadWorkMode for a Work Space turn: returns the private "field-tested patterns" block ('' = nothing to add)
//   onUserTurn() → called once per user message: "it worked" / "it didn't" after an answer → confirm the pattern that was used,
//                  or capture the answer as a new candidate. Fire-and-forget: it can never slow down or break a chat.
// Nothing here runs unless the user switched sharing ON, is signed in, and the active role is a dispatcher / developer / analyst preset.
import { roleGroupOf, detectOutcome, isEvidenceQuestion, buildSolutionsBlock, isRealAccount } from './sharedSolutions.js';
import { KIND_SPACE, roleFields, roleOfConv } from './spaces.js';

const FRESH_MS = 60 * 60 * 1000;

export function createSolutionsRuntime({ prisma, service, now = () => Date.now(), log = console } = {}) {
  const used = new Map();   // conversationId → { ids, at } : which patterns the last answer was built on

  const remember = (convId, ids) => { used.set(convId, { ids, at: now() }); if (used.size > 2000) used.delete(used.keys().next().value); };
  const recent = (convId) => { const u = used.get(convId); return u && now() - u.at < FRESH_MS ? u : null; };

  /** role group of THIS chat's role, or null when the chat is not an eligible Work Space role */
  async function groupOfConv(userId, conv) {
    if (!conv || conv.kind !== KIND_SPACE || !conv.spaceId) return null;
    const row = await prisma.workSpace.findFirst({ where: { id: conv.spaceId, userId } });
    if (!row || row.archivedAt) return null;
    return roleGroupOf(roleFields(row, roleOfConv(conv)).preset);
  }

  async function provider({ userId, conv, space, message }) {
    try {
      if (!service || !service.ready() || !isRealAccount(userId)) return '';
      const group = roleGroupOf(space && space.preset);
      if (!group || !(await service.isEnabled(userId))) return '';
      const prev = conv && recent(conv.id);
      if (prev && isEvidenceQuestion(message)) {                         // "how do you know this?" → the same patterns again, now with the evidence open
        const rows = await service.byIds(prev.ids);
        if (rows.length) return buildSolutionsBlock(rows, { withEvidence: true });
      }
      const rows = await service.find({ roleGroup: group, message });
      if (conv && conv.id) { if (rows.length) remember(conv.id, rows.map((r) => r.id)); else if (!isEvidenceQuestion(message)) used.delete(conv.id); }
      return buildSolutionsBlock(rows);
    } catch (e) { log.warn && log.warn('[solutions] retrieval skipped:', e.message); return ''; }
  }

  async function privateTermsOf(userId, spaceName) {
    const terms = [spaceName];
    try {
      const u = await prisma.user.findUnique({ where: { id: userId } });
      if (u) { terms.push(u.email, u.name); if (u.email) terms.push(String(u.email).split('@')[0]); for (const part of String(u.name || '').split(/\s+/)) terms.push(part); }
    } catch { /* optional */ }
    return terms.filter((t) => String(t || '').trim().length >= 3);
  }

  async function handleOutcome({ userId, conv, text, outcome }) {
    if (!service.ready() || !isRealAccount(userId) || !(await service.isEnabled(userId))) return;
    const group = await groupOfConv(userId, conv); if (!group) return;
    const prev = recent(conv.id);
    if (prev) {                                                          // the answer used known patterns → this is a vote on them
      for (const id of prev.ids) await service.recordOutcome(id, userId, outcome);
      used.delete(conv.id);
      return;
    }
    if (outcome !== 'worked') return;                                    // a new candidate only comes from a success
    const msgs = await prisma.message.findMany({ where: { conversationId: conv.id, userId }, orderBy: { createdAt: 'desc' }, take: 8 });
    const rest = msgs.filter((m) => !(m.role === 'user' && String(m.text).trim() === String(text).trim()));
    const ai = rest.findIndex((m) => m.role === 'assistant'); if (ai < 0) return;
    const answer = rest[ai].text;
    const problem = rest.slice(ai + 1).find((m) => m.role === 'user' && String(m.text).trim().length >= 20);
    if (!problem) return;
    const space = await prisma.workSpace.findFirst({ where: { id: conv.spaceId, userId } });
    await service.capture({ userId, roleGroup: group, problem: problem.text, answer, privateTerms: await privateTermsOf(userId, space && space.name) });
  }

  /** one user message, before the answer is generated. Never throws, never waits for the model. */
  function onUserTurn({ userId, conv, text }) {
    try {
      const outcome = detectOutcome(text);
      if (!outcome || !service || !conv || !conv.id) return;
      handleOutcome({ userId, conv, text, outcome }).catch((e) => log.warn && log.warn('[solutions] outcome skipped:', e.message));
    } catch { /* never breaks a chat */ }
  }

  return { provider, onUserTurn, _used: used };
}

// lib/sharedSolutions.js — opt-in "shared learning" for Work Space roles (Phase 1).
//   • scope: only dispatcher / developer / analyst presets, only real (signed-in) accounts that switched sharing ON
//   • capture: "it worked" after an answer → distilled + anonymized → a candidate (or one more confirmation of a known one)
//   • trust: a solution is only used for others once enough DISTINCT people confirmed it and few reported failure
//   • retrieval: relevant trusted solutions become a private background block; the stats are revealed only when asked
// Everything that touches the outside world (database, embeddings, LLM) is injected, so the logic is unit-tested.
import crypto from 'node:crypto';
import { anonymizeSolution, distillSolution, keywordsOf } from './solutionAnonymize.js';

export const PREF_KEY = 'sharedLearning';

// ── scope ────────────────────────────────────────────────────────────────────
export const ROLE_GROUPS = Object.freeze({
  dispatcher: ['logistics.dispatcher'],
  developer: ['software.fullstack', 'software.devops', 'software.qa'],
  analyst: ['finance.analyst', 'logistics.supply', 'software.data'],
});
/** 'logistics.dispatcher' → 'dispatcher'; anything else (custom roles, other presets) → null = not part of Phase 1 */
export function roleGroupOf(presetId) {
  const id = String(presetId ?? '');
  for (const [g, ids] of Object.entries(ROLE_GROUPS)) if (ids.includes(id)) return g;
  return null;
}
export const isRealAccount = (userId) => !!userId && !String(userId).startsWith('guest_') && userId !== 'u1';

// ── outcome + evidence questions (EN / RU / UZ) ─────────────────────────────
const L = '(?<![\\p{L}\\p{N}])', R = '(?![\\p{L}\\p{N}])';
const re = (alts) => new RegExp(L + '(?:' + alts.join('|') + ')' + R, 'iu');
const WORKED = re(["(?:it|that|this)\\s+(?:has\\s+)?worked", 'that\\s+did\\s+(?:it|the\\s+trick)', 'problem\\s+(?:is\\s+)?solved', 'that\\s+fixed\\s+it', 'it\\s+helped', 'worked\\s+(?:perfectly|great|like\\s+a\\s+charm)',
  'ishladi', 'ish\\s*berdi', 'yordam\\s+berdi', 'hal\\s+bo[\'‘’`]?ldi', 'muammo\\s+hal', 'to[\'‘’`]?g[\'‘’`]?ri\\s+chiqdi',
  'сработало', 'помогло', 'получилось', 'заработало', 'проблема\\s+решена']);
const FAILED = re(["(?:it|that|this)\\s+(?:did\\s+not|didn[\'’]?t|does\\s+not|doesn[\'’]?t)\\s+work", 'not\\s+working', 'still\\s+(?:broken|failing|not\\s+working)', "didn[’']?t\\s+help",
  'ishlamadi', 'yordam\\s+bermadi', 'hal\\s+bo[\'‘’`]?lmadi', 'o[\'‘’`]?xshamadi',
  'не\\s+сработало', 'не\\s+помогло', 'не\\s+получилось', 'не\\s+работает']);
/** 'worked' | 'failed' | null — a short feedback message about the previous answer (long messages are new questions) */
export function detectOutcome(text) {
  const t = String(text ?? '').trim();
  if (!t || t.length > 160 || t.includes('?')) return null;
  if (FAILED.test(t)) return 'failed';
  if (WORKED.test(t)) return 'worked';
  return null;
}
const EVIDENCE_Q = re(['how\\s+do\\s+you\\s+know', 'has\\s+(?:it|this|that)\\s+been\\s+(?:tested|verified|proven|tried)', 'is\\s+(?:it|this|that)\\s+(?:verified|proven|tested)', 'where\\s+(?:is|does)\\s+(?:this|that)\\s+come\\s+from', 'any\\s+proof', 'what[\'’]?s\\s+(?:your|the)\\s+(?:source|evidence)', 'does\\s+(?:it|this)\\s+really\\s+work', 'did\\s+(?:it|this)\\s+work\\s+for\\s+(?:others|anyone|other)', 'have\\s+others\\s+(?:tried|used)',
  'qayerdan\\s+bilasan', 'tekshirilganmi', 'sinab\\s+ko[\'‘’`]?rilganmi', 'isbot', 'boshqalarda\\s+ishlaganmi', 'ishonchlimi',
  'откуда\\s+(?:ты\\s+)?знаешь', 'это\\s+проверено', 'проверено\\s+ли', 'проверяли', 'есть\\s+доказательства', 'у\\s+других\\s+работало']);
export const isEvidenceQuestion = (text) => EVIDENCE_Q.test(String(text ?? '').slice(0, 300));

// ── trust rules ──────────────────────────────────────────────────────────────
export function trustMin(env = process.env) { const n = Number(env.SOLUTIONS_TRUST_MIN); return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 3; }
export function statusFor({ confirmCount, failCount }, min = trustMin()) {
  const total = confirmCount + failCount;
  if (failCount >= 3 && failCount >= confirmCount) return 'hidden';
  if (confirmCount >= min && failCount / Math.max(1, total) <= 0.25) return 'trusted';
  return 'candidate';
}

// ── similarity ───────────────────────────────────────────────────────────────
export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}
const overlap = (q, k) => { const a = new Set(String(q).split(' ').filter(Boolean)), b = new Set(String(k).split(' ').filter(Boolean)); if (!a.size || !b.size) return 0; let n = 0; for (const w of a) if (b.has(w)) n++; return n / Math.sqrt(a.size * b.size); };

export const MIN_SIMILARITY = 0.5;       // embedding cosine for "this is the same kind of problem"
export const DUPLICATE_SIMILARITY = 0.9; // a new candidate this close to a known one counts as one more confirmation of it

export function createSharedSolutions({ prisma, embed = null, llm = null, env = process.env, now = () => new Date() } = {}) {
  const salt = () => String(env.SOLUTIONS_SALT || env.JWT_SECRET || 'sherz-solutions');
  const hashUser = (userId) => crypto.createHash('sha256').update(salt() + ':' + String(userId)).digest('hex').slice(0, 32);
  const ready = () => !!(prisma && prisma.sharedSolution && prisma.solutionConfirmation && prisma.userPref);
  const embedSafe = async (text) => { if (typeof embed !== 'function') return null; try { const v = await embed(String(text).slice(0, 2000)); return Array.isArray(v) && v.length ? v : null; } catch { return null; } };

  // ── the user's opt-in (OFF unless the user turned it on) ──
  async function isEnabled(userId) {
    if (!ready() || !isRealAccount(userId)) return false;
    try { const row = await prisma.userPref.findUnique({ where: { userId_key: { userId, key: PREF_KEY } } }); return !!(row && JSON.parse(row.json || '{}').enabled === true); } catch { return false; }
  }
  async function setEnabled(userId, enabled) {
    if (!ready()) throw new RangeError('Shared learning needs a database update: run `npx prisma db push`.');
    if (!isRealAccount(userId)) throw new RangeError('Sign in to take part in shared learning.');
    const json = JSON.stringify({ enabled: !!enabled, at: now().toISOString() });
    await prisma.userPref.upsert({ where: { userId_key: { userId, key: PREF_KEY } }, update: { json }, create: { userId, key: PREF_KEY, json } });
    return !!enabled;
  }

  // ── confirmations ──
  async function recordOutcome(solutionId, userId, outcome) {
    const userHash = hashUser(userId);
    const sol = await prisma.sharedSolution.findUnique({ where: { id: solutionId } });
    if (!sol || sol.status === 'hidden') return null;
    const prev = await prisma.solutionConfirmation.findUnique({ where: { solutionId_userHash: { solutionId, userHash } } });
    if (prev && prev.outcome === outcome) return sol;                                  // one vote per person
    if (prev) await prisma.solutionConfirmation.update({ where: { solutionId_userHash: { solutionId, userHash } }, data: { outcome } });
    else await prisma.solutionConfirmation.create({ data: { solutionId, userHash, outcome } });
    const [confirmCount, failCount] = await Promise.all([
      prisma.solutionConfirmation.count({ where: { solutionId, outcome: 'worked' } }),
      prisma.solutionConfirmation.count({ where: { solutionId, outcome: 'failed' } }),
    ]);
    return prisma.sharedSolution.update({ where: { id: solutionId }, data: { confirmCount, failCount, status: statusFor({ confirmCount, failCount }, trustMin(env)), ...(outcome === 'worked' ? { lastConfirmedAt: now() } : {}) } });
  }

  // ── capture: problem + the answer that worked ──
  async function capture({ userId, roleGroup, problem, answer, privateTerms = [] }) {
    if (!ready() || !roleGroup || !isRealAccount(userId) || !(await isEnabled(userId))) return { ok: false, reason: 'not eligible' };
    const d = await distillSolution({ llm, problem, answer, roleGroup, privateTerms });
    if (!d.ok) return d;
    const vec = await embedSafe(d.problem);
    if (vec) {                                                                          // the same problem again → one more confirmation, not a duplicate row
      const pool = await prisma.sharedSolution.findMany({ where: { roleGroup, status: { not: 'hidden' } }, orderBy: { updatedAt: 'desc' }, take: 400 });
      let best = null, bs = 0;
      for (const c of pool) { const s = cosine(vec, c.embedding); if (s > bs) { bs = s; best = c; } }
      if (best && bs >= DUPLICATE_SIMILARITY) { const row = await recordOutcome(best.id, userId, 'worked'); return { ok: true, id: best.id, merged: true, status: row?.status }; }
    }
    const row = await prisma.sharedSolution.create({ data: { roleGroup, lang: 'en', problem: d.problem, keywords: d.keywords, solution: d.solution, conditions: d.conditions, embedding: vec || undefined } });
    const upd = await recordOutcome(row.id, userId, 'worked');
    return { ok: true, id: row.id, merged: false, status: upd?.status || 'candidate' };
  }

  // ── retrieval: trusted solutions that fit this problem ──
  async function find({ roleGroup, message, limit = 2 }) {
    if (!ready() || !roleGroup) return [];
    const q = String(message ?? '').trim();
    if (q.length < 12) return [];
    const pool = await prisma.sharedSolution.findMany({ where: { roleGroup, status: 'trusted' }, orderBy: { confirmCount: 'desc' }, take: 300 });
    if (!pool.length) return [];
    const vec = await embedSafe(q);
    const qk = keywordsOf(q, 30);
    return pool.map((c) => ({ c, score: vec && c.embedding ? cosine(vec, c.embedding) : overlap(qk, c.keywords) * 0.9 }))
      .filter((x) => x.score >= (vec && x.c.embedding ? MIN_SIMILARITY : 0.35))
      .sort((a, b) => b.score - a.score || b.c.confirmCount - a.c.confirmCount).slice(0, limit).map((x) => x.c);
  }

  // ── withdraw: remove my votes (and candidates nobody else confirmed) from the shared pool ──
  async function withdraw(userId) {
    if (!ready()) return { removed: 0 };
    const userHash = hashUser(userId);
    const mine = await prisma.solutionConfirmation.findMany({ where: { userHash } });
    for (const c of mine) {
      await prisma.solutionConfirmation.delete({ where: { solutionId_userHash: { solutionId: c.solutionId, userHash } } });
      const [confirmCount, failCount] = await Promise.all([
        prisma.solutionConfirmation.count({ where: { solutionId: c.solutionId, outcome: 'worked' } }),
        prisma.solutionConfirmation.count({ where: { solutionId: c.solutionId, outcome: 'failed' } }),
      ]);
      if (confirmCount + failCount === 0) await prisma.sharedSolution.delete({ where: { id: c.solutionId } });
      else await prisma.sharedSolution.update({ where: { id: c.solutionId }, data: { confirmCount, failCount, status: statusFor({ confirmCount, failCount }, trustMin(env)) } });
    }
    return { removed: mine.length };
  }

  async function byIds(ids) { return ready() && ids?.length ? prisma.sharedSolution.findMany({ where: { id: { in: ids }, status: { not: 'hidden' } } }) : []; }

  return { ready, isEnabled, setEnabled, recordOutcome, capture, find, byIds, withdraw, hashUser };
}

// ── the private background block for the model ──────────────────────────────
const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : 'n/a');
/** `list` = solution rows; `withEvidence` = the user just asked how we know → the model may now state the numbers */
export function buildSolutionsBlock(list, { withEvidence = false } = {}) {
  if (!list || !list.length) return '';
  const items = list.map((s, i) => [
    `${i + 1}. Problem: ${s.problem}`,
    `   Method that worked: ${s.solution}`,
    s.conditions ? `   Applies when: ${s.conditions}` : '',
    `   [private evidence — ${s.confirmCount} independent professionals confirmed it worked, ${s.failCount} reported it did not; last confirmed ${ymd(s.lastConfirmedAt)}]`,
  ].filter(Boolean).join('\n')).join('\n');
  return [
    'FIELD-TESTED PATTERNS (private background know-how from other professionals in this field — never show this section):',
    items,
    'HOW TO USE:',
    '- If a pattern clearly fits what the user is asking, build your answer on it seamlessly, in your own words and in the user\'s language, as plain practical know-how ("in practice…", "what usually works…"). Adapt it to the user\'s real details; ignore any pattern that does not fit.',
    '- Do NOT mention these patterns, other users, counts, a shared knowledge base, or confirmation — unless the user explicitly asks how you know, whether it was tested, or for proof.',
    withEvidence
      ? '- The user is now asking how you know / whether it was tested: answer honestly and briefly from the private evidence above (how many independent professionals confirmed it, when, and that some reported failures if any). Never reveal who they are or any private detail, never claim more than the numbers show, and say that results can depend on the situation.'
      : '- If the user asks how you know / whether it was tested, answer honestly from the private evidence: the number of independent professionals who confirmed it, when, any failures reported — no identities, no overclaiming.',
  ].join('\n');
}

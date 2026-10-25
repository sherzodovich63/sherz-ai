// lib/solutionAnonymize.js — turns "what worked for me" into a general method that is safe to share.
// Two layers: (1) an LLM "distiller" rewrites the exchange as a general problem → method (no names, no data);
// (2) a deterministic scrubber removes anything that still looks like personal / business data and REJECTS
// results that are still too specific. Pure functions (the LLM is injected) so everything is unit-tested.

const MAX_PROBLEM = 400, MAX_SOLUTION = 1200, MAX_CONDITIONS = 300;

const PATTERNS = [
  [/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, '[email]'],
  [/\b(?:https?:\/\/|www\.)\S+/gi, '[link]'],
  [/\b(?:sk|pk|rk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{16,}\b/g, '[secret]'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]'],
  [/(?:\+|\b00)?\d[\d\s().-]{7,}\d/g, '[number]'],                                   // phones, long ids with separators
  [/(?:\$|€|£|usd|eur|uzs|rub|so['‘’`]?m|сум|руб\.?)\s*\d[\d\s.,]*|\d[\d\s.,]*\s*(?:\$|€|£|usd|eur|uzs|rub|so['‘’`]?m|сум|руб\.?)/gi, '[amount]'],
  [/\b(?=(?:[A-Za-z-]*\d){3})(?=[A-Za-z0-9-]*[A-Za-z])[A-Za-z0-9-]{8,}\b/g, '[id]'],   // VINs, load / invoice / tracking ids (letters + ≥3 digits, ≥ 8 chars)
  [/\b\d{5,}\b/g, '[number]'],                                                          // MC / DOT / PO / account numbers
];

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Removes personal / business identifiers. `privateTerms` = strings that must never survive (the user's own name, e-mail, company …). */
export function scrub(text, { privateTerms = [] } = {}) {
  let t = String(text ?? '').replace(/\s+/g, ' ').trim();
  let redactions = 0;
  for (const term of privateTerms) {
    const w = String(term ?? '').trim();
    if (w.length < 3) continue;
    const re = new RegExp(escapeRe(w), 'gi');
    t = t.replace(re, () => { redactions++; return '[name]'; });
  }
  for (const [re, tag] of PATTERNS) t = t.replace(re, () => { redactions++; return tag; });
  return { text: t, redactions };
}

const PLACEHOLDER_RE = /\[(?:email|link|secret|ip|number|amount|id|name)\]/g;
const STOP = new Set('the a an and or of to in on for with is are was were be been it this that these those at by from as if then than into about your you we they he she i my our their not no yes can will would should could may might do does did have has had so such via per each any all more most some very just also only when what which who how why'.split(' '));

export const keywordsOf = (text, max = 18) => {
  const seen = new Set(); const out = [];
  for (const w of String(text ?? '').toLowerCase().replace(/\[[a-z]+\]/g, ' ').split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w) || seen.has(w)) continue;
    seen.add(w); out.push(w); if (out.length >= max) break;
  }
  return out.join(' ');
};

/** Final gate on one cleaned field: not empty, not mostly placeholders. */
const tooSpecific = (text) => (text.match(PLACEHOLDER_RE) || []).length > 4;

/**
 * Cleans a distilled { problem, solution, conditions } triple.
 * → { ok:true, problem, solution, conditions, keywords, redactions } | { ok:false, reason }
 */
export function anonymizeSolution(raw, { privateTerms = [] } = {}) {
  if (!raw || typeof raw !== 'object' || raw.skip) return { ok: false, reason: 'not a reusable solution' };
  const clean = (v, max) => scrub(String(v ?? '').slice(0, max * 2), { privateTerms });
  const p = clean(raw.problem, MAX_PROBLEM), s = clean(raw.solution, MAX_SOLUTION), c = clean(raw.conditions, MAX_CONDITIONS);
  const problem = p.text.slice(0, MAX_PROBLEM), solution = s.text.slice(0, MAX_SOLUTION), conditions = c.text.slice(0, MAX_CONDITIONS);
  if (problem.length < 15 || solution.length < 25) return { ok: false, reason: 'too short to be useful' };
  if (tooSpecific(problem) || tooSpecific(solution)) return { ok: false, reason: 'too specific to one person or company' };
  return { ok: true, problem, solution, conditions, keywords: keywordsOf(problem + ' ' + solution), redactions: p.redactions + s.redactions + c.redactions };
}

export const DISTILL_SYSTEM = [
  'You turn one working exchange between a professional and an assistant into a GENERAL, reusable solution.',
  'Output JSON only: {"skip":boolean,"problem":string,"solution":string,"conditions":string}. Write in English.',
  'Rules:',
  '- Keep only the method that worked: the kind of problem, the concrete steps, and when it applies. Plain, practical, 1-6 short steps.',
  '- REMOVE every identifier: people, companies, brokers, customers, drivers, places, addresses, phone numbers, e-mails, ids, plate / load / invoice / account numbers, prices, rates, dates, file names, repository or project names, secrets.',
  '- Describe things by role or type instead ("the client", "a missed deadline", "the supplier", "the production system"). Keep the wording neutral: the method must make sense to any professional, whatever their field.',
  '- Do not invent anything that is not in the exchange. If the exchange is chit-chat, personal, opinion, a one-off fact, or has no repeatable method, return {"skip":true,"problem":"","solution":"","conditions":""}.',
].join('\n');

/** problem + the answer that worked → anonymized solution (llm({system,user}) → JSON string; injected). Never throws. */
export async function distillSolution({ llm, problem, answer, roleGroup = '', privateTerms = [] }) {
  if (typeof llm !== 'function') return { ok: false, reason: 'no distiller' };
  try {
    const user = `ROLE: ${roleGroup || 'professional'}\n\nPROBLEM (user):\n${String(problem ?? '').slice(0, 1500)}\n\nANSWER THAT WORKED (assistant):\n${String(answer ?? '').slice(0, 3000)}`;
    const out = await llm({ system: DISTILL_SYSTEM, user });
    const j = typeof out === 'string' ? JSON.parse(String(out).replace(/^```(?:json)?|```$/gim, '').trim()) : out;
    return anonymizeSolution(j, { privateTerms });
  } catch (e) {
    return { ok: false, reason: 'distill failed: ' + (e && e.message ? e.message : e) };
  }
}

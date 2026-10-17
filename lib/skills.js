// lib/skills.js — Phase 4: per-Work-Space SKILLS (taught procedures) with evidence-based proficiency.
// A skill is advice for the model, never a permission. Proficiency is COMPUTED from events (plans a skill informed that the user
// approved / edited / rejected, plus explicit thumbs) — the model never rates itself.
export const MAX_SKILLS_PER_SPACE = 60;
export const MAX_NAME = 80, MAX_SUMMARY = 200, MAX_BODY = 1500, MAX_TRIGGERS = 8, MAX_TRIGGER = 40;
export const TOP_BODY_CHARS = 1500, OTHER_BODY_CHARS = 600;

const oneLine = (v, n) => String(v ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/<<<|>>>/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const multiLine = (v, n) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').replace(/<<<|>>>/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);

export function cleanSkill(input, { partial = false } = {}) {
  const a = input && typeof input === 'object' ? input : {};
  const out = {};
  if (!partial || a.name !== undefined) { out.name = oneLine(a.name, MAX_NAME); if (!out.name) throw new RangeError('skill name required'); }
  if (!partial || a.summary !== undefined) { out.summary = oneLine(a.summary, MAX_SUMMARY); if (!out.summary) throw new RangeError('skill summary required'); }
  if (!partial || a.body !== undefined) {
    out.body = multiLine(a.body, MAX_BODY); if (out.body.length < 3) throw new RangeError('skill steps required');
    if (String(a.body ?? '').length > MAX_BODY) throw new RangeError(`skill steps are too long (max ${MAX_BODY} characters)`);
  }
  if (!partial || a.triggers !== undefined) {
    const t = Array.isArray(a.triggers) ? a.triggers : String(a.triggers ?? '').split(/[,\n]/);
    out.triggers = [...new Set(t.map((x) => oneLine(x, MAX_TRIGGER).toLowerCase()).filter(Boolean))].slice(0, MAX_TRIGGERS);
  }
  return out;
}

// ── proficiency (same idea as trust.js: successes minus penalties) ──
export const LEVELS = [
  { min: 15, level: 'expert', label: 'Expert' },
  { min: 8, level: 'proficient', label: 'Proficient' },
  { min: 3, level: 'competent', label: 'Competent' },
  { min: -Infinity, level: 'learning', label: 'Learning' },
];
export const scoreOf = (s) => (s.successes || 0) - 2 * (s.rejections || 0) - (s.corrections || 0);
export function levelOf(s) {
  const score = scoreOf(s), lv = LEVELS.find((l) => score >= l.min);
  const judged = (s.successes || 0) + (s.rejections || 0) + (s.corrections || 0);
  const idle = s.lastUsedAt ? Date.now() - new Date(s.lastUsedAt).getTime() > 90 * 86400000 : false;
  return { level: lv.level, label: lv.label, score, accepted: judged ? Math.round((100 * (s.successes || 0)) / judged) : null, idle };
}
export const toClient = (s) => ({
  id: s.id, spaceId: s.spaceId, name: s.name, summary: s.summary, body: s.body, triggers: Array.isArray(s.triggers) ? s.triggers : [],
  source: s.source, status: s.status, uses: s.uses || 0, successes: s.successes || 0, corrections: s.corrections || 0, rejections: s.rejections || 0,
  lastUsedAt: s.lastUsedAt ? new Date(s.lastUsedAt).getTime() : null, createdAt: new Date(s.createdAt).getTime(), ...levelOf(s),
});

// ── selection (v1: lexical, no embeddings needed) ──
const STOP = new Set('the and for with that this from your you are was were have has not but all any can will how what when where who why into out our their they them then than too very just about over under more most some such only own same also use used using'.split(' '));
export function tokens(text) {
  return String(text ?? '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)?.filter((w) => !STOP.has(w)) ?? [];
}
export function scoreSkill(skill, queryTokens) {
  const q = new Set(queryTokens); if (!q.size) return 0;
  const hit = (txt, w) => [...new Set(tokens(txt))].filter((t) => q.has(t)).length * w;
  const trig = (Array.isArray(skill.triggers) ? skill.triggers : []).reduce((n, p) => n + (tokens(p).some((t) => q.has(t)) ? 3 : 0), 0);
  const base = trig + hit(skill.name, 2) + hit(skill.summary, 1);
  if (!base) return 0;
  const lv = levelOf(skill); const bonus = { expert: 0.6, proficient: 0.4, competent: 0.2, learning: 0 }[lv.level];
  return base + bonus;
}
export function rankSkills(skills, message) {
  const qt = tokens(message);
  const active = (skills || []).filter((s) => s.status === 'active');
  const scored = active.map((s) => ({ s, sc: scoreSkill(s, qt) })).filter((x) => x.sc > 0).sort((a, b) => (b.sc - a.sc) || (new Date(b.s.updatedAt || 0) - new Date(a.s.updatedAt || 0)));
  const top = scored.slice(0, 3).map((x) => x.s);
  const ids = new Set(top.map((s) => s.id));
  return { top, index: active.filter((s) => !ids.has(s.id)).slice(0, 15) };
}

// ── store-backed functions (prisma shape: skill / skillEvent) ──
export async function listSkills(prisma, userId, spaceId, { status } = {}) {
  const rows = await prisma.skill.findMany({ where: { userId, spaceId, ...(status ? { status } : {}) }, orderBy: { updatedAt: 'desc' }, take: MAX_SKILLS_PER_SPACE + 5 });
  return rows;
}
export async function pickSkills(prisma, { userId, spaceId, message }) {
  try { return rankSkills(await listSkills(prisma, userId, spaceId, { status: 'active' }), message); }
  catch { return { top: [], index: [] }; }          // skills must never break a chat turn
}
const evt = (prisma, userId, skillId, type, ref = null) => prisma.skillEvent.create({ data: { userId, skillId, type, ref } });

export async function teachSkill(prisma, userId, spaceId, input, { source = 'taught', status = 'active' } = {}) {
  const c = cleanSkill(input);
  const n = (await prisma.skill.findMany({ where: { userId, spaceId }, take: MAX_SKILLS_PER_SPACE + 1 })).length;
  if (n >= MAX_SKILLS_PER_SPACE) throw new RangeError('too many skills in this Work Space');
  if (await prisma.skill.findFirst({ where: { userId, spaceId, name: c.name } })) throw new RangeError('a skill with this name already exists');
  const triggers = c.triggers.length ? c.triggers : tokens(c.name).slice(0, MAX_TRIGGERS);
  const row = await prisma.skill.create({ data: { userId, spaceId, ...c, triggers, source, status } });
  await evt(prisma, userId, row.id, 'created');
  return row;
}
export async function updateSkill(prisma, userId, spaceId, id, patch) {
  const own = await prisma.skill.findFirst({ where: { id: String(id), userId, spaceId } });
  if (!own) return null;
  const data = cleanSkill(patch, { partial: true });
  if (patch && patch.status !== undefined) { if (!['active', 'archived', 'draft'].includes(patch.status)) throw new RangeError('status must be active, draft or archived'); data.status = patch.status; }
  if (!Object.keys(data).length) throw new RangeError('nothing to update');
  if (data.name && data.name !== own.name && await prisma.skill.findFirst({ where: { userId, spaceId, name: data.name } })) throw new RangeError('a skill with this name already exists');
  const content = ['name', 'summary', 'body', 'triggers'].some((k) => data[k] !== undefined);
  const row = await prisma.skill.update({ where: { id: own.id }, data: { ...data, ...(content ? { version: (own.version || 1) + 1 } : {}) } });
  await evt(prisma, userId, own.id, 'edited');
  return row;
}
export async function deleteSkill(prisma, userId, spaceId, id) {
  const own = await prisma.skill.findFirst({ where: { id: String(id), userId, spaceId } });
  if (!own) return false;
  await prisma.skillEvent.deleteMany({ where: { skillId: own.id } });
  await prisma.skill.delete({ where: { id: own.id } });
  return true;
}

/** a plan was proposed while these skills were in the prompt → they "informed" it (this is what `uses` counts) */
export async function recordUse(prisma, { userId, skillIds = [], ref }) {
  if (!ref) return 0; let n = 0;
  for (const id of [...new Set(skillIds)].slice(0, 5)) {
    const s = await prisma.skill.findFirst({ where: { id, userId } }); if (!s) continue;
    if (await prisma.skillEvent.findFirst({ where: { skillId: id, type: 'used', ref } })) continue;
    await prisma.skill.update({ where: { id }, data: { uses: (s.uses || 0) + 1, lastUsedAt: new Date() } });
    await evt(prisma, userId, id, 'used', ref); n++;
  }
  return n;
}
const OUTCOME = { approved: ['success', 'successes'], edited: ['corrected', 'corrections'], rejected: ['rejected', 'rejections'] };
/** the user decided about a plan: credit / debit every skill that informed it (once per skill, plan and outcome) */
export async function recordDecision(prisma, { userId, actionId, outcome }) {
  const o = OUTCOME[outcome]; if (!o || !actionId) return 0; let n = 0;
  const used = await prisma.skillEvent.findMany({ where: { ref: String(actionId), type: 'used', userId }, take: 10 });
  for (const u of used) {
    const s = await prisma.skill.findFirst({ where: { id: u.skillId, userId } }); if (!s) continue;
    if (await prisma.skillEvent.findFirst({ where: { skillId: s.id, type: o[0], ref: String(actionId) } })) continue;
    await prisma.skill.update({ where: { id: s.id }, data: { [o[1]]: (s[o[1]] || 0) + 1 } });
    await evt(prisma, userId, s.id, o[0], String(actionId)); n++;
  }
  return n;
}
/** explicit 👍 / 👎 on a skill card */
export async function thumbs(prisma, userId, spaceId, id, value) {
  const s = await prisma.skill.findFirst({ where: { id: String(id), userId, spaceId } }); if (!s) return null;
  const up = Number(value) > 0;
  const row = await prisma.skill.update({ where: { id: s.id }, data: up ? { successes: (s.successes || 0) + 1 } : { rejections: (s.rejections || 0) + 1 } });
  await evt(prisma, userId, s.id, up ? 'thumbs_up' : 'thumbs_down');
  return row;
}

// lib/spaces.js — Phase 4: WORK SPACES.
// A Space is a reusable profile (role, instructions, style) that conversations of kind "space" attach to.
// Chats stay in Conversation + Message (nothing forked). Every function takes the verified userId and only touches that user's rows.
import { workModeFor } from './conversations.js';
import { pickSkills, MAX_SKILLS_PER_SPACE } from './skills.js';
import { buildSpaceBlock, MAX_INSTRUCTIONS } from '../brain/spaceContext.js';
import { STYLES, STYLE_IDS, normalizeStyle, CATEGORIES, resolveRole, BLANK } from './roleCatalog.js';

export const KIND_SPACE = 'space';
export const MAX_SPACES = 1;      // ONE unified Work Space per user …
export const MAX_ROLES = 2;       // … with up to two role profiles inside it (role 1 = the row itself, role 2 = the `role2` JSON)
const MAX_NAME = 60, MAX_ROLE = 160;
export const ICONS = ['briefcase', 'truck', 'book', 'code', 'chart', 'flask', 'pen', 'globe', 'coins', 'palette', 'megaphone', 'cap', 'wrench'];
export const COLORS = ['violet', 'teal', 'amber', 'rose', 'blue', 'green'];
export { STYLES, CATEGORIES };

export const PRESETS = { blank: BLANK };   // kept for older clients; the real catalog is roleCatalog.js

const oneLine = (v, n) => String(v ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/<<<|>>>/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const multiLine = (v, n) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').replace(/<<<|>>>/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
const pick = (v, list, d) => (list.includes(v) ? v : d);
const presetOf = (id) => resolveRole(id) || BLANK;

// ── roles inside the one Work Space ──
const ROLE_KEYS = ['name', 'role', 'instructions', 'style', 'icon', 'color', 'preset'];
export const hasRole2 = (s) => !!(s && s.role2 && typeof s.role2 === 'object' && typeof s.role2.name === 'string' && s.role2.name.trim());
export const activeRoleOf = (s) => (s && Number(s.activeRole) === 2 && hasRole2(s) ? 2 : 1);
/** the profile fields of role n (1 or 2) */
export const roleFields = (s, n) => (n === 2 && hasRole2(s) ? Object.fromEntries(ROLE_KEYS.map((k) => [k, s.role2[k] ?? (k === 'preset' ? 'blank' : '')])) : Object.fromEntries(ROLE_KEYS.map((k) => [k, s[k]])));
/** the row as the rest of the app sees it: the ACTIVE role's profile on top of the Space (id, skills, chats stay the Space's) */
export const effectiveSpace = (s) => ({ ...s, ...roleFields(s, activeRoleOf(s)) });
// Each role has its OWN chat thread. Role 2's chats carry this marker in `description` (role 1's chats, including every older chat, have none) — no database change needed.
const ROLE2_TAG = 'sherz:role2';
export const roleOfConv = (c) => (c && c.description === ROLE2_TAG ? 2 : 1);
async function roleConvs(prisma, userId, spaceId, role) {
  const all = await prisma.conversation.findMany({ where: { userId, spaceId }, orderBy: { updatedAt: 'desc' }, take: 500 });
  return all.filter((c) => roleOfConv(c) === role);
}
const retitleRole = async (prisma, userId, spaceId, role, title) => { for (const c of await roleConvs(prisma, userId, spaceId, role)) await prisma.conversation.update({ where: { id: c.id }, data: { title } }); };
const dropRoleConvs = async (prisma, userId, spaceId, role) => { for (const c of await roleConvs(prisma, userId, spaceId, role)) { await prisma.message.deleteMany({ where: { userId, conversationId: c.id } }); await prisma.conversation.delete({ where: { id: c.id } }); } };

export function cleanSpace(input, { partial = false, presetBase = null } = {}) {
  const a = input && typeof input === 'object' ? input : {};
  const p = presetBase || BLANK;
  const out = {};
  if (!partial || a.name !== undefined) { out.name = oneLine(a.name ?? p.label, MAX_NAME); if (!out.name) throw new RangeError('Work Space name required'); }
  if (!partial || a.role !== undefined) out.role = oneLine(a.role ?? p.role, MAX_ROLE) || null;
  if (!partial || a.instructions !== undefined) {
    if (String(a.instructions ?? '').length > MAX_INSTRUCTIONS) throw new RangeError(`instructions are too long (max ${MAX_INSTRUCTIONS} characters)`);
    out.instructions = multiLine(a.instructions ?? p.instructions, MAX_INSTRUCTIONS);
  }
  if (!partial || a.icon !== undefined) out.icon = pick(a.icon, ICONS, p.icon);
  if (!partial || a.color !== undefined) out.color = pick(a.color, COLORS, p.color);
  if (!partial || a.style !== undefined) out.style = pick(normalizeStyle(a.style ?? p.style), STYLE_IDS, 'general');
  return out;
}

export const spaceToClient = (row, extra = {}) => {
  const s = effectiveSpace(row);                                   // top-level fields = the active role, so older UI code keeps working
  const roleView = (n) => { const f = roleFields(row, n); return { n, name: f.name, role: f.role || '', preset: f.preset || 'blank', style: normalizeStyle(f.style), icon: f.icon, color: f.color, instructions: f.instructions || '' }; };
  return {
    id: s.id, name: s.name, role: s.role || '', preset: s.preset || 'blank', style: normalizeStyle(s.style), icon: s.icon, color: s.color,
    instructions: s.instructions || '', archived: !!s.archivedAt, createdAt: new Date(s.createdAt).getTime(), updatedAt: new Date(s.updatedAt).getTime(),
    activeRole: activeRoleOf(row), roles: hasRole2(row) ? [roleView(1), roleView(2)] : [roleView(1)], canAddRole: !hasRole2(row), ...extra,
  };
};

export async function listSpaces(prisma, userId) {
  const rows = await prisma.workSpace.findMany({ where: { userId, archivedAt: null }, orderBy: { updatedAt: 'desc' }, take: MAX_SPACES + 5 });
  const out = [];
  for (const s of rows) {
    const sk = await prisma.skill.findMany({ where: { userId, spaceId: s.id }, take: MAX_SKILLS_PER_SPACE + 1 });
    out.push(spaceToClient(s, { skillCount: sk.filter((x) => x.status === 'active').length, draftCount: sk.filter((x) => x.status === 'draft').length }));
  }
  return out;
}
export const getSpace = (prisma, userId, id) => prisma.workSpace.findFirst({ where: { id: String(id), userId } });

export async function createSpace(prisma, userId, input = {}) {
  const base = resolveRole(String(input.preset || 'blank'));
  const preset = base ? base.id : 'blank';
  const c = cleanSpace(input, { presetBase: base || BLANK });
  const mine = await prisma.workSpace.findMany({ where: { userId, archivedAt: null }, take: MAX_SPACES + 1 });
  if (mine.length >= MAX_SPACES) throw new RangeError('you already have your Work Space — edit it or add a second role instead');
  if (mine.some((s) => s.name.toLowerCase() === c.name.toLowerCase())) throw new RangeError('you already have a Work Space with this name');
  const row = await prisma.workSpace.create({ data: { userId, preset, ...c } });
  return spaceToClient(row, { skillCount: 0, draftCount: 0 });
}
export async function updateSpace(prisma, userId, id, patch) {
  const own = await getSpace(prisma, userId, id); if (!own) return null;
  if (activeRoleOf(own) === 2) {                                   // editing while role 2 is active edits role 2
    const d2 = cleanSpace(patch, { partial: true, presetBase: presetOf(own.role2.preset) });
    if (!Object.keys(d2).length) throw new RangeError('nothing to update');
    const row2 = await prisma.workSpace.update({ where: { id: own.id }, data: { role2: { ...roleFields(own, 2), ...d2 } } });
    if (d2.name) await retitleRole(prisma, userId, own.id, 2, d2.name);
    return spaceToClient(row2);
  }
  const data = cleanSpace(patch, { partial: true, presetBase: presetOf(own.preset) });
  if (!Object.keys(data).length) throw new RangeError('nothing to update');
  if (data.name && data.name.toLowerCase() !== own.name.toLowerCase()) {
    const mine = await prisma.workSpace.findMany({ where: { userId, archivedAt: null }, take: MAX_SPACES + 1 });
    if (mine.some((s) => s.id !== own.id && s.name.toLowerCase() === data.name.toLowerCase())) throw new RangeError('you already have a Work Space with this name');
  }
  const row = await prisma.workSpace.update({ where: { id: own.id }, data });
  if (data.name) await retitleRole(prisma, userId, own.id, 1, data.name);
  return spaceToClient(row);
}
/** set / replace the second role (becomes the active one) */
export async function setSecondRole(prisma, userId, id, input = {}) {
  const own = await getSpace(prisma, userId, id); if (!own || own.archivedAt) return null;
  const base = resolveRole(String(input.preset || 'blank'));
  const c = cleanSpace(input, { presetBase: base || BLANK });
  if (!hasRole2(own)) await dropRoleConvs(prisma, userId, own.id, 2);                    // a brand-new 2nd role starts with an empty chat of its own
  const row = await prisma.workSpace.update({ where: { id: own.id }, data: { role2: { ...c, preset: base ? base.id : 'blank' }, activeRole: 2 } });
  await retitleRole(prisma, userId, own.id, 2, c.name);
  return spaceToClient(row);
}
export async function removeSecondRole(prisma, userId, id) {
  const own = await getSpace(prisma, userId, id); if (!own || own.archivedAt) return null;
  const row = await prisma.workSpace.update({ where: { id: own.id }, data: { role2: {}, activeRole: 1 } });
  await dropRoleConvs(prisma, userId, own.id, 2);                                         // the removed role's chat goes with it (it would otherwise bleed into a future 2nd role)
  return spaceToClient(row);
}
export async function setActiveRole(prisma, userId, id, n) {
  const own = await getSpace(prisma, userId, id); if (!own || own.archivedAt) return null;
  const want = Number(n);
  if (want !== 1 && want !== 2) throw new RangeError('role must be 1 or 2');
  if (want === 2 && !hasRole2(own)) throw new RangeError('there is no second role yet');
  const row = await prisma.workSpace.update({ where: { id: own.id }, data: { activeRole: want } });   // each role keeps its own chat (and title); nothing to rename
  return spaceToClient(row);
}
/** the user has more than one active Space from before this rule → they must choose one (they are never merged or deleted automatically) */
export const needsPick = (spaces) => (spaces || []).length > MAX_SPACES;
/**
 * Keeps `id` as THE Work Space; `secondId` (optional) is copied in as its second role. Every other Space is archived (not deleted:
 * chats and skills stay in the database). Skills of the second Space move to the kept one (a name clash keeps the kept Space's skill).
 */
export async function pickSpace(prisma, userId, { id, secondId = null } = {}) {
  const keep = await getSpace(prisma, userId, id); if (!keep || keep.archivedAt) return null;
  const second = secondId && String(secondId) !== String(id) ? await getSpace(prisma, userId, secondId) : null;
  if (secondId && (!second || second.archivedAt)) return null;
  const all = await prisma.workSpace.findMany({ where: { userId, archivedAt: null }, take: 200 });
  let row = keep;
  if (second) {
    const f = roleFields(effectiveSpace(second), 1);
    row = await prisma.workSpace.update({ where: { id: keep.id }, data: { role2: { ...f } } });
    const mineNames = new Set((await prisma.skill.findMany({ where: { userId, spaceId: keep.id }, take: 500 })).map((k) => String(k.name).toLowerCase()));
    for (const k of await prisma.skill.findMany({ where: { userId, spaceId: second.id }, take: 500 })) {
      if (mineNames.has(String(k.name).toLowerCase())) continue;
      try { await prisma.skill.update({ where: { id: k.id }, data: { spaceId: keep.id } }); mineNames.add(String(k.name).toLowerCase()); } catch { /* keeps its old Space; nothing is lost */ }
    }
  }
  for (const o of all) if (o.id !== keep.id) await prisma.workSpace.update({ where: { id: o.id }, data: { archivedAt: new Date() } });
  await retitleRole(prisma, userId, keep.id, 1, roleFields(row, 1).name);
  return spaceToClient(row);
}
export async function archiveSpace(prisma, userId, id) {
  const own = await getSpace(prisma, userId, id); if (!own) return false;
  await prisma.workSpace.update({ where: { id: own.id }, data: { archivedAt: new Date() } }); return true;
}
/** permanent: the Space, its skills (cascade) and its chats with their messages */
export async function deleteSpace(prisma, userId, id) {
  const own = await getSpace(prisma, userId, id); if (!own) return false;
  const convs = await prisma.conversation.findMany({ where: { userId, spaceId: own.id }, take: 500 });
  for (const c of convs) { await prisma.message.deleteMany({ where: { userId, conversationId: c.id } }); await prisma.conversation.delete({ where: { id: c.id } }); }
  await prisma.skill.deleteMany({ where: { userId, spaceId: own.id } });
  await prisma.workSpace.delete({ where: { id: own.id } });
  return true;
}

/** the Space's chat: the newest one, or a fresh one (`fresh`) / the first one */
export async function openSpaceConversation(prisma, userId, spaceId, { fresh = false, role = null } = {}) {
  const space = await getSpace(prisma, userId, spaceId);
  if (!space || space.archivedAt) return null;
  let conv = null;
  const want = Number(role) === 2 && hasRole2(space) ? 2 : Number(role) === 1 ? 1 : activeRoleOf(space);   // default: the active role's chat
  if (!fresh) conv = (await roleConvs(prisma, userId, space.id, want))[0] || null;
  if (!conv) conv = await prisma.conversation.create({ data: { userId, kind: KIND_SPACE, spaceId: space.id, title: roleFields(space, want).name, ...(want === 2 ? { description: ROLE2_TAG } : {}) } });
  return { space: spaceToClient(space), conversation: convToClient(conv) };
}
export const convToClient = (c) => ({ id: c.id, kind: KIND_SPACE, spaceId: c.spaceId, role: roleOfConv(c), title: c.title, description: '', createdAt: new Date(c.createdAt).getTime(), updatedAt: new Date(c.updatedAt).getTime() });

/**
 * The work mode for a turn. Project → as before. Space chat → same, plus the Space profile + the skills that match this message.
 * Any trouble loading the Space falls back to plain work mode: a Space problem never breaks a chat.
 */
export async function loadWorkMode(prisma, userId, conv, message = '') {
  const base = workModeFor(conv);
  if (!base || conv.kind !== KIND_SPACE || !conv.spaceId) return base;
  try {
    const row = await prisma.workSpace.findFirst({ where: { id: conv.spaceId, userId } });
    if (!row || row.archivedAt) return base;
    const space = { ...row, ...roleFields(row, roleOfConv(conv)) };   // the profile of the role THIS chat belongs to; skills belong to the whole Work Space
    const { top, index } = await pickSkills(prisma, { userId, spaceId: space.id, message });
    return { ...base, projectName: space.name, space: { id: space.id, name: space.name, role: space.role || '', style: normalizeStyle(space.style), block: buildSpaceBlock({ space, skills: top, skillIndex: index }), skillIds: top.map((s) => s.id) } };
  } catch (e) { console.warn('[spaces] profile load failed (non-fatal):', e.message); return base; }
}

// lib/spaces.js — Phase 4: WORK SPACES.
// A Space is a reusable profile (role, instructions, style) that conversations of kind "space" attach to.
// Chats stay in Conversation + Message (nothing forked). Every function takes the verified userId and only touches that user's rows.
import { workModeFor } from './conversations.js';
import { pickSkills, MAX_SKILLS_PER_SPACE } from './skills.js';
import { buildSpaceBlock, MAX_INSTRUCTIONS } from '../brain/spaceContext.js';
import { STYLES, STYLE_IDS, normalizeStyle, CATEGORIES, resolveRole, BLANK } from './roleCatalog.js';

export const KIND_SPACE = 'space';
export const MAX_SPACES = 30;
const MAX_NAME = 60, MAX_ROLE = 160;
export const ICONS = ['briefcase', 'truck', 'book', 'code', 'chart', 'flask', 'pen', 'globe', 'coins', 'palette', 'megaphone', 'cap', 'wrench'];
export const COLORS = ['violet', 'teal', 'amber', 'rose', 'blue', 'green'];
export { STYLES, CATEGORIES };

export const PRESETS = { blank: BLANK };   // kept for older clients; the real catalog is roleCatalog.js

const oneLine = (v, n) => String(v ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/<<<|>>>/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const multiLine = (v, n) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').replace(/<<<|>>>/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
const pick = (v, list, d) => (list.includes(v) ? v : d);
const presetOf = (id) => resolveRole(id) || BLANK;

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

export const spaceToClient = (s, extra = {}) => ({
  id: s.id, name: s.name, role: s.role || '', preset: s.preset || 'blank', style: normalizeStyle(s.style), icon: s.icon, color: s.color,
  instructions: s.instructions || '', archived: !!s.archivedAt, createdAt: new Date(s.createdAt).getTime(), updatedAt: new Date(s.updatedAt).getTime(), ...extra,
});

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
  if (mine.length >= MAX_SPACES) throw new RangeError('too many Work Spaces — archive one first');
  if (mine.some((s) => s.name.toLowerCase() === c.name.toLowerCase())) throw new RangeError('you already have a Work Space with this name');
  const row = await prisma.workSpace.create({ data: { userId, preset, ...c } });
  return spaceToClient(row, { skillCount: 0, draftCount: 0 });
}
export async function updateSpace(prisma, userId, id, patch) {
  const own = await getSpace(prisma, userId, id); if (!own) return null;
  const data = cleanSpace(patch, { partial: true, presetBase: presetOf(own.preset) });
  if (!Object.keys(data).length) throw new RangeError('nothing to update');
  if (data.name && data.name.toLowerCase() !== own.name.toLowerCase()) {
    const mine = await prisma.workSpace.findMany({ where: { userId, archivedAt: null }, take: MAX_SPACES + 1 });
    if (mine.some((s) => s.id !== own.id && s.name.toLowerCase() === data.name.toLowerCase())) throw new RangeError('you already have a Work Space with this name');
  }
  const row = await prisma.workSpace.update({ where: { id: own.id }, data });
  if (data.name) await prisma.conversation.updateMany({ where: { userId, spaceId: own.id }, data: { title: data.name } });
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
export async function openSpaceConversation(prisma, userId, spaceId, { fresh = false } = {}) {
  const space = await getSpace(prisma, userId, spaceId);
  if (!space || space.archivedAt) return null;
  let conv = null;
  if (!fresh) conv = await prisma.conversation.findFirst({ where: { userId, spaceId: space.id, kind: KIND_SPACE }, orderBy: { updatedAt: 'desc' } });
  if (!conv) conv = await prisma.conversation.create({ data: { userId, kind: KIND_SPACE, spaceId: space.id, title: space.name } });
  return { space: spaceToClient(space), conversation: convToClient(conv) };
}
export const convToClient = (c) => ({ id: c.id, kind: KIND_SPACE, spaceId: c.spaceId, title: c.title, description: '', createdAt: new Date(c.createdAt).getTime(), updatedAt: new Date(c.updatedAt).getTime() });

/**
 * The work mode for a turn. Project → as before. Space chat → same, plus the Space profile + the skills that match this message.
 * Any trouble loading the Space falls back to plain work mode: a Space problem never breaks a chat.
 */
export async function loadWorkMode(prisma, userId, conv, message = '') {
  const base = workModeFor(conv);
  if (!base || conv.kind !== KIND_SPACE || !conv.spaceId) return base;
  try {
    const space = await prisma.workSpace.findFirst({ where: { id: conv.spaceId, userId } });
    if (!space || space.archivedAt) return base;
    const { top, index } = await pickSkills(prisma, { userId, spaceId: space.id, message });
    return { ...base, projectName: space.name, space: { id: space.id, name: space.name, style: normalizeStyle(space.style), block: buildSpaceBlock({ space, skills: top, skillIndex: index }), skillIds: top.map((s) => s.id) } };
  } catch (e) { console.warn('[spaces] profile load failed (non-fatal):', e.message); return base; }
}

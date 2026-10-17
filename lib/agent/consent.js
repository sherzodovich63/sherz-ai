// lib/agent/consent.js — Phase 3a: per-folder consent to feed file contents to the model.
// Reading a file/folder listing during a run sends its text to the AI provider, so the user must allow it ONCE per folder.
// A consent covers that folder and everything below it; "." means the whole shared folder. It can be revoked any time.
import crypto from 'node:crypto';

export function cleanFolder(v) {
  if (typeof v !== 'string') throw new Error('folder must be text');
  const raw = v.trim().replace(/\\/g, '/');
  if (raw.length > 200) throw new Error('folder is too long');
  if (/^([A-Za-z]:|\/|~)/.test(raw)) throw new Error('folder must be relative to the shared folder');
  if (/[\x00-\x1f<>:"|?*]/.test(raw)) throw new Error('folder has characters that are not allowed');
  const segs = raw.split('/').filter((x) => x && x !== '.');
  if (segs.some((x) => x === '..')) throw new Error('folder must not contain ".."');
  if (segs.some((x) => x.toLowerCase() === '.sherz-trash')) throw new Error('folder is reserved');
  return segs.join('/') || '.';
}
/** which folder must be consented for this observation? null = none needed (server-side sandbox) */
export function folderOf(tool, args = {}) {
  if (tool === 'files.list') return cleanFolder(args.path ?? '.');
  if (tool === 'files.read') { const p = cleanFolder(args.path); const i = p.lastIndexOf('/'); return i < 0 ? '.' : p.slice(0, i); }
  return null;
}
export const covers = (list, folder) => list.some((c) => c === '.' || c === folder || folder.startsWith(c + '/'));

export function memorySettingsStore() {
  const rows = new Map();
  return {
    async get(userId) { return rows.has(userId) ? structuredClone(rows.get(userId)) : { userId, consentFolders: [], autonomy: {}, prefs: {} }; },
    async save(userId, patch) { const r = { ...(await this.get(userId)), ...structuredClone(patch), userId }; rows.set(userId, r); return structuredClone(r); },
  };
}
export function prismaSettingsStore(prisma) {
  const m = () => prisma.agentSettings;
  return {
    async get(userId) { return (await m().findUnique({ where: { userId } })) || { userId, consentFolders: [], autonomy: {}, prefs: {} }; },
    async save(userId, patch) { return m().upsert({ where: { userId }, create: { userId, ...patch }, update: patch }); },
  };
}

export function createConsent({ store } = {}) {
  if (!store) throw new Error('consent needs a store');
  const list = async (userId) => { const r = await store.get(userId); return Array.isArray(r.consentFolders) ? r.consentFolders : []; };
  return {
    list,
    async has(userId, folder) { return covers(await list(userId), folder); },
    async grant(userId, folder) {
      const f = cleanFolder(folder); const cur = await list(userId);
      if (covers(cur, f)) return cur;
      const next = [...cur.filter((c) => !(f === '.' || c.startsWith(f + '/'))), f].slice(-50);   // a broader consent absorbs narrower ones
      await store.save(userId, { consentFolders: next }); return next;
    },
    async revoke(userId, folder) {
      const f = cleanFolder(folder); const cur = await list(userId);
      const next = cur.filter((c) => c !== f); await store.save(userId, { consentFolders: next }); return cur.length - next.length;
    },
  };
}

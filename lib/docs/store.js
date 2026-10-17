// lib/docs/store.js — where generated / uploaded files live. Owner-scoped, quota-limited, bytes kept in the database
// (Render's disk is wiped on every deploy). The store is a process-wide singleton that server.js sets at boot, so the
// registry tools (which only receive {userId, helper}) can reach it without changing the gate's call signature.
import crypto from 'node:crypto';

export const QUOTA = { files: 40, bytes: 60 * 1024 * 1024, fileBytes: 5 * 1024 * 1024 };
const safeName = (n) => String(n).replace(/[\x00-\x1f"\\/]/g, '').slice(0, 120);
export const toMeta = (r) => ({ id: r.id, name: r.name, mime: r.mime, size: r.size, source: r.source, createdAt: new Date(r.createdAt).getTime() });

async function enforce(usage, size) {
  if (size > QUOTA.fileBytes) throw new RangeError('file is larger than 5 MB');
  if (usage.count >= QUOTA.files) throw new RangeError(`you already have ${QUOTA.files} files — delete some with /files first`);
  if (usage.bytes + size > QUOTA.bytes) throw new RangeError('your file storage is full — delete some files with /files first');
}

export function memoryFileStore() {
  const rows = [];
  return {
    kind: 'memory',
    async put(userId, { name, mime, bytes, source = 'generated' }) {
      await enforce(await this.usage(userId), bytes.length);
      const r = { id: 'f_' + crypto.randomBytes(9).toString('hex'), userId, name: safeName(name), mime, size: bytes.length, source, bytes: Buffer.from(bytes), createdAt: new Date() };
      rows.push(r); return toMeta(r);
    },
    async get(userId, id) { const r = rows.find((x) => x.id === String(id) && x.userId === userId); return r ? { ...toMeta(r), bytes: Buffer.from(r.bytes) } : null; },
    async findByName(userId, name) { const r = [...rows].reverse().find((x) => x.userId === userId && x.name.toLowerCase() === String(name).toLowerCase()); return r ? { ...toMeta(r), bytes: Buffer.from(r.bytes) } : null; },
    async list(userId) { return rows.filter((x) => x.userId === userId).sort((a, b) => b.createdAt - a.createdAt).map(toMeta); },
    async remove(userId, id) { const i = rows.findIndex((x) => x.id === String(id) && x.userId === userId); if (i < 0) return false; rows.splice(i, 1); return true; },
    async usage(userId) { const m = rows.filter((x) => x.userId === userId); return { count: m.length, bytes: m.reduce((n, x) => n + x.size, 0) }; },
  };
}

export function prismaFileStore(prisma) {
  const M = () => { if (!prisma?.generatedFile) throw new Error('file storage is not set up yet: run `npx prisma db push` on the server'); return prisma.generatedFile; };
  const SEL = { id: true, name: true, mime: true, size: true, source: true, createdAt: true };
  return {
    kind: 'prisma',
    async usage(userId) { const rows = await M().findMany({ where: { userId }, select: { size: true }, take: QUOTA.files + 5 }); return { count: rows.length, bytes: rows.reduce((n, x) => n + x.size, 0) }; },
    async put(userId, { name, mime, bytes, source = 'generated' }) {
      await enforce(await this.usage(userId), bytes.length);
      return toMeta(await M().create({ data: { userId, name: safeName(name), mime, size: bytes.length, source, bytes: Buffer.from(bytes) }, select: SEL }));
    },
    async get(userId, id) { const r = await M().findFirst({ where: { id: String(id), userId } }); return r ? { ...toMeta(r), bytes: Buffer.from(r.bytes) } : null; },
    async findByName(userId, name) { const r = await M().findFirst({ where: { userId, name: String(name) }, orderBy: { createdAt: 'desc' } }); return r ? { ...toMeta(r), bytes: Buffer.from(r.bytes) } : null; },
    async list(userId) { return (await M().findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: QUOTA.files + 5, select: SEL })).map(toMeta); },
    async remove(userId, id) { const r = await M().findFirst({ where: { id: String(id), userId }, select: { id: true } }); if (!r) return false; await M().delete({ where: { id: r.id } }); return true; },
  };
}

let current = memoryFileStore();
export const getFileStore = () => current;
export const setFileStore = (s) => { current = s; return current; };

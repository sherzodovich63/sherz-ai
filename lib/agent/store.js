// lib/agent/store.js — persistence for agent actions. Prisma in production, memory store for tests/dev fallback.
import crypto from 'node:crypto';

export function prismaStore(prisma) {
  const m = () => prisma.agentAction;
  return {
    async create(data) { return m().create({ data }); },
    async get(id, userId) { return m().findFirst({ where: { id, userId } }); },
    async update(id, patch) { return m().update({ where: { id }, data: patch }); },
    // atomic compare-and-set on status; returns true only for the single caller that won
    async transition(id, userId, from, patch) { const r = await m().updateMany({ where: { id, userId, status: from }, data: patch }); return r.count === 1; },
    async listPending(userId) { return m().findMany({ where: { userId, status: 'pending' }, orderBy: { createdAt: 'desc' }, take: 20 }); },
    async listRecent(userId, limit) { return m().findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit }); },
  };
}

export function memoryStore() {
  const rows = new Map();
  return {
    _rows: rows,
    async create(data) { const r = { id: 'act_' + crypto.randomBytes(6).toString('hex'), createdAt: new Date().toISOString(), ...structuredClone(data) }; rows.set(r.id, r); return structuredClone(r); },
    async get(id, userId) { const r = rows.get(id); return r && r.userId === userId ? structuredClone(r) : null; },
    async update(id, patch) { const r = rows.get(id); Object.assign(r, structuredClone(patch)); return structuredClone(r); },
    async transition(id, userId, from, patch) { const r = rows.get(id); if (!r || r.userId !== userId || r.status !== from) return false; Object.assign(r, structuredClone(patch)); return true; },
    async listPending(userId) { return [...rows.values()].filter((r) => r.userId === userId && r.status === 'pending').map((r) => structuredClone(r)); },
    async listRecent(userId, limit) { return [...rows.values()].filter((r) => r.userId === userId).slice(-limit).reverse().map((r) => structuredClone(r)); },
  };
}

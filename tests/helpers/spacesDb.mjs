// tiny in-memory Prisma for Work Spaces tests: equality `where`, orderBy (single key), take, create/update/delete(+Many)
export function spacesDb() {
  let n = 0, clock = 1_760_000_000_000;
  const now = () => new Date((clock += 1000));
  const T = { workSpace: [], skill: [], skillEvent: [], conversation: [], message: [] };
  const eq = (row, w) => Object.entries(w || {}).every(([k, v]) => (v && typeof v === 'object' && !(v instanceof Date) ? ('in' in v ? v.in.includes(row[k]) : true) : v === undefined ? true : row[k] === v || (v === null && row[k] == null)));
  const model = (name, defaults = () => ({})) => ({
    create: async ({ data }) => { const r = { id: `${name[0]}${String(++n).padStart(5, '0')}`, createdAt: now(), updatedAt: now(), ...defaults(), ...data }; T[name].push(r); return { ...r }; },
    findFirst: async ({ where, orderBy } = {}) => { const r = T[name].filter((x) => eq(x, where)); if (orderBy) { const [k, d] = Object.entries(orderBy)[0]; r.sort((a, b) => (d === 'desc' ? -1 : 1) * ((a[k] - b[k]) || (a.id < b.id ? -1 : 1))); } return r[0] ? { ...r[0] } : null; },
    findMany: async ({ where, orderBy, take } = {}) => { const r = T[name].filter((x) => eq(x, where)); if (orderBy) { const [k, d] = Object.entries(orderBy)[0]; r.sort((a, b) => (d === 'desc' ? -1 : 1) * ((a[k] - b[k]) || (a.id < b.id ? -1 : 1))); } return r.slice(0, take ?? 1e9).map((x) => ({ ...x })); },
    update: async ({ where, data }) => { const r = T[name].find((x) => x.id === where.id); if (!r) throw new Error('not found'); Object.assign(r, data, { updatedAt: now() }); return { ...r }; },
    updateMany: async ({ where, data }) => { const r = T[name].filter((x) => eq(x, where)); r.forEach((x) => Object.assign(x, data)); return { count: r.length }; },
    delete: async ({ where }) => { T[name] = T[name].filter((x) => x.id !== where.id); },
    deleteMany: async ({ where } = {}) => { const b = T[name].length; T[name] = T[name].filter((x) => !eq(x, where)); return { count: b - T[name].length }; },
  });
  const db = {
    T: new Proxy(T, { get: (t, k) => t[k] }),
    workSpace: model('workSpace', () => ({ preset: 'blank', style: 'general', archivedAt: null, role2: {}, activeRole: 1 })),
    skill: model('skill', () => ({ source: 'taught', status: 'active', version: 1, uses: 0, successes: 0, corrections: 0, rejections: 0, lastUsedAt: null })),
    skillEvent: model('skillEvent'),
    conversation: model('conversation', () => ({ kind: 'companion', title: 'New chat', description: null, spaceId: null })),
    message: model('message'),
  };
  return db;
}

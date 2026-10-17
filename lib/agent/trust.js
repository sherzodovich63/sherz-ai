// lib/agent/trust.js — Phase 2: Trust & Habit Learning.
// Watches what the user DECIDES about plans (approve / reject / edit) and remembers recurring patterns:
//   pattern = tool + parent folder + file extension      e.g.  "files.write | notes | .md"
// It stores SHAPES only (tool, folder, extension, counters) — never file contents.
//
// What it is used for:
//   1. decorate()    → plan cards show "Learned habit • High confidence".
//   2. promptBlock() → the model is told the user's habits so it proposes things the way they like.
//   3. (Phase 3, later) the confidence level is the input for "low-risk routine → auto-run".
// What it can NOT do: skip, pre-approve or weaken the Approval Gate. Nothing here is called by gate.approve()'s checks.
import crypto from 'node:crypto';

// ── signature ────────────────────────────────────────────────
const clean = (s) => String(s ?? '').toLowerCase().replace(/\\/g, '/').replace(/[^a-z0-9_\-./ ]/g, '').trim();
function splitPath(p) {
  const segs = clean(p).split('/').filter((x) => x && x !== '.');
  return segs;
}
const DIR_TOOLS = new Set(['files.list', 'files.mkdir']);        // their path IS a folder
export function signatureOf(step) {
  const tool = String(step?.tool || '');
  const a = step?.args || {};
  let segs = [];
  if (tool === 'files.move') segs = splitPath(a.to);                // the destination is the habit
  else if (tool.startsWith('files.')) segs = splitPath(a.path);
  else if (tool.startsWith('sandbox.')) segs = splitPath(a.filename);
  let dir = '', ext = '';
  if (DIR_TOOLS.has(tool)) dir = segs.slice(0, 3).join('/');
  else {
    const last = segs[segs.length - 1] || '';
    const dot = last.lastIndexOf('.');
    ext = dot > 0 ? last.slice(dot, dot + 9) : '';
    dir = segs.slice(0, -1).slice(0, 3).join('/');
  }
  return { signature: `${tool}|${dir}|${ext}`, tool, dir, ext };
}
// what we keep as an example — never the content
function sampleArgs(step) {
  const a = step?.args || {}, o = {};
  for (const k of ['path', 'from', 'to', 'filename']) if (typeof a[k] === 'string') o[k] = a[k].slice(0, 200);
  if (typeof a.overwrite === 'boolean') o.overwrite = a.overwrite;
  return o;
}

// ── confidence ───────────────────────────────────────────────
export const empty = () => ({ approvals: 0, rejections: 0, edits: 0, preferred: 0, corrected: 0, failures: 0 });
export function scoreOf(p) {
  return (p.approvals || 0) + (p.preferred || 0) - 2 * (p.rejections || 0) - (p.corrected || 0);
}
export const LEVELS = [
  { min: 8, level: 'high', label: 'Learned habit • High confidence' },
  { min: 4, level: 'medium', label: 'Learned habit • Growing confidence' },
  { min: 2, level: 'low', label: 'Learning this habit' },
];
export function levelOf(p) {
  const s = scoreOf(p);
  const l = LEVELS.find((x) => s >= x.min);
  return l ? { level: l.level, label: l.label, score: s } : null;
}
const RANK = { low: 1, medium: 2, high: 3 };

// ── stores ───────────────────────────────────────────────────
// bump(userId, sig, deltas, extra) · list(userId) · forget(userId, id|null) · getMany(userId, signatures)
export function memoryTrustStore() {
  const rows = new Map();
  const k = (u, s) => `${u}\u0000${s}`;
  return {
    async bump(userId, sig, deltas = {}, extra = {}) {
      const key = k(userId, sig.signature);
      const r = rows.get(key) || { id: 'pat_' + crypto.randomBytes(5).toString('hex'), userId, signature: sig.signature, tool: sig.tool, dir: sig.dir, ext: sig.ext, ...empty(), lastArgs: null, redirectTo: null, createdAt: new Date().toISOString() };
      for (const f of Object.keys(empty())) r[f] += deltas[f] || 0;
      if (extra.lastArgs) r.lastArgs = extra.lastArgs;
      if (extra.redirectTo !== undefined) r.redirectTo = extra.redirectTo;
      r.lastUsedAt = new Date().toISOString();
      rows.set(key, r);
      return structuredClone(r);
    },
    async list(userId) { return [...rows.values()].filter((r) => r.userId === userId).map((r) => structuredClone(r)); },
    async getMany(userId, sigs) { return sigs.map((s) => rows.get(k(userId, s))).filter(Boolean).map((r) => structuredClone(r)); },
    async forget(userId, id = null) {
      let n = 0;
      for (const [key, r] of rows) if (r.userId === userId && (!id || r.id === id)) { rows.delete(key); n++; }
      return n;
    },
  };
}
export function prismaTrustStore(prisma) {
  const m = () => prisma.userPattern;
  return {
    async bump(userId, sig, deltas = {}, extra = {}) {
      const inc = {}, base = {};
      for (const f of Object.keys(empty())) if (deltas[f]) { inc[f] = { increment: deltas[f] }; base[f] = deltas[f]; }
      const set = { lastUsedAt: new Date(), ...(extra.lastArgs ? { lastArgs: extra.lastArgs } : {}), ...(extra.redirectTo !== undefined ? { redirectTo: extra.redirectTo } : {}) };
      return m().upsert({
        where: { userId_signature: { userId, signature: sig.signature } },
        create: { userId, signature: sig.signature, tool: sig.tool, dir: sig.dir, ext: sig.ext, ...base, ...set },
        update: { ...inc, ...set },
      });
    },
    async list(userId) { return m().findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: 200 }); },
    async getMany(userId, sigs) { return sigs.length ? m().findMany({ where: { userId, signature: { in: sigs } } }) : []; },
    async forget(userId, id = null) { const r = await m().deleteMany({ where: { userId, ...(id ? { id } : {}) } }); return r.count; },
  };
}

// ── the learner ──────────────────────────────────────────────
export function createTrust({ store, conventions = null, log = console } = {}) {
  if (!store) throw new Error('trust needs a store');
  const safe = async (fn) => { try { return await fn(); } catch (e) { log.warn?.('[trust] ' + (e.message || e)); return null; } };   // learning must never break the gate

  /** events: 'approved' {steps, results} · 'rejected' {steps} · 'edited' {before, after} */
  async function observe(event, { userId, steps = [], results = [], before = [], after = [] } = {}) {
    if (!userId) return;
    return safe(async () => {
      if (event === 'approved') {
        for (const [i, s] of steps.entries()) {
          const r = results.find((x) => x.i === i);
          if (!r || r.status === 'skipped') continue;
          await store.bump(userId, signatureOf(s), r.status === 'ok' ? { approvals: 1 } : { failures: 1 }, { lastArgs: sampleArgs(s) });
        }
        // Phase 3d: naming / folder conventions are learned from the same human approvals (shapes only)
        if (conventions) await conventions.learn(userId, steps.filter((s, i) => results.find((x) => x.i === i)?.status === 'ok'));
      } else if (event === 'rejected') {
        for (const s of steps) await store.bump(userId, signatureOf(s), { rejections: 1 });
      } else if (event === 'edited') {
        const n = Math.max(before.length, after.length);
        for (let i = 0; i < n; i++) {
          const b = before[i], a = after[i];
          if (!b || !a || b.tool !== a.tool) { if (b && !a) await store.bump(userId, signatureOf(b), { corrected: 1 }); continue; }   // step removed / swapped
          const sb = signatureOf(b), sa = signatureOf(a);
          if (sb.signature === sa.signature) {
            if (JSON.stringify(b.args) !== JSON.stringify(a.args)) await store.bump(userId, sa, { edits: 1 }, { lastArgs: sampleArgs(a) });   // content-only tweak
          } else {
            // the user moved it somewhere else (other folder / extension): remember where they prefer it
            await store.bump(userId, sb, { corrected: 1 }, { redirectTo: sa.dir !== sb.dir || sa.ext !== sb.ext ? `${sa.dir}|${sa.ext}` : null });
            await store.bump(userId, sa, { preferred: 1 }, { lastArgs: sampleArgs(a) });
          }
        }
      }
    });
  }

  /** adds `habit` to every step (and to the plan when ALL steps are known habits) — display only */
  async function decorate(pub, userId) {
    if (!pub || !Array.isArray(pub.steps)) return pub;
    const rows = (await safe(() => store.getMany(userId, [...new Set(pub.steps.map((s) => signatureOf(s).signature))]))) || [];
    const by = new Map(rows.map((r) => [r.signature, r]));
    let min = 9, all = pub.steps.length > 0;
    const steps = pub.steps.map((s) => {
      const r = by.get(signatureOf(s).signature), lv = r && levelOf(r);
      if (!lv) { all = false; return s; }
      min = Math.min(min, RANK[lv.level]);
      return { ...s, habit: { level: lv.level, label: lv.label, count: (r.approvals || 0) + (r.preferred || 0) } };
    });
    const planLv = all ? Object.keys(RANK).find((k) => RANK[k] === min) : null;
    return { ...pub, steps, habit: planLv ? { level: planLv, label: LEVELS.find((l) => l.level === planLv).label } : null };
  }

  async function habits(userId) {
    const rows = (await safe(() => store.list(userId))) || [];
    return rows.map((r) => ({ id: r.id, tool: r.tool, dir: r.dir, ext: r.ext, approvals: r.approvals, rejections: r.rejections, edits: r.edits, preferred: r.preferred, corrected: r.corrected, redirectTo: r.redirectTo || null, lastArgs: r.lastArgs || null, lastUsedAt: r.lastUsedAt, ...(levelOf(r) || { level: null, label: null, score: scoreOf(r) }) }))
      .sort((a, b) => b.score - a.score);
  }

  // text for the model. Everything user-derived is reduced to a safe charset first (a file NAME must never become an instruction).
  const q = (s) => '"' + clean(s).replace(/[^a-z0-9_\-./ ]/g, '').slice(0, 60) + '"';
  async function promptBlock(userId) {
    const hs = (await habits(userId)).filter((h) => h.level).slice(0, 8);
    if (!hs.length) return '';
    const lines = [];
    for (const h of hs) {
      const where = h.dir ? ` in ${q(h.dir)}` : '';
      const what = h.ext ? ` ${q(h.ext)} files` : '';
      lines.push(`- ${h.tool}${what}${where}: approved ${h.approvals + h.preferred}× (${h.level})`);
      if (h.redirectTo && h.corrected >= 1) {
        const [d, e] = String(h.redirectTo).split('|');
        lines.push(`  · the user changed this to ${d ? 'folder ' + q(d) : 'the same folder'}${e ? ' / type ' + q(e) : ''} ${h.corrected}×`);
      }
    }
    return 'Learned habits of THIS user (observed from the plans they approved, edited or rejected — use them as defaults when the request leaves details open; the user\'s explicit words always win; every plan still needs their approval; do not mention this list unless asked):\n' + lines.join('\n');
  }

  const forget = (userId, id = null) => store.forget(userId, id);
  return { observe, decorate, habits, promptBlock, forget };
}

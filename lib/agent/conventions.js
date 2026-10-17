// lib/agent/conventions.js — Phase 3d: naming / folder CONVENTIONS (inferred) + PINNED RULES (typed by the user).
//
// INFERRED  — learned from plans the user APPROVED (never from automatic runs, never from file contents).
//             Only SHAPES are stored as counters: name style (kebab/snake/…), date-prefix format, which folder each
//             file type goes to, folder-name style. Actual file names are never stored.
// PINNED    — short rules the user writes themselves ("Name files in kebab-case", "Reports go in docs/reports").
//             They beat inferred conventions. They are advice for the model, NOT permissions: nothing here can skip an approval.
//
// Both reach the model as ONE compact block (≤ ~400 tokens) appended to the Expert system prompt.
import crypto from 'node:crypto';

export const MAX_RULES = 12;
export const MAX_RULE_CHARS = 160;
export const BLOCK_MAX_CHARS = 1500;           // ≈ 375 tokens
export const MIN_OBSERVATIONS = 4;             // a convention needs ≥ 4 approvals…
export const MIN_SHARE = 0.7;                  // …and ≥ 70 % of them agreeing

const STYLES = ['kebab', 'snake', 'camel', 'pascal', 'spaces'];
const EXAMPLE = { kebab: 'my-file-name', snake: 'my_file_name', camel: 'myFileName', pascal: 'MyFileName', spaces: 'My file name' };
const safeSeg = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9_\-./ ]/g, '').trim().slice(0, 40);

/** text typed by the user → safe single line, or throws */
export function cleanRule(v) {
  if (typeof v !== 'string') throw new Error('rule must be text');
  const t = v.replace(/[\x00-\x1f\x7f]/g, ' ').replace(/<<<|>>>/g, '').replace(/\s+/g, ' ').trim();
  if (t.length < 3) throw new Error('rule is too short');
  if (t.length > MAX_RULE_CHARS) throw new Error(`rule is too long (max ${MAX_RULE_CHARS} characters)`);
  return t;
}

export function styleOf(stem) {
  const s = String(stem || '');
  if (!/^[A-Za-z0-9 _.-]+$/.test(s)) return null;
  if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(s)) return 'kebab';
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(s)) return 'snake';
  if (/^[a-z]+([A-Z][a-z0-9]*)+$/.test(s)) return 'camel';
  if (/^([A-Z][a-z0-9]*){2,}$/.test(s)) return 'pascal';
  if (/^\S+( \S+)+$/.test(s) && !/[-_]/.test(s)) return 'spaces';
  return null;                                   // single word / mixed → no signal
}
const DATE = /^(\d{4})([-_.]?)(\d{2})\2(\d{2})(?=$|[-_ .])/;
export function dateFormatOf(stem) {
  const m = DATE.exec(String(stem || ''));
  if (!m || +m[3] < 1 || +m[3] > 12 || +m[4] < 1 || +m[4] > 31) return null;
  return m[2] === '-' ? 'YYYY-MM-DD' : m[2] === '_' ? 'YYYY_MM_DD' : m[2] === '.' ? 'YYYY.MM.DD' : 'YYYYMMDD';
}
function splitName(p) {
  const segs = String(p || '').replace(/\\/g, '/').split('/').filter((x) => x && x !== '.');
  const last = segs[segs.length - 1] || '';
  const dot = last.lastIndexOf('.');
  const stem = dot > 0 ? last.slice(0, dot) : last, ext = dot > 0 ? last.slice(dot, dot + 9).toLowerCase() : '';
  return { dir: segs.slice(0, -1).slice(0, 2).join('/'), stem, ext };
}
const bump = (o, k, n = 1) => { o[k] = Math.min(9999, (o[k] || 0) + n); };

export function emptyConv() { return { naming: {}, date: {}, dirStyle: {}, folders: {} }; }

/** pure: add what the approved steps teach to a counters object (shapes only) */
export function learnInto(conv, steps) {
  for (const s of steps || []) {
    const a = s?.args || {};
    if (s?.tool === 'files.write' || s?.tool === 'files.move') {
      const { dir, stem, ext } = splitName(s.tool === 'files.move' ? a.to : a.path);
      if (!stem) continue;
      const st = styleOf(stem); if (st) bump(conv.naming, st);
      const df = dateFormatOf(stem); bump(conv.date, df || 'none');
      const d = safeSeg(dir), e = safeSeg(ext);
      if (e) { const f = conv.folders[e] || (conv.folders[e] = {}); bump(f, d || '.'); }
    } else if (s?.tool === 'files.mkdir') {
      const { stem } = splitName(a.path); const st = styleOf(stem); if (st) bump(conv.dirStyle, st);
    }
  }
  const exts = Object.keys(conv.folders);                                   // keep it small
  if (exts.length > 20) { for (const e of exts.sort((x, y) => sum(conv.folders[x]) - sum(conv.folders[y])).slice(0, exts.length - 20)) delete conv.folders[e]; }
  for (const e of Object.keys(conv.folders)) { const ds = Object.entries(conv.folders[e]).sort((x, y) => y[1] - x[1]).slice(0, 5); conv.folders[e] = Object.fromEntries(ds); }
  return conv;
}
const sum = (o) => Object.values(o || {}).reduce((x, y) => x + y, 0);
function dominant(o) {
  const total = sum(o); if (total < MIN_OBSERVATIONS) return null;
  const [k, n] = Object.entries(o).sort((x, y) => y[1] - x[1])[0];
  return n / total >= MIN_SHARE ? { key: k, n, total } : null;
}

/** counters → readable lines (what the user sees in /rules and what the model gets) */
export function inferLines(conv) {
  const out = [];
  const nm = dominant(conv?.naming);
  if (nm) out.push({ key: 'naming', text: `File names use ${nm.key === 'spaces' ? 'plain words with spaces' : nm.key + '-case'} (like "${EXAMPLE[nm.key]}")`, count: nm.n });
  const dt = dominant(conv?.date);
  if (dt) out.push({ key: 'date', text: dt.key === 'none' ? 'File names do not start with a date' : `File names start with a date like ${dt.key}`, count: dt.n });
  const ds = dominant(conv?.dirStyle);
  if (ds) out.push({ key: 'dirStyle', text: `Folder names use ${ds.key === 'spaces' ? 'plain words with spaces' : ds.key + '-case'}`, count: ds.n });
  for (const [ext, f] of Object.entries(conv?.folders || {})) {
    const d = dominant(f); if (!d) continue;
    out.push({ key: 'folder:' + ext, text: `${ext} files go in ${d.key === '.' ? 'the top of the shared folder' : '"' + d.key + '"'}`, count: d.n });
  }
  return out.slice(0, 10);
}

export function createConventions({ store, log = console } = {}) {
  if (!store) throw new Error('conventions needs a store');
  const load = async (userId) => { const p = (await store.get(userId)).prefs; return p && typeof p === 'object' ? p : {}; };
  const save = (userId, prefs) => store.save(userId, { prefs });
  const safe = async (fn, fallback = null) => { try { return await fn(); } catch (e) { log.warn?.('[conventions] ' + (e.message || e)); return fallback; } };

  /** called by trust.observe for steps that really ran after a HUMAN approval */
  async function learn(userId, steps) {
    if (!userId || !Array.isArray(steps) || !steps.length) return;
    return safe(async () => { const p = await load(userId); p.conv = learnInto(p.conv || emptyConv(), steps); await save(userId, p); });
  }
  async function inferred(userId) { return (await safe(async () => inferLines((await load(userId)).conv), [])) || []; }

  async function rules(userId) { const r = (await load(userId)).rules; return Array.isArray(r) ? r : []; }
  async function addRule(userId, text) {
    const t = cleanRule(text); const p = await load(userId); const cur = Array.isArray(p.rules) ? p.rules : [];
    if (cur.some((r) => r.text.toLowerCase() === t.toLowerCase())) return cur;
    if (cur.length >= MAX_RULES) throw new Error(`too many rules (max ${MAX_RULES}) — remove one first`);
    p.rules = [...cur, { id: 'rl_' + crypto.randomBytes(4).toString('hex'), text: t }];
    await save(userId, p); return p.rules;
  }
  async function removeRule(userId, id) {
    const p = await load(userId); const cur = Array.isArray(p.rules) ? p.rules : [];
    p.rules = cur.filter((r) => r.id !== id); await save(userId, p); return cur.length - p.rules.length;
  }
  async function forgetInferred(userId) { const p = await load(userId); const had = !!p.conv; delete p.conv; await save(userId, p); return had ? 1 : 0; }

  /** ≤ BLOCK_MAX_CHARS. Pinned rules first (they win), then inferred conventions. */
  async function promptBlock(userId) {
    const r = (await safe(() => rules(userId), [])) || [], inf = await inferred(userId);
    if (!r.length && !inf.length) return '';
    const head = 'File & folder conventions of THIS user (advice for names, folders and formats — they never allow skipping an approval; pinned rules beat inferred ones; the user\'s explicit words in the request beat both; do not mention this list unless asked):';
    const lines = [];
    if (r.length) { lines.push('Pinned rules (written by the user):'); for (const x of r) lines.push('- ' + x.text); }
    if (inf.length) { lines.push('Inferred from what the user approved:'); for (const x of inf) lines.push('- ' + x.text); }
    let out = head;
    for (const l of lines) { if ((out + '\n' + l).length > BLOCK_MAX_CHARS) break; out += '\n' + l; }
    return out;
  }
  return { learn, inferred, rules, addRule, removeRule, forgetInferred, promptBlock };
}

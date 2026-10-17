// helper/fsTools.mjs — the file actions the SHERZ helper can perform, confined to ONE folder (the "root").
// This is the REAL safety boundary: the server also validates paths, but only this code touches your disk,
// so every rule is enforced here again, and never trusts the server.
//
//   • every path is relative to the root; absolute paths, "..", drive letters, NUL bytes → refused
//   • realpath() check on the target (or its nearest existing parent) → symlinks cannot lead outside the root
//   • nothing is ever permanently deleted: delete / overwrite move the old copy to <root>/.sherz-trash/<time>/…
//   • .sherz-trash itself is off limits to the tools (no reading, listing or writing it)
//   • size limits on read / write / list
import fs from 'node:fs/promises';
import path from 'node:path';

export const TRASH = '.sherz-trash';
export const LIMITS = { read: 100 * 1024, write: 100 * 1024, list: 500, depth: 40 };

export class HelperError extends Error {}
const fail = (m) => { throw new HelperError(m); };

/** relative path string → clean array of segments, or throws */
export function cleanRel(p, { allowEmpty = false } = {}) {
  if (typeof p !== 'string') fail('path must be text');
  if (p.length > 300) fail('path is too long');
  if (p.includes('\0')) fail('path contains a NUL byte');
  const s = p.replace(/\\/g, '/').trim();
  if (/^([A-Za-z]:|\/|~)/.test(s)) fail('path must be relative to the shared folder (no drive letters, no leading / or ~)');
  const segs = s.split('/').filter((x) => x && x !== '.');
  if (segs.some((x) => x === '..')) fail('".." is not allowed');
  if (segs.length > LIMITS.depth) fail('path is too deep');
  if (segs.some((x) => x.toLowerCase() === TRASH)) fail(`${TRASH} is reserved`);
  if (/[<>:"|?*\x00-\x1f]/.test(segs.join('/').replace(/\//g, ''))) fail('path has characters that are not allowed');
  if (!segs.length && !allowEmpty) fail('path is empty');
  return segs;
}

export async function openRoot(folder) {
  if (!folder) fail('no folder given');
  const real = await fs.realpath(path.resolve(folder)).catch(() => fail(`folder does not exist: ${folder}`));
  const st = await fs.stat(real);
  if (!st.isDirectory()) fail('the shared folder must be a directory');
  if (path.parse(real).root === real) fail('refusing to share a drive root — pick a dedicated folder');
  return real;
}

const inside = (root, p) => { const r = path.relative(root, p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

/** Resolve to an absolute path inside root. For paths that don't exist yet, the nearest existing parent must be inside root. */
export async function resolveSafe(root, rel, opts) {
  const segs = cleanRel(rel, opts);
  const abs = path.join(root, ...segs);
  let probe = abs;
  for (;;) {
    try { const real = await fs.realpath(probe); if (!inside(root, real)) fail('path leads outside the shared folder'); break; }
    catch (e) { if (e instanceof HelperError) throw e; if (probe === root || !inside(root, path.dirname(probe))) break; probe = path.dirname(probe); }
  }
  return { abs, segs, rel: segs.join('/') };
}

const exists = (p) => fs.lstat(p).then(() => true, () => false);

async function toTrash(root, abs, rel) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(root, TRASH, stamp, ...rel.split('/'));
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.rename(abs, dest);
  return `${TRASH}/${stamp}/${rel}`;
}

export const ACTIONS = {
  async 'files.list'(root, { path: p = '.' }) {
    const { abs, rel } = await resolveSafe(root, p || '.', { allowEmpty: true });
    const st = await fs.stat(abs).catch(() => fail('folder does not exist'));
    if (!st.isDirectory()) fail('not a folder');
    const all = (await fs.readdir(abs, { withFileTypes: true })).filter((d) => d.name.toLowerCase() !== TRASH);
    const entries = [];
    for (const d of all.slice(0, LIMITS.list)) {
      const s = await fs.lstat(path.join(abs, d.name)).catch(() => null);
      entries.push({ name: d.name, type: d.isDirectory() ? 'dir' : d.isSymbolicLink() ? 'link' : 'file', size: s && d.isFile() ? s.size : null });
    }
    return { path: rel || '.', entries, truncated: all.length > LIMITS.list };
  },
  async 'files.read'(root, { path: p }) {
    const { abs, rel } = await resolveSafe(root, p);
    const st = await fs.stat(abs).catch(() => fail('file does not exist'));
    if (!st.isFile()) fail('not a file');
    if (st.size > LIMITS.read) fail(`file is larger than ${LIMITS.read / 1024} KB`);
    const buf = await fs.readFile(abs);
    if (buf.includes(0)) fail('binary file — only text files can be read');
    return { path: rel, bytes: buf.length, content: buf.toString('utf8') };
  },
  async 'files.write'(root, { path: p, content, overwrite = false }) {
    if (typeof content !== 'string') fail('content must be text');
    if (Buffer.byteLength(content) > LIMITS.write) fail(`content is larger than ${LIMITS.write / 1024} KB`);
    const { abs, rel } = await resolveSafe(root, p);
    let backup = null;
    if (await exists(abs)) {
      if (!overwrite) fail('file already exists (the plan did not allow overwriting)');
      const st = await fs.lstat(abs);
      if (!st.isFile()) fail('target is not a regular file');
      backup = await toTrash(root, abs, rel);          // old copy is kept, never destroyed
    }
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, { encoding: 'utf8', flag: 'wx' });
    return { path: rel, bytes: Buffer.byteLength(content), overwritten: !!backup, backup };
  },
  async 'files.mkdir'(root, { path: p }) {
    const { abs, rel } = await resolveSafe(root, p);
    await fs.mkdir(abs, { recursive: true });
    return { path: rel, created: true };
  },
  async 'files.move'(root, { from, to }) {
    const a = await resolveSafe(root, from), b = await resolveSafe(root, to);
    if (!(await exists(a.abs))) fail('source does not exist');
    if (await exists(b.abs)) fail('destination already exists (moves never overwrite)');
    if (b.abs === a.abs || b.abs.startsWith(a.abs + path.sep)) fail('cannot move a folder into itself');
    await fs.mkdir(path.dirname(b.abs), { recursive: true });
    await fs.rename(a.abs, b.abs);
    return { from: a.rel, to: b.rel };
  },
  async 'files.delete'(root, { path: p }) {
    const { abs, rel } = await resolveSafe(root, p);
    if (!(await exists(abs))) fail('does not exist');
    const trash = await toTrash(root, abs, rel);       // reversible: nothing is permanently removed
    return { path: rel, movedTo: trash };
  },
};

export async function runAction(root, tool, args) {
  const fn = ACTIONS[tool];
  if (!fn) fail(`unknown action ${tool}`);
  return fn(root, args || {});
}

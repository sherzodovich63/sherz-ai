// tools/archive-root-docs.mjs — moves the loose *.md files from the project root into docs/archive/ (README.md stays).
//   node tools/archive-root-docs.mjs            → dry run: only prints what WOULD move
//   node tools/archive-root-docs.mjs --apply    → moves them (nothing is ever deleted)
// Uses `git mv` for tracked files, so git history follows them. Undo: `git checkout -- . ` / `git mv` back, or move the files out of docs/archive/.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const apply = process.argv.includes('--apply');
const root = process.cwd();
const keep = new Set(['readme.md']);
const git = (...a) => execFileSync('git', a, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
let inGit = false; try { git('rev-parse', '--is-inside-work-tree'); inGit = true; } catch { /* not a git repo: plain move */ }
const tracked = (f) => { if (!inGit) return false; try { git('ls-files', '--error-unmatch', f); return true; } catch { return false; } };

if (!fs.existsSync(path.join(root, 'README.md'))) { console.error('STOP: there is no README.md in this folder. Run this from the project root.'); process.exit(1); }
if (!fs.existsSync(path.join(root, 'docs', 'CHANGELOG.md'))) { console.error('STOP: docs/CHANGELOG.md is missing. Copy it into docs/ first, so nothing is archived before it is consolidated.'); process.exit(1); }

const files = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isFile() && /\.md$/i.test(e.name) && !keep.has(e.name.toLowerCase())).map((e) => e.name).sort();
if (!files.length) { console.log('Nothing to do: the root has no markdown files besides README.md.'); process.exit(0); }

if (inGit) { try { const dirty = git('status', '--porcelain').trim(); if (dirty && apply) console.log('Note: you have uncommitted changes. Moves are still safe, but commit first if you want a clean undo point.\n'); } catch { /* ignore */ } }
console.log((apply ? 'Moving' : 'Would move') + ` ${files.length} file(s) to docs/archive/:`);
const dest = path.join(root, 'docs', 'archive');
if (apply) fs.mkdirSync(dest, { recursive: true });
let moved = 0;
for (const f of files) {
  let target = path.join(dest, f);
  if (fs.existsSync(target)) target = path.join(dest, f.replace(/\.md$/i, '') + '.' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.md');   // never overwrite an archived file
  console.log('  ' + f + '  →  ' + path.relative(root, target));
  if (!apply) continue;
  if (tracked(f)) execFileSync('git', ['mv', f, path.relative(root, target)], { cwd: root, stdio: 'ignore' }); else fs.renameSync(path.join(root, f), target);
  moved++;
}
if (apply) console.log(`\nDone: ${moved} moved, 0 deleted. README.md and docs/CHANGELOG.md untouched.`); else console.log('\nDry run only. Run again with --apply to move them.');

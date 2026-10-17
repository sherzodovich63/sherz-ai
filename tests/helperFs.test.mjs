import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openRoot, runAction, cleanRel, HelperError, TRASH } from '../helper/fsTools.mjs';

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'sherz-fs-'));
const outside = path.join(base, 'outside'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'secret.txt'), 'TOP SECRET');
const rootDir = path.join(base, 'shared'); await fs.mkdir(rootDir);
const root = await openRoot(rootDir);
const run = (t, a) => runAction(root, t, a);
const rejects = (p, re) => assert.rejects(p, (e) => e instanceof HelperError && re.test(e.message));
const read = (r) => fs.readFile(path.join(root, r), 'utf8');

test('write → list → read round trip', async () => {
  await run('files.write', { path: 'notes/ideas.md', content: 'one\ntwo' });
  assert.equal(await read('notes/ideas.md'), 'one\ntwo');
  const l = await run('files.list', { path: 'notes' }); assert.deepEqual(l.entries.map((e) => e.name), ['ideas.md']);
  assert.equal((await run('files.read', { path: 'notes/ideas.md' })).content, 'one\ntwo');
  assert.equal((await run('files.list', {})).entries[0].name, 'notes');
});
test('path rules: absolute, drive, ~, .., NUL, empty, bad chars, reserved trash', async () => {
  for (const bad of ['/etc/passwd', 'C:\\Windows\\x', '~/x', '../outside/secret.txt', 'a/../../x', 'a\0b', '', 'a:b', 'a?b', `${TRASH}/x`, 'x/.SHERZ-TRASH/y'])
    await rejects(run('files.read', { path: bad }), /./, bad);
  assert.throws(() => cleanRel('a/'.repeat(50)), /deep/);
});
test('write never overwrites unless allowed; overwrite keeps the old copy in trash', async () => {
  await run('files.write', { path: 'a.txt', content: 'v1' });
  await rejects(run('files.write', { path: 'a.txt', content: 'v2' }), /already exists/);
  assert.equal(await read('a.txt'), 'v1');
  const r = await run('files.write', { path: 'a.txt', content: 'v2', overwrite: true });
  assert.equal(r.overwritten, true); assert.equal(await read('a.txt'), 'v2');
  assert.equal(await read(r.backup), 'v1');
});
test('delete moves to .sherz-trash (recoverable) and the trash is invisible/unreachable', async () => {
  await run('files.write', { path: 'gone.txt', content: 'bye' });
  const d = await run('files.delete', { path: 'gone.txt' });
  await assert.rejects(fs.access(path.join(root, 'gone.txt')));
  assert.equal(await read(d.movedTo), 'bye');
  assert.ok(!(await run('files.list', {})).entries.some((e) => e.name === TRASH));
  await rejects(run('files.read', { path: d.movedTo }), /reserved/);
  await rejects(run('files.delete', { path: 'nope.txt' }), /does not exist/);
});
test('move: renames, never overwrites, cannot go into itself', async () => {
  await run('files.write', { path: 'm1.txt', content: 'x' }); await run('files.write', { path: 'm2.txt', content: 'y' });
  await rejects(run('files.move', { from: 'm1.txt', to: 'm2.txt' }), /already exists/);
  await run('files.move', { from: 'm1.txt', to: 'sub/dir/m1b.txt' });
  assert.equal(await read('sub/dir/m1b.txt'), 'x');
  await run('files.mkdir', { path: 'f' });
  await rejects(run('files.move', { from: 'f', to: 'f/inner' }), /itself/);
  await rejects(run('files.move', { from: 'ghost', to: 'z' }), /source does not exist/);
});
test('symlink escapes are refused (file link, folder link, new file under a folder link)', async (t) => {
  try {
    await fs.symlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
    await fs.symlink(outside, path.join(root, 'linkdir'), 'dir');
  } catch { return t.skip('symlinks not permitted here'); }
  await rejects(run('files.read', { path: 'link.txt' }), /outside/);
  await rejects(run('files.list', { path: 'linkdir' }), /outside/);
  await rejects(run('files.write', { path: 'linkdir/new.txt', content: 'x' }), /outside/);
  await rejects(run('files.write', { path: 'linkdir/deep/new.txt', content: 'x' }), /outside/);
  await assert.rejects(fs.access(path.join(outside, 'new.txt')));
  assert.equal(await fs.readFile(path.join(outside, 'secret.txt'), 'utf8'), 'TOP SECRET');
});
test('limits and types: big write, big read, binary read, non-text content, folder as file', async () => {
  await rejects(run('files.write', { path: 'big.txt', content: 'x'.repeat(101 * 1024) }), /larger/);
  await rejects(run('files.write', { path: 'n.txt', content: 123 }), /text/);
  await fs.writeFile(path.join(root, 'bin.dat'), Buffer.from([1, 2, 0, 3]));
  await rejects(run('files.read', { path: 'bin.dat' }), /binary/);
  await fs.writeFile(path.join(root, 'huge.txt'), 'x'.repeat(200 * 1024));
  await rejects(run('files.read', { path: 'huge.txt' }), /larger/);
  await rejects(run('files.read', { path: 'sub' }), /not a file/);
  await rejects(run('files.nuke', {}), /unknown action/);
});
test('openRoot refuses a missing folder, a file, and a drive root', async () => {
  await rejects(openRoot(path.join(base, 'nope')), /does not exist/);
  await rejects(openRoot(path.join(outside, 'secret.txt')), /directory/);
  await rejects(openRoot(path.parse(base).root), /drive root/);
});

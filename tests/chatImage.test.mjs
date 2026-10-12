import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { sniffImageType, normalizeImage, chatImageNote, chatImageMiddleware, MAX_IMAGE_BYTES, IMAGE_MARK, toDataUrl } from '../lib/chatImage.js';

// 1x1 images in each format (real file headers)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0'), Buffer.alloc(40)]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(30)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([30, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(30)]);

test('sniffImageType reads the real bytes, not the name', () => {
  assert.equal(sniffImageType(PNG), 'image/png'); assert.equal(sniffImageType(JPG), 'image/jpeg');
  assert.equal(sniffImageType(GIF), 'image/gif'); assert.equal(sniffImageType(WEBP), 'image/webp');
  assert.equal(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(sniffImageType(Buffer.from('MZ\x90\x00 not an image at all, just some text')), null);
  assert.equal(sniffImageType(Buffer.alloc(3)), null);
});

test('normalizeImage: only genuine base64 image data URLs survive', () => {
  assert.equal(normalizeImage(toDataUrl(PNG, 'image/png')), toDataUrl(PNG, 'image/png'));
  assert.equal(normalizeImage('data:image/jpg;base64,' + JPG.toString('base64')), toDataUrl(JPG, 'image/jpeg'), 'label is corrected to the real type');
  for (const bad of [undefined, null, 5, '', 'https://evil.example/x.png', 'file:///etc/passwd', 'data:text/html;base64,PGgxPg==', 'data:image/png;base64,@@@@', 'data:image/svg+xml;base64,' + Buffer.from('<svg/>').toString('base64'), 'data:image/png;base64,' + Buffer.from('not a png, just words here ....').toString('base64')])
    assert.equal(normalizeImage(bad), null, String(bad).slice(0, 40));
});

test('chatImageNote marks a picture turn in the saved history', () => {
  assert.equal(chatImageNote('what is this?'), IMAGE_MARK + '\nwhat is this?');
  assert.equal(chatImageNote(''), IMAGE_MARK);
});

async function withServer(fn) {
  let express; try { express = (await import('express')).default; } catch { return 'skip'; }
  const app = express(); app.use(express.json());
  app.post('/t', chatImageMiddleware(), (req, res) => res.json({ body: { ...req.body, image: req.body.image ? req.body.image.slice(0, 40) + '…' + req.body.image.length : undefined }, info: req.imageInfo || null, hasFile: !!req.file }));
  const srv = http.createServer(app); await new Promise((r) => srv.listen(0, r));
  try { await fn(`http://127.0.0.1:${srv.address().port}/t`); } finally { srv.close(); }
}
const form = (fields, file) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); if (file) f.append(file.field || 'image', new Blob([file.buf], { type: file.type || 'application/octet-stream' }), file.name || 'x.png'); return f; };
const post = (url, body, headers) => fetch(url, { method: 'POST', body, headers }).then(async (r) => ({ s: r.status, j: await r.json() }));

test('multipart: text + image arrive together; image becomes a data URL with the REAL type', async (t) => {
  if (await withServer(async (url) => {
    const r = await post(url, form({ message: 'bu nima?', userId: 'u1', conversationId: 'c1', expertMode: 'false' }, { buf: PNG, type: 'image/jpeg', name: 'lying.jpg' }));
    assert.equal(r.s, 200); assert.equal(r.j.body.message, 'bu nima?'); assert.equal(r.j.body.conversationId, 'c1');
    assert.ok(r.j.body.image.startsWith('data:image/png;base64,'), 'type decided by bytes, not the client label');
    assert.deepEqual(r.j.info, { mime: 'image/png', bytes: PNG.length });
    assert.equal(r.j.body.expertMode, false, '"false" in a form is false');
    const r2 = await post(url, form({ message: 'x', expertMode: 'true' }, { buf: JPG })); assert.equal(r2.j.body.expertMode, true);
  }) === 'skip') t.skip('express not installed');
});

test('multipart: text only, and image only', async (t) => {
  if (await withServer(async (url) => {
    const a = await post(url, form({ message: 'salom' })); assert.deepEqual([a.s, a.j.body.image, a.j.hasFile], [200, undefined, false]);
    const b = await post(url, form({ message: '' }, { buf: WEBP })); assert.equal(b.s, 200); assert.ok(b.j.body.image.startsWith('data:image/webp;base64,')); assert.equal(b.j.body.message, '');
  }) === 'skip') t.skip('express not installed');
});

test('multipart: rejects non-images, oversize files and a wrong field name — with JSON errors', async (t) => {
  if (await withServer(async (url) => {
    const svg = await post(url, form({ message: 'x' }, { buf: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'), type: 'image/png', name: 'a.png' }));
    assert.equal(svg.s, 415); assert.equal(svg.j.ok, false); assert.match(svg.j.error, /JPEG, PNG/);
    const big = await post(url, form({ message: 'x' }, { buf: Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)]) }));
    assert.equal(big.s, 413); assert.match(big.j.error, /too large/);
    const wrong = await post(url, form({ message: 'x' }, { buf: PNG, field: 'file' }));
    assert.equal(wrong.s, 400); assert.match(wrong.j.error, /"image"/);
  }) === 'skip') t.skip('express not installed');
});

test('JSON requests: a valid image data URL is kept, a URL / junk is dropped', async (t) => {
  if (await withServer(async (url) => {
    const J = { 'content-type': 'application/json' };
    const ok = await post(url, JSON.stringify({ message: 'm', image: toDataUrl(PNG, 'image/png') }), J); assert.ok(ok.j.body.image.startsWith('data:image/png'));
    const url2 = await post(url, JSON.stringify({ message: 'm', image: 'https://169.254.169.254/latest/meta-data' }), J); assert.equal(url2.j.body.image, undefined);
    const none = await post(url, JSON.stringify({ message: 'm' }), J); assert.equal(none.j.body.image, undefined);
  }) === 'skip') t.skip('express not installed');
});

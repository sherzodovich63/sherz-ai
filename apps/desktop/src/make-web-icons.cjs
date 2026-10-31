'use strict';
// Crisp icons for the website / installed web app / Windows taskbar — every size is drawn from the VECTOR logo at its exact pixel size
// (never a big picture shrunk down), on a solid dark tile with padding, so thin strokes stay sharp at 16–48 px.
//   cd apps && npm run web-icons                      → uses ../public/sherz-icon.svg
//   cd apps && npm run web-icons -- C:\path\logo.svg  → uses that file
//   options: --bg=#070709  (tile colour)   --pad=0.66 (how much of the tile the logo covers, 0.4–0.9)
// Runs inside Electron itself (nothing extra to install). Output:
//   public/apple-touch-icon.png 180 (opaque, iOS rounds it) · public/icon-192.png · public/icon-512.png (rounded tile) · public/icon-maskable-512.png (full-bleed, safe zone)
//   public/favicon-16.png · favicon-32.png · favicon.ico (16/32/48)
//   apps/desktop/build/icon.ico (16/24/32/48/64/128/256)  → Windows taskbar, window, installer
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');
const arg = process.argv.slice(2).find((a) => !a.startsWith('-') && a !== '.' && !/\.(cjs|js)$/.test(a));
const SRC = [arg, path.join(ROOT, 'public/sherz-icon.svg'), path.join(ROOT, 'public/sherz-icon.png')].filter(Boolean).find((p) => fs.existsSync(p));
const opt = (name, dflt) => (process.argv.find((a) => a.startsWith('--' + name + '=')) || '').slice(name.length + 3) || dflt;
const BG = opt('bg', '#070709');
const PAD = Math.min(0.9, Math.max(0.4, Number(opt('pad', '0.66')) || 0.66));

/** file → data URL; SVGs get a definite width/height (an SVG without one is drawn at an unpredictable size) */
function toDataUrl(file) {
  const buf = fs.readFileSync(file);
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'data:image/png;base64,' + buf.toString('base64');
  let text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le', 2) : buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const open = /<svg\b[^>]*>/i.exec(text);
  if (!open) throw new Error('this is not an SVG or PNG picture');
  const tag = open[0], vb = /viewBox\s*=\s*["']\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)\s*["']/i.exec(tag);
  const w = /\swidth\s*=\s*["']\s*([\d.]+)/i.exec(tag), h = /\sheight\s*=\s*["']\s*([\d.]+)/i.exec(tag);
  const VW = vb ? +vb[3] : w ? +w[1] : 512, VH = vb ? +vb[4] : h ? +h[1] : 512;
  let fixed = tag.replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, '').replace(/<svg\b/i, `<svg width="${VW}" height="${VH}"` + (vb ? '' : ` viewBox="0 0 ${VW} ${VH}"`));
  if (!/xmlns\s*=/.test(fixed)) fixed = fixed.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return 'data:image/svg+xml;base64,' + Buffer.from(text.replace(tag, fixed), 'utf8').toString('base64');
}

/** PNG buffers → one .ico (PNG-compressed entries: supported by Windows Vista+) */
function makeIco(entries) {
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  let offset = 6 + 16 * entries.length;
  const dir = entries.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; e[1] = size >= 256 ? 0 : size; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12); offset += png.length; return e;
  });
  return Buffer.concat([head, ...dir, ...entries.map((e) => e.png)]);
}

async function main() {
  if (!SRC) { console.error('No logo found. Put it at public/sherz-icon.svg or run:  npm run web-icons -- path\\to\\logo.svg'); app.exit(1); return; }
  console.log('Logo source:', SRC, ' tile', BG, ' logo covers', Math.round(PAD * 100) + '%');
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
  await win.loadURL('data:text/html,<canvas></canvas>');
  const sizes = { ico: [16, 24, 32, 48, 64, 128, 256], favico: [16, 32, 48] };
  const out = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image(); img.src = ${JSON.stringify(toDataUrl(SRC))};
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('the browser could not draw this picture')); });
    const iw = img.naturalWidth || 512, ih = img.naturalHeight || 512, ar = iw / ih;
    // an SVG that already is a coloured tile (opaque corners) is used full-bleed instead of being put on another tile
    const probe = document.createElement('canvas'); probe.width = 64; probe.height = 64; const px = probe.getContext('2d', { willReadFrequently: true });
    px.drawImage(img, 0, 0, 64, 64); const corner = (x, y) => px.getImageData(x, y, 1, 1).data[3];
    const ownTile = [corner(1, 1), corner(62, 1), corner(1, 62), corner(62, 62)].every((a) => a > 240);
    // every size is rasterised from the vector at its own size → sharp
    const draw = (size, { rounded, full, cover }) => {
      const c = document.createElement('canvas'); c.width = size; c.height = size; const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      if (ownTile) { if (rounded) { x.beginPath(); x.roundRect(0, 0, size, size, size * 0.22); x.clip(); } x.drawImage(img, 0, 0, size, size); return c.toDataURL('image/png'); }
      x.fillStyle = ${JSON.stringify(BG)};
      if (rounded) { x.beginPath(); x.roundRect(0, 0, size, size, size * 0.22); x.fill(); } else x.fillRect(0, 0, size, size);
      let dw = size * cover, dh = dw / ar; if (dh > size * cover) { dh = size * cover; dw = dh * ar; }
      const ox = Math.round((size - dw) / 2), oy = Math.round((size - dh) / 2);
      if (size <= 48) { const e = size <= 24 ? 0.55 : 0.35; for (const [ax, ay] of [[-e, -e], [e, -e], [-e, e], [e, e], [0, 0]]) x.drawImage(img, ox + ax, oy + ay, dw, dh); }   // thin strokes: a hair of extra weight keeps small sizes readable
      else x.drawImage(img, ox, oy, dw, dh);
      return c.toDataURL('image/png');
    };
    const P = ${PAD}, r = {};
    r.apple = draw(180, { rounded: false, cover: P });                // iOS applies its own rounded mask → square, opaque
    r.i192 = draw(192, { rounded: true, cover: P });
    r.i512 = draw(512, { rounded: true, cover: P });
    r.mask = draw(512, { rounded: false, cover: Math.min(P, 0.56) }); // maskable: keep the logo inside the 80% safe circle
    r.f16 = draw(16, { rounded: true, cover: Math.min(0.84, P + 0.12) }); r.f32 = draw(32, { rounded: true, cover: Math.min(0.84, P + 0.08) });
    r.ico = ${JSON.stringify(sizes.ico)}.map((s) => [s, draw(s, { rounded: true, cover: s <= 32 ? Math.min(0.84, P + 0.1) : P })]);
    r.fav = ${JSON.stringify(sizes.favico)}.map((s) => [s, draw(s, { rounded: true, cover: s <= 32 ? Math.min(0.84, P + 0.1) : P })]);
    r.ownTile = ownTile; return r;
  })()`);
  const buf = (d) => Buffer.from(d.split(',')[1], 'base64');
  const put = (rel, data) => { const f = path.join(ROOT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); console.log('  wrote', rel, `(${data.length} bytes)`); };
  if (out.ownTile) console.log('  the logo file is already a coloured tile → used as it is (no second tile)');
  put('public/apple-touch-icon.png', buf(out.apple)); put('public/icon-192.png', buf(out.i192)); put('public/icon-512.png', buf(out.i512)); put('public/icon-maskable-512.png', buf(out.mask));
  put('public/favicon-16.png', buf(out.f16)); put('public/favicon-32.png', buf(out.f32));
  put('public/favicon.ico', makeIco(out.fav.map(([size, d]) => ({ size, png: buf(d) }))));
  put('apps/desktop/build/icon.ico', makeIco(out.ico.map(([size, d]) => ({ size, png: buf(d) }))));
  console.log('Done. Windows caches taskbar icons: unpin SHERZ from the taskbar, restart the app (or reinstall), then pin it again.');
  app.exit(0);
}
app.whenReady().then(main).catch((e) => { console.error('Could not make the icons:', e.message); app.exit(1); });

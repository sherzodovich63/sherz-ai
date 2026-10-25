'use strict';
// Makes every icon SHERZ needs from ONE picture (default: public/sherz-icon.svg; or give a path to any .svg / .png).
//   cd apps && npm run icons                      → uses ../public/sherz-icon.svg
//   cd apps && npm run icons -- C:\path\logo.png  → uses that file
//   options: --tighten-svg (also rewrite public/sherz-icon.svg with a zero-padding viewBox; the original is kept)   --default (use the built-in clean logo)   --keep-bg (do not remove a plain background)   --fill=0.9 (logo covers 90 % of the square, default 96 %)   --no-trim (keep the empty margin of the picture)   --bg=#101018 (phone icon background)
// It runs inside Electron itself (nothing extra to install). Output:
//   desktop/build/icon.png        1024×1024   window, taskbar, installer (.exe / .dmg)
//   desktop/build/tray.png        32×32       tray icon        · trayTemplate.png = macOS menu-bar silhouette
//   mobile/assets/icon-only.png, icon-foreground.png, icon-background.png, splash.png, splash-dark.png   → `npm run mobile:init` turns these into Android / iOS icons
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');                 // project root
const arg = process.argv.slice(2).find((a) => !a.startsWith('-') && a !== '.' && !a.endsWith('main.cjs') && !a.endsWith('make-icons.cjs'));
const candidates = [arg, path.join(ROOT, 'public/sherz-icon.svg'), path.join(ROOT, 'public/sherz-icon.png')].filter(Boolean);
const SRC = candidates.find((p) => fs.existsSync(p));
const FLAG_ARGS = /^--/;
const TRIM = !process.argv.includes('--no-trim');                                  // cut the transparent margin around the artwork (default)
const FILL = Math.min(1, Math.max(0.5, Number((process.argv.find((a) => a.startsWith('--fill=')) || '--fill=0.96').slice(7)) || 0.96));   // how much of the square the logo covers
const REMOVE_BG = !process.argv.includes('--keep-bg');                              // a plain background around the logo is removed (default)
const TIGHTEN_SVG = process.argv.includes('--tighten-svg');
const DEFAULT_ICON = process.argv.includes('--default');
const BG = (process.argv.find((a) => a.startsWith('--bg=')) || '--bg=#070709').slice(5);   // mobile background colour

/** bytes → a data URL the page can draw. Handles UTF-16 / BOM text files (Windows editors and `>` redirects write them), SVGs without width/height, and PNG/JPG. */
function toDataUrl(file) {
  let buf = fs.readFileSync(file);
  const ext = path.extname(file).slice(1).toLowerCase();
  const head = buf.slice(0, 4);
  const isPng = head[0] === 0x89 && head[1] === 0x50, isJpg = head[0] === 0xff && head[1] === 0xd8;
  if (isPng || isJpg || ['png', 'jpg', 'jpeg', 'webp'].includes(ext) && !/^\s*[<﻿]/.test(buf.toString('utf8', 0, 20))) {
    return { url: `data:image/${isJpg ? 'jpeg' : ext === 'webp' ? 'webp' : 'png'};base64,${buf.toString('base64')}`, kind: 'bitmap', note: '' };
  }
  let text, note = '';
  if (head[0] === 0xff && head[1] === 0xfe) { text = buf.toString('utf16le', 2); note = 'file was UTF-16 → converted'; }
  else if (head[0] === 0xfe && head[1] === 0xff) { text = Buffer.from(buf.slice(2)).swap16().toString('utf16le'); note = 'file was UTF-16 → converted'; }
  else { text = buf.toString('utf8'); if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); }
  const open = /<svg\b[^>]*>/i.exec(text);
  if (!open) return { error: `this is not an SVG or PNG picture (${buf.length} bytes, starts with: ${JSON.stringify(text.slice(0, 60))})` };
  let tag = open[0], vb = /viewBox\s*=\s*["']\s*([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)[\s,]+([-\d.eE]+)\s*["']/i.exec(tag);
  const w = /\swidth\s*=\s*["']\s*([\d.]+)\s*(?:px)?\s*["']/i.exec(tag), h = /\sheight\s*=\s*["']\s*([\d.]+)\s*(?:px)?\s*["']/i.exec(tag);
  const VBW = vb ? +vb[3] : w ? +w[1] : 512, VBH = vb ? +vb[4] : h ? +h[1] : 512;
  let fixed = tag.replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, '');            // give the picture a definite size: browsers draw an SVG without one at an unpredictable size
  fixed = fixed.replace(/<svg\b/i, `<svg width="${VBW}" height="${VBH}"` + (vb ? '' : ` viewBox="0 0 ${VBW} ${VBH}"`));
  if (!/xmlns\s*=/.test(fixed)) fixed = fixed.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  text = text.replace(tag, fixed);
  return { url: 'data:image/svg+xml;base64,' + Buffer.from(text, 'utf8').toString('base64'), kind: 'svg', note, svgText: text, vb: vb ? [+vb[1], +vb[2], +vb[3], +vb[4]] : [0, 0, VBW, VBH] };
}

async function main() {
  if (DEFAULT_ICON) {                                                         // --default: write the built-in clean logo to public/sherz-icon.svg
    const target = path.join(ROOT, 'public/sherz-icon.svg');
    if (fs.existsSync(target)) fs.copyFileSync(target, path.join(ROOT, 'public/sherz-icon.previous.svg'));
    fs.copyFileSync(path.join(__dirname, 'default-icon.svg'), target); console.log('Wrote public/sherz-icon.svg (the previous one, if any, is saved as sherz-icon.previous.svg)');
  }
  const SRC2 = DEFAULT_ICON ? path.join(ROOT, 'public/sherz-icon.svg') : SRC;
  if (!SRC2) { console.error('No icon found. Put your logo at public/sherz-icon.svg, or run:  npm run icons -- path\\to\\logo.png   (or  npm run icons -- --default  for a clean built-in logo)'); app.exit(1); return; }
  const pic = toDataUrl(SRC2);
  if (pic.error) { console.error('Could not make the icons: ' + pic.error + '\nFix: save the logo as a normal .svg / .png, or use  npm run icons -- --default'); app.exit(1); return; }
  console.log('Icon source:', SRC2, pic.note ? `(${pic.note})` : '');
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
  await win.loadURL('data:text/html,<canvas></canvas>');
  const out = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image(); img.src = ${JSON.stringify(pic.url)};
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('the browser could not draw this picture (broken SVG, or it needs an external file / font)')); });
    const iw = img.naturalWidth || 512, ih = img.naturalHeight || 512;
    const log = [];
    // 1) draw it big
    const BIG = 2048, SCALE = Math.min(BIG / iw, BIG / ih);
    const bw = Math.max(1, Math.round(iw * SCALE)), bh = Math.max(1, Math.round(ih * SCALE));
    const big = document.createElement('canvas'); big.width = bw; big.height = bh; const bx = big.getContext('2d', { willReadFrequently: true }); bx.drawImage(img, 0, 0, bw, bh);
    let src = big, crop = { x0: 0, y0: 0, x1: bw - 1, y1: bh - 1 };
    if (${TRIM}) {
      let d = bx.getImageData(0, 0, bw, bh).data;
      const px = (x, y) => { const i = (y * bw + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
      // 2a) an opaque background of ONE colour (corners all equal)? then the logo is whatever differs from it
      const cs = [px(3, 3), px(bw - 4, 3), px(3, bh - 4), px(bw - 4, bh - 4)];
      const same = cs.every((c) => c[3] > 240 && Math.abs(c[0] - cs[0][0]) + Math.abs(c[1] - cs[0][1]) + Math.abs(c[2] - cs[0][2]) < 24);
      let bg = same ? cs[0] : null;
      const differs = (i) => d[i + 3] > 10 && (!bg || Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 90);
      let x0 = bw, y0 = bh, x1 = -1, y1 = -1;
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (differs((y * bw + x) * 4)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 >= x0 && y1 >= y0) {
        const cw = x1 - x0 + 1, ch = y1 - y0 + 1, c = document.createElement('canvas'); c.width = cw; c.height = ch; const cx = c.getContext('2d', { willReadFrequently: true });
        cx.drawImage(big, x0, y0, cw, ch, 0, 0, cw, ch);
        if (bg && ${REMOVE_BG}) {                                                         // make the old background transparent (soft edge) so only the logo remains
          const id = cx.getImageData(0, 0, cw, ch), dd = id.data;
          for (let i = 0; i < dd.length; i += 4) { const dist = Math.abs(dd[i] - bg[0]) + Math.abs(dd[i + 1] - bg[1]) + Math.abs(dd[i + 2] - bg[2]); const k = Math.max(0, Math.min(1, (dist - 30) / 120)); dd[i + 3] = Math.round(dd[i + 3] * k); }
          cx.putImageData(id, 0, 0);
        }
        crop = { x0, y0, x1, y1 };
        if (x1 - x0 < bw - 4 || y1 - y0 < bh - 4) src = c;
        log.push(bg ? 'plain background rgb(' + bg.slice(0, 3).join(',') + ') found around the logo → cropped to the logo' + (${REMOVE_BG} ? ' and made transparent' : '') : 'transparent margin cut away');
      }
    }
    const ar = src.width / src.height || 1;
    const make = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; draw(x, w, h); return c.toDataURL('image/png'); };
    const logo = (x, w, h, scale) => { let dw = w * scale, dh = dw / ar; if (dh > h * scale) { dh = h * scale; dw = dh * ar; } x.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh); };
    const mono = (x, w, h) => { logo(x, w, h, 0.92); x.globalCompositeOperation = 'source-in'; x.fillStyle = '#000'; x.fillRect(0, 0, w, h); };
    const before = Math.round(100 * Math.max(crop.x1 - crop.x0 + 1, crop.y1 - crop.y0 + 1) / Math.max(bw, bh)), after = Math.round(100 * ${FILL});
    return {
      log, before, after, ratio: ar,
      icon:   make(1024, 1024, (x, w, h) => logo(x, w, h, ${FILL})),
      tray:   make(32, 32, (x, w, h) => logo(x, w, h, 0.96)),
      tmpl:   make(44, 44, mono),
      only:   make(1024, 1024, (x, w, h) => { x.fillStyle = ${JSON.stringify(BG)}; x.fillRect(0, 0, w, h); logo(x, w, h, 0.78); }),
      fg:     make(1024, 1024, (x, w, h) => logo(x, w, h, 0.56)),
      bg:     make(1024, 1024, (x, w, h) => { x.fillStyle = ${JSON.stringify(BG)}; x.fillRect(0, 0, w, h); }),
      splash: make(2732, 2732, (x, w, h) => { x.fillStyle = ${JSON.stringify(BG)}; x.fillRect(0, 0, w, h); logo(x, w, h, 0.26); }),
      bbox: { x0: crop.x0 / bw, y0: crop.y0 / bh, x1: (crop.x1 + 1) / bw, y1: (crop.y1 + 1) / bh },
    };
  })()`);
  out.log.forEach((l) => console.log('  ' + l));
  console.log(`  the logo covered ${out.before}% of the picture's own square → now ${out.after}% of the icon`);
  const put = (rel, d) => { const f = path.join(ROOT, 'apps', rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from(d.split(',')[1], 'base64')); console.log('  wrote apps/' + rel); };
  put('desktop/build/icon.png', out.icon); put('desktop/build/tray.png', out.tray); put('desktop/build/trayTemplate.png', out.tmpl);
  put('mobile/assets/icon-only.png', out.only); put('mobile/assets/icon-foreground.png', out.fg); put('mobile/assets/icon-background.png', out.bg);
  put('mobile/assets/splash.png', out.splash); put('mobile/assets/splash-dark.png', out.splash);
  if (TIGHTEN_SVG) {                                                          // rewrite the SVG's own viewBox to the logo's real bounds → zero padding everywhere it is used (website favicon, notifications…)
    if (pic.kind !== 'svg') console.log('  --tighten-svg: only works on an .svg source');
    else {
      const [vx, vy, vw, vh] = pic.vb, b = out.bbox, nx = vx + b.x0 * vw, ny = vy + b.y0 * vh, nw = (b.x1 - b.x0) * vw, nh = (b.y1 - b.y0) * vh;
      const keep = path.join(path.dirname(SRC2), path.basename(SRC2, '.svg') + '.original.svg');
      if (!fs.existsSync(keep)) fs.copyFileSync(SRC2, keep);
      const f = (n) => +n.toFixed(3);
      let t = pic.svgText.replace(/<svg\b[^>]*>/i, (tag) => tag.replace(/\sviewBox\s*=\s*["'][^"']*["']/i, '').replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, '').replace(/<svg\b/i, `<svg width="${f(nw)}" height="${f(nh)}" viewBox="${f(nx)} ${f(ny)} ${f(nw)} ${f(nh)}"`));
      fs.writeFileSync(SRC2, t); console.log(`  tightened ${path.basename(SRC2)}: viewBox ${vx} ${vy} ${vw} ${vh}  →  ${f(nx)} ${f(ny)} ${f(nw)} ${f(nh)}   (original kept as ${path.basename(keep)})`);
    }
  }
  console.log('Done. Restart the desktop app to see it (Windows may cache the taskbar icon: unpin / re-pin it if the old one stays).');
  app.exit(0);
}
app.whenReady().then(main).catch((e) => { console.error('Could not make the icons:', e.message); app.exit(1); });

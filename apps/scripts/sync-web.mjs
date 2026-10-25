// apps/scripts/sync-web.mjs — copies the web app (../public) into apps/www and tells it that it runs inside an app.
// Both the desktop app and the mobile apps load apps/www, so the screens, the language system, streaming and infinite scroll are the SAME code as the website.
//   node scripts/sync-web.mjs [--api https://your-backend]      (or SHERZ_API_URL=…)    SHERZ_PUSH=1 turns on mobile push registration
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SRC = path.resolve(HERE, '../../public');
export const OUT = path.resolve(HERE, '../www');
export const DEFAULT_API = 'https://sherz-ai.onrender.com';

// Some code of the web app calls the backend with a RELATIVE path (fetch('/api/chat'), EventSource('/api/…')). On the website that reaches the server
// behind the same address; inside an app the page lives on app://sherz, so those calls must go to the real backend. This shim does that, once, for everything.
export const API_SHIM = "(function(){var A=window.SHERZ_API_URL;if(!A)return;var re=/^\\/(api|admin|health|google)(\\/|\\?|$)/;var f=window.fetch;window.fetch=function(i,o){try{if(typeof i==='string'&&re.test(i))i=A+i;else if(typeof Request!=='undefined'&&i instanceof Request){var u=new URL(i.url);if(u.origin===location.origin&&re.test(u.pathname))i=new Request(A+u.pathname+u.search,i);}}catch(e){}return f.call(this,i,o)};var E=window.EventSource;if(E){var N=function(u,c){if(typeof u==='string'&&re.test(u))u=A+u;return new E(u,c)};N.prototype=E.prototype;N.CONNECTING=0;N.OPEN=1;N.CLOSED=2;window.EventSource=N}})();";

/** puts the app settings in front of every other script of index.html (idempotent) */
export function injectConfig(html, { api = DEFAULT_API, push = false } = {}) {
  const clean = String(html).replace(/<script data-sherz-native>[\s\S]*?<\/script>\s*/g, '');
  const tag = `<script data-sherz-native>window.SHERZ_NATIVE=true;window.SHERZ_API_URL=${JSON.stringify(String(api).replace(/\/+$/, ''))};window.SHERZ_PUSH=${push ? 'true' : 'false'};${API_SHIM}</script>\n`;
  if (!/<head[^>]*>/i.test(clean)) throw new Error('index.html has no <head>');
  return clean.replace(/<head[^>]*>/i, (m) => `${m}\n  ${tag}`);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

export function syncWeb({ api, push, src = SRC } = {}) {
  if (!fs.existsSync(path.join(src, 'index.html'))) throw new Error(`${src}/index.html not found — run this from the SHERZ project`);
  fs.rmSync(OUT, { recursive: true, force: true });
  copyDir(src, OUT);
  const idx = path.join(OUT, 'index.html');
  fs.writeFileSync(idx, injectConfig(fs.readFileSync(idx, 'utf8'), { api, push }));
  const warn = [];
  const html = fs.readFileSync(idx, 'utf8');
  const kb = Math.round(Buffer.byteLength(html) / 1024);
  if (!/id="composerShell"/.test(html) || !/id="log"/.test(html)) warn.push(`public/index.html (${kb} KB) is NOT the SHERZ chat page — it has no chat box / message list. The window will stay black. Put the full SHERZ index.html in public/ (the real one is roughly 300 KB).`);
  if (!/src="\/native\.js"/.test(html)) warn.push('index.html does not load /native.js — the app would run without its native features');
  if (!fs.existsSync(path.join(OUT, 'i18n.js'))) warn.push('i18n.js is missing');
  return { out: OUT, files: fs.readdirSync(OUT).length, warn };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--api');
  const api = (i > 0 && process.argv[i + 1]) || process.env.SHERZ_API_URL || DEFAULT_API;
  const r = syncWeb({ api, push: process.env.SHERZ_PUSH === '1' });
  console.log(`[sync-web] ${r.files} top-level entries → ${r.out}\n[sync-web] backend = ${api}`);
  console.log(`[sync-web] public/index.html = ${Math.round(fs.statSync(path.join(OUT, 'index.html')).size / 1024)} KB`);
  r.warn.forEach((w) => console.warn('[sync-web] ⚠⚠⚠', w));
}

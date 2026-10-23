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

/** puts the app settings in front of every other script of index.html (idempotent) */
export function injectConfig(html, { api = DEFAULT_API, push = false } = {}) {
  const clean = String(html).replace(/<script data-sherz-native>[\s\S]*?<\/script>\s*/g, '');
  const tag = `<script data-sherz-native>window.SHERZ_NATIVE=true;window.SHERZ_API_URL=${JSON.stringify(String(api).replace(/\/+$/, ''))};window.SHERZ_PUSH=${push ? 'true' : 'false'};</script>\n`;
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

export function syncWeb({ api, push } = {}) {
  if (!fs.existsSync(path.join(SRC, 'index.html'))) throw new Error(`${SRC}/index.html not found — run this from the SHERZ project`);
  fs.rmSync(OUT, { recursive: true, force: true });
  copyDir(SRC, OUT);
  const idx = path.join(OUT, 'index.html');
  fs.writeFileSync(idx, injectConfig(fs.readFileSync(idx, 'utf8'), { api, push }));
  const warn = [];
  const html = fs.readFileSync(idx, 'utf8');
  if (!/src="\/native\.js"/.test(html)) warn.push('index.html does not load /native.js — the app would run without its native features');
  if (!fs.existsSync(path.join(OUT, 'i18n.js'))) warn.push('i18n.js is missing');
  return { out: OUT, files: fs.readdirSync(OUT).length, warn };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--api');
  const api = (i > 0 && process.argv[i + 1]) || process.env.SHERZ_API_URL || DEFAULT_API;
  const r = syncWeb({ api, push: process.env.SHERZ_PUSH === '1' });
  console.log(`[sync-web] ${r.files} top-level entries → ${r.out}\n[sync-web] backend = ${api}`);
  r.warn.forEach((w) => console.warn('[sync-web] ⚠', w));
}

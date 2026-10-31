// node apply_server_patch_push.mjs [path/to/server.js] [path/to/proactive/proactiveRunner.js]
// Surgical edits (nothing else is touched; safe to run twice):
//   server.js                      1) imports   2) after the /api/spaces mount: the push service, the proactive hook and the /api/push routes
//   proactive/proactiveRunner.js   3) `setPushNotifier` export   4) one call after a proactive message is delivered
import fs from 'node:fs';
const fail = (m) => { console.error(m); process.exit(1); };

// ── server.js ──
const file = process.argv[2] || 'server.js';
let s = fs.readFileSync(file, 'utf8');
if (s.includes('createWebPush')) console.log('already patched: ' + file);
else {
  const IMP = "import { loadWorkMode";
  const ii = s.indexOf(IMP); if (ii < 0) fail("an import line starting with \"import { loadWorkMode\" was not found in server.js — send me your import block");
  s = s.slice(0, ii) + "import { createWebPush } from './lib/webPush.js';                  // notifications while the app is closed (Web Push)\n" +
    "import { pushRouter } from './routes/push.js';\n" +
    "import { setPushNotifier } from './proactive/proactiveRunner.js';\n" + s.slice(ii);
  const MOUNT = "app.use('/api/spaces', spacesRouter(";
  const mi = s.indexOf(MOUNT); if (mi < 0) fail("app.use('/api/spaces', spacesRouter(...)) not found — send me that line as it is in your server.js");
  const eol = s.indexOf('\n', mi);
  const BLOCK = `
// ── Web Push: needs prisma/PushSubscriptions.prisma.txt in schema.prisma + \`npx prisma db push\`, \`npm i web-push\`, and VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT in .env (npx web-push generate-vapid-keys) ──
const webPush = createWebPush({ prisma });
setPushNotifier(({ userId, text, meta }) => webPush.sendToUser(userId, { title: 'SHERZ', body: text, url: '/', tag: (meta && meta.boundaryDecision) || 'proactive' }));
if (!webPush.ready()) console.warn('[push] off — add the PushSubscription table and VAPID_* keys to enable notifications while the app is closed.');
app.use('/api/push', pushRouter({ service: webPush, isProd, ensureUser: ensureGuestUser }));`;
  s = s.slice(0, eol) + BLOCK + s.slice(eol);
  fs.writeFileSync(file, s); console.log('patched ' + file);
}

// ── proactive/proactiveRunner.js ──
const rf = process.argv[3] || 'proactive/proactiveRunner.js';
let r = fs.readFileSync(rf, 'utf8');
if (r.includes('setPushNotifier')) console.log('already patched: ' + rf);
else {
  // 1) after the LAST import of the top import block (works whatever the imports look like)
  const lines = r.split('\n'); let last = -1;
  for (let k = 0; k < lines.length; k++) {
    const t = lines[k];
    if (/^import\s.*['"][^'"]+['"]\s*;?\s*(\/\/.*)?$/.test(t) || /^\}\s*from\s+['"][^'"]+['"]\s*;?\s*(\/\/.*)?$/.test(t)) last = k;
    else if (/^(const|let|var|function|async|export|class)\b/.test(t)) break;
  }
  if (last < 0) fail("no import line found at the top of " + rf + " — send me the first 20 lines of that file");
  lines.splice(last + 1, 0, "", "// Web Push hook: server.js sets it (setPushNotifier) when VAPID keys exist; with none set, nothing happens.", "let pushNotifier = null;", "export function setPushNotifier(fn) { pushNotifier = typeof fn === 'function' ? fn : null; }");
  r = lines.join('\n');
  // 2) one call right before the in-memory record of a delivered proactive send
  const HOOK = "  // 3) Web Push — reaches the phone / desktop when the app is closed (the service worker skips it if the app is open in front)\n  if (pushNotifier) { try { Promise.resolve(pushNotifier({ userId, text, meta: typeof meta === 'undefined' ? undefined : meta })).catch(() => {}); } catch { /* never blocks delivery */ } }\n\n";
  const B = "  // ✅ Loop fix: in-memory record of this send, independent of any DB write\n  rememberProactiveSend({ userId, text, intent: guardIntent });\n";
  if (r.split(B).length === 2) r = r.replace(B, HOOK + B);
  else {
    const m = [...r.matchAll(/^([ \t]*)rememberProactiveSend\(\{[^\n]*\}\);[^\n]*$/gm)];
    if (m.length !== 1) fail("could not find the single rememberProactiveSend({...}) call in " + rf + " — send me the end of deliverProactiveToUser");
    r = r.slice(0, m[0].index) + HOOK + r.slice(m[0].index);
  }
  fs.writeFileSync(rf, r); console.log('patched ' + rf);
}

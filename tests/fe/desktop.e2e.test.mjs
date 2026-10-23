const { _electron } = await import('playwright-core');
const { startMock, mkJwt } = await import('./mock.mjs');
const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
const { execSync } = await import('node:child_process');
const { server, state, port } = await startMock('public');
let pass = 0, fail = 0; const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n} ${x}`); };
const APPS = '/home/claude/apps';
execSync(`node scripts/sync-web.mjs --api http://localhost:${port}`, { cwd: APPS, stdio: 'ignore' });
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sherz-home-'));
const PACKED = process.env.PACKAGED === '1';
const app = await _electron.launch({ executablePath: PACKED ? `${APPS}/desktop/dist/linux-unpacked/sherz-desktop` : `${APPS}/desktop/node_modules/electron/dist/electron`, args: PACKED ? ['--no-sandbox'] : ['--no-sandbox', `${APPS}/desktop`], env: { ...process.env, HOME: home, XDG_CONFIG_HOME: home + '/.config', SHERZ_TEST: '1', SHERZ_NO_UPDATE: '1' } });
const page = await app.firstWindow(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
await page.waitForLoadState('domcontentloaded'); await page.waitForTimeout(1800);
ok('loads the bundled app under app://sherz', page.url().startsWith('app://sherz/'), page.url());
const info = await page.evaluate(() => ({ plat: window.SherzNative && window.SherzNative.platform, native: window.SherzNative && window.SherzNative.isNative, attr: document.documentElement.getAttribute('data-native'), api: window.CONFIG && window.CONFIG.API_URL, lang: document.documentElement.lang, node: typeof require, proc: typeof process }));
ok('native bridge: platform=desktop, API → backend', info.plat === 'desktop' && info.native && info.attr === 'desktop' && /localhost:\d+$/.test(info.api), JSON.stringify(info));
ok('page has NO Node access (sandbox + isolation)', info.node === 'undefined' && info.proc === 'undefined');
if (!PACKED) ok('web app booted (guest session via the backend, CORS from app://sherz works)', state.guestIds.length > 0 || (await page.evaluate(() => !!localStorage.getItem('sherz_guest_token'))));
ok('i18n runs inside the shell', !!(await page.evaluate(() => window.SherzI18n && window.SherzI18n.lang)));
ok('desktop settings block appears in the menu hub', !!(await page.$('#hubDesktopSec')));
// path traversal is refused
const trav = await page.evaluate(async () => { try { const r = await fetch('app://sherz/%2e%2e/%2e%2e/desktop/package.json'); return r.status; } catch (e) { return 'err'; } });
ok('../ escape from the bundle is refused', trav === 403 || trav === 404 || trav === 'err', String(trav));
const idx = await page.evaluate(async () => (await fetch('app://sherz/native.js')).status); ok('bundled files are served', idx === 200);
// links never navigate the app away
await page.evaluate(() => { location.href = 'https://example.com/'; }); await page.waitForTimeout(600);
ok('navigating to a foreign site is blocked', page.url().startsWith('app://sherz/'), page.url());
// global-hotkey → focus the chat box
await page.evaluate(() => { document.getElementById('text').blur(); });
await app.evaluate(() => global.__sherz.focusComposer()); await page.waitForTimeout(300);
ok('hotkey action focuses the composer', await page.evaluate(() => document.activeElement && document.activeElement.id === 'text'));
const hk = await app.evaluate(() => ({ ok: global.__sherz.hotkeyOk, tray: global.__sherz.hasTray })); console.log('INFO  hotkey registered:', hk.ok, '· tray available here:', hk.tray);
// offline banner + online event
await page.evaluate(() => { window.__ev = 0; window.addEventListener('sherz:online', () => window.__ev++); window.dispatchEvent(new Event('offline')); }); await page.waitForTimeout(400);
const off = await page.evaluate(() => { const b = document.querySelector('.sherz-offline'); return b && b.classList.contains('on') ? b.textContent : null; });
ok('offline → banner shown', !!off, off);
await page.evaluate(() => window.dispatchEvent(new Event('online'))); await page.waitForTimeout(400);
ok('online → "sherz:online" fired and banner turns green', (await page.evaluate(() => window.__ev)) === 1 && (await page.evaluate(() => document.querySelector('.sherz-offline').classList.contains('ok'))));
// i18n for the banner
await page.evaluate(() => window.SherzI18n.setLang('ru')); await page.evaluate(() => window.dispatchEvent(new Event('offline'))); await page.waitForTimeout(300);
ok('banner follows the interface language (ru)', /Нет интернета/.test(await page.evaluate(() => document.querySelector('.sherz-offline').textContent)));
await page.evaluate(() => { window.dispatchEvent(new Event('online')); window.SherzI18n.setLang('auto'); });
// download goes to the Downloads folder
fs.mkdirSync(home + '/Downloads', { recursive: true });
await page.evaluate(() => window.SherzNative.saveBlob(new Blob(['hello'], { type: 'text/plain' }), 'hisobot.txt')); await page.waitForTimeout(1200);
/* the packaged bundle has the backend URL from build time, so the guest-session check only runs against the dev shell */
const dlDir = await app.evaluate(({ app }) => app.getPath('downloads')); const dl = fs.existsSync(dlDir) ? fs.readdirSync(dlDir) : []; console.log('INFO  downloads dir:', dlDir);
ok('a file download lands in Downloads without a dialog', dl.includes('hisobot.txt'), JSON.stringify(dl));
// Google sign-in hand-back
const TOKEN = mkJwt({ id: 'user_9', name: 'Ali', email: 'a@e.com', exp: Math.floor(Date.now() / 1000) + 3600 });
await app.evaluate((_, t) => global.__sherz.deliverLink('sherz://auth?token=' + t + '&name=Ali'), TOKEN);
await page.waitForTimeout(2500);
const stored = await page.evaluate(() => localStorage.getItem('sherz_token'));
ok('sherz://auth link signs the user in (token stored, URL cleaned)', stored === TOKEN && !page.url().includes('token='), page.url());
const bad = await app.evaluate(() => { global.__sherz.deliverLink('sherz://evil?x=1'); return 'ignored'; }); ok('other sherz:// links are ignored', bad === 'ignored' && (await page.evaluate(() => localStorage.getItem('sherz_token'))) === TOKEN);
ok('no page errors', errs.length === 0, errs.slice(0, 3).join('|'));
await page.screenshot({ path: 'shots/desktop.png' });
await app.close(); server.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);

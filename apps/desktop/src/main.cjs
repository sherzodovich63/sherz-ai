'use strict';
// SHERZ desktop shell (Electron). It shows the SAME web app as the website, from the bundled folder `www`, under its own origin app://sherz.
// Adds: tray / menu-bar icon, a global hotkey that opens SHERZ from anywhere, system notifications, downloads straight to the Downloads
// folder, single instance, sherz:// links (Google sign-in comes back this way), start-with-computer, and auto-update when a release feed is configured.
const { app, BrowserWindow, Tray, Menu, Notification, dialog, globalShortcut, ipcMain, nativeImage, protocol, net, session, shell, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { t, pick } = require('./i18n-main.cjs');

const SCHEME = 'app', HOST = 'sherz', ORIGIN = `${SCHEME}://${HOST}`;
const DEV_URL = process.env.SHERZ_DEV_URL || '';                       // e.g. http://localhost:3000 to run the shell against the dev server
const TEST = process.env.SHERZ_TEST === '1';
const WWW = app.isPackaged ? path.join(process.resourcesPath, 'www') : path.resolve(__dirname, '../../www');
const DEFAULTS = { hotkey: 'CommandOrControl+Shift+Space', closeToTray: true, launchAtLogin: false, bounds: null };

protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

const DEBUG = process.env.SHERZ_DEBUG === '1' || process.argv.includes('--sherz-debug');
const seenLogs = new Set();
function logOnce(msg) { if (seenLogs.has(msg) || seenLogs.size > 200) return; seenLogs.add(msg); console.warn('[sherz] ' + msg); }

// ───────── settings (a small JSON file in the user-data folder) ─────────
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { ...DEFAULTS };
function loadSettings() { try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { settings = { ...DEFAULTS }; } }
function saveSettings() { try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch (e) { console.warn('[settings] not saved:', e.message); } }

let win = null, tray = null, quitting = false, lang = (app.getLocale() || 'en').slice(0, 2);
let pendingLinks = [], rendererReady = false, hotkeyOk = false;

// ───────── single instance + sherz:// links ─────────
const linkFrom = (argv) => argv.find((a) => /^sherz:\/\//i.test(a));
function deliverLink(url) {
  if (!url || !/^sherz:\/\/auth/i.test(url)) return;                    // the only link the app understands
  if (win && rendererReady) { win.webContents.send('native:deep-link', url); showWindow(); } else pendingLinks.push(url);
}
if (!app.requestSingleInstanceLock() && !TEST) { app.quit(); process.exit(0); }
app.on('second-instance', (_e, argv) => { const l = linkFrom(argv); if (l) deliverLink(l); showWindow(); });
app.on('open-url', (e, url) => { e.preventDefault(); deliverLink(url); });     // macOS
try {
  if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient('sherz', process.execPath, [path.resolve(process.argv[1])]);
  else app.setAsDefaultProtocolClient('sherz');
} catch (e) { console.warn('[protocol] sherz:// not registered:', e.message); }

// ───────── window ─────────
function boundsOk(b) { return b && Number.isFinite(b.x) && Number.isFinite(b.y) && screen.getAllDisplays().some((d) => { const a = d.workArea; return b.x < a.x + a.width - 40 && b.x + b.width > a.x + 40 && b.y < a.y + a.height - 40 && b.y + b.height > a.y + 20; }); }
function createWindow() {
  const b = settings.bounds && boundsOk(settings.bounds) ? settings.bounds : null;
  win = new BrowserWindow({
    width: b?.width || 1100, height: b?.height || 780, x: b?.x, y: b?.y, minWidth: 380, minHeight: 520,
    backgroundColor: '#070709', title: 'SHERZ', show: !TEST ? false : true, autoHideMenuBar: true, icon: iconPath(),
    // no separate title bar (no tiny icon / "SHERZ" text): the app's own header is the top of the window; Windows/Linux keep the real minimise / maximise / close buttons drawn over it, macOS keeps its traffic lights
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(process.platform === 'darwin' ? {} : { titleBarOverlay: { color: '#070709', symbolColor: '#d8d8e4', height: 44 } }),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });
  watchPage(win.webContents);
  win.on('page-title-updated', (e) => e.preventDefault());                       // the window is always called just "SHERZ", whatever the page's <title> says
  // the header becomes the drag handle; its buttons stay clickable and leave room for the window buttons on the right (or the traffic lights on a Mac)
  const FRAME_CSS = `.topbar{-webkit-app-region:drag;user-select:none}
.topbar button,.topbar a,.topbar input,.topbar select,.topbar [role=button],.topbar [data-lang-pref]{-webkit-app-region:no-drag}
.topbar{box-sizing:border-box;${process.platform === 'darwin' ? 'padding-left:max(84px,env(titlebar-area-x,0px))' : 'padding-right:calc(100vw - env(titlebar-area-width,100vw) + 8px)'}}
html,body{height:100%;margin:0}
/* compact header: 44 px, same height as the window buttons */
.topbar{height:44px!important;padding-top:0!important}
.topbar-inner{height:44px!important;padding:0 12px!important;box-sizing:border-box!important;gap:8px!important}
.topbar .brand{gap:8px!important}
.topbar .brand-name{font-size:13px!important;letter-spacing:.28em!important}
.topbar .mode-badge{height:26px!important;min-height:0!important;padding:0 10px 0 8px!important;font-size:12.5px!important}
.topbar .top-actions{gap:6px!important}
.topbar .btn-ghost,.topbar .status-pill{height:28px!important;min-height:0!important;padding:0 10px!important;font-size:12.5px!important;line-height:1!important;display:inline-flex;align-items:center;gap:6px}
.topbar .btn-ghost svg{width:15px!important;height:15px!important}`;
  win.webContents.on('did-finish-load', () => { win.webContents.insertCSS(FRAME_CSS).catch(() => {}); });
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) win.show(); });
  win.loadURL(DEV_URL || `${ORIGIN}/index.html`);
  win.on('close', (e) => {
    try { if (!win.isMinimized() && !win.isMaximized()) settings.bounds = win.getBounds(); saveSettings(); } catch {}
    if (!quitting && settings.closeToTray && tray) { e.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; rendererReady = false; });
  // links: the app only ever shows its own origin; everything else opens in the real browser
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!DEV_URL && !url.startsWith(ORIGIN + '/')) { e.preventDefault(); openExternal(url); } });
}
function iconPath() { const ico = path.join(__dirname, '../build/icon.ico'); if (process.platform === 'win32' && fs.existsSync(ico)) return ico; const p = path.join(__dirname, '../build/icon.png'); return fs.existsSync(p) ? p : undefined; }   // Windows: the multi-size .ico (npm run web-icons) keeps the taskbar icon sharp   // PNG, 256×256 or bigger (see desktop/build/)
// Problems the page has are printed in this terminal: failed loads, blocked requests (CORS), script errors. SHERZ_DEBUG=1 also opens the developer tools.
function watchPage(wc) {
  wc.on('did-fail-load', (_e, code, desc, url, isMain) => { if (isMain || DEBUG) logOnce(`page load failed (${code} ${desc}) ${url}`); });
  wc.on('render-process-gone', (_e, d) => console.error('[sherz] page process gone:', d && d.reason));
  wc.on('console-message', (...a) => {
    const d = a[0] && typeof a[0] === 'object' && 'message' in a[0] ? a[0] : { level: a[1], message: a[2], sourceId: a[4], lineNumber: a[3] };
    const lvl = typeof d.level === 'string' ? d.level : ['verbose', 'info', 'warning', 'error'][d.level] || 'info';
    if (lvl === 'error' || (DEBUG && lvl === 'warning')) logOnce(`page ${lvl}: ${String(d.message).slice(0, 300)}${d.sourceId ? '  (' + String(d.sourceId).split('/').pop() + ':' + d.lineNumber + ')' : ''}`);
  });
  if (DEBUG) wc.once('did-finish-load', () => wc.openDevTools({ mode: 'detach' }));
  // a few seconds after load: did the SHERZ chat page actually start? (an empty <div id="app"> means public/index.html is not the SHERZ page)
  wc.on('did-finish-load', () => setTimeout(async () => {
    try {
      const r = await wc.executeJavaScript(`({ log: !!document.getElementById('log'), box: !!document.getElementById('text'), app: !!document.getElementById('app'), kb: Math.round(document.documentElement.outerHTML.length / 1024) })`);
      if (!r.log || !r.box) logOnce(`the SHERZ chat page did not start: no message list / chat box in the page (${r.kb} KB of HTML${r.app ? ', it only has an empty <div id="app">' : ''}). Check apps/www/index.html — it must be the full SHERZ index.html — and the "page error" lines above.`);
    } catch {}
  }, 4000));
}
function showWindow() { if (!win) createWindow(); if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
function toggleWindow() { if (win && win.isVisible() && win.isFocused()) win.hide(); else { showWindow(); focusComposer(); } }
function focusComposer() { if (win && rendererReady) win.webContents.send('native:focus-composer'); else if (win) win.webContents.once('did-finish-load', () => win && win.webContents.send('native:focus-composer')); }
function openExternal(url) { try { const u = new URL(url); if (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:') shell.openExternal(u.toString()); } catch {} }

// ───────── tray / menu bar ─────────
function trayImage() {
  const p = path.join(__dirname, '../build', process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png');
  let img = fs.existsSync(p) ? nativeImage.createFromPath(p) : nativeImage.createEmpty();
  if (img.isEmpty() && iconPath()) img = nativeImage.createFromPath(iconPath()).resize({ width: 32, height: 32 });
  if (process.platform === 'darwin') img.setTemplateImage(true);
  return img;
}
function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: t('open', lang), click: showWindow },
    { label: t('hotkey', lang, hotkeyOk ? settings.hotkey.replace('CommandOrControl', process.platform === 'darwin' ? '⌘' : 'Ctrl') : '—'), enabled: false },
    { type: 'separator' },
    { label: t('tray', lang), type: 'checkbox', checked: !!settings.closeToTray, click: (i) => { settings.closeToTray = i.checked; saveSettings(); } },
    { label: t('login', lang), type: 'checkbox', checked: !!settings.launchAtLogin, click: (i) => setLaunchAtLogin(i.checked) },
    { type: 'separator' },
    ...(app.isPackaged ? [{ label: t('upd', lang), click: checkUpdatesNow }] : []),
    { label: t('quit', lang), click: () => { quitting = true; app.quit(); } },
  ]);
}
function createTray() {
  try { tray = new Tray(trayImage()); tray.setToolTip(t('tip', lang)); tray.setContextMenu(buildTrayMenu()); tray.on('click', toggleWindow); }
  catch (e) { tray = null; console.warn('[tray] not available here:', e.message); }       // some Linux desktops have no tray → the window then closes normally
}
function refreshTray() { if (tray) { tray.setContextMenu(buildTrayMenu()); tray.setToolTip(t('tip', lang)); } }
function setLaunchAtLogin(on) { settings.launchAtLogin = !!on; saveSettings(); try { app.setLoginItemSettings({ openAtLogin: !!on, args: on ? ['--hidden'] : [] }); } catch {} }

// ───────── global hotkey ─────────
function registerHotkey() {
  globalShortcut.unregisterAll(); hotkeyOk = false;
  try { hotkeyOk = !!settings.hotkey && globalShortcut.register(settings.hotkey, toggleWindow); } catch (e) { console.warn('[hotkey] invalid:', settings.hotkey, e.message); }
  if (!hotkeyOk) console.warn('[hotkey] could not register', settings.hotkey, '(taken by another app?)');
  refreshTray();
}

// ───────── notifications, downloads, permissions ─────────
function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, silent: false });
  n.on('click', () => { if (onClick) onClick(); else showWindow(); });
  n.show();
}
function uniquePath(dir, name) {
  const ext = path.extname(name), base = path.basename(name, ext).replace(/[\\/:*?"<>|]/g, '_') || 'file';
  let p = path.join(dir, base + ext), i = 1;
  while (fs.existsSync(p)) p = path.join(dir, `${base} (${i++})${ext}`);
  return p;
}
function setupSession() {
  const ses = session.defaultSession;
  ses.webRequest.onErrorOccurred((d) => { if (d.error && !/ERR_ABORTED/.test(d.error)) logOnce(`request failed: ${d.error}  ${String(d.url).slice(0, 160)}   ← "ERR_FAILED" on a backend URL usually means the server's CORS list does not include app://sherz`); });
  const mine = (wc) => { try { return DEV_URL ? true : wc.getURL().startsWith(ORIGIN + '/'); } catch { return false; } };
  ses.setPermissionRequestHandler((wc, perm, cb) => cb(mine(wc) && ['media', 'notifications', 'clipboard-sanitized-write', 'fullscreen'].includes(perm)));
  ses.setPermissionCheckHandler((wc, perm) => mine(wc || { getURL: () => '' }) && ['media', 'notifications', 'clipboard-sanitized-write', 'fullscreen'].includes(perm));
  ses.on('will-download', (_e, item) => {
    const target = uniquePath(app.getPath('downloads'), item.getFilename() || 'file');
    item.setSavePath(target);                                                  // no dialog: the file goes to Downloads, like the "saved to your device" banner says
    item.once('done', (_ev, state) => {
      if (state !== 'completed') return;
      if (win) win.webContents.send('native:downloaded', path.basename(target));
      notify(t('saved', lang), path.basename(target), () => shell.showItemInFolder(target));
    });
  });
  if (process.platform === 'darwin') { try { require('electron').systemPreferences.askForMediaAccess('microphone'); } catch {} }
}
function setupProtocol() {
  protocol.handle(SCHEME, async (req) => {
    const u = new URL(req.url);
    if (u.host !== HOST) return new Response('not found', { status: 404 });
    let rel = decodeURIComponent(u.pathname); if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(WWW, rel));
    if (file !== WWW && !file.startsWith(WWW + path.sep)) return new Response('forbidden', { status: 403 });   // no ../ escapes
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { logOnce('missing file in the app bundle: ' + rel + ' (looked in ' + WWW + ')'); return new Response('not found', { status: 404 }); }
    try { return await net.fetch(pathToFileURL(file).toString()); } catch (e) { logOnce('could not read ' + rel + ': ' + e.message); return new Response('error', { status: 500 }); }
  });
}

// ───────── messages from the page (only from our own origin) ─────────
const trusted = (e) => { try { const u = e.senderFrame?.url || e.sender?.getURL() || ''; return DEV_URL ? true : u.startsWith(ORIGIN + '/'); } catch { return false; } };
function setupIpc() {
  ipcMain.on('native:notify', (e, title, body) => { if (trusted(e)) notify(title, body); });
  ipcMain.on('native:open-external', (e, url) => { if (trusted(e)) openExternal(url); });
  ipcMain.on('native:language', (e, l) => { if (trusted(e)) { lang = pick(l); refreshTray(); } });
  ipcMain.on('native:badge', (e, n) => { if (trusted(e)) { try { app.setBadgeCount(Math.max(0, Math.min(999, n | 0))); } catch {} } });
  ipcMain.handle('native:get-settings', (e) => (trusted(e) ? { hotkey: settings.hotkey, hotkeyActive: hotkeyOk, closeToTray: settings.closeToTray, launchAtLogin: settings.launchAtLogin, version: app.getVersion() } : null));
  ipcMain.handle('native:set-settings', (e, patch) => {
    if (!trusted(e)) return null;
    if (typeof patch.closeToTray === 'boolean') settings.closeToTray = patch.closeToTray;
    if (typeof patch.launchAtLogin === 'boolean') setLaunchAtLogin(patch.launchAtLogin);
    if (typeof patch.hotkey === 'string' && patch.hotkey.length < 60) { settings.hotkey = patch.hotkey; registerHotkey(); }
    saveSettings(); refreshTray();
    return { hotkey: settings.hotkey, hotkeyActive: hotkeyOk, closeToTray: settings.closeToTray, launchAtLogin: settings.launchAtLogin };
  });
  ipcMain.on('native:ready', (e) => {
    if (!trusted(e)) return; rendererReady = true;
    const l = pendingLinks.splice(0); l.forEach((u) => win && win.webContents.send('native:deep-link', u));
  });
}

// ───────── updates (only for installed builds that have a release feed) ─────────
let updater = null, manualCheck = false;
function setupUpdates() {
  if (!app.isPackaged || process.env.SHERZ_NO_UPDATE === '1') return;
  try {
    ({ autoUpdater: updater } = require('electron-updater'));
    updater.autoDownload = true; updater.autoInstallOnAppQuit = true;           // downloads in the background; installs when SHERZ is closed (or right away if you press Restart)
    updater.on('error', (e) => { console.warn('[update]', e.message); if (manualCheck) { manualCheck = false; dialog.showMessageBox({ type: 'info', message: t('updFail', lang) }); } });
    updater.on('update-not-available', () => { if (manualCheck) { manualCheck = false; dialog.showMessageBox({ type: 'info', message: t('updNone', lang, app.getVersion()) }); } });
    updater.on('update-downloaded', (info) => {
      manualCheck = false;
      dialog.showMessageBox(win && !win.isDestroyed() ? win : undefined, { type: 'info', buttons: [t('updNow', lang), t('updLater', lang)], defaultId: 0, cancelId: 1, message: t('updReady', lang, info.version), detail: t('updText', lang) })
        .then((r) => { if (r.response === 0) { quitting = true; updater.quitAndInstall(); } });
    });
    const check = () => updater.checkForUpdates().catch(() => {});
    check(); setInterval(check, 4 * 60 * 60 * 1000);                              // on start, then every 4 hours
  } catch (e) { console.warn('[update] updater unavailable:', e.message); }
}
function checkUpdatesNow() { if (!updater) { dialog.showMessageBox({ type: 'info', message: t('updNone', lang, app.getVersion()) }); return; } manualCheck = true; updater.checkForUpdates().catch(() => {}); }

app.whenReady().then(() => {
  try { app.setAppUserModelId('ai.sherz.app'); } catch {}                         // Windows: groups the taskbar icon with the app's own icon
  loadSettings(); setupProtocol(); setupSession(); setupIpc();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]));
  createWindow(); createTray(); registerHotkey();
  const first = linkFrom(process.argv); if (first) deliverLink(first);
  if (settings.launchAtLogin) setLaunchAtLogin(true);
  setupUpdates();
  if (TEST) global.__sherz = { get win() { return win; }, deliverLink, focusComposer, toggleWindow, get settings() { return settings; }, get hotkeyOk() { return hotkeyOk; }, get hasTray() { return !!tray; } };
});
app.on('activate', showWindow);                                                  // macOS dock click
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && (!tray || !settings.closeToTray)) app.quit(); });

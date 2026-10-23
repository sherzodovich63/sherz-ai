'use strict';
// SHERZ desktop shell (Electron). It shows the SAME web app as the website, from the bundled folder `www`, under its own origin app://sherz.
// Adds: tray / menu-bar icon, a global hotkey that opens SHERZ from anywhere, system notifications, downloads straight to the Downloads
// folder, single instance, sherz:// links (Google sign-in comes back this way), start-with-computer, and auto-update when a release feed is configured.
const { app, BrowserWindow, Tray, Menu, Notification, globalShortcut, ipcMain, nativeImage, protocol, net, session, shell, screen } = require('electron');
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
    backgroundColor: '#070709', title: 'SHERZ', show: !TEST ? false : true, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });
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
function showWindow() { if (!win) createWindow(); if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
function toggleWindow() { if (win && win.isVisible() && win.isFocused()) win.hide(); else { showWindow(); focusComposer(); } }
function focusComposer() { if (win && rendererReady) win.webContents.send('native:focus-composer'); else if (win) win.webContents.once('did-finish-load', () => win && win.webContents.send('native:focus-composer')); }
function openExternal(url) { try { const u = new URL(url); if (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:') shell.openExternal(u.toString()); } catch {} }

// ───────── tray / menu bar ─────────
function trayImage() {
  const p = path.join(__dirname, '../build', process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png');
  let img = fs.existsSync(p) ? nativeImage.createFromPath(p) : nativeImage.createEmpty();
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
  protocol.handle(SCHEME, (req) => {
    const u = new URL(req.url);
    if (u.host !== HOST) return new Response('not found', { status: 404 });
    let rel = decodeURIComponent(u.pathname); if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(WWW, rel));
    if (file !== WWW && !file.startsWith(WWW + path.sep)) return new Response('forbidden', { status: 403 });   // no ../ escapes
    return net.fetch(pathToFileURL(file).toString());
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
function setupUpdates() {
  if (!app.isPackaged || process.env.SHERZ_NO_UPDATE === '1') return;
  try { const { autoUpdater } = require('electron-updater'); autoUpdater.on('error', (e) => console.warn('[update]', e.message)); autoUpdater.checkForUpdatesAndNotify().catch(() => {}); }
  catch (e) { console.warn('[update] updater unavailable:', e.message); }
}

app.whenReady().then(() => {
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

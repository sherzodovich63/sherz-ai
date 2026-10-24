/* public/native.js — the bridge between the web app and the desktop / mobile shells.
 * In a normal browser it does almost nothing (window.SherzNative.isNative === false).
 * Inside the Electron app (preload gives window.SherzNativeHost) or a Capacitor app (window.Capacitor) it adds:
 *   • connection state: an "offline" banner, and sherz:online / sherz:resume events the page uses to re-sync the open chat
 *   • system notifications, saving files (a share sheet on phones), the global-hotkey "focus the chat box", Android back button
 *   • Google sign-in through the SYSTEM browser (Google refuses embedded webviews) and the sherz://auth?token=… hand-back
 *   • mobile push registration (only when the app was built with SHERZ_PUSH=1 and the server supports it)
 */
(function () {
  'use strict';
  const H = window.SherzNativeHost || null;                                        // Electron preload
  const CAP = window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform() ? window.Capacitor : null;
  const platform = H ? 'desktop' : CAP ? CAP.getPlatform() : 'web';               // desktop | ios | android | web
  const isNative = platform !== 'web';
  const P = (name) => (CAP && CAP.Plugins && CAP.Plugins[name]) || null;           // Capacitor plugin proxy (only if the plugin is installed)
  const T = (k, v) => (window.SherzI18n ? window.SherzI18n.t(k, v) : String(k).replace(/\{(\d)\}/g, (_, i) => (v && v[+i]) ?? ''));
  const safe = (fn, d) => { try { return fn(); } catch (e) { return d; } };
  const api = (p) => (typeof window.apiUrl === 'function' ? window.apiUrl(p) : p);

  document.documentElement.setAttribute('data-native', platform);
  if (H && H.os) document.documentElement.setAttribute('data-os', H.os);

  /* ───────────── connection state ───────────── */
  let online = navigator.onLine !== false, banner = null, resumeAt = 0;
  function ensureBanner() {
    if (banner) return banner;
    const st = document.createElement('style');
    st.textContent = '.sherz-offline{position:fixed;left:50%;top:max(10px,env(safe-area-inset-top));transform:translate(-50%,-140%);z-index:9999;max-width:min(92vw,420px);padding:9px 16px;border-radius:999px;font:600 13px/1.3 system-ui,sans-serif;color:#fff;background:rgba(190,60,60,.94);box-shadow:0 8px 28px rgba(0,0,0,.4);transition:transform .25s ease;pointer-events:none;text-align:center}.sherz-offline.on{transform:translate(-50%,0)}.sherz-offline.ok{background:rgba(30,150,100,.95)}';
    document.head.appendChild(st);
    banner = document.createElement('div'); banner.className = 'sherz-offline'; banner.setAttribute('role', 'status'); banner.setAttribute('aria-live', 'polite');
    document.body.appendChild(banner); return banner;
  }
  let hideTimer = 0;
  function showBanner(text, ok, autoHideMs) {
    const b = ensureBanner(); clearTimeout(hideTimer);
    b.textContent = text; b.classList.toggle('ok', !!ok); b.classList.add('on');
    if (autoHideMs) hideTimer = setTimeout(() => b.classList.remove('on'), autoHideMs);
  }
  function setOnline(v) {
    if (v === online) return; online = v;
    if (!v) showBanner(T('You are offline. SHERZ will reconnect by itself.'), false, 0);
    else { showBanner(T('Back online'), true, 2200); window.dispatchEvent(new CustomEvent('sherz:online')); }
  }
  window.addEventListener('online', () => setOnline(true));
  window.addEventListener('offline', () => setOnline(false));
  const resume = () => { const n = Date.now(); if (n - resumeAt < 1500) return; resumeAt = n; window.dispatchEvent(new CustomEvent('sherz:resume')); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resume(); });
  if (window.SherzI18n) window.SherzI18n.onChange(() => { if (!online) showBanner(T('You are offline. SHERZ will reconnect by itself.'), false, 0); });
  if (isNative && !online) document.addEventListener('DOMContentLoaded', () => showBanner(T('You are offline. SHERZ will reconnect by itself.'), false, 0));

  /* ───────────── notifications ───────────── */
  let notifId = 1, localAsked = false;
  async function notify(title, body) {
    title = String(title || 'SHERZ'); body = String(body || '');
    if (H) return H.notify(title, body);
    const LN = P('LocalNotifications');
    if (LN) {
      try {
        if (!localAsked) { localAsked = true; await LN.requestPermissions(); }
        await LN.schedule({ notifications: [{ id: (notifId = (notifId % 2000000000) + 1), title, body: body.slice(0, 200), schedule: { at: new Date(Date.now() + 250) } }] });
      } catch (e) { console.warn('[native] notification failed:', e && e.message); }
      return;
    }
    if ('Notification' in window && Notification.permission === 'granted') safe(() => new Notification(title, { body }));
  }

  /* ───────────── files ───────────── */
  const cleanName = (n) => String(n || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120) || 'file';
  const toBase64 = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onerror = () => rej(fr.error); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.readAsDataURL(blob); });
  function anchorSave(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  /** Saves a downloaded file. Browser / desktop: a normal download (the desktop shell puts it in Downloads). Phones: the share sheet ("Save to Files", "Open in…"). */
  async function saveBlob(blob, name) {
    name = cleanName(name);
    const FS = P('Filesystem'), SH = P('Share');
    if (CAP && FS && SH) {
      try {
        const r = await FS.writeFile({ path: name, data: await toBase64(blob), directory: 'CACHE' });
        await SH.share({ title: name, url: r.uri, dialogTitle: name });
        return true;
      } catch (e) { if (e && /cancel/i.test(String(e.message || e))) return true; console.warn('[native] share failed, falling back:', e && e.message); }
    }
    anchorSave(blob, name); return true;
  }

  /* ───────────── Google sign-in through the system browser, and coming back ───────────── */
  function openExternal(url) {
    if (H) return H.openExternal(url);
    const B = P('Browser'); if (B) return B.open({ url });
    window.open(url, '_blank', 'noopener');
  }
  function handleAuthUrl(url) {
    let u; try { u = new URL(String(url)); } catch (e) { return false; }
    if (u.protocol !== 'sherz:' || u.hostname !== 'auth') return false;
    const B = P('Browser'); if (B) safe(() => B.close());
    const q = new URLSearchParams();
    if (u.searchParams.get('token')) { q.set('token', u.searchParams.get('token')); if (u.searchParams.get('name')) q.set('name', u.searchParams.get('name')); }
    else q.set('auth_error', u.searchParams.get('auth_error') || 'sign-in failed');
    location.replace(location.pathname + '?' + q.toString());                       // script.js stores the token and reloads — the same path the website uses
    return true;
  }
  if (isNative) window.__signInWithGoogle = function () { openExternal(api('/api/auth/google?native=1')); };
  if (H) { H.onDeepLink(handleAuthUrl); }
  if (CAP && P('App')) {
    safe(() => P('App').addListener('appUrlOpen', (e) => handleAuthUrl(e && e.url)));
    safe(() => P('App').addListener('resume', resume));
    safe(() => P('App').addListener('backButton', () => {                          // Android: close the side menu first, then send the app to the background
      const open = document.querySelector('#menuClose, .menu-close, [data-menu-close]');
      const drawer = document.getElementById('menu') || document.querySelector('.menu.open, .drawer.open');
      if (drawer && drawer.classList.contains('open') && open) open.click(); else P('App').minimizeApp && P('App').minimizeApp();
    }));
  }
  if (P('Network')) {
    safe(() => P('Network').getStatus().then((s) => setOnline(!!s.connected)));
    safe(() => P('Network').addListener('networkStatusChange', (s) => setOnline(!!s.connected)));
  }

  /* ───────────── desktop: global hotkey, language for the tray, small settings block ───────────── */
  function focusComposer() {
    const shell = document.getElementById('composerShell'); if (shell) shell.classList.remove('collapsed');
    const t = document.getElementById('text'); if (t) { t.focus(); try { t.setSelectionRange(t.value.length, t.value.length); } catch (e) {} }
  }
  function desktopSettingsBlock(s) {
    const hub = document.getElementById('menuHub'); if (!hub || document.getElementById('hubDesktopSec')) return;
    const sec = document.createElement('div'); sec.className = 'hub-sec'; sec.id = 'hubDesktopSec';
    const row = (id, label, checked) => `<label class="hub-label" style="display:flex;gap:8px;align-items:center;cursor:pointer"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}> <span>${T(label)}</span></label>`;
    sec.innerHTML = `<h4 class="hub-h">${T('Desktop app')}</h4>${row('dkTray', 'Keep running in the tray when closed', s.closeToTray)}${row('dkLogin', 'Start with the computer', s.launchAtLogin)}<div class="hub-label">${T('Hotkey: {0}', [(s.hotkey || '').replace('CommandOrControl', H.os === 'darwin' ? '⌘' : 'Ctrl').replace('Shift', 'Shift')])}${s.hotkeyActive ? '' : ' ⚠'}</div>`;
    hub.insertBefore(sec, hub.firstChild);
    sec.querySelector('#dkTray').addEventListener('change', (e) => H.setSettings({ closeToTray: e.target.checked }));
    sec.querySelector('#dkLogin').addEventListener('change', (e) => H.setSettings({ launchAtLogin: e.target.checked }));
  }
  function initDesktop() {
    H.onFocusComposer(focusComposer);
    H.onDownloaded((n) => window.dispatchEvent(new CustomEvent('sherz:downloaded', { detail: { name: n } })));
    const lang = () => safe(() => H.setLanguage(window.SherzI18n ? window.SherzI18n.lang : (navigator.language || 'en').slice(0, 2)));
    lang(); if (window.SherzI18n) window.SherzI18n.onChange(lang);
    H.getSettings().then((s) => { if (s) desktopSettingsBlock(s); }).catch(() => {});
    H.ready();
  }

  /* ───────────── mobile push (off unless the app was built for it) ───────────── */
  async function initPush() {
    const PN = P('PushNotifications'); if (!CAP || !PN || !window.SHERZ_PUSH) return;
    try {
      const perm = await PN.requestPermissions(); if (perm.receive !== 'granted') return;
      PN.addListener('registration', (t) => {
        const tok = localStorage.getItem('sherz_token'); if (!tok || !t || !t.value) return;
        fetch(api('/api/push/register'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ token: t.value, platform: CAP.getPlatform() }) }).catch(() => {});
      });
      PN.addListener('registrationError', (e) => console.warn('[push] registration error', e));
      await PN.register();
    } catch (e) { console.warn('[push] not started:', e && e.message); }
  }

  window.SherzNative = Object.freeze({
    platform, isNative, get online() { return online; },
    notify, saveBlob, openExternal, focusComposer, handleAuthUrl,
    setBadge: (n) => { if (H) H.setBadge(n); },
  });

  function boot() {
    if (H) initDesktop();
    if (CAP) { safe(() => { const SB = P('StatusBar'); if (SB) { SB.setStyle({ style: 'DARK' }); } }); safe(() => { const SS = P('SplashScreen'); if (SS) SS.hide(); }); initPush(); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

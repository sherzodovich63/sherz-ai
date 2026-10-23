// Runs inside the page with no Node access. Gives the web app exactly the few things it may ask the desktop shell for.
const { contextBridge, ipcRenderer } = require('electron');
const once = (ch, cb) => { const f = (_e, ...a) => cb(...a); ipcRenderer.on(ch, f); return () => ipcRenderer.removeListener(ch, f); };
contextBridge.exposeInMainWorld('SherzNativeHost', {
  kind: 'desktop',
  os: process.platform,                                   // win32 | darwin | linux
  notify: (title, body) => ipcRenderer.send('native:notify', String(title || 'SHERZ').slice(0, 80), String(body || '').slice(0, 300)),
  openExternal: (url) => ipcRenderer.send('native:open-external', String(url || '')),
  setLanguage: (lang) => ipcRenderer.send('native:language', String(lang || 'en')),
  setBadge: (n) => ipcRenderer.send('native:badge', Number(n) || 0),
  getSettings: () => ipcRenderer.invoke('native:get-settings'),
  setSettings: (patch) => ipcRenderer.invoke('native:set-settings', patch && typeof patch === 'object' ? patch : {}),
  onDeepLink: (cb) => once('native:deep-link', cb),       // sherz://auth?token=…  (back from the browser after Google sign-in)
  onFocusComposer: (cb) => once('native:focus-composer', cb),   // the global hotkey was pressed
  onDownloaded: (cb) => once('native:downloaded', cb),
  ready: () => ipcRenderer.send('native:ready'),          // the page is up: deliver anything that arrived early
});

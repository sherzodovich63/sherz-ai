// lib/nativeAuth.js — the pieces the desktop / mobile apps need from the server, kept free of Express so they can be unit-tested.
//  • NATIVE_ORIGINS: the page origins of the wrapped apps (Electron "app://sherz", Capacitor on Android "https://localhost", on iOS "capacitor://localhost").
//  • Google sign-in inside an app: Google refuses embedded webviews, so the app opens the SYSTEM browser on /api/auth/google?native=1.
//    The browser flow carries state=native through Google, and the callback ends by opening  sherz://auth?token=…  which the OS hands back to the app.
export const NATIVE_ORIGINS = Object.freeze(['app://sherz', 'https://localhost', 'capacitor://localhost']);
export const NATIVE_SCHEME = 'sherz';
export const NATIVE_STATE = 'native';

export const isNativeOrigin = (origin) => NATIVE_ORIGINS.includes(String(origin || ''));
export const isNativeState = (state) => String(state || '') === NATIVE_STATE;

/** where the callback sends the browser when the login started inside an app */
export function nativeRedirectUrl({ token = '', name = '', error = '' } = {}) {
  const q = new URLSearchParams();
  if (token) q.set('token', token);
  if (name) q.set('name', name);
  if (error) q.set('auth_error', error);
  return `${NATIVE_SCHEME}://auth?${q.toString()}`;
}

/** app side + tests: accepts only sherz://auth?… and returns its fields, otherwise null */
export function parseNativeAuthUrl(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== `${NATIVE_SCHEME}:` || u.hostname !== 'auth') return null;
    return { token: u.searchParams.get('token') || '', name: u.searchParams.get('name') || '', error: u.searchParams.get('auth_error') || '' };
  } catch { return null; }
}

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/**
 * The page the system browser lands on at the end of an app sign-in. A bare 302 to sherz:// is blocked by some mobile browsers, so this page
 * hands over by <meta refresh> (no script — the server's CSP forbids inline script) and shows a button as the fallback.
 */
export function nativeHandoffHtml(appUrl) {
  const u = escHtml(appUrl);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=${u}"><title>SHERZ</title>` +
    `<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070709;color:#fff;font:16px system-ui,sans-serif;text-align:center}a{display:inline-block;margin-top:18px;padding:14px 26px;border-radius:14px;background:linear-gradient(135deg,#6b46ff,#2f7bff);color:#fff;text-decoration:none;font-weight:700}</style></head>` +
    `<body><main><h1>SHERZ</h1><p>Signed in. Returning to the app…</p><a href="${u}">Open SHERZ</a></main></body></html>`;
}

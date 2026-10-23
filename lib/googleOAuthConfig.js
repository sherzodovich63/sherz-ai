// lib/googleOAuthConfig.js
// Builds the exact redirect_uri / client_id sent to Google, and cleans env values first.
// Why: Google answers a malformed redirect_uri with "Error 400: invalid_request – doesn't comply with
// Google's OAuth 2.0 policy" (NOT redirect_uri_mismatch). Typical causes: the env var holds a pasted
// Markdown link "[https://x](https://x)", surrounding quotes/spaces, http:// on a public host, or a path
// that isn't the registered one. The SAME value must be used for the auth request and the token exchange.

/** Trim, strip wrapping quotes and a pasted Markdown link: "[a](b)" → b */
export function cleanEnv(v) {
  let s = String(v ?? '').trim();
  const md = /^\[[^\]]*\]\(([^)]+)\)$/.exec(s);
  if (md) s = md[1].trim();
  s = s.replace(/^['"`]+|['"`]+$/g, '').trim();
  return s;
}

export const CALLBACK_PATH = '/api/auth/google/callback';

function validRedirect(u) {
  try {
    const url = new URL(u);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return 'must be https (http is only allowed for localhost)';
    if (url.hash) return 'must not contain #fragment';
    if (/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) && !local) return 'raw IP addresses are not allowed';
    if (!url.pathname || url.pathname === '/') return 'needs a path like /api/auth/google/callback';
    return null;
  } catch { return 'is not a valid URL'; }
}

/**
 * Decide the redirect_uri. Order: GOOGLE_REDIRECT, GOOGLE_CALLBACK_URL (cleaned) → else derived from this request's
 * public host (works behind Render's proxy via x-forwarded-*). A configured value that is invalid is reported
 * in `warnings` and replaced by the derived one, so Google never receives garbage.
 */
export function resolveRedirect({ env = process.env, req } = {}) {
  const warnings = [];
  const rawCandidates = [['GOOGLE_REDIRECT', env.GOOGLE_REDIRECT], ['GOOGLE_CALLBACK_URL', env.GOOGLE_CALLBACK_URL]];
  const derived = req
    ? `${(req.get?.('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim()}://${(req.get?.('x-forwarded-host') || req.get?.('host') || '').split(',')[0].trim()}${CALLBACK_PATH}`
    : null;
  for (const [name, raw] of rawCandidates) {
    if (raw == null || String(raw).trim() === '') continue;
    const cleaned = cleanEnv(raw);
    if (cleaned !== String(raw)) warnings.push(`${name} had extra characters (quotes / spaces / markdown link) — cleaned`);
    const bad = validRedirect(cleaned);
    if (bad) { warnings.push(`${name} "${cleaned}" ${bad}`); continue; }
    return { redirectUri: cleaned, source: name, raw: String(raw), warnings };
  }
  if (derived && !validRedirect(derived)) {
    warnings.push('no valid GOOGLE_REDIRECT set — derived from the request host');
    return { redirectUri: derived, source: 'derived', raw: null, warnings };
  }
  return { redirectUri: null, source: null, raw: null, warnings: [...warnings, 'no usable redirect URI'] };
}

export function resolveClientId(env = process.env) {
  return cleanEnv(env.GOOGLE_CLIENT_ID);
}

export function maskId(id) {
  if (!id) return null;
  return id.length <= 16 ? '***' : `${id.slice(0, 8)}…${id.slice(-24)}`;
}

/** Where to send the browser after login. FRONTEND_URL (e.g. https://sherz-ai.vercel.app) or same origin. */
export function frontendBase(env = process.env) {
  const v = cleanEnv(env.FRONTEND_URL || env.CORS_ORIGIN_PRIMARY || '');
  try { const u = new URL(v); return u.origin; } catch { return ''; }
}

export function buildAuthUrl({ clientId, redirectUri, state = '' }) {
  const params = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
    scope: 'openid email profile', access_type: 'offline', prompt: 'select_account',
  });
  if (state) params.set('state', String(state));                   // comes back unchanged on the callback (the desktop / mobile apps use it)
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

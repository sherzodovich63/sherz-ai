# Google sign-in: "Error 400: invalid_request" — fix + diagnostics

Your Console settings are fine. Google returns invalid_request (not redirect_uri_mismatch) when the redirect_uri it
RECEIVES is malformed. The old code sent `process.env.GOOGLE_REDIRECT` raw (it never read GOOGLE_CALLBACK_URL).
A value pasted into Render with quotes/spaces, as a Markdown link "[https://…](https://…)", with http://, or the old
localhost value from .env is enough to trigger it.

## What changed (routes/auth.js + new lib/googleOAuthConfig.js)
- The redirect_uri is cleaned (quotes, spaces, markdown link), validated (https unless localhost, has a path, no IP) and,
  if the env value is unusable, derived from the request host: https://sherz-ai.onrender.com/api/auth/google/callback.
- The token exchange in the callback uses the SAME value (Google requires it to be identical).
- Render logs now print: `[auth/google] redirecting to Google · redirect_uri=… (from GOOGLE_REDIRECT|derived)`.
- NEW  GET /api/auth/google/debug  → shows exactly what is sent (no secrets) + warnings.
- Callback now redirects to FRONTEND_URL (if set) so the login token lands on your Vercel site, not on onrender.com.

## Do this
1. Copy `routes/auth.js` and `lib/googleOAuthConfig.js` into the project, push, let Render redeploy.
2. Render → Environment: set
   GOOGLE_REDIRECT = https://sherz-ai.onrender.com/api/auth/google/callback   (plain text, no quotes, no brackets)
   FRONTEND_URL    = https://sherz-ai.vercel.app
   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET = from the "Web application" OAuth client you registered the URIs on.
3. Open https://sherz-ai.onrender.com/api/auth/google/debug — `redirectUri` must be one of your Authorized redirect URIs,
   `clientIdLooksRight` must be true, `warnings` should be empty.
4. Click Sign in with Google again. If it still fails, click "error details" on the Google page and send me that text.

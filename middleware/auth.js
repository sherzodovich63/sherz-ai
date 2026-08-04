// middleware/auth.js
// ─────────────────────────────────────────────────────────────────
// SHERZ AI — JWT authentication middleware
//
// signJwt(payload)   → creates a signed token (use in login route)
// authRequired       → Express middleware; sets req.user on success
// optionalAuth       → same but never blocks — req.user may be null
// ─────────────────────────────────────────────────────────────────
import jwt from 'jsonwebtoken';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === 'ROTATE_ME' || secret.length < 32) {
    throw new Error(
      'JWT_SECRET is not set or too short. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"'
    );
  }
  return secret;
}

/** Create a signed JWT token — use in your login/register route */
export function signJwt(payload, expiresIn = '7d') {
  return jwt.sign(payload, getSecret(), { expiresIn });
}

/**
 * Require a valid Bearer token.
 * On success → sets req.user = { id, email, ...payload }
 * On failure → 401/403 JSON response
 */
export function authRequired(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      ok: false,
      error: 'Authorization header kerak (Bearer <token)',
    });
  }

  const token = authHeader.slice(7); // remove "Bearer "
  try {
    const decoded = jwt.verify(token, getSecret());
    req.user = decoded; // { id, email, iat, exp, ... }
    next();
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    return res.status(403).json({
      ok: false,
      error: expired ? 'Token muddati tugagan' : 'Token noto\'g\'ri',
    });
  }
}

/**
 * Optional auth — does not block unauthenticated requests.
 * Sets req.user if a valid token is present, otherwise req.user = null.
 * Use for endpoints that behave differently for logged-in users.
 */
export function optionalAuth(req, _res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }
  try {
    req.user = jwt.verify(authHeader.slice(7), getSecret());
  } catch {
    req.user = null;
  }
  next();
}

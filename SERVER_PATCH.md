# server.js — 2 surgical edits (dev mode ignored the login token)

## 1) import
SEARCH:
import { authRequired } from './middleware/auth.js';
REPLACE:
import { authRequired, optionalAuth } from './middleware/auth.js';

## 2) /api guard (inside app.use('/api', ...))
SEARCH:
  if (!isProd) return next();

  return authRequired(req, res, next);
REPLACE:
  // DEV: don't force login, but DO read the token when one is sent, so req.user is the real account
  if (!isProd) return optionalAuth(req, res, next);

  return authRequired(req, res, next);

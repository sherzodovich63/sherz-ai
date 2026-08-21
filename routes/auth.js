// routes/auth.js
// ─────────────────────────────────────────────────────────────────
// SHERZ AI — Authentication routes
//
// POST /api/auth/register  → create account, return JWT
// POST /api/auth/login     → verify credentials, return JWT
// GET  /api/auth/me        → return current user (requires JWT)
//
// All routes use the existing Prisma `User` model.
// Passwords are hashed with bcryptjs (cost factor 12).
// JWTs are signed with JWT_SECRET from .env (min 32 chars).
// Input is validated with Zod before any DB call.
// ─────────────────────────────────────────────────────────────────
import { Router }  from 'express';
import bcrypt      from 'bcryptjs';
import { z }       from 'zod';
import { signJwt, authRequired } from '../middleware/auth.js';

// ── Zod schemas ────────────────────────────────────────────────
const RegisterSchema = z.object({
  name:     z.string().min(1, 'Ism kiritish shart').max(80).trim(),
  email:    z.string().email('Noto\'g\'ri email format').toLowerCase().trim(),
  password: z
    .string()
    .min(8, 'Parol kamida 8 ta belgi bo\'lishi kerak')
    .max(128, 'Parol juda uzun'),
});

const LoginSchema = z.object({
  email:    z.string().email().toLowerCase().trim(),
  password: z.string().min(1, 'Parol kiritish shart'),
});

// ── Helper: strip sensitive fields before sending user to client ─
function safeUser(user) {
  const { passwordHash: _pw, ...rest } = user;
  return rest;
}

// ── Helper: build the JWT payload ──────────────────────────────
function buildJwtPayload(user) {
  return {
    id:    user.id,
    email: user.email,
    name:  user.name,
  };
}

// ── Router ─────────────────────────────────────────────────────
export function authRouter(prisma) {
  const router = Router();

  // ──────────────────────────────────────────────────────────────
  // POST /api/auth/register
  // Body: { name, email, password }
  // ──────────────────────────────────────────────────────────────
  router.post('/register', async (req, res) => {
    // 1. Validate input
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      const errors = parsed.error.errors.map(e => e.message);
      return res.status(400).json({ ok: false, errors });
    }

    const { name, email, password } = parsed.data;

    try {
      // 2. Check if email is already taken
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return res.status(409).json({
          ok: false,
          error: 'Bu email allaqachon ro\'yxatdan o\'tgan',
        });
      }

      // 3. Hash the password (cost 12 ≈ 250ms — safe against brute force)
      const passwordHash = await bcrypt.hash(password, 12);

      // 4. Create user in DB
      const user = await prisma.user.create({
        data: { name, email, passwordHash },
      });

      // 5. Sign JWT
      const token = signJwt(buildJwtPayload(user));

      // 6. Respond
      return res.status(201).json({
        ok:    true,
        token,
        user:  safeUser(user),
      });

    } catch (err) {
      console.error('[auth/register] error:', err);
      return res.status(500).json({ ok: false, error: 'Ro\'yxatdan o\'tishda xatolik' });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // POST /api/auth/login
  // Body: { email, password }
  // ──────────────────────────────────────────────────────────────
  router.post('/login', async (req, res) => {
    // 1. Validate input
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      const errors = parsed.error.errors.map(e => e.message);
      return res.status(400).json({ ok: false, errors });
    }

    const { email, password } = parsed.data;

    try {
      // 2. Find user — always return same error for email OR password wrong
      //    (prevents email enumeration attacks)
      const user = await prisma.user.findUnique({ where: { email } });

      const INVALID = { ok: false, error: 'Email yoki parol noto\'g\'ri' };

      if (!user || !user.passwordHash) {
        // Run a dummy bcrypt compare to prevent timing attacks
        await bcrypt.compare(password, '$2b$12$invalidhashpaddingtopreventimingtim');
        return res.status(401).json(INVALID);
      }

      // 3. Compare password
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json(INVALID);
      }

      // 4. Sign JWT
      const token = signJwt(buildJwtPayload(user));

      // 5. Respond
      return res.json({
        ok:    true,
        token,
        user:  safeUser(user),
      });

    } catch (err) {
      console.error('[auth/login] error:', err);
      return res.status(500).json({ ok: false, error: 'Kirishda xatolik' });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // GET /api/auth/me
  // Header: Authorization: Bearer <token>
  // Returns the current authenticated user's profile
  // ──────────────────────────────────────────────────────────────
  router.get('/me', authRequired, async (req, res) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        include: {
          profile: true,   // UserProfile (name prefs, tone, energy)
          _count: {
            select: {
              messages: true,
              facts:    true,
            },
          },
        },
      });

      if (!user) {
        return res.status(404).json({ ok: false, error: 'Foydalanuvchi topilmadi' });
      }

      return res.json({
        ok:   true,
        user: {
          ...safeUser(user),
          stats: {
            messageCount: user._count.messages,
            factCount:    user._count.facts,
          },
        },
      });

    } catch (err) {
      console.error('[auth/me] error:', err);
      return res.status(500).json({ ok: false, error: 'Profil yuklanmadi' });
    }
  });

  // ──────────────────────────────────────────────────────────────
  // GET /api/auth/google
  // Redirects the browser to Google's OAuth consent screen.
  // Frontend: window.location.href = '/api/auth/google'
  // ──────────────────────────────────────────────────────────────
  router.get('/google', (req, res) => {
    const clientId    = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT;
    if (!clientId || !redirectUri) {
      return res.status(503).json({ ok: false, error: 'Google OAuth not configured' });
    }
    const params = new URLSearchParams({
      client_id:     clientId,
      redirect_uri:  redirectUri,
      response_type: 'code',
      scope:         'openid email profile',
      access_type:   'offline',
      prompt:        'select_account',
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  // ──────────────────────────────────────────────────────────────
  // GET /api/auth/google/callback   ← matches GOOGLE_REDIRECT in .env
  // Google redirects here after user approves. We:
  //   1. Exchange the auth code for tokens
  //   2. Fetch the user's Google profile (email, name, picture)
  //   3. Find the matching user (googleId first, email fallback) and
  //      create/update/link accordingly
  //   4. Sign a SHERZ JWT and redirect to the frontend with it as a query param
  // ──────────────────────────────────────────────────────────────
  router.get('/google/callback', async (req, res) => {
    const { code, error } = req.query;

    if (error || !code) {
      console.error('[google/callback] error from Google:', error);
      return res.redirect('/?auth_error=' + encodeURIComponent(error || 'no_code'));
    }

    const clientId     = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri  = process.env.GOOGLE_REDIRECT;

    try {
      // ── Step 1: Exchange code → access_token + id_token ──────
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id:     clientId,
          client_secret: clientSecret,
          redirect_uri:  redirectUri,
          grant_type:    'authorization_code',
        }),
      });
      const tokenData = await tokenRes.json();
      if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);

      // ── Step 2: Fetch Google user profile ────────────────────
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const profile = await profileRes.json();
      if (!profile.email) throw new Error('Google did not return an email address');

      // ── Step 3: Find existing user — googleId first, email as fallback ──
      // ✅ FIX: upsert() can only key on ONE unique field, so "try googleId,
      // fall back to email" has to be an explicit two-step lookup instead.
      // googleId is checked first because it's the stable identifier — this
      // is what makes a returning user match correctly even if their Google
      // account's email has changed since last login. The email lookup only
      // exists to LINK an existing email/password account the first time
      // that same person logs in via Google.
      let user = await prisma.user.findUnique({ where: { googleId: profile.sub } });

      if (!user) {
        user = await prisma.user.findUnique({ where: { email: profile.email } });
      }

      if (user) {
        // Existing user (found via either lookup) — refresh their googleId
        // (backfills it the first time an email/password user links Google;
        // no-op if already set) and sync their current name/email from Google.
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            googleId: profile.sub,
            name:     profile.name || user.name || profile.email.split('@')[0],
            email:    profile.email || user.email,
          },
        });
      } else {
        // Genuinely new user
        user = await prisma.user.create({
          data: {
            email:    profile.email,
            name:     profile.name || profile.email.split('@')[0],
            googleId: profile.sub,
            // passwordHash left null — Google users don't have a password
          },
        });
      }

      // ── Step 4: Sign SHERZ JWT ────────────────────────────────
      const token = signJwt({ id: user.id, email: user.email, name: user.name });

      // ── Step 5: Redirect to frontend with token ───────────────
      // The frontend catches ?token= on load and stores it in localStorage
      res.redirect(`/?token=${encodeURIComponent(token)}&name=${encodeURIComponent(user.name || '')}`);

    } catch (err) {
      console.error('[google/callback] error:', err.message);
      res.redirect('/?auth_error=' + encodeURIComponent(err.message));
    }
  });


  return router;
}
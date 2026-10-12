// lib/googleLogin.js
//
// POST /api/auth/google logic, free of Express/Google/JWT imports so it can be
// unit-tested: the ID-token verifier and signJwt are injected.

import { isGuestId, mergeGuestIntoUser } from './guestMerge.js';

/**
 * @param {object} p
 * @param {object} p.prisma
 * @param {(credential:string)=>Promise<{sub:string,email?:string,email_verified?:boolean,name?:string,picture?:string}>} p.verifyIdToken
 * @param {(payload:object)=>string} p.signJwt
 * @param {string} p.credential        Google ID token from Google Identity Services
 * @param {string|null} [p.guestId]    id of the CURRENT guest session (from its verified guest JWT), if any
 * @returns {Promise<{status:number, body:object}>}
 */
export async function googleLogin({ prisma, verifyIdToken, signJwt, credential, guestId = null }) {
  if (typeof credential !== 'string' || credential.length < 20 || credential.length > 4096) {
    return { status: 400, body: { ok: false, error: 'credential required' } };
  }

  let g;
  try {
    g = await verifyIdToken(credential); // checks signature, audience, expiry
  } catch {
    return { status: 401, body: { ok: false, error: 'Google token invalid' } };
  }

  const email = String(g?.email || '').toLowerCase().trim();
  if (!g?.sub || !email) return { status: 401, body: { ok: false, error: 'Google token missing identity' } };
  // Never trust an unverified email: it is what links accounts.
  if (g.email_verified !== true) return { status: 403, body: { ok: false, error: 'Google email not verified' } };

  let user = await prisma.user.findUnique({ where: { googleId: g.sub } });

  if (user) {
    // stable id matched: refresh only what is safe to refresh
    const data = {};
    if (g.picture && g.picture !== user.avatarUrl) data.avatarUrl = g.picture;
    if (!user.name && g.name) data.name = g.name;
    if (Object.keys(data).length) user = await prisma.user.update({ where: { id: user.id }, data });
  } else {
    const byEmail = await prisma.user.findUnique({ where: { email } });
    if (byEmail) {
      if (byEmail.googleId && byEmail.googleId !== g.sub) {
        return { status: 409, body: { ok: false, error: 'Email already linked to another Google account' } };
      }
      // Linking an existing email/password account. The password is cleared on link:
      // register has no email verification, so someone could have pre-registered this
      // address with a password they know ("pre-hijacking").
      user = await prisma.user.update({
        where: { id: byEmail.id },
        data: {
          googleId: g.sub,
          passwordHash: null,
          avatarUrl: g.picture || byEmail.avatarUrl,
          name: byEmail.name && byEmail.name !== 'Guest' ? byEmail.name : (g.name || email.split('@')[0]),
        },
      });
    } else {
      user = await prisma.user.create({
        data: { googleId: g.sub, email, name: g.name || email.split('@')[0], avatarUrl: g.picture || null },
      });
    }
  }

  // Merge the active guest session (chat + facts only). Failure must not block login.
  let merged = null;
  if (isGuestId(guestId)) {
    try {
      merged = await mergeGuestIntoUser(prisma, guestId, user.id);
    } catch (e) {
      console.error('[auth/google] guest merge failed:', e?.message || e);
      merged = { error: true };
    }
  }

  const token = signJwt({ id: user.id, email: user.email, name: user.name });
  const { passwordHash: _pw, ...safe } = user;
  return { status: 200, body: { ok: true, token, user: safe, merged } };
}

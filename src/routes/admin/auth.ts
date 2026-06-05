// src/routes/admin/auth.ts
// POST /api/admin/auth/login   — verify PIN, set cookie
// POST /api/admin/auth/logout  — clear cookie
// GET  /api/admin/auth/me      — return current PM user

import { Hono } from 'hono';
import { verifyPin } from '../../auth/pin.ts';
import { isLockedOut, recordAttempt } from '../../auth/lockout.ts';
import { signSession, SESSION_MAX_AGE_SECONDS } from '../../auth/session.ts';
import { getPmUserId } from '../../middleware/requirePm.ts';
import { logAudit } from '../../utils/audit.ts';
import type { Env } from '../../worker.ts';
import type { User } from '../../db/types.ts';

const auth = new Hono<{ Bindings: Env }>();

const COOKIE_NAME = 'pm_session';

function buildCookie(value: string, maxAgeSec: number, isHttps: boolean): string {
  // HttpOnly + SameSite=Strict + Path=/ + Max-Age
  // `Secure` is required in production (HTTPS) so the cookie is never sent over plaintext.
  // Wrangler dev is HTTP on localhost, so we leave it off there.
  const secure = isHttps ? '; Secure' : '';
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure}`;
}

function clearCookie(isHttps: boolean): string {
  const secure = isHttps ? '; Secure' : '';
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

/** Find the PM user (only one expected). */
async function findPmUser(db: D1Database): Promise<User | null> {
  const row = await db
    .prepare(
      `SELECT id, name, role, pin_hash, created_at, updated_at FROM users WHERE role = 'pm' LIMIT 1`,
    )
    .first<User>();
  return row ?? null;
}

auth.post('/login', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { pin?: unknown } | null;
  const pin = typeof body?.pin === 'string' ? body.pin : null;
  if (!pin || !/^\d{4,8}$/.test(pin)) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'pin must be 4-8 digits' } }, 400);
  }

  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? '0.0.0.0';
  const db = c.env.DB;

  if (await isLockedOut(db, ip)) {
    return c.json(
      { error: { code: 'TOO_MANY_ATTEMPTS', message: 'IP locked out. Try again in 5 minutes.' } },
      429,
    );
  }

  const pm = await findPmUser(db);
  if (!pm || !pm.pin_hash) {
    return c.json({ error: { code: 'NO_PM_USER', message: 'No PM user configured' } }, 500);
  }

  const secret = c.env.JWT_SECRET;
  if (!secret) {
    return c.json({ error: { code: 'SERVER_MISCONFIG', message: 'JWT_SECRET not set' } }, 500);
  }

  const ok = await verifyPin(pin, pm.pin_hash, secret);
  await recordAttempt(db, ip, ok);

  if (!ok) {
    await logAudit(db, { actor: 'pm', action: 'login_failed', target_user_id: pm.id, details: { ip } });
    return c.json({ error: { code: 'INVALID_PIN', message: 'Wrong PIN' } }, 401);
  }

  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const token = await signSession({ user_id: pm.id, exp }, secret);
  await logAudit(db, { actor: 'pm', action: 'login', target_user_id: pm.id, details: { ip } });

  const isHttps = new URL(c.req.url).protocol === 'https:';
  c.header('Set-Cookie', buildCookie(token, SESSION_MAX_AGE_SECONDS, isHttps), { append: true });
  return c.json({ user: { id: pm.id, name: pm.name, role: pm.role } });
});

auth.post('/logout', async (c) => {
  const uid = await getPmUserId(c);
  const isHttps = new URL(c.req.url).protocol === 'https:';
  c.header('Set-Cookie', clearCookie(isHttps), { append: true });
  if (uid != null) {
    await logAudit(c.env.DB, { actor: 'pm', action: 'logout', target_user_id: uid });
  }
  return c.json({ ok: true });
});

auth.get('/me', async (c) => {
  const uid = await getPmUserId(c);
  if (uid == null) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'No active session' } }, 401);
  }
  const pm = await findPmUser(c.env.DB);
  if (!pm || pm.id !== uid) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Session user not found' } }, 401);
  }
  return c.json({ id: pm.id, name: pm.name, role: pm.role });
});

export default auth;

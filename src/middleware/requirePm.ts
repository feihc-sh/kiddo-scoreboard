// src/middleware/requirePm.ts
// Hono middleware: verify pm_session cookie, attach user_id to context.
// Returns 401 if missing/invalid.

import type { Context, MiddlewareHandler } from 'hono';
import { parseSessionCookie, verifySession, type SessionPayload } from '../auth/session.ts';
import type { Env } from '../worker.ts';

type Vars = { pm?: SessionPayload };

/** Look up the PM user_id from the pm_session cookie. Caches on c.var.pm. */
export async function getPmUserId(c: Context): Promise<number | null> {
  const cached = (c as Context<{ Variables: Vars }>).get('pm') as SessionPayload | undefined;
  if (cached?.user_id) return cached.user_id;
  const cookieHeader = c.req.header('cookie') ?? null;
  const token = parseSessionCookie(cookieHeader);
  if (!token) return null;
  const env = c.env as Env;
  const secret = env.JWT_SECRET;
  if (!secret) return null;
  const payload = await verifySession(token, secret);
  if (!payload) return null;
  (c as Context<{ Variables: Vars }>).set('pm', payload);
  return payload.user_id;
}

/** Hono middleware: 401 unless a valid session is present. */
export const requirePm: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = async (c, next) => {
  const uid = await getPmUserId(c);
  if (uid == null) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'PM session required' } }, 401);
  }
  await next();
};

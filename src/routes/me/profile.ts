// src/routes/me/profile.ts
// Child-only first-time name setting. Once set, the name is permanent — a
// follow-up PATCH returns 409 ALREADY_SET.
//
//   PATCH /api/me/profile
//     Body: { name: string }   (1..20 chars after trim)
//     Effects (single db.batch() transaction):
//       1. UPDATE users SET name = ?, updated_at = unixepoch() WHERE id = ?
//       2. INSERT audit_log (actor='child', action='set_name',
//                           target_user_id=2, details={name})
//     Returns 200 with { id, name, is_first_time: false, updated_at }, or
//     400 / 404 / 409 with an error code.
//
// Auth: child user_id is HARDCODED to 2 (CHILD_USER_ID) to match
// seeds/local.sql and src/routes/me/tasks.ts. M5 will replace this with
// proper child auth (cookie/token from a kiddo login flow).

import { Hono } from 'hono';
import type { Env } from '../../worker.ts';
import type { User } from '../../db/types.ts';

/**
 * Hardcoded child user id. M5 will replace this with a real auth lookup.
 * Must match the id inserted by seeds/local.sql.
 */
const CHILD_USER_ID = 2;

const MAX_NAME_LENGTH = 20;

const profile = new Hono<{ Bindings: Env }>();

profile.patch('/', async (c) => {
  // 1. Parse + validate body. Missing / unparseable / non-object bodies all
  //    collapse to BAD_REQUEST so the client gets a single consistent error
  //    code for any malformed input.
  let body: { name?: unknown };
  try {
    const parsed: unknown = await c.req.json();
    if (parsed === null || parsed === undefined || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return c.json(
        { error: { code: 'BAD_REQUEST', message: 'request body must be a JSON object' } },
        400,
      );
    }
    body = parsed as { name?: unknown };
  } catch {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'request body must be valid JSON' } },
      400,
    );
  }

  const { name } = body;
  if (typeof name !== 'string') {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'name must be a string' } },
      400,
    );
  }

  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'name cannot be empty or whitespace' } },
      400,
    );
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: `name cannot exceed ${MAX_NAME_LENGTH} characters` } },
      400,
    );
  }

  const db = c.env.DB;

  // 2. Load user. 404 if the hardcoded child id is missing.
  const user = await db
    .prepare(`SELECT id, name, role, pin_hash, created_at, updated_at FROM users WHERE id = ?`)
    .bind(CHILD_USER_ID)
    .first<User>();
  if (!user) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'user not found' } },
      404,
    );
  }

  // 3. Refuse if the name was already set. The child's name is permanent.
  if (user.name.trim() !== '') {
    return c.json(
      { error: { code: 'ALREADY_SET', message: 'name is already set and cannot be changed' } },
      409,
    );
  }

  // 4. Atomic write: UPDATE users + INSERT audit_log in one batch so the
  //    audit row is never written without the name change (and vice versa).
  const detailsJson = JSON.stringify({ name: trimmed });

  await db.batch([
    db
      .prepare(`UPDATE users SET name = ?, updated_at = unixepoch() WHERE id = ?`)
      .bind(trimmed, CHILD_USER_ID),
    db
      .prepare(
        `INSERT INTO audit_log
           (actor, action, target_event_id, target_user_id, details, created_at)
         VALUES ('child', 'set_name', NULL, ?, ?, unixepoch())`,
      )
      .bind(CHILD_USER_ID, detailsJson),
  ]);

  // 5. Re-read so the response carries the actual updated_at written by D1's
  //    unixepoch() — `unixepoch()` can drift from `Date.now()` if the host
  //    clocks disagree, so we trust the DB.
  const updated = await db
    .prepare(`SELECT id, name, updated_at FROM users WHERE id = ?`)
    .bind(CHILD_USER_ID)
    .first<{ id: number; name: string; updated_at: number }>();

  return c.json({
    id: updated?.id ?? CHILD_USER_ID,
    name: updated?.name ?? trimmed,
    is_first_time: false,
    updated_at: updated?.updated_at ?? 0,
  });
});

export default profile;

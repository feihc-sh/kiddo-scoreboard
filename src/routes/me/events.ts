// src/routes/me/events.ts
// Child-only event-submission endpoint (currently unauthenticated — child user_id
// is HARDCODED to 2 to match seeds/local.sql. M5 will replace this with proper
// child auth, e.g. a cookie or token issued by a kiddo login flow).
//
//   POST /api/me/events
//     Body: { type, change_value, reason }
//     Effect: insert a 'pending' score_event (child-submitted, manual). Pending
//     events do NOT count toward the balance — they wait for PM approval.
//     Writes (single db.batch() transaction):
//       1. INSERT score_event (status='pending', source='manual', week_of=now)
//       2. INSERT audit_log (action='submit_event', actor='child')
//     Returns 201 with { id, status: 'pending', created_at }.

import { Hono } from 'hono';
import type { Env } from '../../worker.ts';
import { currentWeek, nowUnix } from '../../utils/week.ts';

const events = new Hono<{ Bindings: Env }>();

/**
 * Hardcoded child user id. M5 will replace this with a real auth lookup.
 * Must match the id inserted by seeds/local.sql.
 */
const CHILD_USER_ID = 2;

const VALID_TYPES = new Set<string>(['game_time', 'pocket_money', 'coins']);

events.post('/', async (c) => {
  // 1. Parse JSON body — null means missing / malformed.
  const body = (await c.req.json().catch(() => null)) as
    | { type?: unknown; change_value?: unknown; reason?: unknown }
    | null;
  if (!body || typeof body !== 'object') {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'request body must be a JSON object' } },
      400,
    );
  }

  // 2. Validate `type`.
  const type = body.type;
  if (typeof type !== 'string' || !VALID_TYPES.has(type)) {
    return c.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message: 'type must be "game_time", "pocket_money", or "coins"',
        },
      },
      400,
    );
  }

  // 3. Validate `change_value`: must be a non-zero integer.
  //    typeof check rejects strings like "5"; Number.isInteger rejects floats
  //    and NaN/Infinity; the === 0 check rejects no-op submissions.
  const changeValue = body.change_value;
  if (typeof changeValue !== 'number' || !Number.isInteger(changeValue)) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'change_value must be an integer' } },
      400,
    );
  }
  if (changeValue === 0) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'change_value must not be zero' } },
      400,
    );
  }

  // 4. Validate `reason`: non-empty after trimming whitespace.
  const reason = body.reason;
  if (typeof reason !== 'string' || reason.trim() === '') {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'reason must be a non-empty string' } },
      400,
    );
  }

  const db = c.env.DB;
  const createdAt = nowUnix();
  const weekOf = currentWeek();
  const detailsJson = JSON.stringify({
    type,
    change_value: changeValue,
    reason,
  });

  // 5. Atomic write: pending score_event + audit_log in one batch.
  //    SQLite/D1's `last_insert_rowid()` returns the rowid of the most recent
  //    insert on the same connection, so the audit row can reference the
  //    score_event just inserted in the previous batch statement.
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO score_events
           (user_id, type, change_value, reason, status,
            submitted_by, source, source_ref, week_of, created_at)
         VALUES (?, ?, ?, ?, 'pending', 'child', 'manual', NULL, ?, unixepoch())`,
      )
      .bind(CHILD_USER_ID, type, changeValue, reason, weekOf),
    db
      .prepare(
        `INSERT INTO audit_log
           (actor, action, target_event_id, target_user_id, details, created_at)
         VALUES ('child', 'submit_event', last_insert_rowid(), ?, ?, unixepoch())`,
      )
      .bind(CHILD_USER_ID, detailsJson),
  ]);

  // The score_events insert is the 1st statement (index 0).
  const eventId = Number(results[0]?.meta?.last_row_id ?? 0);

  return c.json({ id: eventId, status: 'pending', created_at: createdAt }, 201);
});

export default events;

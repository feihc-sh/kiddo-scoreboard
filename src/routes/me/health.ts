// src/routes/me/health.ts
// Module 8 (Health Check-in, RFC §4.2.2 + §4.2.5) — child-facing health check-in.
//   POST  /api/me/health/events
//     Auth: child user (HARDCODED to id=2 to match seeds/local.sql).
//           M5 will replace this with real child auth (cookie/session).
//     Body: { event_type (req), start_date (opt, default=today SH),
//             note (opt) }
//     Effect: atomic INSERT health_events + INSERT audit_log
//             (action='health_event_create', actor='child').
//   PATCH /api/me/health/events/:id/resolve   [§4.2.5]
//     Auth: child user (HARDCODED to id=2). Children can resolve THEIR
//           OWN events only (resolved_by = CHILD_USER_ID). The PM-facing
//           route /api/admin/health/events/:id/resolve (§4.2.4) stays
//           PM-only and can resolve any user's event.
//     Body: { end_date (req, 'YYYY-MM-DD', >= existing start_date) }
//     Effect: atomic UPDATE health_events + INSERT audit_log
//             (action='health_event_resolve', actor='child').
//     403 if event.user_id !== CHILD_USER_ID (cross-child attempt).
// Mounted at /api/me/health by src/worker.ts.

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../../worker.ts';
import {
  createEvent,
  endDateNotBeforeStart,
  isValidDateString,
  isValidHealthEventType,
  HEALTH_EVENT_TYPES,
  todayShanghai,
  resolveEvent,
  deleteEvent,
} from '../../utils/health-events.ts';

const meHealth = new Hono<{ Bindings: Env }>();

/**
 * Hardcoded child user id. Matches seeds/local.sql (id=2, role='child').
 * M5 will replace this with a real auth lookup (mirrors src/routes/me/events.ts).
 */
const CHILD_USER_ID = 2;

meHealth.post('/events', async (c) => {
  // 1. Parse JSON body.
  const body = (await c.req.json().catch(() => null)) as
    | { event_type?: unknown; start_date?: unknown; note?: unknown }
    | null;
  if (!body || typeof body !== 'object') {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'request body must be a JSON object' } },
      400,
    );
  }

  // 2. Validate event_type ∈ 8 hardcoded.
  const eventType = body.event_type;
  if (typeof eventType !== 'string' || !isValidHealthEventType(eventType)) {
    return c.json(
      {
        error: {
          code: 'INVALID_EVENT_TYPE',
          message: `event_type must be one of: ${HEALTH_EVENT_TYPES.join(', ')}`,
        },
      },
      400,
    );
  }

  // 3. start_date optional, default = today (Asia/Shanghai). Validate if present.
  let startDate: string;
  if (body.start_date === undefined || body.start_date === null) {
    startDate = todayShanghai();
  } else if (typeof body.start_date !== 'string' || !isValidDateString(body.start_date)) {
    return c.json(
      {
        error: {
          code: 'INVALID_DATE_FORMAT',
          message: "start_date must be 'YYYY-MM-DD'",
        },
      },
      400,
    );
  } else {
    startDate = body.start_date;
  }

  // 4. note optional; trimmed string or null. Empty string → null.
  let note: string | null = null;
  if (typeof body.note === 'string') {
    const trimmed = body.note.trim();
    if (trimmed !== '') note = trimmed;
  }

  // 5. Atomic create: health_events + audit_log via db.batch().
  const event = await createEvent(c.env.DB, {
    userId: CHILD_USER_ID,
    eventType,
    startDate,
    note,
    submittedBy: 'child',
  });

  return c.json(event, 201);
});

// ---------------- PATCH /events/:id/resolve (§4.2.5) ----------------
// Children can resolve their OWN active event with this route. Mirrors
// the PM-facing admin/health.ts route but:
//   - actor='child' in audit_log
//   - resolved_by = CHILD_USER_ID (the child themselves)
//   - 403 if the event belongs to a different user (defense-in-depth;
//     in v1 with single-child seed this never fires, but locks down
//     the boundary so M5 (multi-user) doesn't accidentally let child A
//     resolve child B's events).
//
// Request/response/error shapes match the PM route exactly so the
// frontend can switch endpoints with a one-line URL change.

meHealth.patch('/events/:id/resolve', async (c: Context<{ Bindings: Env }>) => {
  // 1. Parse :id.
  const idRaw = c.req.param('id');
  const id = (() => {
    if (!idRaw) return null;
    const n = Number(idRaw);
    if (!Number.isInteger(n) || n <= 0) return null;
    return n;
  })();
  if (id == null) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'id must be a positive integer' } },
      400,
    );
  }

  // 2. Parse JSON body.
  const body = (await c.req.json().catch(() => null)) as
    | { end_date?: unknown }
    | null;
  if (!body || typeof body !== 'object') {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'request body must be a JSON object' } },
      400,
    );
  }

  // 3. Validate end_date.
  const endDate = body.end_date;
  if (typeof endDate !== 'string' || !isValidDateString(endDate)) {
    return c.json(
      {
        error: {
          code: 'INVALID_DATE_FORMAT',
          message: "end_date must be 'YYYY-MM-DD'",
        },
      },
      400,
    );
  }

  // 4. Pre-check: event exists, owned by this child, not already resolved,
  //    and end_date >= start_date.
  const db = c.env.DB;
  const existing = await db
    .prepare(
      `SELECT id, user_id, start_date, end_date, is_resolved
       FROM health_events WHERE id = ?`,
    )
    .bind(id)
    .first<{
      id: number;
      user_id: number;
      start_date: string;
      end_date: string | null;
      is_resolved: number;
    }>();

  if (!existing) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'health event not found' } },
      404,
    );
  }
  if (existing.user_id !== CHILD_USER_ID) {
    return c.json(
      {
        error: {
          code: 'FORBIDDEN',
          message: 'children can only resolve their own events',
        },
      },
      403,
    );
  }
  if (existing.is_resolved === 1) {
    return c.json(
      {
        error: {
          code: 'ALREADY_RESOLVED',
          message: 'event is already resolved',
        },
      },
      409,
    );
  }
  if (!endDateNotBeforeStart(endDate, existing.start_date)) {
    return c.json(
      {
        error: {
          code: 'INVALID_DATE',
          message: `end_date (${endDate}) must be on or after start_date (${existing.start_date})`,
        },
      },
      400,
    );
  }

  // 5. Atomic resolve as child.
  const updated = await resolveEvent(db, {
    id,
    userId: existing.user_id,
    endDate,
    resolvedBy: CHILD_USER_ID,
    submittedBy: 'child',
  });

  if (!updated) {
    return c.json(
      {
        error: {
          code: 'CONCURRENT_RESOLVE',
          message: 'event was resolved by another request',
        },
      },
      409,
    );
  }

  return c.json(updated, 200);
});

// ---------------- DELETE /events/:id (§4.2.7) ----------------
// Children can hard-delete their OWN events. Mirrors the PATCH resolve
// route's auth pattern (hardcoded CHILD_USER_ID + ownership check).
//   - 403 if event.user_id !== CHILD_USER_ID (cross-child)
//   - 404 if event not found
//   - 200 with snapshot on success
//
// Request: no body.
// Response 200: { ok: true, deleted_event: <snapshot> }

meHealth.delete('/events/:id', async (c: Context<{ Bindings: Env }>) => {
  // 1. Parse :id.
  const idRaw = c.req.param('id');
  const id = (() => {
    if (!idRaw) return null;
    const n = Number(idRaw);
    if (!Number.isInteger(n) || n <= 0) return null;
    return n;
  })();
  if (id == null) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'id must be a positive integer' } },
      400,
    );
  }

  // 2. Pre-check: event exists AND owned by this child.
  const db = c.env.DB;
  const existing = await db
    .prepare(`SELECT user_id FROM health_events WHERE id = ?`)
    .bind(id)
    .first<{ user_id: number }>();
  if (!existing) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'health event not found' } },
      404,
    );
  }
  if (existing.user_id !== CHILD_USER_ID) {
    return c.json(
      {
        error: {
          code: 'FORBIDDEN',
          message: 'children can only delete their own events',
        },
      },
      403,
    );
  }

  // 3. Atomic delete as child.
  const deleted = await deleteEvent(db, {
    id,
    userId: existing.user_id,
    deletedBy: CHILD_USER_ID,
    submittedBy: 'child',
  });

  if (!deleted) {
    return c.json(
      {
        error: {
          code: 'CONCURRENT_DELETE',
          message: 'event was deleted by another request',
        },
      },
      409,
    );
  }

  return c.json({ ok: true, deleted_event: deleted }, 200);
});

export default meHealth;

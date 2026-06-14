// src/routes/admin/health.ts
// Module 8 (Health Check-in, RFC §4.2.3 + §4.2.4) — PM-facing endpoints.
//   POST  /api/admin/health/events
//     Auth: PM session via getPmUserId(c).
//     Body: { user_id (req), event_type (req), start_date (opt),
//             note (opt) }
//     Effect: atomic INSERT health_events + INSERT audit_log
//             (action='health_event_create', actor='pm').
//   PATCH /api/admin/health/events/:id/resolve
//     Auth: PM session via getPmUserId(c).
//     Body: { end_date (req, 'YYYY-MM-DD', >= existing start_date) }
//     Effect: atomic UPDATE health_events + INSERT audit_log
//             (action='health_event_resolve', actor='pm').
// Mounted at /api/admin/health by src/worker.ts.
//
// Note: these endpoints do NOT use the admin/index.ts requirePm guard —
// they mount directly under /api/admin/health so they're isolated from
// the existing /api/admin/* routes. Auth is checked per-handler via
// getPmUserId(c) (same pattern as src/routes/admin/events.ts).

import { Hono } from 'hono';
import type { Context } from 'hono';
import { getPmUserId } from '../../middleware/requirePm.ts';
import {
  createEvent,
  endDateNotBeforeStart,
  isValidDateString,
  isValidHealthEventType,
  HEALTH_EVENT_TYPES,
  todayShanghai,
  resolveEvent,
} from '../../utils/health-events.ts';
import type { Env } from '../../worker.ts';

const adminHealth = new Hono<{ Bindings: Env }>();

function unauthorized(c: Context<{ Bindings: Env }>) {
  return c.json(
    { error: { code: 'UNAUTHORIZED', message: 'PM session required' } },
    401,
  );
}

function badId(idRaw: string | undefined): number | null {
  if (!idRaw) return null;
  const n = Number(idRaw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

// ---------------- POST /events ----------------

adminHealth.post('/events', async (c) => {
  const pmUserId = await getPmUserId(c);
  if (pmUserId == null) return unauthorized(c);

  // 1. Parse JSON body.
  const body = (await c.req.json().catch(() => null)) as
    | {
        user_id?: unknown;
        event_type?: unknown;
        start_date?: unknown;
        note?: unknown;
      }
    | null;
  if (!body || typeof body !== 'object') {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'request body must be a JSON object' } },
      400,
    );
  }

  // 2. Validate user_id (PM records events for any child).
  const userId = Number(body.user_id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return c.json(
      {
        error: {
          code: 'MISSING_USER_ID',
          message: 'user_id is required and must be a positive integer',
        },
      },
      400,
    );
  }

  // 3. Validate event_type.
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

  // 4. start_date optional, default = today (Asia/Shanghai).
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

  // 5. note optional.
  let note: string | null = null;
  if (typeof body.note === 'string') {
    const trimmed = body.note.trim();
    if (trimmed !== '') note = trimmed;
  }

  // 6. Atomic create.
  const event = await createEvent(c.env.DB, {
    userId,
    eventType,
    startDate,
    note,
    submittedBy: 'pm',
  });

  return c.json(event, 201);
});

// ---------------- PATCH /events/:id/resolve ----------------

adminHealth.patch('/events/:id/resolve', async (c) => {
  const pmUserId = await getPmUserId(c);
  if (pmUserId == null) return unauthorized(c);

  const id = badId(c.req.param('id'));
  if (id == null) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'id must be a positive integer' } },
      400,
    );
  }

  // 1. Parse JSON body.
  const body = (await c.req.json().catch(() => null)) as
    | { end_date?: unknown }
    | null;
  if (!body || typeof body !== 'object') {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'request body must be a JSON object' } },
      400,
    );
  }

  // 2. Validate end_date.
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

  // 3. Pre-check: event must exist AND not already resolved AND
  //    end_date >= start_date. We do this via a SELECT so we can return
  //    precise 404 / 409 / 400 codes (the helper's atomic UPDATE would
  //    return null on all three without distinguishing).
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
  console.log('DEBUG PATCH existing:', JSON.stringify(existing));
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
  console.log('DEBUG endDateNotBeforeStart:', endDate, '>=', existing.start_date);
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

  // 4. Atomic resolve.
  const updated = await resolveEvent(db, {
    id,
    userId: existing.user_id,
    endDate,
    pmUserId,
  });

  // resolveEvent returns null only if the WHERE clause matched 0 rows —
  // i.e. someone else resolved it between our SELECT and the UPDATE.
  // Treat as 409 (concurrent resolve) — caller can retry.
  console.log('DEBUG updated:', JSON.stringify(updated));
  if (!updated) {
    return c.json(
      {
        error: {
          code: 'ALREADY_RESOLVED',
          message: 'event was resolved by another request',
        },
      },
      409,
    );
  }

  return c.json(updated, 200);
});

export default adminHealth;

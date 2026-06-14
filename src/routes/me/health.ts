// src/routes/me/health.ts
// Module 8 (Health Check-in, RFC §4.2.2) — child-facing health check-in.
//   POST /api/me/health/events
//     Auth: child user (HARDCODED to id=2 to match seeds/local.sql).
//           M5 will replace this with real child auth (cookie/session).
//     Body: { event_type (req), start_date (opt, default=today SH),
//             note (opt) }
//     Effect: atomic INSERT health_events + INSERT audit_log
//             (action='health_event_create', actor='child').
// Mounted at /api/me/health by src/worker.ts.

import { Hono } from 'hono';
import type { Env } from '../../worker.ts';
import {
  createEvent,
  isValidDateString,
  isValidHealthEventType,
  HEALTH_EVENT_TYPES,
  todayShanghai,
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

export default meHealth;

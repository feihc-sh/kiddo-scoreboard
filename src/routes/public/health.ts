// src/routes/public/health.ts
// Module 8 (Health Check-in, RFC §4.2.1) — read-only public endpoint.
//   GET /api/public/health/events
//     Query: user_id (req), event_type (opt), month (opt, 'YYYY-MM'),
//            active_only (opt, default 'false')
//     Used by: month-calendar render (M2) + resume-UX active check (M3).
// Mounted at /api/public/health by src/worker.ts. No auth required.

import { Hono } from 'hono';
import type { Env } from '../../worker.ts';
import type { HealthEventType } from '../../db/types.ts';
import {
  HEALTH_EVENT_TYPES,
  isValidHealthEventType,
  listEventsActive,
  listEventsByMonth,
} from '../../utils/health-events.ts';

const publicHealth = new Hono<{ Bindings: Env }>();

publicHealth.get('/events', async (c) => {
  // 1. user_id is required.
  const userIdStr = c.req.query('user_id');
  if (!userIdStr) {
    return c.json(
      { error: { code: 'MISSING_USER_ID', message: 'user_id is required' } },
      400,
    );
  }
  const userId = Number(userIdStr);
  if (!Number.isInteger(userId) || userId <= 0) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'user_id must be a positive integer' } },
      400,
    );
  }

  // 2. event_type is optional; if present must be one of 8 hardcoded.
  const eventTypeParam = c.req.query('event_type');
  let eventType: HealthEventType | null = null;
  if (eventTypeParam) {
    if (!isValidHealthEventType(eventTypeParam)) {
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
    eventType = eventTypeParam;
  }

  // 3. month is optional 'YYYY-MM'.
  const monthParam = c.req.query('month');
  if (monthParam && !/^\d{4}-\d{2}$/.test(monthParam)) {
    return c.json(
      { error: { code: 'INVALID_DATE_FORMAT', message: "month must be 'YYYY-MM'" } },
      400,
    );
  }
  const month: string | null = monthParam ?? null;

  // 4. active_only default 'false'. Used by resume-UX flow (RFC §4.2.1).
  const activeOnly = c.req.query('active_only') === 'true';

  // 5. Dispatch: active_only short-circuits to the active-list helper.
  const events = activeOnly
    ? await listEventsActive(c.env.DB, userId, eventType)
    : await listEventsByMonth(c.env.DB, userId, eventType, month);

  return c.json({ events });
});

export default publicHealth;

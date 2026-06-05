// src/routes/public/events.ts
// Read-only endpoints for score events.
//   GET /api/public/events           — list events for a user (filterable)
//   GET /api/public/events/:id       — single event detail
// Mounted at /api/public/events by src/worker.ts. No auth required (public).

import { Hono } from 'hono';
import type { Env } from '../../worker.ts';
import type { ScoreEvent } from '../../db/types.ts';

const events = new Hono<{ Bindings: Env }>();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const SELECT_COLUMNS =
  'id, user_id, type, change_value, reason, status, submitted_by, source, ' +
  'source_ref, reviewed_by, reviewed_at, week_of, created_at';

events.get('/', async (c) => {
  const userIdStr = c.req.query('user_id');
  if (!userIdStr) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'user_id is required' } },
      400,
    );
  }
  const userId = Number(userIdStr);
  if (Number.isNaN(userId)) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'user_id must be a number' } },
      400,
    );
  }

  // Status filter: explicit only. No default = return all statuses.
  // (The child UI needs to see their own pending/rejected/revoked events.)
  const status = c.req.query('status');
  const type = c.req.query('type');

  // Limit: default 50, clamp to [1, 200].
  const limitParam = Number(c.req.query('limit') ?? String(DEFAULT_LIMIT));
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.isFinite(limitParam) ? limitParam : DEFAULT_LIMIT),
  );

  // Build WHERE clause dynamically.
  const conditions: string[] = ['user_id = ?'];
  const whereParams: unknown[] = [userId];
  if (status) {
    conditions.push('status = ?');
    whereParams.push(status);
  }
  if (type) {
    conditions.push('type = ?');
    whereParams.push(type);
  }
  const whereClause = conditions.join(' AND ');

  const db = c.env.DB;

  const listStmt = db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM score_events ` +
        `WHERE ${whereClause} ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(...whereParams, limit);
  const countStmt = db
    .prepare(`SELECT COUNT(*) AS n FROM score_events WHERE ${whereClause}`)
    .bind(...whereParams);

  const [rowsResult, countRow] = await Promise.all([
    listStmt.all<ScoreEvent>(),
    countStmt.first<{ n: number }>(),
  ]);

  return c.json({
    events: rowsResult.results ?? [],
    total: countRow?.n ?? 0,
  });
});

events.get('/:id', async (c) => {
  const idStr = c.req.param('id');
  const id = Number(idStr);
  if (Number.isNaN(id)) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'id must be a number' } },
      400,
    );
  }

  const row = await c.env.DB
    .prepare(`SELECT ${SELECT_COLUMNS} FROM score_events WHERE id = ?`)
    .bind(id)
    .first<ScoreEvent>();
  if (!row) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'event not found' } },
      404,
    );
  }

  return c.json(row);
});

export default events;

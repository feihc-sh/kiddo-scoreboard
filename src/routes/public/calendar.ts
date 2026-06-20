// src/routes/public/calendar.ts
// GET /api/public/calendar/checkins?child_id=X&year=Y&month=M
// Returns { checkins: { "2026-06-15": 3, "2026-06-16": 1, ... } }
// Groups task_completions by child_id + DATE(completed_at) for the given month.

import { Hono } from 'hono';
import type { Env } from '../../worker.ts';

const calendar = new Hono<{ Bindings: Env }>();

calendar.get('/checkins', async (c) => {
  const childIdStr = c.req.query('child_id') || c.req.query('child');
  const yearStr = c.req.query('year');
  const monthStr = c.req.query('month');

  if (!childIdStr || !yearStr || !monthStr) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'child_id, year, month required' } },
      400,
    );
  }

  const year = parseInt(yearStr);
  const month = parseInt(monthStr);

  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'year must be valid, month must be 1-12' } },
      400,
    );
  }

  const childId = Number(childIdStr);
  if (!Number.isInteger(childId) || childId <= 0) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'child_id must be a positive integer' } },
      400,
    );
  }

  // completed_at is INTEGER unix seconds; use 'unixepoch' modifier for DATE().
  // Range is [start-of-month, start-of-next-month) to include all of the target month.
  const startTs = Math.floor(Date.UTC(year, month - 1, 1) / 1000);
  const endTs = Math.floor(Date.UTC(year, month, 1) / 1000); // start of next month

  const result = await c.env.DB.prepare(`
    SELECT DATE(completed_at, 'unixepoch') as date_str, COUNT(*) as cnt
    FROM task_completions
    WHERE user_id = ? AND completed_at >= ? AND completed_at < ?
    GROUP BY date_str
  `).bind(childId, startTs, endTs).all();

  const checkins: Record<string, number> = {};
  for (const row of (result.results || [])) {
    checkins[row.date_str as string] = Number(row.cnt);
  }

  return c.json({ checkins });
});

export default calendar;

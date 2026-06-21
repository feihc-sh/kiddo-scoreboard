// src/routes/public/calendar.ts
// GET /api/public/calendar/checkins?child_id=X&year=Y&month=M[&task_ids=1,3]
// Returns { checkins: { "2026-06-15": [{task_id, task_icon, task_name, count}, ...], ... } }
// Groups task_completions by child_id + DATE(completed_at) + task_id for the given month.
// When task_ids is provided, filters to only those tasks (invalid ids silently filtered).

import { Hono } from 'hono';
import type { Env } from '../../worker.ts';

const calendar = new Hono<{ Bindings: Env }>();

interface CheckinRow {
  date_str: string;
  task_id: number;
  task_icon: string | null;
  task_name: string;
  cnt: number;
}

calendar.get('/checkins', async (c) => {
  const childIdStr = c.req.query('child_id') || c.req.query('child');
  const yearStr = c.req.query('year');
  const monthStr = c.req.query('month');
  const taskIdsRaw = c.req.query('task_ids');

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

  // Parse task_ids: comma-separated integer list. Invalid values silently dropped.
  let taskIdFilter: number[] | undefined;
  if (taskIdsRaw && taskIdsRaw.trim() !== '') {
    const parsed = taskIdsRaw
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (parsed.length > 0) {
      taskIdFilter = parsed;
    }
  }

  let query: string;
  let bindParams: (string | number)[];

  if (taskIdFilter) {
    const placeholders = taskIdFilter.map(() => '?').join(', ');
    query = `
      SELECT
        DATE(tc.completed_at, 'unixepoch') AS date_str,
        tc.task_id                         AS task_id,
        t.icon                             AS task_icon,
        t.name                             AS task_name,
        COUNT(*)                           AS cnt
      FROM task_completions tc
      JOIN tasks t ON t.id = tc.task_id
      WHERE tc.user_id = ?
        AND tc.completed_at >= ?
        AND tc.completed_at < ?
        AND tc.status = 'active'
        AND tc.task_id IN (${placeholders})
      GROUP BY date_str, tc.task_id, t.icon, t.name
      ORDER BY date_str, tc.task_id
    `;
    bindParams = [childId, startTs, endTs, ...taskIdFilter];
  } else {
    query = `
      SELECT
        DATE(tc.completed_at, 'unixepoch') AS date_str,
        tc.task_id                         AS task_id,
        t.icon                             AS task_icon,
        t.name                             AS task_name,
        COUNT(*)                           AS cnt
      FROM task_completions tc
      JOIN tasks t ON t.id = tc.task_id
      WHERE tc.user_id = ?
        AND tc.completed_at >= ?
        AND tc.completed_at < ?
        AND tc.status = 'active'
      GROUP BY date_str, tc.task_id, t.icon, t.name
      ORDER BY date_str, tc.task_id
    `;
    bindParams = [childId, startTs, endTs];
  }

  const result = await c.env.DB.prepare(query).bind(...bindParams).all<CheckinRow>();

  const checkins: Record<string, { task_id: number; task_icon: string | null; task_name: string; count: number }[]> = {};
  for (const row of (result.results || [])) {
    const dateStr = row.date_str;
    if (!checkins[dateStr]) {
      checkins[dateStr] = [];
    }
    checkins[dateStr].push({
      task_id: row.task_id,
      task_icon: row.task_icon,
      task_name: row.task_name,
      count: Number(row.cnt),
    });
  }

  return c.json({ checkins });
});

export default calendar;

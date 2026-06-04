// src/routes/public/tasks.ts
// Read-only task list and today's completion status.
//   GET /api/public/tasks                   — list all tasks (optionally ?active=true)
//   GET /api/public/tasks/today-status      — completed_task_ids + today for a user
// Mounted at /api/public/tasks by src/worker.ts. No auth required (public).

import { Hono } from 'hono';
import type { Env } from '../../worker.ts';
import type { Task } from '../../db/types.ts';
import { todayShanghai } from '../../utils/week.ts';

const tasks = new Hono<{ Bindings: Env }>();

const TASK_COLUMNS =
  'id, name, token_reward, target_account, icon, category, ' +
  'is_active, sort_order, created_at, updated_at';

tasks.get('/', async (c) => {
  const userId = c.req.query('user_id');
  if (!userId) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'user_id is required' } },
      400,
    );
  }

  const activeFlag = c.req.query('active');
  const db = c.env.DB;
  const whereClause = activeFlag === 'true' ? 'WHERE is_active = ?' : '';
  const stmt = db
    .prepare(
      `SELECT ${TASK_COLUMNS} FROM tasks ${whereClause} ` +
        `ORDER BY sort_order ASC, id ASC`,
    );
  const bound = activeFlag === 'true' ? stmt.bind(1) : stmt.bind();
  const rows = await bound.all<Task>();

  return c.json({ tasks: rows.results ?? [] });
});

tasks.get('/today-status', async (c) => {
  const userIdStr = c.req.query('user_id');
  if (!userIdStr) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'user_id is required' } },
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

  const today = todayShanghai();
  const rows = await c.env.DB
    .prepare(
      `SELECT task_id FROM task_completions ` +
        `WHERE user_id = ? AND status = 'active' AND completed_date = ?`,
    )
    .bind(userId, today)
    .all<{ task_id: number }>();

  const completed_task_ids = (rows.results ?? []).map((r) => r.task_id);
  return c.json({ completed_task_ids, today });
});

export default tasks;

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
  'is_active, sort_order, cutoff_time, is_self_lockout, ' +
  'created_at, updated_at';

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
  // §3.11 toggle: also return tasks the child has already revoked today,
  // so the page remembers the disabled state across reloads.
  const [activeRows, revokedRows] = await Promise.all([
    c.env.DB
      .prepare(
        `SELECT task_id FROM task_completions
         WHERE user_id = ? AND status = 'active' AND completed_date = ?`,
      )
      .bind(userId, today)
      .all<{ task_id: number }>(),
    c.env.DB
      .prepare(
        `SELECT task_id FROM task_completions
         WHERE user_id = ? AND status = 'revoked' AND completed_date = ?`,
      )
      .bind(userId, today)
      .all<{ task_id: number }>(),
  ]);

  const completed_task_ids = (activeRows.results ?? []).map((r) => r.task_id);
  const uncompleted_today_ids = (revokedRows.results ?? []).map((r) => r.task_id);
  return c.json({ completed_task_ids, uncompleted_today_ids, today });
});

// §3 Progress bars (Item #005):
//   GET /api/public/tasks/progress?user_id=N
//   Returns the 3 progress numbers the child UI needs for the top-of-page bars.
//   No auth required (public, child only sees their own).
//
//   Response:
//     {
//       daily:   { completed: <int>, total: <int> },
//       monthly: { completed: <int>, target: <int> },
//       yearly:  { completed: <int>, target: <int> }
//     }
//
//   Note: monthly/yearly counters "reset" lazily on read (we filter by SH
//   calendar date window) — no cron trigger needed. Once the date rolls over,
//   the counts automatically reflect only the new month/year.
const DEFAULT_MONTHLY_TARGET = 100;
const DEFAULT_YEARLY_TARGET = 1200;

tasks.get('/progress', async (c) => {
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

  const db = c.env.DB;
  const today = todayShanghai();  // 'YYYY-MM-DD' in Asia/Shanghai
  const [yyyy, mm] = today.split('-');
  const monthStart = `${yyyy}-${mm}-01`;  // first day of current month
  const yearStart = `${yyyy}-01-01`;      // first day of current year

  // task_completions.completed_date is stored as 'YYYY-MM-DD' in Shanghai tz,
  // so a string range filter on completed_date gives the right SH-day window.
  const [dailyCompleted, monthlyCompleted, yearlyCompleted, activeTasks, cfg] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM task_completions
         WHERE user_id = ? AND status = 'active' AND completed_date = ?`,
      )
      .bind(userId, today)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM task_completions
         WHERE user_id = ? AND status = 'active'
           AND completed_date >= ? AND completed_date <= ?`,
      )
      .bind(userId, monthStart, today)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM task_completions
         WHERE user_id = ? AND status = 'active'
           AND completed_date >= ? AND completed_date <= ?`,
      )
      .bind(userId, yearStart, today)
      .first<{ n: number }>(),
    db
      .prepare(`SELECT COUNT(*) AS n FROM tasks WHERE is_active = 1`)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT monthly_target_count, yearly_target_count
         FROM app_config WHERE id = 1`,
      )
      .first<{ monthly_target_count: number; yearly_target_count: number }>(),
  ]);

  return c.json({
    daily: {
      completed: dailyCompleted?.n ?? 0,
      total: activeTasks?.n ?? 0,
    },
    monthly: {
      completed: monthlyCompleted?.n ?? 0,
      target: cfg?.monthly_target_count ?? DEFAULT_MONTHLY_TARGET,
    },
    yearly: {
      completed: yearlyCompleted?.n ?? 0,
      target: cfg?.yearly_target_count ?? DEFAULT_YEARLY_TARGET,
    },
  });
});

export default tasks;

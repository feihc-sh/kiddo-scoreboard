// src/routes/public/calendar-details.ts
// GET /api/public/calendar/details?child_id=X&date=YYYY-MM-DD
// Returns { completions: [{ id, task_name, task_icon, completed_at, token_reward, target_account }] }

import { Hono } from 'hono';
import type { Env } from '../../worker.ts';

const calendarDetails = new Hono<{ Bindings: Env }>();

calendarDetails.get('/details', async (c) => {
  const childIdStr = c.req.query('child_id') || c.req.query('child');
  const date = c.req.query('date');

  if (!childIdStr || !date) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'child_id and date required' } },
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

  const result = await c.env.DB.prepare(`
    SELECT tc.id, tc.task_id, t.name as task_name, t.icon as task_icon,
           tc.completed_at, t.token_reward, t.target_account
    FROM task_completions tc
    JOIN tasks t ON t.id = tc.task_id
    WHERE tc.child_id = ? AND DATE(tc.completed_at) = ?
    ORDER BY tc.completed_at ASC
  `).bind(childId, date).all();

  const completions = (result.results || []).map((row: Record<string, unknown>) => ({
    id: row.id,
    task_id: row.task_id,
    task_name: row.task_name,
    task_icon: row.task_icon,
    completed_at: row.completed_at,
    token_reward: row.token_reward,
    target_account: row.target_account,
  }));

  return c.json({ completions });
});

export default calendarDetails;

// src/routes/public/calendar-tasks.ts
// GET /api/public/calendar/tasks
// Returns { tasks: [{id, name, icon, category, sort_order}] }
// Lists all active tasks (is_active = 1) ordered by sort_order ASC, id ASC.

import { Hono } from 'hono';
import type { Env } from '../../worker.ts';

const calendarTasks = new Hono<{ Bindings: Env }>();

interface TaskRow {
  id: number;
  name: string;
  icon: string | null;
  category: string;
  sort_order: number;
}

calendarTasks.get('/tasks', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT id, name, icon, category, sort_order
    FROM tasks
    WHERE is_active = 1
    ORDER BY sort_order ASC, id ASC
  `).all<TaskRow>();

  const tasks = (result.results || []).map((row: TaskRow) => ({
    id: row.id,
    name: row.name,
    icon: row.icon,
    category: row.category,
    sort_order: row.sort_order,
  }));

  return c.json({ tasks });
});

export default calendarTasks;

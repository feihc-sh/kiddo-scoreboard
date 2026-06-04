// src/routes/public/balance.ts
// GET /api/public/balance?user_id=N — read-only balance lookup.
// Mounted at /api/public/balance by src/worker.ts.

import { Hono } from 'hono';
import { computeBalance } from '../../utils/balance.ts';
import type { Env } from '../../worker.ts';

const balance = new Hono<{ Bindings: Env }>();

balance.get('/', async (c) => {
  const userIdStr = c.req.query('user_id');
  if (userIdStr === undefined || userIdStr === '') {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'user_id query param is required' } },
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

  const result = await computeBalance(c.env.DB, userId);
  return c.json(result);
});

export default balance;

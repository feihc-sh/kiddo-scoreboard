// src/routes/public/user.ts
// GET /api/public/user/:id — read-only user info (no pin_hash).
// Mounted at /api/public/user by src/worker.ts.

import { Hono } from 'hono';
import type { Env } from '../../worker.ts';
import type { User } from '../../db/types.ts';

const user = new Hono<{ Bindings: Env }>();

user.get('/:id', async (c) => {
  const idStr = c.req.param('id');
  const id = Number(idStr);
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'id must be a positive integer' } }, 400);
  }

  const row = await c.env.DB
    .prepare(`SELECT id, name, role, pin_hash, created_at, updated_at FROM users WHERE id = ?`)
    .bind(id)
    .first<User>();
  if (!row) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'User not found' } }, 404);
  }

  // Explicit field pick — pin_hash MUST NOT be returned.
  return c.json({
    id: row.id,
    name: row.name,
    role: row.role,
    is_first_time: row.name === '',
  });
});

export default user;

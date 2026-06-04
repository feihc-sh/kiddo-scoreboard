// src/routes/admin/index.ts
// Aggregates all /api/admin/* routes under the requirePm guard,
// except for the auth subroutes (login is public, logout is idempotent).

import { Hono } from 'hono';
import { requirePm } from '../../middleware/requirePm.ts';
import auth from './auth.ts';
import type { Env } from '../../worker.ts';

const admin = new Hono<{ Bindings: Env }>();

// /auth/* (login, logout, me) has its own per-route auth handling
admin.route('/auth', auth);

// All OTHER /api/admin/* routes require a valid PM session.
admin.use('/*', requirePm);

export default admin;

// src/routes/admin/index.ts
// Aggregates all /api/admin/* routes under the requirePm guard,
// except for the auth subroutes (login is public, logout is idempotent).

import { Hono } from 'hono';
import { requirePm } from '../../middleware/requirePm.ts';
import auth from './auth.ts';
import taskCompletions from './task-completions.ts';
import adminEvents from './events.ts';
import auditLogRoute from './audit-log.ts';
import exchange from './exchange.ts';
import weeklyGrant from './weekly-grant.ts';
import tasksConfig from './tasks.ts';
import deletedRecordsRoute from './deleted-records.ts';
import adminHealth from './health.ts';
import type { Env } from '../../worker.ts';

const admin = new Hono<{ Bindings: Env }>();

// /auth/* (login, logout, me) has its own per-route auth handling
admin.route('/auth', auth);

// All OTHER /api/admin/* routes require a valid PM session.
admin.use('/*', requirePm);

admin.route('/task-completions', taskCompletions);
admin.route('/events', adminEvents);
admin.route('/audit-log', auditLogRoute);
admin.route('/exchange', exchange);
admin.route('/weekly-grant', weeklyGrant);
admin.route('/tasks', tasksConfig);
admin.route('/deleted-records', deletedRecordsRoute);
admin.route('/health', adminHealth);

export default admin;

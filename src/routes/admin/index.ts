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
// Module 7 (Coin System, M3 — RFC §4.5): PM 手动 confirm kind='custom' 兑换
import shopFulfill from './shop-fulfill.ts';
// Item #011 §4: PM admin running records (list + revoke with km/points rollback)
import adminRunning from './running-records.ts';
// Achievement system (spec §7): grant / revoke / grant-log / seasons / eval-streak
import adminAchievements, {
  achievementsEvalStreak,
  seasonsAdmin,
} from './achievement-awards.ts';
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
// Module 7 (Coin System, M3): POST /api/admin/shop/fulfill/:id
admin.route('/shop/fulfill', shopFulfill);
// Item #011 §4: running_records list + revoke (mounted at /running/records)
// The recordsRouter inside serves:
//   GET  /api/admin/running/records          (list)
//   POST /api/admin/running/records/:id/revoke  (revoke)
admin.route('/running/records', adminRunning);
// Achievement system (spec §7):
//   POST /api/admin/achievement-awards          — grant a medal
//   POST /api/admin/achievement-awards/revoke   — revoke (confirm gate)
//   GET  /api/admin/achievement-awards          — grant log (?status=all default)
//   POST /api/admin/seasons                     — create a season
//   POST /api/admin/achievements/eval-streak    — manual streak re-evaluation
// Achievement system (spec §7):
//   POST /api/admin/achievement-awards          — grant a medal
//   POST /api/admin/achievement-awards/revoke   — revoke (confirm gate)
//   GET  /api/admin/achievement-awards          — grant log (?status=all default)
//   POST /api/admin/seasons                     — create a season
//   GET  /api/admin/seasons                     — list seasons
//   POST /api/admin/achievements/eval-streak    — manual streak re-evaluation
//
// Each path space gets its OWN router: sharing one router would make
// POST /api/admin/seasons fall through to the award router's grant handler.
admin.route('/achievement-awards', adminAchievements);
admin.route('/seasons', seasonsAdmin);
admin.route('/achievements', achievementsEvalStreak);

export default admin;

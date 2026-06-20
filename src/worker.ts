import { Hono } from 'hono';
import admin from './routes/admin/index.ts';
import publicUser from './routes/public/user.ts';
import publicEvents from './routes/public/events.ts';
import publicBalance from './routes/public/balance.ts';
import publicTasks from './routes/public/tasks.ts';
import publicHealth from './routes/public/health.ts';
import publicCalendar from './routes/public/calendar.ts';
import publicCalendarDetails from './routes/public/calendar-details.ts';
import me from './routes/me/index.ts';
import meHealth from './routes/me/health.ts';
// Module 7 (Coin System, M3 — RFC §4): child-facing coin balance + redemptions
// + shop catalog + exchange endpoints.
import meCoins from './routes/me/coins.ts';
import shopItems from './routes/shop/items.ts';
import shopExchange from './routes/shop/exchange.ts';
// Item #011 §2 (Running check-in modal) — child submits km, server writes
// the record, rolls any newly-reached point prizes, and returns the
// updated balance for the home page to refresh.
import running from './routes/running/index.ts';

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  ASSETS: Fetcher;
}

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) =>
  c.json({
    message: 'Kiddo Scoreboard v0',
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
);

app.get('/health', (c) => c.json({ status: 'healthy' }));

app.route('/api/admin', admin);
app.route('/api/public/user', publicUser);
app.route('/api/public/balance', publicBalance);
app.route('/api/public/events', publicEvents);
app.route('/api/public/tasks', publicTasks);
app.route('/api/public/health', publicHealth);
app.route('/api/public/calendar', publicCalendar);
app.route('/api/public/calendar', publicCalendarDetails);
app.route('/api/me', me);
app.route('/api/me/health', meHealth);
// Coin System M3 mounts (RFC §4):
//   GET  /api/coins/balance        — child coin balance
//   GET  /api/coins/redemptions    — child redemption history
//   POST /api/coins/exchange       — child initiates a redemption
//   GET  /api/shop/items           — public shop catalog
app.route('/api/coins', meCoins);
app.route('/api/coins', shopExchange);
app.route('/api/shop/items', shopItems);
// Item #011 §2 (Running check-in modal):
//   POST /api/running/records   — child submits km, server writes record +
//     score_event + audit_log atomically.
app.route('/api/running', running);

export default app;

import { Hono } from 'hono';
import admin from './routes/admin/index.ts';
import publicUser from './routes/public/user.ts';
import publicEvents from './routes/public/events.ts';
import publicBalance from './routes/public/balance.ts';
import publicTasks from './routes/public/tasks.ts';
import me from './routes/me/index.ts';

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
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
app.route('/api/me', me);

export default app;

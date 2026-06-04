import { Hono } from 'hono';
import admin from './routes/admin/index.ts';

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

export default app;

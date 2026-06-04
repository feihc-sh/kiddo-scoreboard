import { Hono } from 'hono';

export interface Env {
  DB: D1Database;
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

export default app;

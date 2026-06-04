// src/routes/me/index.ts
// Aggregates all /api/me/* (child-facing) routes.
// M5 will wrap this with a `requireChild` middleware once kiddo auth lands.

import { Hono } from 'hono';
import tasks from './tasks.ts';
import type { Env } from '../../worker.ts';

const me = new Hono<{ Bindings: Env }>();

me.route('/tasks', tasks);

export default me;

// src/routes/running/index.ts
// Item #011 §2 — Running route aggregator.
// Mounted at /api/running by src/worker.ts.
//
//   POST /api/running/records   (src/routes/running/records.ts)

import { Hono } from 'hono';
import type { Env } from '../../worker.ts';
import records from './records.ts';

const running = new Hono<{ Bindings: Env }>();

running.route('/records', records);

export default running;

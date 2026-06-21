// src/routes/running/index.ts
// Item #011 §2+3 — Running route aggregator.
// Mounted at /api/running by src/worker.ts.
//
//   POST /api/running/records           (src/routes/running/records.ts)
//   GET  /api/running/maps/active       (src/routes/running/maps.ts)
//   POST /api/running/maps/:id/complete (src/routes/running/maps.ts)

import { Hono } from 'hono';
import type { Env } from '../../worker.ts';
import records from './records.ts';
import maps from './maps.ts';

const running = new Hono<{ Bindings: Env }>();

running.route('/records', records);
running.route('/maps', maps);

export default running;

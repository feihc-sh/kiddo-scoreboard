// functions/health.ts
// Targeted fix for issue #6: /health endpoint returns 404 HTML on Pages
// (Pages Function file `health.ts` matches URL `/health`).
// Routes through existing Hono app to keep behavior identical to Workers.
//
// Only `/health` reaches this function (Pages routing: file name = URL path),
// so Hono's other routes (`/api/*` via api/[[path]].ts, `/` static index.html)
// are unaffected.

import app from '../src/worker';
import type { Env } from '../src/worker';

export const onRequest: PagesFunction<Env> = async (context) => {
  return app.fetch(context.request, context.env, context);
};

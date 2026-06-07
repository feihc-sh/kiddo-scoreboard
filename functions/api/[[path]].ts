import app from '../../src/worker';
import type { Env } from '../../src/worker';

export const onRequest: PagesFunction<Env> = async (context) => {
  return app.fetch(context.request, context.env, context);
};

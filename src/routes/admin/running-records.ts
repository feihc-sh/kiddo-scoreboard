// src/routes/admin/running-records.ts
// Item #011 §4 — PM admin endpoints for running records.
//
// Mounted at /api/admin/running/records by src/routes/admin/index.ts.
// Two sub-routes share the /records path prefix:
//   GET  /records              → list all running_records
//   POST /records/:id/revoke   → revoke a running_record
//
// This flat structure avoids Hono's greedy /:id routing conflict where
// POST /running/records/:id/revoke would interpret "records" as the :id param.

import { Hono } from 'hono';
import { getPmUserId } from '../../middleware/requirePm.ts';
import { rederiveRecordRevoke } from '../../utils/running-rederive.ts';
import type { Env } from '../../worker.ts';

// ---- helpers --------------------------------------------------------

type HonoContext = import('hono').Context<{ Bindings: Env }>;

function unauthorized(c: HonoContext) {
  return c.json(
    { error: { code: 'UNAUTHORIZED', message: 'PM session required' } },
    401,
  );
}

function badId(idRaw: string | undefined): number | null {
  if (!idRaw) return null;
  const n = Number(idRaw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

// ---- list endpoint (served as GET /records within this sub-router) ----

interface RunningRecordRow {
  id: number;
  child_id: number;
  child_name: string;
  map_id: number;
  map_name: string;
  km: number;
  awarded_point_id: number | null;
  awarded_coins: number | null;
  created_at: number;
  revoked_at: number | null;
  revoked_by: number | null;
  revoked_by_name: string | null;
}

async function listRunningRecords(
  db: D1Database,
  limitRaw: string | undefined,
): Promise<{ records: RunningRecordRow[]; count: number }> {
  const limit = Math.min(Math.max(Number(limitRaw) | 0, 0), 500) || 200;
  const result = await db
    .prepare(
      `SELECT
         rr.id,
         rr.child_id,
         u_child.name        AS child_name,
         rr.map_id,
         rm.name             AS map_name,
         rr.km,
         rr.awarded_point_id,
         rr.awarded_coins,
         rr.created_at,
         rr.revoked_at,
         rr.revoked_by,
         u_pm.name           AS revoked_by_name
       FROM running_records AS rr
       JOIN users           AS u_child ON u_child.id = rr.child_id
       JOIN running_maps    AS rm      ON rm.id       = rr.map_id
       LEFT JOIN users      AS u_pm    ON u_pm.id     = rr.revoked_by
       ORDER BY rr.created_at DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<RunningRecordRow>();
  const records = (result.results ?? []) as RunningRecordRow[];
  return { records, count: records.length };
}

// ---- revoke endpoint (served as POST /records/:id/revoke) ----

interface RevokeBody {
  confirm?: unknown;
}

// Item #013 §6: the admin revoke endpoint now delegates to R2 cascade
// (rederiveRecordRevoke), which writes 0+ per-milestone score_events with
// source_ref='running:N:point:P[:compensation|:reverse]' instead of a single
// -X score_event. The response carries the cascade summary so the admin UI
// can show the user-visible net coin delta.
async function revokeRunningRecord(
  db: D1Database,
  id: number,
  pmUserId: number,
): Promise<{
  record_id: number;
  revoked_at: number;
  cum_km: number;
  // R2 writes 0+ score_events (one per affected milestone) — there is no
  // single "the" revoke event id, so this field is always null. Kept in the
  // response shape for backward compatibility with X1 clients that read it.
  revoke_score_event_id: number | null;
  net_coin_change: number;
  compensated_milestones: Array<{ point_id: number; coins: number }>;
  reversed_milestones: Array<{ point_id: number; coins: number }>;
}> {
  const now = Math.floor(Date.now() / 1000);
  const result = await rederiveRecordRevoke(db, id, pmUserId);
  return {
    record_id: id,
    revoked_at: now,
    cum_km: result.newCumKm,
    revoke_score_event_id: null,
    net_coin_change: result.netCoinChange,
    compensated_milestones: result.compensatedMilestones,
    reversed_milestones: result.reversedMilestones,
  };
}

// ---- Route mounting ---------------------------------------------------
//
// This Hono instance is mounted at /api/admin/running/records.
// The list GET / is served as GET /records (via the /records sub-router).
// The revoke POST /:id/revoke is served as POST /records/:id/revoke.

const recordsRouter = new Hono<{ Bindings: Env }>();

// GET / → list all running_records (served as GET /records from /api/admin/running)
recordsRouter.get('/', async (c) => {
  const pmUserId = await getPmUserId(c);
  if (pmUserId == null) return unauthorized(c);

  const limit = c.req.query('limit');
  const result = await listRunningRecords(c.env.DB, limit);
  return c.json(result);
});

// POST /:id/revoke → revoke (served as POST /records/:id/revoke)
recordsRouter.post('/:id/revoke', async (c) => {
  const pmUserId = await getPmUserId(c);
  if (pmUserId == null) return unauthorized(c);

  const id = badId(c.req.param('id'));
  if (id == null) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'id must be a positive integer' } },
      400,
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'invalid JSON body' } },
      400,
    );
  }
  const body = rawBody as RevokeBody;
  if (body.confirm !== true) {
    return c.json(
      {
        error: {
          code: 'CONFIRM_REQUIRED',
          message: 'body must contain confirm: true',
        },
      },
      400,
    );
  }

  try {
    const result = await revokeRunningRecord(c.env.DB, id, pmUserId);
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'NOT_FOUND') {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'running_record not found' } },
        404,
      );
    }
    if (msg === 'ALREADY_REVOKED') {
      return c.json(
        { error: { code: 'ALREADY_REVOKED', message: 'running_record already revoked' } },
        409,
      );
    }
    return c.json(
      { error: { code: 'INTERNAL', message: 'revoke failed: ' + msg } },
      500,
    );
  }
});

// This Hono instance is the export — mounted at /api/admin/running/records
// (src/routes/admin/index.ts does: admin.route('/running', adminRunning))
// The GET / and POST /:id/revoke handlers inside are served as:
//   GET  /api/admin/running/records
//   POST /api/admin/running/records/:id/revoke
export default recordsRouter;

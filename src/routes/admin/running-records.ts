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

async function revokeRunningRecord(
  db: D1Database,
  id: number,
  pmUserId: number,
): Promise<{
  record_id: number;
  revoked_at: number;
  cum_km: number;
  revoke_score_event_id: number | null;
}> {
  const now = Math.floor(Date.now() / 1000);

  // 1) Load the record
  const rec = await db
    .prepare(
      `SELECT id, child_id, map_id, km, awarded_coins, revoked_at
       FROM running_records WHERE id = ?`,
    )
    .bind(id)
    .first<{
      id: number;
      child_id: number;
      map_id: number;
      km: number;
      awarded_coins: number | null;
      revoked_at: number | null;
    }>();
  if (!rec) throw new Error('NOT_FOUND');
  if (rec.revoked_at !== null) throw new Error('ALREADY_REVOKED');

  // 2) Recompute active cum_km (excluding this record) before we UPDATE it
  const cumRow = await db
    .prepare(
      `SELECT COALESCE(SUM(km), 0) AS cum_km
       FROM running_records
       WHERE child_id = ? AND map_id = ? AND revoked_at IS NULL AND id != ?`,
    )
    .bind(rec.child_id, rec.map_id, id)
    .first<{ cum_km: number }>();
  const newCumKm = Number(cumRow?.cum_km ?? 0);

  // 3) Build the batch statements
  const stmts = [
    // a. Revoke the record
    db
      .prepare(
        `UPDATE running_records
         SET revoked_at = ?, revoked_by = ?
         WHERE id = ?`,
      )
      .bind(now, pmUserId, id),
    // c. UPSERT running_progress (write-through cache)
    db
      .prepare(
        `INSERT INTO running_progress (child_id, map_id, cum_km, last_updated)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (child_id, map_id)
         DO UPDATE SET cum_km = ?, last_updated = ?`,
      )
      .bind(
        rec.child_id,
        rec.map_id,
        newCumKm,
        now,
        newCumKm,
        now,
      ),
    // d. Audit log
    db
      .prepare(
        `INSERT INTO audit_log
           (actor, action, target_event_id, target_user_id, details, created_at)
         VALUES ('pm', 'running_record_revoke', ?, ?, ?, ?)`,
      )
      .bind(
        id,
        rec.child_id,
        JSON.stringify({
          record_id: id,
          child_id: rec.child_id,
          map_id: rec.map_id,
          km: rec.km,
          awarded_coins: rec.awarded_coins,
          cum_km_after: newCumKm,
        }),
        now,
      ),
  ];

  // b. Score event for point reversal (only if there were awarded minutes)
  let revokeScoreEventId: number | null = null;
  if (rec.awarded_coins && rec.awarded_coins > 0) {
    stmts.splice(
      1,
      0,
      db
        .prepare(
          `INSERT INTO score_events
             (user_id, type, change_value, reason, status, submitted_by, source, source_ref, created_at)
           VALUES (?, 'coins', ?, '跑步打卡撤销', 'approved', 'pm', 'manual', ?, ?)`,
        )
        .bind(rec.child_id, -rec.awarded_coins, `running_revoke:${id}`, now),
    );
  }

  // Execute batch
  const results = await db.batch(stmts);

  // Extract last_row_id of the score_event if it was written
  if (rec.awarded_coins && rec.awarded_coins > 0) {
    revokeScoreEventId = Number(results[1]?.meta?.last_row_id ?? 0) || null;
  }

  return {
    record_id: id,
    revoked_at: now,
    cum_km: newCumKm,
    revoke_score_event_id: revokeScoreEventId,
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

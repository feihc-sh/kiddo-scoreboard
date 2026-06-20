// src/routes/running/records.ts
// Item #011 §2 — POST /api/running/records
//
// Body: { km: number }
// Auth: child user_id hardcoded to 2 (matches src/routes/me/coins.ts).
//
// Returns: 200 with the new record_id, cum_km, new_points_reached[], and
// updated balance. Stage 3 reads this to drive the gift modal cascade.

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../../worker.ts';
import { rollPrize, type Rng } from './prize.ts';

/**
 * Hardcoded child user id (matches src/routes/me/coins.ts:CHILD_USER_ID).
 * M5 will replace with a real auth lookup.
 */
const CHILD_USER_ID = 2;

/** Max km per single check-in (kid-friendly cap). */
const MAX_KM = 100;

const records = new Hono<{ Bindings: Env }>();

// ---------- Error helpers (mirror src/routes/shop/exchange.ts:49-62) ----------

function badRequest(c: Context<{ Bindings: Env }>, message: string) {
  return c.json({ error: { code: 'BAD_REQUEST', message } }, 400);
}

function jsonError(
  c: Context<{ Bindings: Env }>,
  code: string,
  message: string,
  status: 400 | 500,
  extra?: Record<string, unknown>,
) {
  return c.json({ error: { code, message, ...extra } }, status);
}

// ---------- Body parsing ----------

interface ParsedBody {
  ok: true;
  km: number;
}
interface ParseError {
  ok: false;
  code: string;
  message: string;
}

function parseBody(raw: unknown): ParsedBody | ParseError {
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, code: 'BAD_REQUEST', message: 'body must be a JSON object' };
  }
  const b = raw as Record<string, unknown>;
  if (!('km' in b)) {
    return { ok: false, code: 'BAD_REQUEST', message: 'km 必须是数字' };
  }
  const km = (b as { km: unknown }).km;
  if (typeof km !== 'number' || Number.isNaN(km) || !Number.isFinite(km)) {
    return { ok: false, code: 'BAD_REQUEST', message: 'km 必须是数字' };
  }
  if (km <= 0) {
    return { ok: false, code: 'BAD_REQUEST', message: '公里数要大于 0 哦' };
  }
  if (km > MAX_KM) {
    return {
      ok: false,
      code: 'BAD_REQUEST',
      message: `单次跑步最多 ${MAX_KM} 公里, 请分次记录`,
    };
  }
  // Enforce max 1 decimal place (Math.round to nearest 0.1 then compare).
  const rounded = Math.round(km * 10) / 10;
  if (Math.abs(rounded - km) > 1e-9) {
    return { ok: false, code: 'BAD_REQUEST', message: '公里数最多保留 1 位小数' };
  }
  return { ok: true, km: rounded };
}

// ---------- Types for DB rows ----------

interface ActiveMapRow {
  id: number;
  total_km: number;
}
interface CumKmRow {
  previous_cum_km: number;
}
interface PointRow {
  id: number;
  name: string;
  cum_km: number;
}

interface ReachedPoint {
  point_id: number;
  name: string;
  cum_km: number;
  awarded_minutes: number;
}

// ---------- POST / ----------

records.post('/', async (c) => {
  // 1) Parse + validate body
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return badRequest(c, 'invalid JSON body');
  }
  const parsed = parseBody(raw);
  if (!parsed.ok) {
    return jsonError(c, parsed.code, parsed.message, 400);
  }
  const { km } = parsed;

  const db = c.env.DB;
  const now = Math.floor(Date.now() / 1000);

  // Test hook: pin the RNG for deterministic e2e prize assertions.
  // Production: never set, always Math.random.
  const url = new URL(c.req.url);
  const rng: Rng =
    url.searchParams.get('rng') === 'fixed'
      ? () => 0.5 // 0.5 < 0.6 → small bucket; floor(0.5*5)=2 → 1+2 = 3
      : Math.random;

  // 2) Read batch: pick active map + previous cum km + candidate points.
  //    db.batch() returns D1Result<T>[]; we cast via unknown first to avoid the
  //    'unknown' row shape that bites when generic params are inferred.
  const readResults = await db.batch([
    db
      .prepare(
        `SELECT id, total_km FROM running_maps
         WHERE is_active = 1
         ORDER BY display_order ASC
         LIMIT 1`,
      ),
    db
      .prepare(
        `SELECT COALESCE(SUM(km), 0) AS previous_cum_km
         FROM running_records
         WHERE child_id = ? AND revoked_at IS NULL`,
      )
      .bind(CHILD_USER_ID),
  ]) as unknown as Array<{ results?: unknown[] }>;
  const activeMapRow = readResults[0]?.results?.[0] as ActiveMapRow | undefined;
  const prevRow = readResults[1]?.results?.[0] as CumKmRow | undefined;

  const map = activeMapRow ?? null;
  if (!map) {
    return jsonError(c, 'NO_ACTIVE_MAP', '还没有可以跑步的地图, 请联系 PM', 500);
  }
  const previousCumKm = Number(
    (prevRow as CumKmRow | null)?.previous_cum_km ?? 0,
  );
  const newCumKmRaw = previousCumKm + km;
  const newCumKm = Math.min(newCumKmRaw, map.total_km);

  // Fetch candidate points (those crossed in this check-in).
  const pointsResult = await db
    .prepare(
      `SELECT id, name, cum_km FROM running_points
       WHERE map_id = ? AND cum_km > ? AND cum_km <= ?
       ORDER BY order_index ASC`,
    )
    .bind(map.id, previousCumKm, newCumKmRaw)
    .all<PointRow>();
  const points = pointsResult.results ?? [];
  const reached: ReachedPoint[] = points.map((p) => ({
    point_id: p.id,
    name: p.name,
    cum_km: p.cum_km,
    awarded_minutes: rollPrize(rng),
  }));
  const totalAwardedMinutes = reached.reduce((s, p) => s + p.awarded_minutes, 0);
  const firstReachedId = reached.length > 0 ? reached[0].point_id : null;

  // 3) Write batch: insert record + score_event (if any) + audit_log.
  try {
    // INSERT running_records
    const recordResult = await db
      .prepare(
        `INSERT INTO running_records
           (child_id, map_id, km, awarded_point_id, awarded_minutes, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING id`,
      )
      .bind(CHILD_USER_ID, map.id, km, firstReachedId, totalAwardedMinutes, now)
      .first<{ id: number }>();
    const recordId = Number(recordIdFromInsert(recordResult));

    let gameTimeEventId: number | null = null;

    if (totalAwardedMinutes > 0) {
      // INSERT score_events (+game_time), mirrors src/routes/shop/exchange.ts:166-180
      const evResult = await db
        .prepare(
          `INSERT INTO score_events
             (user_id, type, change_value, reason, status, submitted_by, source, source_ref, created_at)
           VALUES (?, 'game_time', ?, '跑步打卡积分', 'approved', 'child', 'manual', ?, ?)
           RETURNING id`,
        )
        .bind(CHILD_USER_ID, totalAwardedMinutes, recordId, now)
        .first<{ id: number }>();
      gameTimeEventId = Number(recordIdFromInsert(evResult));
    }

    // INSERT audit_log
    await db
      .prepare(
        `INSERT INTO audit_log
           (actor, action, target_event_id, target_user_id, details, created_at)
         VALUES ('child', 'running_checkin', NULL, ?, ?, ?)`,
      )
      .bind(
        CHILD_USER_ID,
        JSON.stringify({
          record_id: recordId,
          map_id: map.id,
          km,
          previous_cum_km: previousCumKm,
          new_cum_km: newCumKmRaw,
          new_points_reached: reached,
          total_awarded_minutes: totalAwardedMinutes,
          game_time_event_id: gameTimeEventId,
        }),
        now,
      )
      .run();

    // 4) Read back balance so the home page can refresh immediately.
    const balance = await readBalance(db, CHILD_USER_ID);

    return c.json({
      record_id: recordId,
      child_id: CHILD_USER_ID,
      map_id: map.id,
      km,
      cum_km: newCumKm,
      total_km: map.total_km,
      previous_cum_km: previousCumKm,
      new_points_reached: reached,
      total_awarded_minutes: totalAwardedMinutes,
      balance,
      created_at: now,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(c, 'INTERNAL', '记录失败: ' + message, 500);
  }
});

/** D1 batch results wrap rows in { results: [...] } — accept either shape. */
function recordIdFromInsert(row: unknown): number {
  if (!row) return 0;
  const r = row as { id?: number; results?: Array<{ id?: number }> };
  if (typeof r.id === 'number') return r.id;
  if (Array.isArray(r.results) && r.results[0] && typeof r.results[0].id === 'number') {
    return r.results[0].id;
  }
  return 0;
}

interface BalanceRow {
  game_time: number;
  pocket_money: number;
  coins: number;
}

async function readBalance(db: D1Database, userId: number): Promise<BalanceRow> {
  const row = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'game_time'    THEN change_value END), 0) AS game_time,
         COALESCE(SUM(CASE WHEN type = 'pocket_money' THEN change_value END), 0) AS pocket_money,
         COALESCE(SUM(CASE WHEN type = 'coins'        THEN change_value END), 0) AS coins
       FROM score_events
       WHERE user_id = ? AND status = 'approved'`,
    )
    .bind(userId)
    .first<BalanceRow>();
  return {
    game_time: Number(row?.game_time ?? 0),
    pocket_money: Number(row?.pocket_money ?? 0),
    coins: Number(row?.coins ?? 0),
  };
}

export default records;

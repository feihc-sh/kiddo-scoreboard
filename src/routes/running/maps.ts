// src/routes/running/maps.ts
// Item #011 §3 — Running map endpoints.
//
//   GET  /api/running/maps/active
//     → Returns active map with points + child's cum_km.
//   POST /api/running/maps/:id/complete
//     → Marks map complete, activates next map.

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../../worker.ts';

const CHILD_USER_ID = 2;

const maps = new Hono<{ Bindings: Env }>();

// ---------- GET /active ----------
maps.get('/active', async (c) => {
  const db = c.env.DB;

  // Pick the active map.
  const mapRow = await db
    .prepare(
      `SELECT id, name, theme, total_km, is_active, display_order
       FROM running_maps
       WHERE is_active = 1
       ORDER BY display_order ASC
       LIMIT 1`,
    )
    .first<{
      id: number;
      name: string;
      theme: string;
      total_km: number;
      is_active: number;
      display_order: number;
    }>();

  if (!mapRow) {
    return c.json({ map: null, cum_km: 0, points: [] });
  }

  // Get all points for this map.
  const pointsResult = await db
    .prepare(
      `SELECT id, name, order_index, cum_km
       FROM running_points
       WHERE map_id = ?
       ORDER BY order_index ASC`,
    )
    .bind(mapRow.id)
    .all<{ id: number; name: string; order_index: number; cum_km: number }>();

  const points = pointsResult.results ?? [];

  // Get child's cumulative km for this map.
  const cumRow = await db
    .prepare(
      `SELECT COALESCE(SUM(km), 0) AS cum_km
       FROM running_records
       WHERE child_id = ? AND map_id = ? AND revoked_at IS NULL`,
    )
    .bind(CHILD_USER_ID, mapRow.id)
    .first<{ cum_km: number }>();

  return c.json({
    map: {
      id: mapRow.id,
      name: mapRow.name,
      theme: mapRow.theme,
      total_km: mapRow.total_km,
      display_order: mapRow.display_order,
    },
    points,
    cum_km: Number(cumRow?.cum_km ?? 0),
  });
});

// ---------- POST /:id/complete ----------
// Marks a map as complete and activates the next map in the sequence.
maps.post('/:id/complete', async (c) => {
  const mapId = Number(c.req.param('id'));
  if (!Number.isFinite(mapId) || mapId <= 0) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'invalid map id' } }, 400);
  }

  const db = c.env.DB;
  const now = Math.floor(Date.now() / 1000);

  // Read the current map's display_order.
  const currentMap = await db
    .prepare(
      `SELECT id, display_order FROM running_maps WHERE id = ?`,
    )
    .bind(mapId)
    .first<{ id: number; display_order: number }>();

  if (!currentMap) {
    return c.json({ error: { code: 'NOT_FOUND', message: '地图不存在' } }, 404);
  }

  // Find the next map (if any).
  const nextMap = await db
    .prepare(
      `SELECT id, name FROM running_maps
       WHERE display_order = ?
       LIMIT 1`,
    )
    .bind(currentMap.display_order + 1)
    .first<{ id: number; name: string }>();

  const hasNext = !!nextMap;

  // Activate next map (if any) and deactivate current.
  if (nextMap) {
    await db
      .prepare(
        `UPDATE running_maps SET is_active = 1 WHERE id = ?`,
      )
      .bind(nextMap.id)
      .run();
    // Deactivate current map so only one map is active at a time.
    await db
      .prepare(
        `UPDATE running_maps SET is_active = 0 WHERE id = ?`,
      )
      .bind(mapId)
      .run();
  }

  // Audit log for completion.
  await db
    .prepare(
      `INSERT INTO audit_log
         (actor, action, target_event_id, target_user_id, details, created_at)
       VALUES ('child', 'running_map_complete', NULL, ?, ?, ?)`,
    )
    .bind(
      CHILD_USER_ID,
      JSON.stringify({ map_id: mapId, next_map_id: nextMap?.id ?? null }),
      now,
    )
    .run();

  return c.json({
    completed: true,
    map_id: mapId,
    next_map: nextMap
      ? { id: nextMap.id, name: nextMap.name }
      : null,
  });
});

export default maps;

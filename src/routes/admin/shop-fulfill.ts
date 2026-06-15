// src/routes/admin/shop-fulfill.ts
// Module 7 (Coin System, M3 — RFC §4.5):
//   POST /api/admin/shop/fulfill/:redemption_id
//     PM only. 把 kind='custom' 的 shop_redemptions 从 'pending' → 'approved',
//     并写 fulfilled_at + fulfilled_by + audit_log 记录。
//
// 状态机 (RFC §5.2):
//   'pending'   → 'approved'   (本端点, PM 手动 confirm)
//   'approved'  → 409 INVALID_STATUS (already done)
//   'revoked'   → 409 INVALID_STATUS (rejected, can't resurrect)
//   'consumed'  → 409 INVALID_STATUS (旧 v1 值, 不再流转)
//
// Auth: PM only via requirePm middleware (挂在 admin/index.ts 上)。

import { Hono } from 'hono';
import type { Context } from 'hono';
import { getPmUserId } from '../../middleware/requirePm.ts';
import type { Env } from '../../worker.ts';

const shopFulfill = new Hono<{ Bindings: Env }>();

function unauthorized(c: Context<{ Bindings: Env }>) {
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

interface RedemptionRow {
  id: number;
  user_id: number;
  item_id: number;
  status: string;
  redeemed_at: number;
  fulfilled_at: number | null;
  fulfilled_by: number | null;
}

shopFulfill.post('/:id', async (c) => {
  const pmUserId = await getPmUserId(c);
  if (pmUserId == null) return unauthorized(c);

  const id = badId(c.req.param('id'));
  if (id == null) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'id must be a positive integer' } },
      400,
    );
  }

  const db = c.env.DB;
  const redemption = await db
    .prepare(
      `SELECT id, user_id, item_id, status, redeemed_at, fulfilled_at, fulfilled_by
       FROM shop_redemptions WHERE id = ?`,
    )
    .bind(id)
    .first<RedemptionRow>();
  if (!redemption) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: `redemption ${id} not found` } },
      404,
    );
  }

  // 状态机: 只允许 'pending' → 'approved'
  if (redemption.status !== 'pending') {
    return c.json(
      {
        error: {
          code: 'INVALID_STATUS',
          message: `cannot fulfill redemption in status '${redemption.status}' (only 'pending' is fulfillable)`,
        },
      },
      409,
    );
  }

  const now = Math.floor(Date.now() / 1000);

  // 原子写: UPDATE redemption + INSERT audit_log
  await db.batch([
    db
      .prepare(
        `UPDATE shop_redemptions
         SET status = 'approved', fulfilled_at = ?, fulfilled_by = ?
         WHERE id = ?`,
      )
      .bind(now, pmUserId, id),
    db
      .prepare(
        `INSERT INTO audit_log
           (actor, action, target_event_id, target_user_id, details, created_at)
         VALUES ('pm', 'shop_redemption_fulfilled', NULL, ?, ?, ?)`,
      )
      .bind(
        redemption.user_id,
        JSON.stringify({
          redemption_id: id,
          item_id: redemption.item_id,
          from_status: 'pending',
          to_status: 'approved',
        }),
        now,
      ),
  ]);

  return c.json({
    id,
    status: 'approved',
    fulfilled_at: now,
    fulfilled_by: pmUserId,
  });
});

export default shopFulfill;

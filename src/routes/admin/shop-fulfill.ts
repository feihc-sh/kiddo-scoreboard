// src/routes/admin/shop-fulfill.ts
// Module 7 (Coin System, M3 — RFC §4.5 + M4 §6.5 PM 待发列表):
//   GET  /api/admin/shop/fulfill?status=pending|approved|all
//     — 列 shop_redemptions (默认 status='pending' — PM 看到的就是待发)
//     — JOIN shop_items 拿 name + icon
//     — desc by redeemed_at (新兑换先出)
//   POST /api/admin/shop/fulfill/:id
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

// ---------------- GET /api/admin/shop/fulfill?status=pending ----------------
// 列 shop_redemptions (M4 §6.5 待发 section 必备)。默认 'pending' — 这就是
// PM 在 admin 后台看到的"待发"列表。status=all 返所有(上限 100)。
// JOIN shop_items 拿 name/icon 让前端不用再发一次 /api/shop/items。

interface AdminRedemptionRow extends RedemptionRow {
  item_name: string;
  item_icon: string | null;
  item_kind: string;
  cost_coins: number;
  reward_value: number;
  week_of: string;
  child_name: string | null;
}

shopFulfill.get('/', async (c) => {
  const pmUserId = await getPmUserId(c);
  if (pmUserId == null) return unauthorized(c);

  const statusParam = (c.req.query('status') ?? 'pending').toLowerCase();
  // Whitelist statuses (防 SQL 注入: 拼字符串前必须 enum-validate)
  const allowed = new Set(['pending', 'approved', 'consumed', 'revoked', 'all']);
  if (!allowed.has(statusParam)) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: `status must be one of ${[...allowed].join(',')}` } },
      400,
    );
  }

  const db = c.env.DB;
  const where = statusParam === 'all' ? '' : 'WHERE sr.status = ?';
  const bindArgs = statusParam === 'all' ? [] : [statusParam];

  const result = await db
    .prepare(
      `SELECT sr.id, sr.user_id, sr.item_id, sr.status, sr.redeemed_at,
              sr.fulfilled_at, sr.fulfilled_by, sr.week_of,
              sr.cost_coins, sr.reward_value,
              si.name AS item_name, si.icon AS item_icon, si.kind AS item_kind,
              u.name AS child_name
       FROM shop_redemptions sr
       JOIN shop_items si ON si.id = sr.item_id
       LEFT JOIN users u ON u.id = sr.user_id
       ${where}
       ORDER BY sr.redeemed_at DESC
       LIMIT 100`,
    )
    .bind(...bindArgs)
    .all<AdminRedemptionRow>();

  const redemptions = (result.results ?? []).map((r) => ({
    id: r.id,
    user_id: r.user_id,
    child_name: r.child_name,
    item_id: r.item_id,
    item_name: r.item_name,
    item_icon: r.item_icon,
    item_kind: r.item_kind,
    cost_coins: r.cost_coins,
    reward_value: r.reward_value,
    week_of: r.week_of,
    status: r.status,
    redeemed_at: r.redeemed_at,
    fulfilled_at: r.fulfilled_at,
  }));

  return c.json({ count: redemptions.length, redemptions });
});

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

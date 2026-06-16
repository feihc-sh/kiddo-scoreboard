// src/routes/shop/items.ts
// Module 7 (Coin System, M3 — RFC §4.3):
//   GET /api/shop/items
//     — 列 is_active=1 的商品
//     — 计算每个商品的 weekly_limit_remaining (本周已兑次数 / weekly_limit)
//     — 按 sort_order ASC, id ASC 排序
//
// Auth: 公开 (跟 /api/shop/items 列商品 spec 一致), 不需登录。
// 设计: 不做 rate limit / 限流 — 家庭场景, 不会被人扫。

import { Hono } from 'hono';
import type { Env } from '../../worker.ts';
import { currentWeek } from '../../utils/week.ts';

const shopItems = new Hono<{ Bindings: Env }>();

/**
 * Hardcoded child user id (M5 会改). 跟 /api/coins/* 路由保持一致。
 * weekly_limit_remaining 是 per-user 的, 所以这里要传 user_id。
 */
const CHILD_USER_ID = 2;

interface ShopItemRow {
  id: number;
  name: string;
  kind: string;
  cost_coins: number;
  reward_value: number;
  reward_type: string;
  description: string | null;
  icon: string | null;
  is_active: number;
  sort_order: number;
  weekly_limit: number;
  weekly_limit_used: number;
}

shopItems.get('/', async (c) => {
  const db = c.env.DB;
  const week = currentWeek();

  // CC follow-up #2 (2026-06-16 PR #39 review): fold N+1 Promise.all loop
  // (1 items query + N per-item getWeeklyRedemptionCount) into a single
  // LEFT JOIN ... GROUP BY query. Same response shape, 1 query instead of N+1.
  //
  // Status filter 'pending'/'approved' (跟 coin.ts S2 严格化一致, v1.1 RFC §3.3):
  // v1 'consumed' / 'revoked' records 保留在 DB 但不参与 new week count
  // (migration 0008 enum 仍含 4 个, 兼容 v1 已有 data).
  //
  // COALESCE(SUM(...), 0) 保证 LEFT JOIN 没 match 的 item 也返 0 (not NULL).
  const result = await db
    .prepare(
      `SELECT si.id, si.name, si.kind, si.cost_coins, si.reward_value, si.reward_type,
              si.description, si.icon, si.is_active, si.sort_order, si.weekly_limit,
              COALESCE(SUM(CASE WHEN sr.status IN ('pending', 'approved') THEN 1 ELSE 0 END), 0) AS weekly_limit_used
       FROM shop_items si
       LEFT JOIN shop_redemptions sr
         ON sr.item_id = si.id
         AND sr.user_id = ?
         AND sr.week_of = ?
       WHERE si.is_active = 1
       GROUP BY si.id
       ORDER BY si.sort_order ASC, si.id ASC`,
    )
    .bind(CHILD_USER_ID, week)
    .all<ShopItemRow>();

  // Compute weekly_limit_remaining / is_unlimited in JS (同原 logic).
  const items = (result.results ?? []).map((it) => {
    const remaining = it.weekly_limit === 0
      ? Number.POSITIVE_INFINITY  // 0 = unlimited
      : Math.max(0, it.weekly_limit - it.weekly_limit_used);
    return {
      id: it.id,
      name: it.name,
      kind: it.kind,
      cost_coins: it.cost_coins,
      reward_value: it.reward_value,
      reward_type: it.reward_type,
      description: it.description,
      icon: it.icon,
      weekly_limit: it.weekly_limit,
      weekly_limit_used: it.weekly_limit_used,
      weekly_limit_remaining: remaining === Number.POSITIVE_INFINITY ? null : remaining,
      // Coarse "affordable / can_exchange" hints for child UI 按钮置灰。
      // 注意: 这只是 UI 提示, 真验证在 POST /api/coins/exchange 服务端 (防 race)。
      is_unlimited: it.weekly_limit === 0,
    };
  });

  return c.json({ week_of: week, items });
});

export default shopItems;

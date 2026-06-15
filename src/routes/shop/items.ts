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
import { getWeeklyRedemptionCount } from '../../utils/coin.ts';
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
}

shopItems.get('/', async (c) => {
  const db = c.env.DB;
  const week = currentWeek();

  const result = await db
    .prepare(
      `SELECT id, name, kind, cost_coins, reward_value, reward_type,
              description, icon, is_active, sort_order, weekly_limit
       FROM shop_items
       WHERE is_active = 1
       ORDER BY sort_order ASC, id ASC`,
    )
    .all<ShopItemRow>();

  // For each item, compute weekly_limit_remaining. We do N+1 (item count is
  // bounded — v1=2, target < 10) so this is fine; if the catalog grows we
  // can fold it into a single GROUP BY join.
  const items = await Promise.all(
    (result.results ?? []).map(async (it) => {
      const used = await getWeeklyRedemptionCount(db, CHILD_USER_ID, week);
      const remaining = it.weekly_limit === 0
        ? Number.POSITIVE_INFINITY  // 0 = unlimited
        : Math.max(0, it.weekly_limit - used);
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
        weekly_limit_used: used,
        weekly_limit_remaining: remaining === Number.POSITIVE_INFINITY ? null : remaining,
        // Coarse "affordable / can_exchange" hints for child UI 按钮置灰。
        // 注意: 这只是 UI 提示, 真验证在 POST /api/coins/exchange 服务端 (防 race)。
        is_unlimited: it.weekly_limit === 0,
      };
    }),
  );

  return c.json({ week_of: week, items });
});

export default shopItems;

// src/routes/me/coins.ts
// Module 7 (Coin System, M3 — RFC §4.1/§4.2):
//   GET /api/coins/balance      — 当前 child 的金币余额
//   GET /api/coins/redemptions  — 当前 child 的兑换历史 (desc by redeemed_at, limit 50)
//
// Auth: child user_id is HARDCODED to 2 (CHILD_USER_ID) to match
// seeds/local.sql + src/routes/me/* pattern. M5 will replace with real auth.
//
// Returned shapes are explicitly designed to be the "child UI" view:
//   - balance: 跟 /api/public/balance 不同的精简 shape (只 coins + last_updated_at)
//   - redemptions: 包含 item.name + item.icon (joined) 方便 child UI 渲染
//                  而不用再发一次 /api/shop/items 查名字

import { Hono } from 'hono';
import type { Env } from '../../worker.ts';
import { getCoinBalance, getCoinBalanceUpdatedAt } from '../../utils/coin.ts';

/**
 * Hardcoded child user id. M5 will replace with a real auth lookup.
 * Must match the id inserted by seeds/local.sql.
 */
const CHILD_USER_ID = 2;

const REDEMPTION_HISTORY_LIMIT = 50;

const coins = new Hono<{ Bindings: Env }>();

// ---------------- GET /api/coins/balance ----------------

coins.get('/balance', async (c) => {
  const db = c.env.DB;
  const [balance, lastUpdatedAt] = await Promise.all([
    getCoinBalance(db, CHILD_USER_ID),
    getCoinBalanceUpdatedAt(db, CHILD_USER_ID),
  ]);
  return c.json({
    user_id: CHILD_USER_ID,
    balance,
    last_updated_at: lastUpdatedAt,
  });
});

// ---------------- GET /api/coins/redemptions ----------------

interface RedemptionHistoryRow {
  id: number;
  user_id: number;
  item_id: number;
  week_of: string;
  cost_coins: number;
  reward_value: number;
  reward_type: string;
  status: string;
  redeemed_at: number;
  fulfilled_at: number | null;
  fulfilled_by: number | null;
  item_name: string;
  item_icon: string | null;
  item_kind: string;
}

coins.get('/redemptions', async (c) => {
  const db = c.env.DB;
  // Join shop_redemptions + shop_items to give the child UI everything it
  // needs in a single request (no extra round-trip to /api/shop/items for
  // historical rows that have since been edited or deactivated).
  const result = await db
    .prepare(
      `SELECT sr.id, sr.user_id, sr.item_id, sr.week_of, sr.cost_coins,
              sr.reward_value, sr.reward_type, sr.status, sr.redeemed_at,
              sr.fulfilled_at, sr.fulfilled_by,
              si.name AS item_name, si.icon AS item_icon, si.kind AS item_kind
       FROM shop_redemptions sr
       JOIN shop_items si ON si.id = sr.item_id
       WHERE sr.user_id = ?
       ORDER BY sr.redeemed_at DESC
       LIMIT ?`,
    )
    .bind(CHILD_USER_ID, REDEMPTION_HISTORY_LIMIT)
    .all<RedemptionHistoryRow>();

  const redemptions = (result.results ?? []).map((r) => ({
    id: r.id,
    item_id: r.item_id,
    item_name: r.item_name,
    item_icon: r.item_icon,
    item_kind: r.item_kind,
    cost_coins: r.cost_coins,
    reward_value: r.reward_value,
    reward_type: r.reward_type,
    status: r.status,
    week_of: r.week_of,
    redeemed_at: r.redeemed_at,
    fulfilled_at: r.fulfilled_at,
  }));

  return c.json({ redemptions });
});

export default coins;

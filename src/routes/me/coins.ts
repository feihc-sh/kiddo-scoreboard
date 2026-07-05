// src/routes/me/coins.ts
// Module 7 (Coin System, M3 — RFC §4.1/§4.2):
//   GET /api/coins/balance      — 当前 child 的金币余额
//   GET /api/coins/redemptions  — 当前 child 的兑换历史 (desc by redeemed_at, limit 50)
//
// Item #015 §2 (Coin Request Workflow — kid side):
//   POST /api/coins/request  — 提交金币申请
//   GET  /api/coins/requests — 查看自己的申请历史
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
import { createCoinRequest, listCoinRequestsForKid } from '../../utils/coin-request.ts';

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

// ---------------- POST /api/coins/request (kid submit coin request) ----------------

interface CoinRequestBody {
  amount?: unknown;
  reason?: unknown;
}

coins.post('/request', async (c) => {
  const db = c.env.DB;

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'invalid JSON body' } },
      400,
    );
  }

  const body = raw as CoinRequestBody;

  // Validate amount: must be integer > 0 (1-999 range)
  if (
    typeof body.amount !== 'number' ||
    !Number.isInteger(body.amount) ||
    body.amount < 1 ||
    body.amount > 999
  ) {
    return c.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message: 'amount must be an integer between 1 and 999',
        },
      },
      400,
    );
  }

  // Validate reason: non-empty string, 1-200 chars after trim
  if (typeof body.reason !== 'string') {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'reason must be a string' } },
      400,
    );
  }
  const trimmedReason = body.reason.trim();
  if (trimmedReason.length === 0 || trimmedReason.length > 200) {
    return c.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message: 'reason must be 1–200 non-whitespace characters',
        },
      },
      400,
    );
  }

  try {
    const result = await createCoinRequest(db, CHILD_USER_ID, body.amount, trimmedReason);
    // Fetch the freshly-inserted row to return the server-assigned fields.
    const row = await db
      .prepare(
        `SELECT id, status, amount, requested_at
         FROM coin_requests WHERE id = ?`,
      )
      .bind(result.id)
      .first();
    return c.json(
      {
        id: row!.id,
        status: row!.status,
        amount: row!.amount,
        requested_at: row!.requested_at,
      },
      201,
    );
  } catch (err) {
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: String(err) } },
      500,
    );
  }
});

// ---------------- GET /api/coins/requests (kid list own request history) ----------------

const KID_REQUEST_HISTORY_LIMIT = 50;

coins.get('/requests', async (c) => {
  const db = c.env.DB;
  const requests = await listCoinRequestsForKid(db, CHILD_USER_ID, KID_REQUEST_HISTORY_LIMIT);
  return c.json({ requests });
});

export default coins;

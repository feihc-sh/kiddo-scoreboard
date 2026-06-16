// src/routes/shop/exchange.ts
// Module 7 (Coin System, M3 — RFC §4.4):
//   POST /api/coins/exchange
//     Body: { item_id: number }
//     3 步短路校验 (RFC §4.4 + Test Plan §2 TC-F6/F7):
//       1) item.is_active=1? 否返 404 ITEM_NOT_FOUND
//       2) 余额 >= cost_coins? 不够返 400 INSUFFICIENT_COINS + { need, have }
//       3) weekly_limit 未达? 达返 400 WEEKLY_LIMIT_REACHED + { limit, used }
//     通过后 2 个 db.batch() 原子写:
//       Batch 1: score_events (-cost_coins coins [+reward_value game_time])
//         — 自包含, atomic
//       Batch 2: shop_redemptions (status 视 kind 而定) + audit_log
//         — self-contained, atomic; FK 引用 batch 1 的 event id
//     失败模式: 如果 batch 1 成功但 batch 2 失败, child 扣了金币但没有
//     redemption 记录 — 在 catch 写 -cost_coins 的退款 event 兜底。
//
// 状态分流 (RFC §5.1/§5.2):
//   - kind='game_time' → status='approved' (自动, 写 2 events + redemption)
//   - kind='custom'    → status='pending'  (等 PM 手动 fulfill, 无 reward event)
//
// Auth: child user_id is HARDCODED to 2 (CHILD_USER_ID) to match
// seeds/local.sql + src/routes/me/* pattern. M5 will replace with real auth.

import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCoinBalance, getWeeklyRedemptionCount } from '../../utils/coin.ts';
import { currentWeek } from '../../utils/week.ts';
import type { Env } from '../../worker.ts';

const CHILD_USER_ID = 2;

const exchange = new Hono<{ Bindings: Env }>();

// ---------------- helpers ----------------

interface ItemRow {
  id: number;
  name: string;
  kind: 'game_time' | 'pocket_money' | 'custom';
  cost_coins: number;
  reward_value: number;
  reward_type: 'game_time' | 'pocket_money' | 'none';
  description: string | null;
  icon: string | null;
  is_active: 0 | 1;
  weekly_limit: number;
}

function badRequest(c: Context<{ Bindings: Env }>, message: string) {
  return c.json({ error: { code: 'BAD_REQUEST', message } }, 400);
}

function jsonError(
  c: Context<{ Bindings: Env }>,
  code: string,
  message: string,
  status: number,
  extra: Record<string, unknown> = {},
) {
  return c.json({ error: { code, message, ...extra } }, status as 400);
}

async function loadItem(c: Context<{ Bindings: Env }>, id: number): Promise<ItemRow | null> {
  return c.env.DB
    .prepare(
      `SELECT id, name, kind, cost_coins, reward_value, reward_type,
              description, icon, is_active, weekly_limit
       FROM shop_items WHERE id = ?`,
    )
    .bind(id)
    .first<ItemRow>();
}

function parseBody(
  raw: unknown,
): { ok: true; itemId: number } | { ok: false; code: string; message: string } {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'BAD_REQUEST', message: 'body must be a JSON object' };
  }
  const b = raw as Record<string, unknown>;
  if (b.item_id === undefined || b.item_id === null) {
    return { ok: false, code: 'BAD_REQUEST', message: 'item_id is required' };
  }
  if (typeof b.item_id !== 'number' || !Number.isInteger(b.item_id) || b.item_id <= 0) {
    return { ok: false, code: 'BAD_REQUEST', message: 'item_id must be a positive integer' };
  }
  return { ok: true, itemId: b.item_id };
}

// ---------------- POST /exchange (POST /api/coins/exchange when mounted) ----------------

exchange.post('/exchange', async (c) => {
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
  const { itemId } = parsed;

  const db = c.env.DB;
  const week = currentWeek();
  const now = Math.floor(Date.now() / 1000);

  // -------------------------------------------------------------
  // 3 步短路校验 (顺序很重要: 不存在优先于缺钱优先于周限额,
  // 这样错误信息能让 PM / child 快速定位问题)
  // -------------------------------------------------------------

  // 1) 加载商品 (RFC §4.4 step 1: 必须存在 + active=1)
  const item = await loadItem(c, itemId);
  if (!item || item.is_active !== 1) {
    return jsonError(c, 'ITEM_NOT_FOUND', `shop item ${itemId} not found or inactive`, 404);
  }

  // 2) 余额校验 (RFC §4.4 step 2: 余额够才允许)
  const balance = await getCoinBalance(db, CHILD_USER_ID);
  if (balance < item.cost_coins) {
    return jsonError(
      c,
      'INSUFFICIENT_COINS',
      `insufficient coins: need ${item.cost_coins}, have ${balance}`,
      400,
      { need: item.cost_coins, have: balance, item_id: itemId },
    );
  }

  // 3) 周限额校验 (RFC §4.4 step 3)
  // 用 coin.ts 的 getWeeklyRedemptionCount, 它 M3 起包含 'consumed' / 'pending' / 'approved'
  // 三种状态 (排除 'revoked' — PM 撤销后 child 可再兑)。
  // 2026-06-16 fix: 传 itemId 让 SQL 按 per-item 计数 (之前 SQL 缺 item_id 过滤, 把 user
  // 全部 item 的本周兑换都算进 used, 错把 cross-item 兑换数当 same-item 计数).
  const weekUsed = await getWeeklyRedemptionCount(db, CHILD_USER_ID, week, itemId);
  if (item.weekly_limit > 0 && weekUsed >= item.weekly_limit) {
    return jsonError(
      c,
      'WEEKLY_LIMIT_REACHED',
      `weekly redemption limit reached for item ${itemId}`,
      400,
      { item_id: itemId, limit: item.weekly_limit, used: weekUsed, week_of: week },
    );
  }

  // -------------------------------------------------------------
  // 2 个 db.batch() 原子写 (event-batch + redemption-batch)
  // -------------------------------------------------------------
  // 设计: 1 个 batch 写 self-contained 的 score_events (因为它们之间无 FK 引用);
  //       1 个 batch 写 shop_redemptions + audit_log (redemption 的 FK 引用 batch 1
  //       的 event id, 所以必须分 2 步)。
  // 失败兜底: 如果 batch 2 失败, 在 catch 写 -cost_coins 的退款 event。

  const redemptionStatus: 'pending' | 'approved' = item.kind === 'custom' ? 'pending' : 'approved';

  let coinEventId = 0;
  let rewardEventId: number | null = null;

  try {
    // ===== Batch 1: score_events (-cost_coins coins, +reward_value game_time) =====
    const eventStatements: Array<ReturnType<typeof db.prepare>> = [
      db
        .prepare(
          `INSERT INTO score_events
             (user_id, type, change_value, reason, status, submitted_by,
              source, week_of, created_at)
           VALUES (?, 'coins', ?, ?, 'approved', 'child', 'exchange', ?, ?)`,
        )
        .bind(
          CHILD_USER_ID,
          -item.cost_coins,
          `exchange: -${item.cost_coins} for ${item.name}`,
          week,
          now,
        ),
    ];
    if (item.reward_type !== 'none') {
      eventStatements.push(
        db
          .prepare(
            `INSERT INTO score_events
               (user_id, type, change_value, reason, status, submitted_by,
                source, week_of, created_at)
             VALUES (?, ?, ?, ?, 'approved', 'system', 'exchange', ?, ?)`,
          )
          .bind(
            CHILD_USER_ID,
            item.reward_type,
            item.reward_value,
            `exchange: +${item.reward_value} ${item.reward_type} from ${item.name}`,
            week,
            now,
          ),
      );
    }
    const eventResults = await db.batch(eventStatements);
    // D1: meta.last_row_id gives the AUTOINCREMENT id of the last INSERT in that stmt
    coinEventId = Number(eventResults[0]?.meta?.last_row_id ?? 0);
    if (item.reward_type !== 'none' && eventResults[1]) {
      rewardEventId = Number(eventResults[1].meta?.last_row_id ?? 0);
    }

    // ===== Batch 2: shop_redemptions + audit_log =====
    const redemptionResults = await db.batch([
      db
        .prepare(
          `INSERT INTO shop_redemptions
             (user_id, item_id, week_of, cost_coins, reward_value, reward_type,
              status, redeemed_at, coin_event_id, reward_event_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          CHILD_USER_ID,
          item.id,
          week,
          item.cost_coins,
          item.reward_value,
          item.reward_type,
          redemptionStatus,
          now,
          coinEventId,
          rewardEventId,
          now,
        ),
      db
        .prepare(
          `INSERT INTO audit_log
             (actor, action, target_event_id, target_user_id, details, created_at)
           VALUES ('child', 'coin_exchange', NULL, ?, ?, ?)`,
        )
        .bind(
          CHILD_USER_ID,
          JSON.stringify({
            item_id: item.id,
            item_name: item.name,
            item_kind: item.kind,
            cost_coins: item.cost_coins,
            reward_value: item.reward_value,
            reward_type: item.reward_type,
            status: redemptionStatus,
            week_of: week,
            coin_event_id: coinEventId,
            reward_event_id: rewardEventId,
          }),
          now,
        ),
    ]);
    const redemptionId = Number(redemptionResults[0]?.meta?.last_row_id ?? 0);

    return c.json({
      redemption_id: redemptionId,
      status: redemptionStatus,
      item_id: item.id,
      item_name: item.name,
      cost_coins: item.cost_coins,
      reward_value: item.reward_value,
      reward_type: item.reward_type,
      coin_event_id: coinEventId,
      reward_event_id: rewardEventId,
      new_balance: balance - item.cost_coins,
      pending: redemptionStatus === 'pending',
    });
  } catch (err) {
    // 兜底: batch 1 成功但 batch 2 失败 → 写退款 event, 让 balance 不丢
    if (coinEventId > 0) {
      try {
        await db
          .prepare(
            `INSERT INTO score_events
               (user_id, type, change_value, reason, status, submitted_by,
                source, week_of, created_at)
             VALUES (?, 'coins', ?, ?, 'approved', 'system', 'exchange', ?, ?)`,
          )
          .bind(
            CHILD_USER_ID,
            item.cost_coins,
            `exchange-rollback: refund ${item.cost_coins} (batch 2 failed)`,
            week,
            Math.floor(Date.now() / 1000),
          )
          .run();
      } catch {
        // 退款也失败 — 没办法, 让 admin 看到 audit_log 'coin_exchange' 失败条目
        // 后续手动修复
      }
    }
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(c, 'INTERNAL', 'exchange failed: ' + message, 500);
  }
});

export default exchange;

// src/utils/balance.ts
// Balance calculation: sum approved events per account type.
// Status filter: 'approved' (pending and revoked do NOT affect balance).
// Result type: Balance = { game_time, pocket_money, coins } (Module 7).

import type { Balance, D1Database } from '../db/types.ts';

const ZERO_BALANCE: Balance = { game_time: 0, pocket_money: 0, coins: 0 };

/**
 * Compute current balance for a user by aggregating approved score_events.
 * Returns 0/0/0 if user has no events.
 */
export async function computeBalance(db: D1Database, userId: number): Promise<Balance> {
  const result = await db
    .prepare(
      `SELECT type, COALESCE(SUM(change_value), 0) AS total
       FROM score_events
       WHERE user_id = ? AND status = 'approved'
       GROUP BY type`,
    )
    .bind(userId)
    .all<{ type: 'game_time' | 'pocket_money' | 'coins'; total: number }>();

  const balance: Balance = { ...ZERO_BALANCE };
  for (const row of result.results ?? []) {
    balance[row.type] = Number(row.total) || 0;
  }
  return balance;
}

/**
 * Get balance for a specific account type.
 */
export async function getAccountBalance(
  db: D1Database,
  userId: number,
  account: 'game_time' | 'pocket_money' | 'coins',
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(change_value), 0) AS total
       FROM score_events
       WHERE user_id = ? AND type = ? AND status = 'approved'`,
    )
    .bind(userId, account)
    .first<{ total: number }>();
  return Number(row?.total) || 0;
}

/**
 * Get pending events count (for PM "needs review" badge).
 */
export async function countPendingEvents(db: D1Database, userId: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM score_events
       WHERE user_id = ? AND status = 'pending'`,
    )
    .bind(userId)
    .first<{ n: number }>();
  return Number(row?.n) || 0;
}

/**
 * Stage 2 (NIGHTLY-TODO #009): recompute a child's balance after a
 * hard-delete. Today this is just a thin wrapper around
 * `computeBalance` because we don't cache balances (the canonical
 * store is `score_events`, aggregated on read). Returns the new
 * balance so the caller can put it in the HTTP response.
 *
 * If a balance cache is added later, the upsert call should live
 * here — the endpoint shouldn't need to know.
 */
export async function recalcAfterHardDelete(
  db: D1Database,
  childId: number,
): Promise<Balance> {
  return computeBalance(db, childId);
}

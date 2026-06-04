// src/utils/balance.ts
// Balance calculation: sum approved events per account type.
// Status filter: 'approved' (pending and revoked do NOT affect balance).
// Result type: Balance = { game_time, pocket_money }.

import type { Balance, D1Database } from '../db/types.ts';

const ZERO_BALANCE: Balance = { game_time: 0, pocket_money: 0 };

/**
 * Compute current balance for a user by aggregating approved score_events.
 * Returns 0/0 if user has no events.
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
    .all<{ type: 'game_time' | 'pocket_money'; total: number }>();

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
  account: 'game_time' | 'pocket_money',
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

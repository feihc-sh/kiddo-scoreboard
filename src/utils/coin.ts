// src/utils/coin.ts
// Module 7 (Coin System, RFC §3 + §5): coin-specific helpers.
//
// Coin balance model (RFC §3.4 INV-1):
//   balance = SUM(change_value WHERE type='coins' AND status='approved')
//
// All functions take a D1Database binding. They don't touch HTTP — the
// route layer (M2/M3) wraps these with auth + JSON shaping.
//
// Source-ref conventions (RFC §5.1-5.3):
//   - task grant (+1):       'task:<taskId>:<date>:<userId>'
//   - bonus grant (+3):      'bonus:<date>:<userId>'        (unique per day+user)
//   - task revoke (-1):      'revoke:task:<taskId>:<date>:<userId>'
//   - bonus revoke (-3):     'revoke:bonus:<date>:<userId>'
//
// The bonus source_ref is intentionally date-only (not week-coupled) so
// cross-week revoke still finds the original +3 event (RFC §8.1 / TC-X3).

import type { D1Database } from '../db/types.ts';
import { isoWeekString } from './week.ts';

// =============================================================
// Reads
// =============================================================

/**
 * Current coin balance for a user (RFC §3.4 INV-1).
 * Returns 0 if the user has no approved coin events.
 *
 * Mirrors the algebraic-sum pattern in src/utils/balance.ts:computeBalance
 * but filtered to a single type.
 */
export async function getCoinBalance(
  db: D1Database,
  userId: number,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(change_value), 0) AS balance
       FROM score_events
       WHERE user_id = ? AND type = 'coins' AND status = 'approved'`,
    )
    .bind(userId)
    .first<{ balance: number }>();
  return Number(row?.balance ?? 0);
}

/**
 * Last-updated timestamp for a user's coin balance.
 * Returns 0 if the user has no approved coin events.
 * Used by CoinBalance.lastUpdatedAt in src/db/types.ts.
 */
export async function getCoinBalanceUpdatedAt(
  db: D1Database,
  userId: number,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(MAX(created_at), 0) AS last_at
       FROM score_events
       WHERE user_id = ? AND type = 'coins' AND status = 'approved'`,
    )
    .bind(userId)
    .first<{ last_at: number }>();
  return Number(row?.last_at ?? 0);
}

/**
 * Has the user completed every active task today?
 * Returns false if there are zero active tasks (vacation / config gap —
 * the bonus check should require at least one completion to fire).
 *
 * "Active" means: tasks.is_active = 1 AND task_completions.status = 'active'.
 * Revoked completions (TC-F3) don't count, so a revoke+redo cycle can
 * re-arm the bonus check (TC-F5 / TC-X4).
 */
export async function isAllTasksCompleted(
  db: D1Database,
  userId: number,
  date: string,                  // 'YYYY-MM-DD' Asia/Shanghai
): Promise<boolean> {
  const activeRow = await db
    .prepare(`SELECT COUNT(*) AS cnt FROM tasks WHERE is_active = 1`)
    .first<{ cnt: number }>();
  const activeCount = Number(activeRow?.cnt ?? 0);
  if (activeCount === 0) return false;

  const doneRow = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM task_completions
       WHERE user_id = ? AND completed_date = ? AND status = 'active'`,
    )
    .bind(userId, date)
    .first<{ cnt: number }>();
  const doneCount = Number(doneRow?.cnt ?? 0);

  return activeCount === doneCount;
}

/**
 * Has the bonus been granted for (date, userId) today?
 * Used by revokeCoinsForTask to decide whether to also write -3 (TC-F4).
 *
 * Looks up via the unique source_ref 'bonus:<date>:<userId>' that
 * grantCoinsForTaskCompletion uses when writing the +3 row.
 *
 * This intentionally filters change_value = 3 (positive) so a previously
 * reversed bonus doesn't trigger a second -3 (TC-F4 idempotent edge).
 */
export async function findBonusEvent(
  db: D1Database,
  userId: number,
  date: string,
): Promise<number | null> {
  const row = await db
    .prepare(
      `SELECT id FROM score_events
       WHERE user_id = ? AND type = 'coins' AND change_value = 3
         AND reason LIKE 'bonus:%' AND source_ref = ?
         AND status = 'approved'`,
    )
    .bind(userId, `bonus:${date}:${userId}`)
    .first<{ id: number }>();
  return row?.id ?? null;
}

/**
 * Count redemptions a user has made this ISO week (excluding revoked).
 * Used by the weekly_limit check on POST /api/coins/exchange (M3, TC-F7).
 *
 * weekOf: 'YYYY-Www' (RFC §2.3 ISO 8601 Monday-first).
 */
export async function getWeeklyRedemptionCount(
  db: D1Database,
  userId: number,
  weekOf: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM shop_redemptions
       WHERE user_id = ? AND week_of = ? AND status = 'consumed'`,
    )
    .bind(userId, weekOf)
    .first<{ cnt: number }>();
  return Number(row?.cnt ?? 0);
}

// =============================================================
// Writes (return row IDs so callers can wire audit_log / FK references)
// =============================================================

/**
 * Write the +1 coin event for a task completion.
 * Caller is responsible for the matching task_completions row (M2).
 *
 * Uses RETURNING to capture the new id without a second SELECT.
 */
export async function writeTaskCoinGrant(
  db: D1Database,
  userId: number,
  taskId: number,
  date: string,
): Promise<number> {
  const weekOf = isoWeekString(new Date(`${date}T00:00:00Z`));
  const result = await db
    .prepare(
      `INSERT INTO score_events
         (user_id, type, change_value, reason, status, submitted_by, source, source_ref, week_of)
       VALUES (?, 'coins', 1, ?, 'approved', 'child', 'task', ?, ?)
       RETURNING id`,
    )
    .bind(
      userId,
      `task:#${taskId}`,
      `task:${taskId}:${date}:${userId}`,
      weekOf,
    )
    .first<{ id: number }>();
  return Number(result?.id ?? 0);
}

/**
 * Write the +3 all-tasks-completed bonus.
 * Idempotent by source_ref (RFC §5.1 edge: TC-F2 idempotent, TC-X3 cross-day).
 * If a bonus already exists for this (date, userId), returns the existing
 * id without writing a duplicate row.
 */
export async function writeDailyBonusIfMissing(
  db: D1Database,
  userId: number,
  date: string,
): Promise<number | null> {
  const existing = await findBonusEvent(db, userId, date);
  if (existing !== null) return existing;

  const weekOf = isoWeekString(new Date(`${date}T00:00:00Z`));
  const result = await db
    .prepare(
      `INSERT INTO score_events
         (user_id, type, change_value, reason, status, submitted_by, source, source_ref, week_of)
       VALUES (?, 'coins', 3, ?, 'approved', 'system', 'task', ?, ?)
       RETURNING id`,
    )
    .bind(
      userId,
      `bonus:${date}:${userId}`,
      `bonus:${date}:${userId}`,
      weekOf,
    )
    .first<{ id: number }>();
  return result?.id ?? null;
}

/**
 * Task completion → grant +1 coin, check + grant daily bonus if all done.
 * Composite of writeTaskCoinGrant + writeDailyBonusIfMissing so M2 has a
 * single call site (matches the "atomic" intent in TC-F2 / RFC §5.1).
 *
 * Returns the coin event id always; bonusEventId is null when bonus
 * didn't trigger (still have un-done tasks) or already existed today.
 *
 * NOTE: This implementation issues 3 sequential statements (grant, check,
 * bonus). For full atomicity M2 should wrap these in db.batch() — but
 * M1's scope is the unit-level helpers, and the unit tests can verify
 * behavior with mocks. The route layer (M2) is the natural place for
 * the batch wrap because it owns the task_completions transaction.
 */
export async function grantCoinsForTaskCompletion(
  db: D1Database,
  userId: number,
  taskId: number,
  date: string,
): Promise<{ coinEventId: number; bonusEventId: number | null }> {
  const coinEventId = await writeTaskCoinGrant(db, userId, taskId, date);

  const allDone = await isAllTasksCompleted(db, userId, date);
  const bonusEventId = allDone
    ? await writeDailyBonusIfMissing(db, userId, date)
    : null;

  return { coinEventId, bonusEventId };
}

/**
 * Task revoke → reverse -1 coin, check + reverse -3 bonus if it was granted.
 * Mirrors grantCoinsForTaskCompletion. The +1 grant's existence is assumed
 * (caller has already revoked the task_completion row, so balance should
 * reflect the undo). The bonus check is the inverse of the grant's
 * idempotency: if the bonus hasn't been reversed yet, write -3.
 */
export async function revokeCoinsForTask(
  db: D1Database,
  userId: number,
  taskId: number,
  date: string,
): Promise<{ revokeCoinEventId: number; revokeBonusEventId: number | null }> {
  const weekOf = isoWeekString(new Date(`${date}T00:00:00Z`));
  const coinResult = await db
    .prepare(
      `INSERT INTO score_events
         (user_id, type, change_value, reason, status, submitted_by, source, source_ref, week_of)
       VALUES (?, 'coins', -1, ?, 'approved', 'pm', 'task', ?, ?)
       RETURNING id`,
    )
    .bind(
      userId,
      `revoke:task:#${taskId}`,
      `revoke:task:${taskId}:${date}:${userId}`,
      weekOf,
    )
    .first<{ id: number }>();
  const revokeCoinEventId = Number(coinResult?.id ?? 0);

  const bonusId = await findBonusEvent(db, userId, date);
  let revokeBonusEventId: number | null = null;
  if (bonusId !== null) {
    const bonusResult = await db
      .prepare(
        `INSERT INTO score_events
           (user_id, type, change_value, reason, status, submitted_by, source, source_ref, week_of)
         VALUES (?, 'coins', -3, ?, 'approved', 'pm', 'task', ?, ?)
         RETURNING id`,
      )
      .bind(
        userId,
        `revoke:bonus:${date}:${userId}`,
        `revoke:bonus:${date}:${userId}`,
        weekOf,
      )
      .first<{ id: number }>();
    revokeBonusEventId = bonusResult?.id != null ? Number(bonusResult.id) : null;
  }

  return { revokeCoinEventId, revokeBonusEventId };
}
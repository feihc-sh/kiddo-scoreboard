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
 *
 * FIX (2026-07-16 feihao 拍板): 用 NOT EXISTS 检查每个 active task 是不是
 * 都被今天 active completion 覆盖。旧 activeCount === doneCount 会被
 * "admin 关掉 task 但 task_completion 残留" 破坏 (doneCount 算上 is_active=0
 * 的 row, activeCount 不算 → 永远不相等,bonus 永不触发)。新语义:
 * "active task 全完成 = bonus" — 只要还有 active task 没完成就不触发,
 * 完成过几个 inactive task 不影响判定。
 */
export async function isAllTasksCompleted(
  db: D1Database,
  userId: number,
  date: string,                  // 'YYYY-MM-DD' Asia/Shanghai
): Promise<boolean> {
  // Guard: zero active tasks → no bonus (nothing to "complete all of").
  const activeRow = await db
    .prepare(`SELECT COUNT(*) AS cnt FROM tasks WHERE is_active = 1`)
    .first<{ cnt: number }>();
  const activeCount = Number(activeRow?.cnt ?? 0);
  if (activeCount === 0) return false;

  // Bonus fires iff every active task has an active completion today.
  // undoneCount = active tasks WITHOUT a today's active completion.
  const undoneRow = await db
    .prepare(
      `SELECT COUNT(*) AS cnt
       FROM tasks t
       WHERE t.is_active = 1
         AND NOT EXISTS (
           SELECT 1 FROM task_completions tc
           WHERE tc.task_id = t.id
             AND tc.user_id = ?
             AND tc.completed_date = ?
             AND tc.status = 'active'
         )`,
    )
    .bind(userId, date)
    .first<{ cnt: number }>();
  const undoneCount = Number(undoneRow?.cnt ?? 0);

  return undoneCount === 0;
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
 * Count redemptions a user has made this ISO week for a specific item
 * (excluding revoked).
 * Used by the weekly_limit check on POST /api/coins/exchange (M3, TC-F7)
 * and by GET /api/shop/items to compute `weekly_limit_remaining` (M4).
 *
 * M3 (2026-06-15): 'revoked' is the only excluded status — 'consumed' (old),
 * 'pending' (custom flow), and 'approved' (game_time flow) all count, because
 * a child who has redeemed a custom item shouldn't be able to redeem a
 * second one even if the PM hasn't yet fulfilled the first (TC-X8 fairness).
 *
 * FIX (2026-06-16 feihao 报告): SQL 缺 `item_id` 过滤, 把 user 全部 item
 * 的本周兑换都算进 used (例如 feihao 换 2 次游戏时间后, 小乐高 weekly_limit
 * check 错用 total=2 跟 1 比较, 永远 fail). 加 itemId parameter + SQL filter.
 *
 * weekOf: 'YYYY-Www' (RFC §2.3 ISO 8601 Monday-first).
 */
export async function getWeeklyRedemptionCount(
  db: D1Database,
  userId: number,
  weekOf: string,
  itemId: number,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM shop_redemptions
       WHERE user_id = ? AND week_of = ? AND item_id = ?
         -- S2 (2026-06-15 feihao 拍板, v1.1 RFC §3.3): 新业务只查 'pending'/'approved'.
         -- v1 'consumed' / 'revoked' records 保留在 DB 但不参与新 week count
         -- (migration 0008 enum 仍含 4 个, 兼容 v1 已有 data; code 严格化在
         --  query 层, 不动 migration 避免破坏 v1 production data).
         AND status IN ('pending', 'approved')`,
    )
    .bind(userId, weekOf, itemId)
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

// =============================================================
// SQL builders (M2 atomicity bridge)
// =============================================================
//
// M1's grantCoinsForTaskCompletion / revokeCoinsForTask do 2-3 sequential
// statements (grant, check, bonus) and the SELECT-driven branches can't
// be flattened into one batch. The M2 route layer, however, owns the
// task_completions transaction and wants the +1 / -1 coin grant to
// share that batch (so a "complete a task" failure can never leave a
// child with a completion but no +1 coin — see PM 委托 关键约束 #4).
//
// These four functions return the {query, params} for the INSERT
// statement so the route layer can wrap them with `db.prepare(q).bind(...p)`
// and add them to its own db.batch() call. The bonus / revoke-bonus
// builders are async because they have to read state
// (isAllTasksCompleted / findBonusEvent) to decide whether to return
// a SQL payload or null.
//
// (We deliberately return raw SQL+params rather than a D1PreparedStatement
// instance: the @cloudflare/workers-types ambient D1PreparedStatement and
// the local mock in src/db/types.ts are structurally identical but TS
// treats them as distinct types, so a returned statement object would
// not be assignable to `db.batch(statements: D1PreparedStatement[])` from
// the route layer's perspective.)

/**
 * Build the +1 coin INSERT (query, params) for a task completion.
 * Route layer wraps with `db.prepare(q).bind(...p)` and adds to its
 * existing db.batch() so the +1 coin is committed atomically with
 * the task_completions row.
 *
 * No SELECT, no read; safe to inject into a batch directly.
 */
export function buildTaskCoinGrantSQL(
  userId: number,
  taskId: number,
  date: string,
): { query: string; params: unknown[] } {
  // SQL shape mirrors the original route's score_events INSERT (5 bound
  // params: user_id, type, change_value, reason, source_ref; status,
  // submitted_by, source, week_of, created_at are inlined as literals /
  // NULL / unixepoch()).
  //
  // Why bind 'coins' and 1 instead of inlining them: unit-test mocks
  // (and any future consumer that introspects bound params) expect the
  // first 5 ? slots to be [user_id, type, change_value, reason,
  // source_ref]. M1's writeTaskCoinGrant took a similar shortcut by
  // leaving type/change_value as SQL literals — that one is 4-params
  // and is only used internally by grantCoinsForTaskCompletion where
  // no test mock is involved. M2 puts the +1 coin into a route-layer
  // batch where mocks DO read bound params, so we bind all 5.
  //
  // week_of is inlined to NULL — M2 does not depend on weekly
  // aggregation for coin grants (weekly_limit is checked on
  // shop_redemptions, not score_events).
  return {
    query:
      `INSERT INTO score_events ` +
      `(user_id, type, change_value, reason, status, submitted_by, source, source_ref, week_of, created_at) ` +
      `VALUES (?, ?, ?, ?, 'approved', 'child', 'task', ?, NULL, unixepoch())`,
    params: [
      userId,
      'coins',
      1,
      `task:#${taskId}`,
      `task:${taskId}:${date}:${userId}`,
    ],
  };
}

/**
 * Build the +3 daily-bonus INSERT (query, params) iff all active tasks
 * are completed for (userId, date) and no bonus has been issued yet.
 *
 * Returns null when: (a) some task is still un-done, OR (b) a bonus
 * already exists (idempotent re-issue guard, mirrors
 * writeDailyBonusIfMissing's existing semantics).
 *
 * Async because the decision requires 2 SELECTs (active task count
 * + existing-bonus lookup). The route layer awaits this AFTER its
 * primary batch has already committed the +1 coin, so a "bonus
 * already exists" answer simply means we skip the second batch.
 */
export async function buildDailyBonusSQLIfAllDone(
  _db: D1Database,
  userId: number,
  date: string,
): Promise<{ query: string; params: unknown[] } | null> {
  const allDone = await isAllTasksCompleted(_db, userId, date);
  if (!allDone) return null;

  const existing = await findBonusEvent(_db, userId, date);
  if (existing !== null) return null;

  return {
    query:
      `INSERT INTO score_events ` +
      `(user_id, type, change_value, reason, status, submitted_by, source, source_ref, week_of, created_at) ` +
      `VALUES (?, ?, ?, ?, 'approved', 'system', 'task', ?, NULL, unixepoch())`,
    params: [
      userId,
      'coins',
      3,
      `bonus:${date}:${userId}`,
      `bonus:${date}:${userId}`,
    ],
  };
}

/**
 * Build the -1 coin INSERT (query, params) for a task revoke.
 * Mirrors buildTaskCoinGrantSQL but for the inverse direction.
 * source_ref is anchored on the original (date, userId, taskId) tuple
 * — NOT on the task_completion id, so a cross-day revoke can still
 * find the original +1 if needed for audit reconciliation.
 */
export function buildRevokeTaskCoinSQL(
  userId: number,
  taskId: number,
  date: string,
): { query: string; params: unknown[] } {
  return {
    query:
      `INSERT INTO score_events ` +
      `(user_id, type, change_value, reason, status, submitted_by, source, source_ref, week_of, created_at) ` +
      `VALUES (?, ?, ?, ?, 'approved', 'pm', 'task', ?, NULL, unixepoch())`,
    params: [
      userId,
      'coins',
      -1,
      `revoke:task:#${taskId}`,
      `revoke:task:${taskId}:${date}:${userId}`,
    ],
  };
}

/**
 * Build the -3 daily-bonus-reverse INSERT (query, params) iff a +3
 * bonus still exists for (userId, date). Mirrors findBonusEvent
 * semantics: filters change_value = 3 (positive), so a
 * previously-reversed bonus (already at -3) does NOT trigger a
 * duplicate -3 (TC-F4 idempotent).
 *
 * Returns null when: no bonus exists, or bonus was already reversed
 * by a prior revoke. Async because of the existence SELECT.
 */
export async function buildRevokeBonusSQLIfPresent(
  _db: D1Database,
  userId: number,
  date: string,
): Promise<{ query: string; params: unknown[] } | null> {
  const existing = await findBonusEvent(_db, userId, date);
  if (existing === null) return null;

  return {
    query:
      `INSERT INTO score_events ` +
      `(user_id, type, change_value, reason, status, submitted_by, source, source_ref, week_of, created_at) ` +
      `VALUES (?, ?, ?, ?, 'approved', 'pm', 'task', ?, NULL, unixepoch())`,
    params: [
      userId,
      'coins',
      -3,
      `revoke:bonus:${date}:${userId}`,
      `revoke:bonus:${date}:${userId}`,
    ],
  };
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
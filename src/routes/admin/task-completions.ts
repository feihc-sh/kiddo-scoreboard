// src/routes/admin/task-completions.ts
// PM-only endpoints for task completions.
//
//   GET  /api/admin/task-completions
//     ?user_id=N (required, positive integer)
//     ?date='YYYY-MM-DD' (optional, default = todayShanghai)
//     ?status='active'|'revoked' (optional, default 'active')
//     Returns { completions: TaskCompletion[], count: number }.
//
//   POST /api/admin/task-completions/:id/revoke
//     Revoke a child's task completion. Atomically:
//       1. UPDATE task_completions SET status='revoked', revoked_at, revoked_by
//       2. UPDATE score_events SET status='revoked' for the awarded event
//       3. INSERT audit_log row
//     All three writes go through a single db.batch() so the operation is
//     atomic at the D1 level.

import { Hono } from 'hono';
import type { Context } from 'hono';
import { getPmUserId } from '../../middleware/requirePm.ts';
import { computeBalance, recalcAfterHardDelete } from '../../utils/balance.ts';
import { moveToDeletedRecords } from '../../utils/deleted-records.ts';
import { logAudit } from '../../utils/audit.ts';
import { todayShanghai } from '../../utils/week.ts';
import {
  buildRevokeTaskCoinSQL,
  buildRevokeBonusSQLIfPresent,
} from '../../utils/coin.ts';
import type { Env } from '../../worker.ts';
import type { Balance, CompletionStatus, TaskCompletion } from '../../db/types.ts';

const taskCompletions = new Hono<{ Bindings: Env }>();

// ---------------- GET / (list) ----------------
//
// The SELECT below returns 6 of the 8 TaskCompletion columns; the revoke
// fields (revoked_at, revoked_by) are omitted from the list response to
// keep the payload small. We type the rows with a narrow Omit to stay
// honest with the shape that actually comes back from D1.
type TaskCompletionListItem = Omit<TaskCompletion, 'revoked_at' | 'revoked_by'>;

taskCompletions.get('/', async (c) => {
  const pmUserId = await getPmUserId(c);
  if (pmUserId == null) {
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'PM session required' } },
      401,
    );
  }

  // user_id: required, positive integer
  const userIdRaw = c.req.query('user_id');
  if (userIdRaw == null) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'user_id is required' } },
      400,
    );
  }
  const userId = Number(userIdRaw);
  if (!Number.isInteger(userId) || userId <= 0) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'user_id must be a positive integer' } },
      400,
    );
  }

  // date: optional, default = todayShanghai
  const dateRaw = c.req.query('date');
  const date = dateRaw == null || dateRaw === '' ? todayShanghai() : dateRaw;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'date must be in YYYY-MM-DD format' } },
      400,
    );
  }

  // status: optional, default 'active'
  const statusRaw = c.req.query('status') ?? 'active';
  if (statusRaw !== 'active' && statusRaw !== 'revoked') {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: "status must be 'active' or 'revoked'" } },
      400,
    );
  }
  const status = statusRaw as CompletionStatus;

  const result = await c.env.DB
    .prepare(
      `SELECT id, task_id, user_id, status, completed_date, completed_at, awarded_event_id
       FROM task_completions
       WHERE user_id = ? AND completed_date = ? AND status = ?
       ORDER BY completed_at DESC`,
    )
    .bind(userId, date, status)
    .all<TaskCompletionListItem>();

  const completions = result.results ?? [];
  return c.json({ completions, count: completions.length });
});

taskCompletions.post('/:id/revoke', async (c) => {
  const pmUserId = await getPmUserId(c);
  if (pmUserId == null) {
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'PM session required' } },
      401,
    );
  }

  const idRaw = c.req.param('id');
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'id must be a positive integer' } },
      400,
    );
  }

  const db = c.env.DB;

  // Load completion
  const completion = await db
    .prepare(
      `SELECT id, task_id, user_id, status, completed_date, completed_at,
              awarded_event_id, revoked_at, revoked_by
       FROM task_completions WHERE id = ?`,
    )
    .bind(id)
    .first<TaskCompletion>();
  if (!completion) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'task_completion not found' } },
      404,
    );
  }

  if (completion.status === 'revoked') {
    return c.json(
      { error: { code: 'ALREADY_REVOKED', message: 'task_completion already revoked' } },
      409,
    );
  }

  // Look up the task so we can record its token_reward in the audit log.
  // (Spec calls this `original_token_reward`.)
  const task = await db
    .prepare(`SELECT id, token_reward FROM tasks WHERE id = ?`)
    .bind(completion.task_id)
    .first<{ id: number; token_reward: number }>();
  const originalTokenReward = task?.token_reward ?? null;

  const now = Math.floor(Date.now() / 1000);

  // M2 (Coin System): the -1 coin revoke event is appended to this same
  // batch so a "revoke a task" failure can never leave a completion
  // marked 'revoked' without the matching -1 coin (PM 委托 关键约束 #4).
  // The completion row was completed on completion.completed_date, so
  // we feed that date to the helper (not today) so cross-day revoke
  // still produces a -1 anchored on the original (date, userId, taskId)
  // tuple. bonus -3 is also date-anchored to the original completion
  // date — findBonusEvent looks up by source_ref='bonus:<date>:<userId>'
  // which is date-scoped, so cross-day revoke still works (RFC §8.1).
  const revokeCoin = buildRevokeTaskCoinSQL(
    completion.user_id,
    completion.task_id,
    completion.completed_date,
  );

  // Atomic transaction: completion UPDATE + awarded event UPDATE +
  // -1 coin INSERT + audit_log INSERT in one batch.
  const results = await db.batch([
    db
      .prepare(
        `UPDATE task_completions
         SET status = 'revoked', revoked_at = ?, revoked_by = ?
         WHERE id = ?`,
      )
      .bind(now, pmUserId, id),
    db
      .prepare(
        `UPDATE score_events
         SET status = 'revoked', reviewed_at = ?, reviewed_by = ?
         WHERE id = ?`,
      )
      .bind(now, pmUserId, completion.awarded_event_id),
    // -1 coin (Coin System M2, RFC §4.7 / §5.3)
    db.prepare(revokeCoin.query).bind(...revokeCoin.params),
    db
      .prepare(
        `INSERT INTO audit_log
           (actor, action, target_event_id, target_user_id, details, created_at)
         VALUES ('pm', 'task_revoke', ?, ?, ?, ?)`,
      )
      .bind(
        completion.awarded_event_id,
        completion.user_id,
        JSON.stringify({
          completion_id: completion.id,
          task_id: completion.task_id,
          original_token_reward: originalTokenReward,
        }),
        now,
      ),
  ]);

  // The -1 coin INSERT is now statement index 2 in the batch.
  const revokeCoinEventId = Number(results[2]?.meta?.last_row_id ?? 0);

  // Bonus check: if a +3 bonus was granted on the same date, also
  // write a -3 reversal. SELECT-driven, runs in its own batch so a
  // bonus-only failure does not roll back the primary revoke batch.
  let revokeBonusEventId: number | null = null;
  const bonusSql = await buildRevokeBonusSQLIfPresent(
    db,
    completion.user_id,
    completion.completed_date,
  );
  if (bonusSql) {
    const bonusDetailsJson = JSON.stringify({
      task_id: completion.task_id,
      change_value: -3,
      type: 'coins',
      reason: 'bonus-revoked',
    });
    const bonusResults = await db.batch([
      db.prepare(bonusSql.query).bind(...bonusSql.params),
      db
        .prepare(
          `INSERT INTO audit_log
             (actor, action, target_event_id, target_user_id, details, created_at)
           VALUES ('pm', 'task_revoke', ?, ?, ?, ?)`,
        )
        .bind(
          completion.awarded_event_id,
          completion.user_id,
          bonusDetailsJson,
          now,
        ),
    ]);
    revokeBonusEventId = Number(bonusResults[0]?.meta?.last_row_id ?? 0);
  }

  // Recompute the user's balance after the event was flipped to 'revoked'.
  const newBalance: Balance = await computeBalance(db, completion.user_id);

  return c.json({
    completion_id: completion.id,
    task_id: completion.task_id,
    revoked_at: now,
    new_balance: newBalance,
    // Coin System M2 (RFC §4.7 / TC-F3 / TC-F4): expose the -1 coin event
    // id (and any -3 bonus id) so Qual can assert the SQL writes and the
    // PM UI can display "🪙 -1" alongside the legacy balance update.
    revoke_coin_event_id: revokeCoinEventId,
    revoke_bonus_event_id: revokeBonusEventId,
  });
});

// ---------------- POST /:id/hard-delete ----------------
//
// Stage 3 (NIGHTLY-TODO #009): parallel to events POST /:id/hard-delete.
// 1. Snapshot the row + delete it atomically (deleted_records).
// 2. Audit the *act* of deletion (completion_hard_deleted).
// 3. Recompute balance.
//
// Note: the underlying score_event (awarded_event_id) is NOT touched —
// only the completion row goes away. So the balance, which is derived
// from approved score_events, is unchanged after this call.

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

taskCompletions.post('/:id/hard-delete', async (c) => {
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
  const completion = await db
    .prepare(
      `SELECT id, task_id, user_id, status, completed_date, completed_at,
              awarded_event_id, revoked_at, revoked_by
       FROM task_completions WHERE id = ?`,
    )
    .bind(id)
    .first<TaskCompletion>();
  if (!completion) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'task_completion not found' } },
      404,
    );
  }

  try {
    // 1. Snapshot + delete (atomic via db.batch). For task_completion
    //    deletes there are no orphanable rows (no FK references a
    //    completion in the same way), so the return value is unused.
    await moveToDeletedRecords(
      db,
      'task_completion',
      'task_completions',
      id,
      completion,
      pmUserId,
    );

    // 2. Audit the *act* of deletion. We use logAudit directly (rather
    //    than the stage 2 logHardDelete helper) because that helper
    //    hardcodes action='event_hard_deleted'; completions need a
    //    distinct action so audit-log filters can split them.
    await logAudit(db, {
      actor: 'pm',
      action: 'completion_hard_deleted',
      target_event_id: id,
      target_user_id: pmUserId,
      details: {
        record_type: 'task_completion',
        original_table: 'task_completions',
        original_data: completion,
      },
    });

    // 3. Recompute balance. The score_event is still in the table
    //    (we only removed the completion), so the balance is the same
    //    as before — but we still go through the same code path the
    //    events hard-delete uses, so the API shape is consistent.
    const newBalance = await recalcAfterHardDelete(db, completion.user_id);

    return c.json({
      success: true,
      deleted_id: id,
      balance: newBalance,
    });
  } catch (err) {
    // 500: best-effort audit row (the batch was rolled back, so the
    //    completion is still in task_completions), then generic error.
    const message = err instanceof Error ? err.message : String(err);
    try {
      await logAudit(db, {
        actor: 'pm',
        action: 'completion_hard_deleted',
        target_event_id: id,
        target_user_id: completion.user_id,
        details: { error: message, failed: true },
      });
    } catch {
      // Audit log itself failed — nothing more we can do.
    }
    return c.json(
      { error: { code: 'INTERNAL', message: 'hard-delete failed' } },
      500,
    );
  }
});

export default taskCompletions;

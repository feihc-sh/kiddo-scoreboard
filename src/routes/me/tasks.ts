// src/routes/me/tasks.ts
// Child-only task endpoints (currently unauthenticated — child user_id is
// HARDCODED to 2 to match seeds/local.sql. M5 will replace this with proper
// child auth, e.g. a cookie or token issued by a kiddo login flow).
//
//   POST /api/me/tasks/:id/complete
//     :id = task_id
//     No body required.
//     Effects (single db.batch() transaction):
//       1. INSERT task_completion (status='active', today, unixepoch())
//       2. INSERT score_event (auto-approved, source='task', child-submitted)
//       3. INSERT audit_log (action='task_complete', actor='child')
//     Returns 201 with awarded amount + new balance, or an error code.

import { Hono } from 'hono';
import type { Env } from '../../worker.ts';
import type { Task } from '../../db/types.ts';
import { todayShanghai } from '../../utils/week.ts';
import { computeBalance } from '../../utils/balance.ts';

const tasks = new Hono<{ Bindings: Env }>();

/**
 * Hardcoded child user id. M5 will replace this with a real auth lookup.
 * Must match the id inserted by seeds/local.sql.
 */
const CHILD_USER_ID = 2;

const TASK_COLUMNS =
  'id, name, token_reward, target_account, icon, category, ' +
  'is_active, sort_order, created_at, updated_at';

tasks.post('/:id/complete', async (c) => {
  // 1. Validate task_id is a positive integer.
  const idStr = c.req.param('id');
  const taskId = Number(idStr);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'task_id must be a positive integer' } },
      400,
    );
  }

  const db = c.env.DB;

  // 2. Load task — 404 if not found, 400 TASK_INACTIVE if disabled.
  const task = await db
    .prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`)
    .bind(taskId)
    .first<Task>();
  if (!task) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'task not found' } },
      404,
    );
  }
  if (task.is_active === 0) {
    return c.json(
      { error: { code: 'TASK_INACTIVE', message: 'task is no longer active' } },
      400,
    );
  }

  // 3. Refuse if an 'active' completion already exists for (task, child, today).
  // A 'revoked' row does NOT block re-completion — only status='active' counts.
  const today = todayShanghai();
  const existing = await db
    .prepare(
      `SELECT id FROM task_completions
       WHERE task_id = ? AND user_id = ? AND status = 'active' AND completed_date = ?`,
    )
    .bind(taskId, CHILD_USER_ID, today)
    .first<{ id: number }>();
  if (existing) {
    return c.json(
      { error: { code: 'ALREADY_COMPLETED_TODAY', message: 'task already completed today' } },
      409,
    );
  }

  // 4. Atomic write: completion + score_event + audit_log in one batch.
  // SQLite/D1's `last_insert_rowid()` returns the rowid of the most recent
  // insert on the same connection, so the audit row can reference the
  // score_event just inserted in the previous batch statement.
  const sourceRef = `task:${taskId}`;
  const reason = `Task: ${task.name}`;
  const detailsJson = JSON.stringify({
    task_id: taskId,
    task_name: task.name,
    token_reward: task.token_reward,
  });

  // Order matters: score_events first so task_completions can reference its
  // last_insert_rowid() as awarded_event_id. This is what task-completions.ts:revoke
  // needs to find the score_event to flip to 'revoked'. (PHASE2-FINDING: previously
  // awarded_event_id was NULL on task_completions rows, so revoke UPDATE found nothing.)
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO score_events
           (user_id, type, change_value, reason, status,
            submitted_by, source, source_ref, week_of, created_at)
         VALUES (?, ?, ?, ?, 'approved', 'child', 'task', ?, NULL, unixepoch())`,
      )
      .bind(CHILD_USER_ID, task.target_account, task.token_reward, reason, sourceRef),
    db
      .prepare(
        `INSERT INTO task_completions
           (task_id, user_id, status, completed_date, completed_at, awarded_event_id)
         VALUES (?, ?, 'active', ?, unixepoch(), last_insert_rowid())`,
      )
      .bind(taskId, CHILD_USER_ID, today),
    db
      .prepare(
        `INSERT INTO audit_log
           (actor, action, target_event_id, target_user_id, details, created_at)
         VALUES ('child', 'task_complete', last_insert_rowid(), ?, ?, unixepoch())`,
      )
      .bind(CHILD_USER_ID, detailsJson),
  ]);

  // The score_events insert is now the 1st statement (index 0).
  const eventId = Number(results[0]?.meta?.last_row_id ?? 0);

  // 5. Recompute the balance so the client can update UI optimistically.
  const newBalance = await computeBalance(db, CHILD_USER_ID);

  return c.json(
    {
      task_id: taskId,
      task_name: task.name,
      token_awarded: task.token_reward,
      target_account: task.target_account,
      new_balance: newBalance,
      event_id: eventId,
    },
    201,
  );
});

// §3.11 toggle: child revokes (uncompletes) a task completed today.
//   POST /api/me/tasks/:id/uncomplete
//     :id = task_id
//     No body required.
//     Effects (single db.batch() transaction, all soft — no DELETE):
//       1. UPDATE task_completions SET status='revoked' (active row for today)
//       2. UPDATE score_events SET status='revoked' (matching approved row)
//       3. INSERT audit_log (action='task_uncomplete', actor='child')
//     Returns 200 with revoked amount + new balance, or an error code:
//       400 BAD_REQUEST       — task_id invalid
//       404 NOT_FOUND         — task doesn't exist
//       400 TASK_INACTIVE     — task is disabled
//       409 ALREADY_UNCOMPLETED_TODAY — already revoked today (1 toggle/day limit)
//       400 NOT_COMPLETED_TODAY       — no active completion today (must complete first)

tasks.post('/:id/uncomplete', async (c) => {
  // 1. Validate task_id is a positive integer.
  const idStr = c.req.param('id');
  const taskId = Number(idStr);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'task_id must be a positive integer' } },
      400,
    );
  }

  const db = c.env.DB;
  const today = todayShanghai();

  // 2. Load task — 404 if not found, 400 TASK_INACTIVE if disabled.
  const task = await db
    .prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`)
    .bind(taskId)
    .first<Task>();
  if (!task) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'task not found' } },
      404,
    );
  }
  if (task.is_active === 0) {
    return c.json(
      { error: { code: 'TASK_INACTIVE', message: 'task is no longer active' } },
      400,
    );
  }

  // 3. Refuse if already revoked today (1-toggle-per-day limit).
  //    After revoke, the only way to re-complete is to wait for the next day.
  const alreadyRevoked = await db
    .prepare(
      `SELECT id FROM task_completions
       WHERE task_id = ? AND user_id = ? AND status = 'revoked' AND completed_date = ?`,
    )
    .bind(taskId, CHILD_USER_ID, today)
    .first<{ id: number }>();
  if (alreadyRevoked) {
    return c.json(
      { error: { code: 'ALREADY_UNCOMPLETED_TODAY', message: 'task already uncompleted today; try again tomorrow' } },
      409,
    );
  }

  // 4. Refuse if no active completion exists (must complete first before revoke).
  const active = await db
    .prepare(
      `SELECT id FROM task_completions
       WHERE task_id = ? AND user_id = ? AND status = 'active' AND completed_date = ?`,
    )
    .bind(taskId, CHILD_USER_ID, today)
    .first<{ id: number }>();
  if (!active) {
    return c.json(
      { error: { code: 'NOT_COMPLETED_TODAY', message: 'task was not completed today' } },
      400,
    );
  }

  // 5. Atomic soft-revoke: 3 statements in one batch.
  const sourceRef = `task:${taskId}`;
  const detailsJson = JSON.stringify({
    task_id: taskId,
    task_name: task.name,
    token_reward: task.token_reward,
  });

  await db.batch([
    db
      .prepare(
        `UPDATE task_completions SET status = 'revoked'
         WHERE task_id = ? AND user_id = ? AND status = 'active' AND completed_date = ?`,
      )
      .bind(taskId, CHILD_USER_ID, today),
    db
      .prepare(
        `UPDATE score_events SET status = 'revoked'
         WHERE source_ref = ? AND user_id = ? AND status = 'approved'`,
      )
      .bind(sourceRef, CHILD_USER_ID),
    db
      .prepare(
        `INSERT INTO audit_log
           (actor, action, target_event_id, target_user_id, details, created_at)
         VALUES ('child', 'task_uncomplete', NULL, ?, ?, unixepoch())`,
      )
      .bind(CHILD_USER_ID, detailsJson),
  ]);

  // 6. Recompute balance so the client can update UI optimistically.
  const newBalance = await computeBalance(db, CHILD_USER_ID);

  return c.json(
    {
      task_id: taskId,
      task_name: task.name,
      token_revoked: task.token_reward,
      target_account: task.target_account,
      new_balance: newBalance,
    },
    200,
  );
});

export default tasks;

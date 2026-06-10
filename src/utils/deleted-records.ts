// src/utils/deleted-records.ts
// Stage 2 (NIGHTLY-TODO #009): physically remove a score_event or
// task_completion and stash a snapshot in `deleted_records` so the
// original data is preserved for audit. The INSERT and DELETE are
// wrapped in db.batch() so a partial failure cannot leave the
// snapshot table out of sync with the source table.

import type { D1Database } from '../db/types.ts';

export type HardDeleteRecordType = 'score_event' | 'task_completion';
export type HardDeleteTable = 'score_events' | 'task_completions';

/**
 * Result of a hard-delete move. Returned so callers can extend the audit
 * trail with the side-effecting rows (e.g. task_completions whose
 * awarded_event_id was NULL'd before the event DELETE could succeed).
 */
export interface MoveToDeletedResult {
  /**
   * For score_event deletes only: ids of task_completions whose
   * `awarded_event_id` was NULL'd in the same db.batch() so the FK
   * constraint would not block the DELETE. Empty for task_completion
   * deletes (nothing references a completion in the same way).
   */
  orphanedCompletionIds: number[];
}

/**
 * Move a row from its source table into `deleted_records` atomically.
 *
 * 1. INSERT a snapshot row into `deleted_records` (record_type,
 *    original_id, original_data, deleted_at, deleted_by, original_table)
 * 2. DELETE the row from the source table
 *
 * Both statements run in a single db.batch() call (D1's per-request
 * transaction wrapper) — if either fails, neither takes effect.
 */
export async function moveToDeletedRecords(
  db: D1Database,
  recordType: HardDeleteRecordType,
  originalTable: HardDeleteTable,
  originalId: number,
  originalData: object,
  deletedBy: number,
): Promise<MoveToDeletedResult> {
  const deletedAt = Math.floor(Date.now() / 1000);
  const stmts: ReturnType<D1Database['prepare']>[] = [];
  const orphanedCompletionIds: number[] = [];
  // P0 bug #24: hard-delete of a score_event fails with FK violation when
  // task_completions.awarded_event_id points at it. NULL out the FK first
  // so the DELETE can succeed (completion row preserved for audit).
  if (originalTable === 'score_events') {
    // P1 follow-up (Qual 2026-06-10): capture the completion ids we are
    // about to orphan so the route handler can record them in audit_log
    // details. SELECT first (snapshot of references at delete time),
    // then UPDATE in the same batch.
    const refs = await db
      .prepare(`SELECT id FROM task_completions WHERE awarded_event_id = ?`)
      .bind(originalId)
      .all<{ id: number }>();
    for (const r of refs.results ?? []) orphanedCompletionIds.push(r.id);

    stmts.push(
      db
        .prepare(
          `UPDATE task_completions SET awarded_event_id = NULL WHERE awarded_event_id = ?`,
        )
        .bind(originalId),
    );
  }
  stmts.push(
    db
      .prepare(
        `INSERT INTO deleted_records
           (record_type, original_id, original_data, deleted_at, deleted_by, original_table)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        recordType,
        originalId,
        JSON.stringify(originalData),
        deletedAt,
        deletedBy,
        originalTable,
      ),
    db
      .prepare(`DELETE FROM ${originalTable} WHERE id = ?`)
      .bind(originalId),
  );
  await db.batch(stmts);
  return { orphanedCompletionIds };
}

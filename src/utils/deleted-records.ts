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
): Promise<void> {
  const deletedAt = Math.floor(Date.now() / 1000);
  const stmts: ReturnType<D1Database['prepare']>[] = [];
  // P0 bug #24: hard-delete of a score_event fails with FK violation when
  // task_completions.awarded_event_id points at it. NULL out the FK first
  // so the DELETE can succeed (completion row preserved for audit).
  if (originalTable === 'score_events') {
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
}

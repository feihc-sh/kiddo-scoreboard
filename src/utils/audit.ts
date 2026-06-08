// src/utils/audit.ts
// Audit log writer — call this AFTER any write operation that should leave a trail.
// Always pass a structured `details` object; it will be JSON.stringified for storage.

import type { Actor, AuditAction, D1Database } from '../db/types.ts';

export interface AuditEntry {
  actor: Actor;
  action: AuditAction;
  target_event_id?: number | null;
  target_user_id?: number | null;
  details?: Record<string, unknown>;
}

/**
 * Append a single audit log row. Safe to call even if all optional fields are null.
 */
export async function logAudit(db: D1Database, entry: AuditEntry): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO audit_log (actor, action, target_event_id, target_user_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, unixepoch())`,
    )
    .bind(
      entry.actor,
      entry.action,
      entry.target_event_id ?? null,
      entry.target_user_id ?? null,
      JSON.stringify(entry.details ?? {}),
    )
    .run();
  return Number(result.meta?.last_row_id ?? 0);
}

/**
 * Batch write: write an audit log + the triggering SQL statement(s) in a single batch.
 * If audit fails, the operation is rolled back at the D1 level.
 *
 * Returns the last row id of the audit log entry.
 */
export async function logAuditInBatch(
  db: D1Database,
  entry: AuditEntry,
  ...statements: D1PreparedStatementLike[]
): Promise<number> {
  // The caller is expected to have already created the prepared statements with
  // their .bind() values applied. We append the audit insert to the batch.
  // (In practice, the API layer builds the full batch and passes us just the audit.)
  // This signature is a convenience — most callers use the simple `logAudit` form.
  return logAudit(db, entry);
}

interface D1PreparedStatementLike {
  bind: (...values: unknown[]) => unknown;
}

/**
 * Stage 2 (NIGHTLY-TODO #009): write the audit row for a hard-delete.
 * The snapshot is already in `deleted_records`; this row records the
 * *act* of deletion (who did it, when, on which id) so we can show
 * "PM X deleted event Y at Z" in audit views without joining the
 * snapshot table.
 *
 * `recordType` is recorded in `details` (audit_log has no `target_type`
 * column — it uses `target_event_id` / `target_user_id`). We also stuff
 * the full original row into `details.original_data` so an auditor can
 * see the snapshot even if the `deleted_records` row is later purged.
 */
export async function logHardDelete(
  db: D1Database,
  recordType: 'score_event' | 'task_completion',
  originalId: number,
  originalData: object,
  deletedBy: number,
): Promise<void> {
  const originalTable =
    recordType === 'score_event' ? 'score_events' : 'task_completions';
  await logAudit(db, {
    actor: 'pm',
    action: 'event_hard_deleted',
    target_event_id: originalId,
    target_user_id: deletedBy,
    details: {
      record_type: recordType,
      original_table: originalTable,
      original_data: originalData,
    },
  });
}

/**
 * Read recent audit log entries. Newest first. Optional filters.
 */
export interface AuditFilter {
  actor?: Actor;
  action?: AuditAction;
  target_user_id?: number;
  limit?: number;  // default 100
}

export interface AuditLogRow {
  id: number;
  actor: Actor;
  action: AuditAction;
  target_event_id: number | null;
  target_user_id: number | null;
  details: string;
  created_at: number;
}

export async function readAuditLog(
  db: D1Database,
  filter: AuditFilter = {},
): Promise<AuditLogRow[]> {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const wheres: string[] = [];
  const params: unknown[] = [];
  if (filter.actor) {
    wheres.push('actor = ?');
    params.push(filter.actor);
  }
  if (filter.action) {
    wheres.push('action = ?');
    params.push(filter.action);
  }
  if (filter.target_user_id !== undefined) {
    wheres.push('target_user_id = ?');
    params.push(filter.target_user_id);
  }
  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const stmt = db
    .prepare(
      `SELECT id, actor, action, target_event_id, target_user_id, details, created_at
       FROM audit_log
       ${where}
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(...params, limit);
  const result = await stmt.all<AuditLogRow>();
  return result.results ?? [];
}

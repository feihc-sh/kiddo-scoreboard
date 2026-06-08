-- Module 6: Hard-delete snapshot table
-- When PM physically deletes a score_event or task_completion (NIGHTLY-TODO
-- Item #009), the row is moved here so the original data is preserved for
-- audit, but the source row is gone (child can re-complete / re-submit).
--
-- record_type:     'score_event' | 'task_completion'
-- original_id:     id of the row that was deleted in the source table
-- original_data:   full JSON snapshot of the deleted row (enough to recreate
--                  the row textually for audit, NOT a recovery mechanism)
-- deleted_at:      Unix timestamp of the deletion
-- deleted_by:      PM user id who performed the deletion
-- original_table:  'score_events' | 'task_completions'
--
-- Notes:
--   * We do NOT write a corresponding row to audit_log here. Stage 2
--     (POST /:id/hard-delete) is responsible for the audit_log entry;
--     keeping the two concerns separate keeps this migration schema-only.
--   * No FKs: original_id is a dangling reference by design (the source
--     row is gone), and deleted_by is integrity-checked at the app layer
--     (the caller is already auth'd as PM). Matches the audit_log
--     convention of not FK-ing target_user_id / target_event_id.

CREATE TABLE IF NOT EXISTS deleted_records (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  record_type    TEXT    NOT NULL CHECK(record_type IN ('score_event', 'task_completion')),
  original_id    INTEGER NOT NULL,
  original_data  TEXT    NOT NULL,
  deleted_at     INTEGER NOT NULL,
  deleted_by     INTEGER NOT NULL,
  original_table TEXT    NOT NULL CHECK(original_table IN ('score_events', 'task_completions'))
);

-- Lookup by what-was-deleted (used by list views to render the grey
-- "deleted" marker next to the surviving siblings).
CREATE INDEX IF NOT EXISTS idx_deleted_records_lookup
  ON deleted_records(record_type, original_id);

-- Time-ordered listings (newest deletes first) and purge windows.
CREATE INDEX IF NOT EXISTS idx_deleted_records_deleted_at
  ON deleted_records(deleted_at DESC);

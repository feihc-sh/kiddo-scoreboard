-- Module 9: Running Map (RFC §3 — Running Map M1)
-- Item #011 §4: child-level cumulative km cache for fast avatar-position queries.
--
-- running_records stores every check-in (including revoked ones).
-- Computing cum_km for the avatar requires:
--   SELECT SUM(km) FROM running_records
--   WHERE child_id=? AND map_id=? AND revoked_at IS NULL
-- Doing this on every page load is O(n) over the records table.
--
-- running_progress is a write-through cache: every time a running_record
-- is inserted, updated, or has its revoked_at changed, we recompute the
-- child's cum_km for that map and UPSERT the cache row.
--
-- Schema:
--   - child_id + map_id = unique (PRIMARY KEY)
--   - cum_km = SUM(km) of active (non-revoked) running_records
--   - last_updated = unix seconds of the last write
--
-- No foreign keys here (the cache is derived data; we don't cascade
-- deletes to it — the cache is recalculated on-demand from running_records).
-- The app enforces that a child can only have one active map at a time,
-- but this table is keyed by (child_id, map_id) so it can store
-- progress for all maps simultaneously if future features need it.

CREATE TABLE IF NOT EXISTS running_progress (
  child_id      INTEGER NOT NULL,
  map_id        INTEGER NOT NULL,
  cum_km        REAL    NOT NULL DEFAULT 0,
  last_updated  INTEGER NOT NULL,
  PRIMARY KEY (child_id, map_id)
);

-- Index for the common query: "get child's current map progress"
CREATE INDEX IF NOT EXISTS idx_running_progress_child
  ON running_progress(child_id);

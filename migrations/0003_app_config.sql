-- Module: app_config (PM-tunable settings)
-- Single-row table for child UI progress bar targets.
-- Read by GET /api/public/tasks/progress; PM-side admin UI will edit later.
-- Defaults: 100 tasks/month, 1200 tasks/year (≈ 100 × 12, set 2026-06-06).

CREATE TABLE IF NOT EXISTS app_config (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton
  monthly_target_count  INTEGER NOT NULL DEFAULT 100 CHECK (monthly_target_count > 0),
  yearly_target_count   INTEGER NOT NULL DEFAULT 1200 CHECK (yearly_target_count > 0),
  updated_at            INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Seed the singleton row with defaults (no-op on re-apply).
INSERT OR IGNORE INTO app_config (id, monthly_target_count, yearly_target_count)
VALUES (1, 100, 1200);

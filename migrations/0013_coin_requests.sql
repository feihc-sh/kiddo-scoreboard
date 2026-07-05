-- Item #015 Stage 1: coin_requests table (Kid coin request + approval workflow)
--
-- Background (PM surveyed, no need to re-check):
--   - coin balance is derived: SUM(change_value WHERE type='coins' AND status='approved')
--     from score_events (per coin.ts getCoinBalance, RFC §3.4 INV-1)
--   - coin_requests does NOT write to coin_balances (no such table)
--   - approved requests write +change_value row into score_events (source='manual')
--
-- Schema decisions:
--   - status CHECK: 'pending' | 'approved' | 'rejected' (no 'revoked' for requests)
--   - amount CHECK: must be > 0 (application layer also validates as belt-and-suspenders)
--   - reviewed_at / reviewed_by / review_note: NULL until PM reviews
--   - requested_at: unixepoch() default, set at INSERT time
--   - No FK on score_events from here — approval writes score_events; request is the trigger

-- =============================================================
-- 1) Create coin_requests table
-- =============================================================
CREATE TABLE IF NOT EXISTS coin_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,                            -- kid (CHILD_USER_ID = 2)
  amount        INTEGER NOT NULL CHECK(amount > 0),          -- 申请金币数, 必须 > 0
  reason        TEXT NOT NULL,                               -- 申请理由
  status        TEXT NOT NULL
                 CHECK(status IN ('pending', 'approved', 'rejected'))
                 DEFAULT 'pending',
  requested_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  reviewed_at   INTEGER,
  reviewed_by   INTEGER,                                     -- PM user id
  review_note   TEXT,
  FOREIGN KEY (user_id)     REFERENCES users(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

-- =============================================================
-- 2) Indexes (mirrors score_events / shop_redemptions patterns)
-- =============================================================
-- Kid history: filter by user + sort newest-first (kid sees their own requests)
CREATE INDEX IF NOT EXISTS idx_coin_req_user
  ON coin_requests(user_id, requested_at DESC);

-- Admin queue: pending requests first (FIFO review order by requested_at ASC)
CREATE INDEX IF NOT EXISTS idx_coin_req_status
  ON coin_requests(status, requested_at DESC);

-- Module 2: PM authentication support
-- Adds auth_attempts table for login lockout (5 fails in 5min → lock).

CREATE TABLE IF NOT EXISTS auth_attempts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ip            TEXT NOT NULL,
  success       INTEGER NOT NULL CHECK(success IN (0, 1)),
  attempted_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_auth_attempts_ip_time
  ON auth_attempts(ip, attempted_at DESC);

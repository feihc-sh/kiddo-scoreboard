-- Module 2: Seed default PM user and child user.
-- Local dev: PM PIN = "1234" (placeholder hash; will be regenerated on first login via init-prod script).
-- Production: PM PIN should be set via `scripts/init-prod.ts` after first deploy.

-- PM user placeholder
INSERT OR IGNORE INTO users (id, name, role, pin_hash, created_at, updated_at)
VALUES (
  1, 'PM', 'pm',
  'pbkdf2$600000$AAAAAAAAAAAAAAAAAAAAAA$BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  unixepoch(), unixepoch()
);

-- Child user with empty name (triggers first-time name prompt)
INSERT OR IGNORE INTO users (id, name, role, pin_hash, created_at, updated_at)
VALUES (
  2, '', 'child', NULL, unixepoch(), unixepoch()
);

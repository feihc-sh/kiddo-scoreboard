-- Module 3: Sleep task (准时上床) support
-- Adds two optional columns to `tasks` so any task can be marked as
-- "self-lockout" (e.g. 准时上床: button auto-disables after 21:30 cutoff).
--
-- Existing tasks are unaffected: cutoff_time defaults to NULL (no cutoff)
-- and is_self_lockout defaults to 0 (opt-in per task).
--
-- cutoff_time:    'HH:MM' string in Asia/Shanghai (matches user iPad local time).
--                 NULL means no cutoff — task behaves normally.
-- is_self_lockout: 0/1 flag. When 1, child UI disables the button after
--                 server_now (Asia/Shanghai) > cutoff_time, and the server
--                 refuses the /complete POST with 400 CUTOFF_PASSED.
--                 When 0, no time check.

ALTER TABLE tasks ADD COLUMN cutoff_time      TIME;
ALTER TABLE tasks ADD COLUMN is_self_lockout  INTEGER NOT NULL DEFAULT 0
  CHECK(is_self_lockout IN (0, 1));

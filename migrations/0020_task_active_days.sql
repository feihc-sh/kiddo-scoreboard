-- migrations/0020_task_active_days.sql
-- Feature: task active days (任务生效日)
-- tasks.active_days: JSON array of ISO weekdays [1..7] (Mon=1 .. Sun=7).
--   NULL  = every day (default, back-compat for all existing tasks)
--   [1,2,3,4,5] = Mon-Fri only; [6,7] = Sat-Sun only
-- Server refuses completion when today's Asia/Shanghai ISO weekday
-- is not in active_days (400 TASK_NOT_ACTIVE_TODAY), mirroring §3.12 cutoff.

ALTER TABLE tasks ADD COLUMN active_days TEXT;

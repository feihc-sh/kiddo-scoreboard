-- migrations/0019_disable_summer_homework.sql
-- Item #016 §7 (2026-09-04 feihao): disable summer-homework task post-暑假.
-- 临时禁用 (数据保留),明年暑假手动恢复:
--   UPDATE tasks SET is_active = 1 WHERE name = '每日完成暑假作业';
-- Reason: tasks 表已有 is_active 字段 (migrations/0001_initial.sql) — 不需 schema 改,纯数据更新。
UPDATE tasks SET is_active = 0 WHERE name = '每日完成暑假作业';

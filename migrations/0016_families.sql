-- Phase 0 (mecha-challenge) — 新增 families 表 + users.openid 字段
-- =========================================================================
-- families: 家庭表（首版 1 家 1 家长 1 孩子）
-- users.openid: 微信 openid（微信登录入口；非微信用户为 NULL）
-- =========================================================================

-- families: 家庭单位
CREATE TABLE IF NOT EXISTS families (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- users.openid: 微信 openid 关联（ALTER 后原有 rows 的 openid = NULL）
ALTER TABLE users ADD COLUMN openid TEXT;

-- 唯一索引：每个微信用户只能有一个 kiddo 账号
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_openid ON users(openid);

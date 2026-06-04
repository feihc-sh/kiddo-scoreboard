-- Module 1: Initial schema
-- 5 tables: users / score_events / tasks / task_completions / audit_log
-- All timestamps stored as INTEGER (Unix seconds) for SQLite efficiency.

-- =============================================================
-- users: 儿子 + PM（v1 同款，字段定义稳定）
-- =============================================================
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK(role IN ('child', 'pm')),
  pin_hash    TEXT,                       -- 仅 PM 有；儿子为 NULL
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- =============================================================
-- score_events: 积分流水（v2 增加 source 字段）
-- 双账户通过 type 字段区分；正向加分，负向扣分。
-- =============================================================
CREATE TABLE IF NOT EXISTS score_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  type          TEXT NOT NULL CHECK(type IN ('game_time', 'pocket_money')),
  change_value  INTEGER NOT NULL,         -- 正=奖 / 负=扣
  reason        TEXT NOT NULL,
  status        TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected', 'revoked')),
  submitted_by  TEXT NOT NULL CHECK(submitted_by IN ('child', 'pm', 'system')),
  source        TEXT NOT NULL CHECK(source IN ('manual', 'task', 'exchange', 'weekly_grant')),
  source_ref    TEXT,                     -- 可选: 关联来源 ID (e.g. task_id)
  reviewed_by   INTEGER,                  -- PM user id
  reviewed_at   INTEGER,
  week_of       TEXT,                     -- ISO 8601 格式: '2026-W23'
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id)     REFERENCES users(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_score_events_user_status ON score_events(user_id, status);
CREATE INDEX IF NOT EXISTS idx_score_events_user_type   ON score_events(user_id, type);
CREATE INDEX IF NOT EXISTS idx_score_events_week        ON score_events(week_of);
CREATE INDEX IF NOT EXISTS idx_score_events_created     ON score_events(created_at DESC);

-- =============================================================
-- tasks: 任务模板（PM 后台配置）
-- =============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  token_reward    INTEGER NOT NULL CHECK(token_reward > 0),
  target_account  TEXT NOT NULL CHECK(target_account IN ('game_time', 'pocket_money')),
  icon            TEXT,                   -- emoji, e.g. '🎯'
  category        TEXT NOT NULL CHECK(category IN ('habit', 'study', 'chore', 'custom')),
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_tasks_active ON tasks(is_active, sort_order);

-- =============================================================
-- task_completions: 任务完成流水
-- 每天每任务每人 1 次 (UNIQUE 约束)，撤销后 status='revoked' 但记录保留。
-- =============================================================
CREATE TABLE IF NOT EXISTS task_completions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id           INTEGER NOT NULL,
  user_id           INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
  completed_date    TEXT NOT NULL,         -- Asia/Shanghai 日期 'YYYY-MM-DD'
  completed_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  awarded_event_id  INTEGER,              -- FK → score_events.id
  revoked_at        INTEGER,
  revoked_by        INTEGER,
  UNIQUE(task_id, user_id, completed_date),
  FOREIGN KEY (task_id)          REFERENCES tasks(id),
  FOREIGN KEY (user_id)          REFERENCES users(id),
  FOREIGN KEY (awarded_event_id) REFERENCES score_events(id),
  FOREIGN KEY (revoked_by)       REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_completions_user_date ON task_completions(user_id, completed_date);
CREATE INDEX IF NOT EXISTS idx_completions_task_date ON task_completions(task_id, completed_date);

-- =============================================================
-- audit_log: 审计日志（所有写操作后自动追加）
-- =============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  actor             TEXT NOT NULL CHECK(actor IN ('child', 'pm', 'system')),
  action            TEXT NOT NULL,         -- see ACTION_TYPES
  target_event_id   INTEGER,               -- 可空（配置任务时无 event）
  target_user_id    INTEGER,
  details           TEXT NOT NULL DEFAULT '{}',  -- JSON 字符串
  created_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_audit_created   ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor     ON audit_log(actor);
CREATE INDEX IF NOT EXISTS idx_audit_action    ON audit_log(action);

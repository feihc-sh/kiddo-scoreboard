-- Module 8: Health Check-in (RFC §3 — Health Check-in M1)
-- 改动:
--   1. 新表 health_events (健康事件记录, 不参与积分)
--   2. 3 索引: user_type_active (续接 UX), user_date (月历查询), user_undone (active 过滤)
--   3. 不修改现有 8 张表 (score_events / task_completions / audit_log schema 不动)
--
-- 兼容性: 本 migration 只 ADD 表 + ADD 索引 + ADD 数据, 不动现有数据。
-- health_events 完全独立于 score_events, 不参与 🎮/💰/🪙 余额计算。
-- 仅复用 audit_log (新增 health_event_* action, 通过 AuditAction enum 扩展)。
--
-- 应用顺序: wrangler d1 migrations apply 会按文件名前缀顺序应用 0001..0008。

-- =============================================================
-- health_events: 健康事件记录 (8 种 event_type, 日期范围, 可续接)
-- =============================================================
-- 设计要点:
--   - event_type CHECK IN 8 种 hardcode (v1), 后续 v2 引入 PM 后台配置
--   - start_date / end_date 用 'YYYY-MM-DD' (Asia/Shanghai), 跨时区直观
--   - end_date IS NULL = 进行中, is_resolved 是冗余字段便于索引
--   - is_resolved / end_date 双写必须一致 (CHECK 约束语义保证)
--   - submitted_by CHECK IN ('child', 'pm'), 不支持 system
--   - resolved_by 是 PM user id (FK → users.id)
--   - 不写 score_events, 完全独立
CREATE TABLE IF NOT EXISTS health_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,                       -- 多孩 schema 已 support
  event_type      TEXT NOT NULL CHECK(event_type IN (
                    'ulcer','fever','cough','injury',
                    'allergy','dizzy','vomit','other'
                  )),
  start_date      TEXT NOT NULL,                          -- 'YYYY-MM-DD' (Asia/Shanghai)
  end_date        TEXT,                                   -- NULL = 进行中
  is_resolved     INTEGER NOT NULL DEFAULT 0 CHECK(is_resolved IN (0, 1)),
  note            TEXT,                                   -- 备注 (PM 或 child 自由文本)
  submitted_by    TEXT NOT NULL CHECK(submitted_by IN ('child', 'pm')),
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved_at     INTEGER,                                -- end_date 写入时间
  resolved_by     INTEGER,                                -- 操作 resolve 的 PM user id
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id)     REFERENCES users(id),
  FOREIGN KEY (resolved_by) REFERENCES users(id)
);

-- =============================================================
-- 索引 (RFC §3.1 完整 spec)
-- =============================================================

-- 续接 UX 关键查询: 查某用户某 type 的 active 事件 (ORDER BY start_date DESC)
CREATE INDEX IF NOT EXISTS idx_health_events_user_type_active
  ON health_events(user_id, event_type, is_resolved, start_date DESC);

-- 月历查询: 查某用户某月所有事件 (start_date 范围)
CREATE INDEX IF NOT EXISTS idx_health_events_user_date
  ON health_events(user_id, start_date);

-- 进行中事件过滤 (end_date IS NULL 优化)
CREATE INDEX IF NOT EXISTS idx_health_events_user_undone
  ON health_events(user_id, end_date) WHERE end_date IS NULL;

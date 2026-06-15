-- Module 7: Coin System (RFC §3 — Coin System M1)
-- 改动:
--   1. score_events.type CHECK 扩展,加 'coins' (SQLite 不支持 ALTER CHECK,需重建表)
--   2. 新表 shop_items (商品定义)
--   3. 新表 shop_redemptions (兑换流水)
--   4. seed 1 件商品 (游戏时间 10 分钟 / 10 金币 / 每周限 3 次)
--
-- 兼容性: 本 migration 只 ADD 字段 + ADD 表 + ADD 数据,不动现有数据。
-- 重建 score_events 用 "CREATE new + INSERT SELECT + DROP + RENAME" 模式,
-- SQLite 是单文件,D1 一次迁移内原子完成(不在 BEGIN/COMMIT 包裹,因为 SQLite
-- DDL 不支持事务,但每个 DDL 语句本身在 D1 内是顺序执行的)。
--
-- 应用顺序: wrangler d1 migrations apply 会按文件名前缀顺序应用 0001..0007。

-- =============================================================
-- 1) score_events.type CHECK 扩展 (重建表模式)
-- =============================================================
-- 新表结构与原表完全一致,只把 type CHECK 改为 IN ('game_time', 'pocket_money', 'coins')
CREATE TABLE score_events_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  type          TEXT NOT NULL CHECK(type IN ('game_time', 'pocket_money', 'coins')),
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

-- 复制全部现有数据 (含历史 game_time / pocket_money events,无丢失)
INSERT INTO score_events_new
  SELECT id, user_id, type, change_value, reason, status, submitted_by, source,
         source_ref, reviewed_by, reviewed_at, week_of, created_at
  FROM score_events;

-- 替换旧表
-- 治本: INCIDENTS 2026-06-11 (4 次 deploy 翻车根因,见 docs/INCIDENTS.md)
-- D1 的 PRAGMA foreign_keys = OFF 仅当前 connection 有效,D1 migration apply
--   跨 DDL statement 时新 connection,FK 检查仍触发 → Code 7500 FOREIGN KEY fail
-- 推荐方案 B (INCIDENTS §治本): 显式清空 task_completions FK 引用 + DROP
UPDATE task_completions SET awarded_event_id = NULL WHERE awarded_event_id IS NOT NULL;
PRAGMA foreign_keys = OFF;
DROP TABLE score_events;
ALTER TABLE score_events_new RENAME TO score_events;
PRAGMA foreign_keys = ON;
-- 重建后 task_completions.awarded_event_id 全部为 NULL,业务上 user_id + task_id + completed_at 仍可定位

-- 重建所有索引 (与 0001_initial.sql 一致)
CREATE INDEX IF NOT EXISTS idx_score_events_user_status ON score_events(user_id, status);
CREATE INDEX IF NOT EXISTS idx_score_events_user_type   ON score_events(user_id, type);
CREATE INDEX IF NOT EXISTS idx_score_events_week        ON score_events(week_of);
CREATE INDEX IF NOT EXISTS idx_score_events_created     ON score_events(created_at DESC);

-- =============================================================
-- 2) shop_items: 商品定义 (v1 hardcode 1 件,PM 后台配置 v2 引入)
-- =============================================================
-- kind: 商品的"奖励类别"维度 ('game_time' / 'pocket_money' / 'custom')
--   v1 只用 'game_time', 预留 'pocket_money' 和 'custom' 扩展
-- reward_type: 与 kind 冗余, 便于查询 (v1 简化为同义)
--   CHECK IN ('game_time', 'pocket_money', 'none')
--   - 'none' 用于 'custom' 类商品(无对应账户奖励,纯自定义)
-- cost_coins: 兑换所需金币数 (>0)
-- reward_value: kind='game_time' 时=分钟数, kind='pocket_money' 时=元数 (>0)
-- weekly_limit: 每用户每周限兑次数, 0 = 不限 (>=0)
CREATE TABLE IF NOT EXISTS shop_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,                       -- e.g. "游戏时间 10 分钟"
  kind            TEXT NOT NULL CHECK(kind IN ('game_time', 'pocket_money', 'custom')),
  cost_coins      INTEGER NOT NULL CHECK(cost_coins > 0),
  reward_value    INTEGER NOT NULL CHECK(reward_value > 0),
  reward_type     TEXT NOT NULL CHECK(reward_type IN ('game_time', 'pocket_money', 'none')),
  description     TEXT,                                -- UI 展示文案
  icon            TEXT,                                -- emoji, e.g. '🎮'
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  weekly_limit    INTEGER NOT NULL DEFAULT 3 CHECK(weekly_limit >= 0),
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_shop_items_active ON shop_items(is_active, sort_order);

-- =============================================================
-- 3) shop_redemptions: 兑换流水
-- =============================================================
-- 一次兑换生成 1 条 redemption 记录 + 2 条 score_events (扣金币 + 加游戏时间)
-- 通过 coin_event_id / reward_event_id FK 关联,便于 INV-3/INV-4 校验。
--
-- status: v1 简化, 无 pending, 直接 'consumed' (兑换即生效)
--         'revoked' 用于 PM 后台撤销(预留,M3+ 引入)
-- cost_coins / reward_value / reward_type: 冗余字段,
--   防止商品改价影响历史 (历史 redemption 显示当时的实际价格)
-- week_of: ISO 8601 'YYYY-Www', 用于周限额查询
CREATE TABLE IF NOT EXISTS shop_redemptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  item_id         INTEGER NOT NULL,
  week_of         TEXT NOT NULL,                       -- ISO 8601 '2026-W23'
  cost_coins      INTEGER NOT NULL,
  reward_value    INTEGER NOT NULL,
  reward_type     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'consumed'
                    CHECK(status IN ('consumed', 'revoked')),
  redeemed_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_at      INTEGER,                             -- 撤销时间
  revoked_by      INTEGER,                             -- PM user id
  coin_event_id   INTEGER NOT NULL,                    -- FK → score_events.id (type='coins', change_value=-cost)
  reward_event_id INTEGER NOT NULL,                    -- FK → score_events.id (type=reward_type, change_value=+reward)
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id)         REFERENCES users(id),
  FOREIGN KEY (item_id)         REFERENCES shop_items(id),
  FOREIGN KEY (coin_event_id)   REFERENCES score_events(id),
  FOREIGN KEY (reward_event_id) REFERENCES score_events(id),
  FOREIGN KEY (revoked_by)      REFERENCES users(id)
);

-- 周限额查询性能 (RFC §3.2 关键索引)
CREATE INDEX IF NOT EXISTS idx_redemptions_user_week
  ON shop_redemptions(user_id, week_of);

-- 兑换历史时间倒序
CREATE INDEX IF NOT EXISTS idx_redemptions_user_redeemed
  ON shop_redemptions(user_id, redeemed_at DESC);

-- =============================================================
-- 4) seed: v1 第一件商品 (游戏时间 10 分钟)
-- =============================================================
-- 锁定的需求 (RFC §1): 第 1 件商品 = 10 金币换 10 分钟游戏时间,每周限 3 次
-- 后续 PM 后台配置在 v2 引入,此处 INSERT 一次即可。
INSERT INTO shop_items (name, kind, cost_coins, reward_value, reward_type, description, icon, sort_order, weekly_limit)
  VALUES (
    '游戏时间 10 分钟',
    'game_time',
    10,
    10,
    'game_time',
    '用 10 金币兑换 10 分钟游戏时间',
    '🎮',
    1,
    3
  );
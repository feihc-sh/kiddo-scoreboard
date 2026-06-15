-- Module 7 (Coin System, RFC §3 — Coin System M3)
-- 改动:
--   1. shop_redemptions.status CHECK 扩展, 加 'pending' / 'approved' (v3 custom 流程)
--      兼容老 'consumed' / 'revoked' 值 (旧值不会被丢弃, 但新逻辑不再写)
--   2. shop_redemptions.reward_event_id 改 NULLABLE (kind='custom' 无对应 reward 账户)
--   3. 新增 shop_redemptions.fulfilled_at / fulfilled_by (PM 手动 confirm 字段)
--   4. seed 第 2 件商品: 🧱 小乐高 (kind=custom, cost=50, reward=1, weekly_limit=1)
--
-- 兼容性: 本 migration 只扩展 enum + 加 2 列 + 加 1 行 seed, 不破坏现有数据。
-- 重建 shop_redemptions 用 "CREATE new + INSERT SELECT + DROP + RENAME" 模式,
-- 跟 0007 重建 score_events 一致 (PRAGMA foreign_keys 临时关闭, 避免 DROP 触发
-- 上游 FK 约束)。
--
-- 设计决策 (feihao 2026-06-15 拍板):
--   - kind='game_time'  → status='approved'  (自动, 写 2 events: -coins + +game_time)
--   - kind='custom'     → status='pending'   (等 PM 手动 fulfill, 无 reward_event)
--   - PM 点 "✓ 已发" → status='approved' + fulfilled_at + fulfilled_by
--   - weekly_limit: 只对 kind='game_time' 严格检查 (kind='custom' 也受同一约束, 但实操不会撞)
--
-- 应用顺序: 0008_coin_shop.sql 在 0007 之后应用 (wrangler d1 migrations apply 按文件名前缀顺序)。

-- =============================================================
-- 1) shop_redemptions: 扩展 status CHECK + reward_event_id nullable + 加 2 列
-- =============================================================
-- 新表结构与原表一致, 变更:
--   (a) status CHECK: 允许 'pending' / 'approved' / 'consumed' / 'revoked'
--       ('consumed' 保留兼容老 redemption, 'approved' 是 v3 标准终态)
--   (b) reward_event_id: 改 nullable (kind='custom' 无对应账户)
--   (c) 新增 fulfilled_at / fulfilled_by (custom 流程 PM 手动 confirm)
CREATE TABLE shop_redemptions_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  item_id         INTEGER NOT NULL,
  week_of         TEXT NOT NULL,                       -- ISO 8601 '2026-W23'
  cost_coins      INTEGER NOT NULL,
  reward_value    INTEGER NOT NULL,
  reward_type     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'consumed'
                    CHECK(status IN ('pending', 'approved', 'consumed', 'revoked')),
  redeemed_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_at      INTEGER,                             -- 撤销时间
  revoked_by      INTEGER,                             -- PM user id
  fulfilled_at    INTEGER,                             -- custom 流程 PM 手动 confirm 时间
  fulfilled_by    INTEGER,                             -- custom 流程 PM user id
  coin_event_id   INTEGER NOT NULL,                    -- FK → score_events.id (type='coins', change_value=-cost)
  reward_event_id INTEGER,                             -- FK → score_events.id (type=reward_type, change_value=+reward); NULL for kind='custom'
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id)         REFERENCES users(id),
  FOREIGN KEY (item_id)         REFERENCES shop_items(id),
  FOREIGN KEY (coin_event_id)   REFERENCES score_events(id),
  FOREIGN KEY (reward_event_id) REFERENCES score_events(id),
  FOREIGN KEY (revoked_by)      REFERENCES users(id),
  FOREIGN KEY (fulfilled_by)    REFERENCES users(id)
);

-- 复制全部现有 redemption 数据 (reward_event_id 直接搬过来, 旧数据 reward_event_id 一定非空)
INSERT INTO shop_redemptions_new
  SELECT id, user_id, item_id, week_of, cost_coins, reward_value, reward_type, status,
         redeemed_at, revoked_at, revoked_by,
         NULL, NULL,                  -- fulfilled_at / fulfilled_by 旧 redemption 留空
         coin_event_id, reward_event_id, created_at
  FROM shop_redemptions;

-- 替换旧表 (PRAGMA 关闭外键, 避免 DROP 触发)
PRAGMA foreign_keys = OFF;
DROP TABLE shop_redemptions;
ALTER TABLE shop_redemptions_new RENAME TO shop_redemptions;
PRAGMA foreign_keys = ON;

-- 重建所有索引 (与 0007_coin_system.sql 一致)
CREATE INDEX IF NOT EXISTS idx_redemptions_user_week
  ON shop_redemptions(user_id, week_of);
CREATE INDEX IF NOT EXISTS idx_redemptions_user_redeemed
  ON shop_redemptions(user_id, redeemed_at DESC);

-- 待发查询性能 (v3 新增, PM 后台 "📦 待发" 列表)
-- 查询模式: WHERE status = 'pending' ORDER BY redeemed_at DESC
CREATE INDEX IF NOT EXISTS idx_redemptions_status_redeemed
  ON shop_redemptions(status, redeemed_at DESC);

-- =============================================================
-- 2) seed: 第 2 件商品 (🧱 小乐高, kind=custom)
-- =============================================================
-- 锁定的需求 (RFC §1 + feihao 2026-06-15 拍板):
--   - kind='custom' (无对应 game_time 奖励, 实物小乐高玩具)
--   - 50 金币换 1 件
--   - 每周限 1 次
--   - 兑换后 status='pending', PM 手动点 "✓ 已发" 才转 'approved'
--
-- sort_order = 2 (在 id=1 游戏时间 之后, 跟 RFC §2 商品 list 顺序一致)
INSERT OR IGNORE INTO shop_items (name, kind, cost_coins, reward_value, reward_type, description, icon, sort_order, weekly_limit)
  VALUES (
    '小乐高',
    'custom',
    50,
    1,
    'none',
    '1 个小乐高玩具',
    '🧱',
    2,
    1
  );

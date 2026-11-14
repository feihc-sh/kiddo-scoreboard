-- migrations/0021_achievements.sql
-- Feature: 成就系统 (Achievements) — spec docs/achievements-spec.md v1.1
--
-- 改动:
--   1. score_events 重建: type CHECK 加 'pet_tokens', source CHECK 加 'achievement'
--      (宠物代币账本与 coins 同构 — 余额走 SUM(change_value) 推导, spec §5)
--   2. 新表 seasons (赛季)
--   3. 新表 achievements (奖项定义)
--   4. 新表 achievement_awards (发放记录)
--   5. seed: S1 赛季 + 8 个奖项 (spec §2 表格顺序)
--
-- 兼容性: 0007 已用同样的 "CREATE new + INSERT SELECT + DROP + RENAME" 模式
--   重建过 score_events。本次重建 **保留所有 id 和数据**, 并且 **保留指向
--   score_events(id) 的外键引用** (0007 曾把 task_completions.awarded_event_id
--   全清成 NULL 且没有恢复 —— 那是数据损失, 本次不做)。
--
--   ⚠️ 关键 (实测于 Miniflare/D1, 治本 INCIDENTS 2026-06-11 — 见 docs/INCIDENTS.md):
--   D1 里 `PRAGMA foreign_keys = OFF` **不生效** —— DROP TABLE score_events 仍会
--   触发 FK 违例 (SQLITE_CONSTRAINT_FOREIGNKEY, Code 7500)。实测三种写法:
--     A) PRAGMA foreign_keys=OFF + DROP + RENAME        → 失败 (FK 违例)
--     B) rename 旧表走 → 建新表 → 拷贝 → DROP 旧表        → 失败 (FK 违例)
--     C) PRAGMA defer_foreign_keys=ON + DROP              → 失败 (FK 违例)
--     D) 备份 FK 值 → 置 NULL → 重建 → 回填              → ✅ 成功
--   所以本次采用 D: 先把引用值备份到临时表并置 NULL (让 DROP 能过), 重建后
--   再按主键回填。因为 score_events 的 id 原样复制, 回填必然指向真实存在的行。
--
-- 应用顺序: wrangler d1 migrations apply 按文件名前缀顺序应用 0001..0021。

-- =============================================================
-- 1) score_events 重建 (加 'pet_tokens' 账户类型 + 'achievement' 来源)
-- =============================================================
-- SQLite 不支持 ALTER CHECK, 必须重建表。新表结构与 0007 后的 score_events
-- 完全一致, 只把两个 CHECK 枚举各扩一个值:
--   type:   'game_time' | 'pocket_money' | 'coins' | 'pet_tokens'
--   source: 'manual' | 'task' | 'exchange' | 'weekly_grant' | 'achievement'
CREATE TABLE score_events_v2 (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  type          TEXT NOT NULL CHECK(type IN ('game_time', 'pocket_money', 'coins', 'pet_tokens')),
  change_value  INTEGER NOT NULL,         -- 正=奖 / 负=扣
  reason        TEXT NOT NULL,
  status        TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected', 'revoked')),
  submitted_by  TEXT NOT NULL CHECK(submitted_by IN ('child', 'pm', 'system')),
  source        TEXT NOT NULL CHECK(source IN ('manual', 'task', 'exchange', 'weekly_grant', 'achievement')),
  source_ref    TEXT,                     -- 可选: 关联来源 ID (e.g. 'achievement:award:12')
  reviewed_by   INTEGER,                  -- PM user id
  reviewed_at   INTEGER,
  week_of       TEXT,                     -- ISO 8601 格式: '2026-W23'
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id)     REFERENCES users(id),
  FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

-- 复制全部现有数据 (含历史 game_time / pocket_money / coins events, 无丢失)。
-- 显式列出 id, 保证主键不变 → 回填 FK 时必然指向真实存在的 score_events 行。
INSERT INTO score_events_v2
  SELECT id, user_id, type, change_value, reason, status, submitted_by, source,
         source_ref, reviewed_by, reviewed_at, week_of, created_at
  FROM score_events;

-- 备份所有指向 score_events(id) 的外键引用, 然后置 NULL。
-- 涉及两张引用表 (见 migrations/0007 + 0008):
--   task_completions.awarded_event_id  → score_events(id)
--   shop_redemptions.coin_event_id     → score_events(id)   (NOT NULL)
--   shop_redemptions.reward_event_id   → score_events(id)   (nullable)
CREATE TABLE IF NOT EXISTS _score_events_fk_backup (
  table_name      TEXT NOT NULL,
  row_id          INTEGER NOT NULL,
  col_name        TEXT NOT NULL,
  referenced_id   INTEGER,
  PRIMARY KEY (table_name, row_id, col_name)
);

INSERT OR IGNORE INTO _score_events_fk_backup (table_name, row_id, col_name, referenced_id)
  SELECT 'task_completions', id, 'awarded_event_id', awarded_event_id
  FROM task_completions WHERE awarded_event_id IS NOT NULL;

INSERT OR IGNORE INTO _score_events_fk_backup (table_name, row_id, col_name, referenced_id)
  SELECT 'shop_redemptions', id, 'coin_event_id', coin_event_id
  FROM shop_redemptions WHERE coin_event_id IS NOT NULL;

INSERT OR IGNORE INTO _score_events_fk_backup (table_name, row_id, col_name, referenced_id)
  SELECT 'shop_redemptions', id, 'reward_event_id', reward_event_id
  FROM shop_redemptions WHERE reward_event_id IS NOT NULL;

-- 置 NULL, 让 DROP TABLE score_events 不再触发 FK 违例。
-- task_completions.awarded_event_id 可空 → 直接置 NULL。
UPDATE task_completions SET awarded_event_id = NULL WHERE awarded_event_id IS NOT NULL;

-- ⚠️ shop_redemptions.coin_event_id 是 NOT NULL —— 不能置 NULL。
--   先把这张表重建为 "迁移期间可空版" (结构与 0008 之后一致, 只放宽
--   coin_event_id), 重建 score_events 之后再回填并把约束改回 NOT NULL。
CREATE TABLE shop_redemptions_v2 (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  item_id         INTEGER NOT NULL,
  week_of         TEXT NOT NULL,
  cost_coins      INTEGER NOT NULL,
  reward_value    INTEGER NOT NULL,
  reward_type     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'consumed'
                    CHECK(status IN ('pending', 'approved', 'consumed', 'revoked')),
  redeemed_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_at      INTEGER,
  revoked_by      INTEGER,
  fulfilled_at    INTEGER,
  fulfilled_by    INTEGER,
  coin_event_id   INTEGER,                        -- 迁移期间暂时可空, 迁移后回填并改回 NOT NULL
  reward_event_id INTEGER,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id)         REFERENCES users(id),
  FOREIGN KEY (item_id)         REFERENCES shop_items(id),
  FOREIGN KEY (revoked_by)      REFERENCES users(id)
);

INSERT INTO shop_redemptions_v2
  SELECT id, user_id, item_id, week_of, cost_coins, reward_value, reward_type, status,
         redeemed_at, revoked_at, revoked_by, fulfilled_at, fulfilled_by,
         NULL, NULL, created_at
  FROM shop_redemptions;

DROP TABLE shop_redemptions;
ALTER TABLE shop_redemptions_v2 RENAME TO shop_redemptions;

CREATE INDEX IF NOT EXISTS idx_redemptions_user_week
  ON shop_redemptions(user_id, week_of);
CREATE INDEX IF NOT EXISTS idx_redemptions_user_redeemed
  ON shop_redemptions(user_id, redeemed_at DESC);

-- 重建表 (id 原样保留)。
DROP TABLE score_events;
ALTER TABLE score_events_v2 RENAME TO score_events;

-- 回填外键 (按备份表的主键精确还原, 0007 没做这一步 —— 那次是数据丢失)。
UPDATE task_completions
  SET awarded_event_id = (
    SELECT b.referenced_id FROM _score_events_fk_backup b
    WHERE b.table_name = 'task_completions'
      AND b.row_id = task_completions.id
      AND b.col_name = 'awarded_event_id'
  )
  WHERE id IN (
    SELECT row_id FROM _score_events_fk_backup
    WHERE table_name = 'task_completions' AND col_name = 'awarded_event_id'
  );

UPDATE shop_redemptions
  SET coin_event_id = (
    SELECT b.referenced_id FROM _score_events_fk_backup b
    WHERE b.table_name = 'shop_redemptions'
      AND b.row_id = shop_redemptions.id
      AND b.col_name = 'coin_event_id'
  )
  WHERE id IN (
    SELECT row_id FROM _score_events_fk_backup
    WHERE table_name = 'shop_redemptions' AND col_name = 'coin_event_id'
  );

UPDATE shop_redemptions
  SET reward_event_id = (
    SELECT b.referenced_id FROM _score_events_fk_backup b
    WHERE b.table_name = 'shop_redemptions'
      AND b.row_id = shop_redemptions.id
      AND b.col_name = 'reward_event_id'
  )
  WHERE id IN (
    SELECT row_id FROM _score_events_fk_backup
    WHERE table_name = 'shop_redemptions' AND col_name = 'reward_event_id'
  );

-- 清理临时备份表。
DROP TABLE _score_events_fk_backup;

-- 把 shop_redemptions 恢复成原来的约束 (coin_event_id NOT NULL)。
-- SQLite 不能 ALTER 约束 → 再重建一次表, 这次用原结构。
--
-- 注意: 用 shop_redemptions_v3 而不是复用 v2 的名字, 因为 ALTER RENAME
-- 会把表重命名为目标名, 所以这里直接 DROP + RENAME。
CREATE TABLE shop_redemptions_v3 (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  item_id         INTEGER NOT NULL,
  week_of         TEXT NOT NULL,
  cost_coins      INTEGER NOT NULL,
  reward_value    INTEGER NOT NULL,
  reward_type     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'consumed'
                    CHECK(status IN ('pending', 'approved', 'consumed', 'revoked')),
  redeemed_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_at      INTEGER,
  revoked_by      INTEGER,
  fulfilled_at    INTEGER,
  fulfilled_by    INTEGER,
  coin_event_id   INTEGER NOT NULL,        -- 恢复 NOT NULL (与 0008 一致)
  reward_event_id INTEGER,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id)         REFERENCES users(id),
  FOREIGN KEY (item_id)         REFERENCES shop_items(id),
  FOREIGN KEY (coin_event_id)   REFERENCES score_events(id),
  FOREIGN KEY (reward_event_id) REFERENCES score_events(id),
  FOREIGN KEY (revoked_by)      REFERENCES users(id)
);

INSERT INTO shop_redemptions_v3
  SELECT id, user_id, item_id, week_of, cost_coins, reward_value, reward_type, status,
         redeemed_at, revoked_at, revoked_by, fulfilled_at, fulfilled_by,
         coin_event_id, reward_event_id, created_at
  FROM shop_redemptions;

DROP TABLE shop_redemptions;
ALTER TABLE shop_redemptions_v3 RENAME TO shop_redemptions;

CREATE INDEX IF NOT EXISTS idx_redemptions_user_week
  ON shop_redemptions(user_id, week_of);
CREATE INDEX IF NOT EXISTS idx_redemptions_user_redeemed
  ON shop_redemptions(user_id, redeemed_at DESC);

-- 重建所有索引 (与 0007 重建后保持一致)
CREATE INDEX IF NOT EXISTS idx_score_events_user_status ON score_events(user_id, status);
CREATE INDEX IF NOT EXISTS idx_score_events_user_type   ON score_events(user_id, type);
CREATE INDEX IF NOT EXISTS idx_score_events_week        ON score_events(week_of);
CREATE INDEX IF NOT EXISTS idx_score_events_created     ON score_events(created_at DESC);
-- 代币账本按 source_ref 查幂等来源 (铸造/烧回都按 'achievement:award:<id>' 锚定)
CREATE INDEX IF NOT EXISTS idx_score_events_source_ref  ON score_events(source_ref);

-- =============================================================
-- 2) seasons: 赛季 (spec §6)
-- =============================================================
-- is_current = 1 的赛季是当前赛季; 结束归档后 is_current 归 0。
-- ends_on 为 NULL 表示"尚未归档"。
CREATE TABLE IF NOT EXISTS seasons (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,              -- e.g. 'S1 · 四年级上学期'
  starts_on   TEXT NOT NULL,              -- 'YYYY-MM-DD' (Asia/Shanghai 日历日)
  ends_on     TEXT,                       -- NULL = 未归档
  is_current  INTEGER NOT NULL DEFAULT 0 CHECK(is_current IN (0, 1))
);

-- 当前赛季查询 (每次发放 / 每次读成就墙都要用)
CREATE UNIQUE INDEX IF NOT EXISTS idx_seasons_current ON seasons(is_current) WHERE is_current = 1;

-- =============================================================
-- 3) achievements: 奖项定义 (spec §6)
-- =============================================================
-- grp:       'study' | 'life' | 'skill'  (spec §1 三组)
-- grant_mode: 'admin_tier'  — admin 直发对应牌级 (次数档/本数档)
--             'admin_flat'  — admin 平发, 无等级 (创新家务奖), ladder_json = NULL
--             'auto_streak' — 自动规则引擎发放 (自律生活: 连续全卡 N 天)
-- ladder_json: JSON TEXT, e.g. {"iron":1,"bronze":3,"silver":5,"gold":8,"king":10}
--             服务端必须 parse 成对象再返回 (spec §7b, R11 教训)
CREATE TABLE IF NOT EXISTS achievements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  grp          TEXT NOT NULL CHECK(grp IN ('study', 'life', 'skill')),
  name         TEXT NOT NULL,             -- e.g. '语文默写全对'
  description  TEXT,                      -- e.g. '获得一次语文默写全对'
  grant_mode   TEXT NOT NULL CHECK(grant_mode IN ('admin_tier', 'admin_flat', 'auto_streak')),
  ladder_json  TEXT,                      -- NULL = 无等级阶梯 (admin_flat)
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  sort_order   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_achievements_active ON achievements(is_active, sort_order);

-- =============================================================
-- 4) achievement_awards: 发放记录 (spec §6)
-- =============================================================
-- tier: 'iron' | 'bronze' | 'silver' | 'gold' | 'king' | 'flat'
-- status: 'active' | 'revoked' (撤销 = 状态翻转, spec §3)
-- granted_by / revoked_by → users(id)
--   granted_by 可为 NULL: streak 引擎自动发放时没有 PM 在场, 用 NULL 表示
--   "非人工发放"。**不能**用 0 占位 —— 该列是 FK-enforced 列, 0 不存在
--   于 users(id), 会直接触发 FK 违例 (D1 Code 7500)。
-- 幂等口径: 同季同 achievement 同 tier 是否"发过" **含 revoked**
--   (streak 引擎不自动补发被撤销的牌, spec §8a)
CREATE TABLE IF NOT EXISTS achievement_awards (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  achievement_id INTEGER NOT NULL,
  user_id        INTEGER NOT NULL,
  tier           TEXT NOT NULL CHECK(tier IN ('iron', 'bronze', 'silver', 'gold', 'king', 'flat')),
  season_id      INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
  granted_by     INTEGER,
  granted_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_at     INTEGER,
  revoked_by     INTEGER,
  FOREIGN KEY (achievement_id) REFERENCES achievements(id),
  FOREIGN KEY (user_id)        REFERENCES users(id),
  FOREIGN KEY (season_id)      REFERENCES seasons(id),
  FOREIGN KEY (granted_by)     REFERENCES users(id),
  FOREIGN KEY (revoked_by)     REFERENCES users(id)
);

-- 成就墙查询: 某用户某赛季的全部牌
CREATE INDEX IF NOT EXISTS idx_awards_user_season ON achievement_awards(user_id, season_id, status);
-- 幂等判定: 同季同奖项同用户同档是否发过 (含 revoked)
CREATE INDEX IF NOT EXISTS idx_awards_idem ON achievement_awards(season_id, achievement_id, user_id, tier);
-- 发放日志 (admin)
CREATE INDEX IF NOT EXISTS idx_awards_granted_at ON achievement_awards(granted_at DESC);

-- =============================================================
-- 5) seed: S1 赛季 + 8 个奖项 (spec §2 表格, sort_order 按表格顺序)
-- =============================================================
-- 用 INSERT OR IGNORE + 显式 id, 保证 migration **可重复应用**:
--   * 单元测试用 Miniflare 反复 apply 全部 migration (每个 beforeEach 都
--     drop 掉业务表再重放一遍) — 显式 id + OR IGNORE 让重放成为 no-op,
--     不会撞 PRIMARY KEY。
--   * 生产环境 wrangler d1 migrations apply 只跑一次, 行为一致。
--   * 用显式 id 而非自增, 是为了让 spec §7a 的示例 id (season id=1,
--     首个 achievement id=1) 与实际数据一致。
--
-- S1 赛季: 四年级上学期 (2026-09-01 起, 未归档)
INSERT OR IGNORE INTO seasons (id, name, starts_on, ends_on, is_current)
  VALUES (1, 'S1 · 四年级上学期', '2026-09-01', NULL, 1);

-- 次数档 / 本数档: 1铁/3铜/5银/8金/10王者 (spec §2 E1)
-- 天数档 (自律生活): 2/4/8/15/30 (spec §2, §11 open item 默认值)
-- 平发奖 (创新家务): grant_mode='admin_flat', ladder_json = NULL
INSERT OR IGNORE INTO achievements (id, grp, name, description, grant_mode, ladder_json, is_active, sort_order) VALUES
  (1, 'study', '语文默写全对',       '获得一次语文默写全对',       'admin_tier',  '{"iron":1,"bronze":3,"silver":5,"gold":8,"king":10}',   1, 1),
  (2, 'study', '英语默写全对',       '获得一次英语默写全对',       'admin_tier',  '{"iron":1,"bronze":3,"silver":5,"gold":8,"king":10}',   1, 2),
  (3, 'study', '测评得优',           '在测评中取得优等成绩',       'admin_tier',  '{"iron":1,"bronze":3,"silver":5,"gold":8,"king":10}',   1, 3),
  (4, 'life',  '自律生活',           '连续全卡 N 天, 达档自动发放', 'auto_streak', '{"iron":2,"bronze":4,"silver":8,"gold":15,"king":30}', 1, 4),
  (5, 'life',  '创新家务奖',         '完成一次有创意的家务',       'admin_flat',  NULL,                                                     1, 5),
  (6, 'skill', '读完一本长篇中文小说','读完一本长篇中文小说',       'admin_tier',  '{"iron":1,"bronze":3,"silver":5,"gold":8,"king":10}',   1, 6),
  (7, 'skill', '完成一首新曲子演奏', '完成一首新曲子的演奏',       'admin_tier',  '{"iron":1,"bronze":3,"silver":5,"gold":8,"king":10}',   1, 7),
  (8, 'skill', '通关一个新游戏',     '通关一个之前没玩过的游戏',   'admin_tier',  '{"iron":1,"bronze":3,"silver":5,"gold":8,"king":10}',   1, 8);

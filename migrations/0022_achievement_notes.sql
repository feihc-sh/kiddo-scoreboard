-- migrations/0022_achievement_notes.sql
-- Feature: 发放记录「完成日期 / 完成内容」+ 新奖项「读完一本英文长篇小说」
--
-- 改动:
--   1. achievement_awards 加两列 (都可 NULL):
--        completed_on TEXT  -- 'YYYY-MM-DD' (Asia/Shanghai 日历日)
--        note         TEXT  -- 完成内容 (自由文本, ≤100 字)
--   2. 新增第 9 个奖项: 读完一本英文长篇小说 (skill 组, admin_tier, 次数档)
--
-- 兼容性:
--   * 0021 **已经 applied 到生产** → 绝不能改 0021 (改了生产不会重跑, 只
--     会让新环境与生产 schema 漂移)。本次改动全部走新文件。
--   * ALTER TABLE ADD COLUMN 对已有行是 no-op (新列一律 NULL) —— 老数据
--     不受影响, 不需要 backfill。
--
-- 幂等性 (重要 —— 测试会用 Miniflare 反复重放全部 migration):
--   * 新奖项用 `INSERT ... SELECT ... WHERE NOT EXISTS` 而不是
--     `INSERT OR IGNORE`: 去重键是 **name**, 不依赖 id。本文件刻意
--     **不写死 id** (让 AUTOINCREMENT 分配), 而 OR IGNORE 只能靠
--     UNIQUE 约束去重 —— achievements 表没有 name 唯一约束, 所以
--     OR IGNORE + 自增 id 挡不住重放造成的重复行。
--   * ALTER TABLE ADD COLUMN **不可重复执行** (SQLite 报
--     "duplicate column name"), 所以重放型测试必须先 DROP
--     achievement_awards —— 已有测试 (achievement-real-d1.test.ts)
--     已经是这个 DROP-list 模式。
--
-- 展示顺序:
--   achievements 按 `ORDER BY sort_order ASC, id ASC` 排序。sort_order 是
--   INTEGER 列, 但 SQLite 的 INTEGER 亲和性只在**无损**时才做转换, 所以
--   6.5 会以 REAL 存下 —— 正好卡在 6 与 7 中间:
--       读完一本长篇中文小说 (6) → 读完一本英文长篇小说 (6.5)
--       → 完成一首新曲子演奏 (7) → 通关一个新游戏 (8)
--   旧的 8 个奖项的 id / sort_order 一律不动 —— 新奖项拿自增 id (9)。

-- =============================================================
-- 1) 发放记录加两列
-- =============================================================
-- completed_on: PM 记录「这件事是哪天完成的」(ISO 日历日)。
--   NULL = PM 没记 —— 老数据与不填的发放都是 NULL。
ALTER TABLE achievement_awards ADD COLUMN completed_on TEXT;

-- note: PM 记录「这次具体完成了什么」(例: 英语课外班默写全对)。
--   NULL = PM 没记。长度上限 100 字在 API 层校验 (400), DB 不设 CHECK。
ALTER TABLE achievement_awards ADD COLUMN note TEXT;

-- =============================================================
-- 2) 新奖项: 读完一本英文长篇小说
-- =============================================================
-- 与已有的 id=6「读完一本长篇中文小说」**并列**, 是独立奖项
-- (feihao 2026-11-23: 英文长篇是另一个成就, 不是把中文长篇改名)。
-- 次数档与其它技能组奖项一致 (spec §2 的 E1 档: 1铁/3铜/5银/8金/10王者)。
INSERT INTO achievements (grp, name, description, grant_mode, ladder_json, is_active, sort_order)
SELECT 'skill',
       '读完一本英文长篇小说',
       '读完一本英文长篇小说',
       'admin_tier',
       '{"iron":1,"bronze":3,"silver":5,"gold":8,"king":10}',
       1,
       6.5
WHERE NOT EXISTS (
  SELECT 1 FROM achievements WHERE name = '读完一本英文长篇小说'
);

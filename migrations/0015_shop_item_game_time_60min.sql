-- Module 7 (Coin System) — 新增第 3 件商品
-- =============================================================
-- 锁定的需求 (feihao 2026-07-19 拍板):
--   - 第 3 件商品 = 50 金币换 60 分钟游戏时间
--   - kind='game_time' (与 #1 同类, 自动 approved)
--   - 每周限 1 次 (一次 60 分钟已经够多, 防止一天囤太多)
--   - sort_order=3 (在 #1=1, #2=2 之后)
--
-- 与 #1 "游戏时间 10 分钟" 对比:
--   - #1: 10 金币 / 10 分钟, weekly_limit=3 → 30 分钟/周
--   - #3: 50 金币 / 60 分钟, weekly_limit=1 → 60 分钟/周 (加量优惠: 0.83 金币/分钟 vs #1 的 1 金币/分钟)
--
-- 用 WHERE NOT EXISTS: 防重 (name 字段没 UNIQUE 约束, INSERT OR IGNORE
-- 在缺 PRIMARY KEY 冲突时不生效, 会产生重复行 — 已在本地 sqlite3 dry-run 验证)。
-- =============================================================
INSERT INTO shop_items (name, kind, cost_coins, reward_value, reward_type, description, icon, sort_order, weekly_limit)
  SELECT '游戏时间 60 分钟', 'game_time', 50, 60, 'game_time',
         '用 50 金币兑换 60 分钟游戏时间', '🎮', 3, 1
  WHERE NOT EXISTS (
    SELECT 1 FROM shop_items WHERE name = '游戏时间 60 分钟'
  );
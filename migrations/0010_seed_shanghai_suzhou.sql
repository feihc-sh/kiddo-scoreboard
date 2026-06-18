-- Module 9: Running Map seed (RFC §3 — Running Map M1)
-- 改动:
--   1. Seed 第 1 张地图: 上海 → 苏州 (总 95 km, 不均距 10 个节点)
--   2. Seed 第 2 / 第 3 张地图占位 (display_order=2/3, is_active=0, 等第 1 张通关)
--   3. 不动现有 9 张表数据
--
-- 设计原则 (PRD §Running Map M1):
--   - 8 次跑步完成 (单次 3-4 km × 8 = 24-32 km 太慢, 应让单次 3-4 km 推进感明显)
--   - 95 km 是**目标里程**而非时间, 节点间不均距有节奏感
--   - 通关 (cum_km >= total_km) 触发翻 is_active 到下一张
--
-- 应用顺序: 在 0009 之后, 按 wrangler d1 migrations apply 文件名顺序。

-- =============================================================
-- 1) running_maps: 第 1 张 (active) + 第 2/3 张 (inactive 占位)
-- =============================================================
INSERT OR IGNORE INTO running_maps (id, name, theme, total_km, is_active, display_order, created_at) VALUES
  (1, '上海 → 苏州',     'shanghai-suzhou',     95.0, 1, 1,  strftime('%s','now')),
  (2, '苏州 → 杭州 (规划)', 'suzhou-hangzhou',  180.0, 0, 2,  strftime('%s','now')),
  (3, '杭州 → 黄山 (规划)', 'hangzhou-huangshan', 260.0, 0, 3, strftime('%s','now'));

-- =============================================================
-- 2) running_points: 第 1 张地图 10 个节点 (起点 0 + 8 中间 + 终点 95)
-- =============================================================
-- 实际地理公里数是参考值, Stage 1 不强制精确, Stage 2+ 推进逻辑只依赖 cum_km
-- 单调递增 + 终点 cum_km == total_km (95.0)。如需调整 km, 改 cum_km 列即可。
INSERT OR IGNORE INTO running_points (id, map_id, name, order_index, cum_km) VALUES
  (1,  1, '🏁 上海·普陀区 (起点)',     0,   0.0),
  (2,  1, '嘉定新城',                 1,   8.0),
  (3,  1, '太仓',                     2,  22.0),
  (4,  1, '昆山花桥',                 3,  32.0),
  (5,  1, '昆山城区',                 4,  45.0),
  (6,  1, '阳澄湖',                   5,  58.0),
  (7,  1, '苏州相城区',               6,  72.0),
  (8,  1, '苏州姑苏区',               7,  82.0),
  (9,  1, '苏州工业园区',             8,  89.0),
  (10, 1, '🚩 苏州·金鸡湖 (终点)',    9,  95.0);

-- Module 9: Running Map (RFC §3 — Running Map M1)
-- 改动:
--   1. 新表 running_maps    (主题地图清单, 多张地图切换)
--   2. 新表 running_points  (每张地图的节点: 起点 + N 个 + 终点)
--   3. 新表 running_records (每次打卡: 公里数 + 累计 + 撤销语义)
--   4. 3 索引: cum_km 推进位 / revoked_at 撤销过滤 / map_id 切图
--   5. 不修改现有 9 张表 (score_events / task_completions / health_events schema 不动)
--
-- 兼容性: 本 migration 只 ADD 表 + ADD 索引, 不动现有数据。
-- running_records 完全独立于 score_events, 不参与 🎮/💰/🪙 余额计算。
-- 撤销语义 (X1 修订 2026-06-17): 撤销 = 减回积分 + 回退累计 km,
--                              跟 #009 hard-delete 走相同的 audit_log 模式。
--
-- 应用顺序: wrangler d1 migrations apply 会按文件名前缀顺序应用 0001..0009。
-- 用 0009 前缀避开现有 0007_coin_system / 0008_coin_shop / 0008_health_events 冲突。

-- =============================================================
-- 1) running_maps: 主题地图清单 (多张地图, 可切换 + 通关解锁)
-- =============================================================
-- design notes:
--   - is_active=1 = 当前可用的地图 (同时只 1 张, 通关后自动激活下一张)
--   - display_order 决定通关后激活哪一张 (id ASC 用作 stable 排序)
--   - total_km 是关卡目标公里数 (e.g. 上海→苏州 = 95 km)
--   - theme 自由字符串, 给 CSS 区分视觉 (e.g. "shanghai-suzhou", "suzhou-hangzhou")
CREATE TABLE IF NOT EXISTS running_maps (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  theme          TEXT    NOT NULL,
  total_km       REAL    NOT NULL CHECK(total_km > 0),
  is_active      INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0, 1)),
  display_order  INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);

-- =============================================================
-- 2) running_points: 每张地图的节点 (起点 0 km + 多个 + 终点 total_km)
-- =============================================================
-- design notes:
--   - order_index 从 0 开始, 0 = 起点, max = 终点
--   - cum_km 累计公里数 (单调递增, 起点 cum_km=0, 终点 cum_km=total_km)
--   - name 节点名称 (e.g. "嘉定新城", "阳澄湖")
--   - 不加 UNIQUE(map_id, order_index) 留给应用层保证 (e.g. 删图重建)
CREATE TABLE IF NOT EXISTS running_points (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  map_id      INTEGER NOT NULL,
  name        TEXT    NOT NULL,
  order_index INTEGER NOT NULL,
  cum_km      REAL    NOT NULL CHECK(cum_km >= 0),
  FOREIGN KEY (map_id) REFERENCES running_maps(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_running_points_map_order
  ON running_points(map_id, order_index);

-- =============================================================
-- 3) running_records: 每次跑步打卡 (公里数 + 累计 + 撤销语义)
-- =============================================================
-- design notes:
--   - map_id 决定记到哪张地图的累计 km
--   - km 本次打卡公里数 (用户输入, e.g. 3.5)
--   - awarded_point_id / awarded_minutes NULLABLE (可能未到新节点, 没礼物)
--   - revoked_at / revoked_by NULLABLE (NULL = 未撤销)
--   - 撤销语义 (X1 修订): PM 撤销 → revoked_at + revoked_by + 减回积分 + 回退累计 km
--   - 不强制 FK running_points, 允许 awarded_point_id 指向历史节点
CREATE TABLE IF NOT EXISTS running_records (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id          INTEGER NOT NULL,
  map_id            INTEGER NOT NULL,
  km                REAL    NOT NULL CHECK(km > 0),
  awarded_point_id  INTEGER,
  awarded_minutes   INTEGER,
  created_at        INTEGER NOT NULL,
  revoked_at        INTEGER,
  revoked_by        INTEGER,
  FOREIGN KEY (child_id) REFERENCES users(id),
  FOREIGN KEY (map_id) REFERENCES running_maps(id),
  FOREIGN KEY (awarded_point_id) REFERENCES running_points(id),
  FOREIGN KEY (revoked_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_running_records_child_map
  ON running_records(child_id, map_id, created_at);
CREATE INDEX IF NOT EXISTS idx_running_records_active
  ON running_records(child_id, map_id, revoked_at);

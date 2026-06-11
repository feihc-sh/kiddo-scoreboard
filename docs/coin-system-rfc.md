# 金币系统 RFC（Request for Comments）

**版本:** v1.0 (draft)
**日期:** 2026-06-11
**作者:** Code Agent（代岑斐灏 / feihao 决策）
**状态:** 待用户最终确认
**目标读者:** 用户（产品负责人）、Code Agent（实施者）、Qual Agent（验收者）

> 本 RFC 是 kiddo-scoreboard v2 的第 3 个账户——**金币（coins）**——的设计规格。
> 在现有 🎮 游戏时间 + 💰 零花钱 之外，引入 🪙 金币作为"任务激励 + 商店兑换"的新维度。
> 配套 commit `fc0604b` 已经预留了第 3 个 balance card placeholder，本 RFC 把它从占位符变成真实功能。

---

## 1. 背景与目标

### 1.1 现状

kiddo-scoreboard v2 已经稳定运行 2 个并行账户：

| 账户 | 来源 | 用途 |
|------|------|------|
| 🎮 游戏时间 (game_time, 分钟) | 任务直接奖励 + PM 手动发周额度 + 双账户兑换 | 玩 Switch / iPad 游戏 |
| 💰 零花钱 (pocket_money, 元) | 任务直接奖励 + PM 手动发周额度 + 双账户兑换 | 实体商品 / 攒钱 |

**当前痛点（岑斐灏 v2.1 反馈）：**

1. **任务奖励"种类单一"**：现在每个任务只能往 game_time 或 pocket_money 其中一个账户加分，孩子感受不到"努力攒东西"的乐趣——游戏时间只是消耗品，零花钱是被动储蓄。
2. **游戏时间来源过于分散**：任务奖励 + PM 周额度 + 双账户兑换都能产出游戏时间，孩子对"怎么又多出 30 分钟"没有清晰认知。
3. **缺乏"中期目标"**：现在的奖励都是即时的（完成任务立刻给 30 分钟游戏），没有"攒 → 兑"的成长感。
4. **撤销逻辑不闭环**：撤销任务时游戏时间回收没问题，但"全完成 bonus"这种正向激励机制完全缺失。

### 1.2 目标

引入 **🪙 金币** 作为第 3 个账户：

- ✅ **任务完成激励**：每完成一个任务 +1 金币，给孩子持续正反馈（比"任务 → 30 分钟游戏"的二选一更轻量）。
- ✅ **全任务完成 bonus**：当天所有任务全部完成额外 +3 金币，奖励"坚持一整天"的努力。
- ✅ **金币商店**：攒够金币可以兑换游戏时间（10 金币 = 10 分钟游戏时间，每周限 3 次），让孩子体验"攒 → 兑"的成就感。
- ✅ **游戏时间来源收敛**：任务不再直接奖励游戏时间，**游戏时间只能通过金币兑换获得**。这样孩子的"游戏时间" = "他用努力换来的"，来源清晰可追溯。
- ✅ **撤销闭环**：撤销任务时同步回收金币 + bonus，保持账本严格守恒。

### 1.3 非目标（明确不做）

- ❌ 不做金币 → 零花钱的反向兑换（金币只换游戏时间，第一阶段只 1 件商品）
- ❌ 不做金币排行榜 / 多孩竞争（仍只 1 个 child，但 schema 要 support 多孩）
- ❌ 不做金币过期机制（金币永久有效，除非被撤销回收）
- ❌ 不做金币抽奖 / 概率玩法（确定性兑换，确定性反馈）
- ❌ 不做 push 通知（金币变化在 child UI 实时显示即可）

### 1.4 成功指标

| 指标 | 目标值 | 衡量方式 |
|------|--------|----------|
| 孩子每周主动兑换次数 | ≥ 2 次 | shop_redemptions 表 COUNT(week_of) |
| 全任务完成率 | 比 v2.1 提升 ≥ 20% | task_completions WHERE completed_date = 今天 AND status='active' |
| 撤销对账一致性 | 100%（无孤儿金币事件） | audit_log + score_events 联合校验 |
| 兑换操作延迟 | < 500ms | API 响应时间 |
| 孩子对金币系统满意度 | "好玩 / 想攒" | 主观反馈（岑斐灏观察） |

### 1.5 与现有系统的关系

```
                      ┌─────────────────────┐
                      │   任务完成 (task)   │
                      └──────────┬──────────┘
                                 │
                                 ▼
        ┌────────────────────────────────────────┐
        │  写入 task_completions (status=active) │
        └────────────┬───────────────────────────┘
                     │
        ┌────────────┴─────────────┬──────────────┐
        ▼                          ▼              ▼
  +1 🪙 金币           (未来) 任务分类        检查 bonus
  (score_events,        写入 game_time         条件
   type='coins')        或 pocket_money        │
        │                                       ▼
        │                              +3 🪙 金币 bonus
        │                              (如果今天所有
        │                               active 任务
        │                               都完成)
        ▼                                       │
   🪙 金币账户  ────── 兑换 ──────►  🎮 游戏时间账户
   (代数和)              10 coins          (+10 min)
                        / 周限 3 次
```

**关键变化**：

- ❌ **移除**：tasks.token_reward 字段不再写入 game_time score_event（v3 兼容开关关闭）
- ✅ **新增**：tasks → coins 1:1 写入（每个 active completion 触发 1 条 coins +1）
- ✅ **新增**：全任务完成 → bonus +3 coins（实时触发，最后一个任务完成时立刻判定）
- ✅ **新增**：shop_items + shop_redemptions 表 + /api/coins/exchange 端点

---

## 2. 需求清单

### 2.1 锁定需求（10 条，feihao 已拍板）

| # | 需求 | 关键决策 |
|---|------|---------|
| 1 | 商店架构预留扩展 | `shop_items` + `shop_redemptions` 两表分离，item.kind 字段预留多种商品类型 |
| 2 | 周定义 | 自然周，**ISO 8601** 格式 `YYYY-Www`，周一 00:00 (Asia/Shanghai) ~ 周日 23:59 |
| 3 | 任务全完成判定 | **严格**：当天 active 任务数 = 完成任务数，**请假/禁用任务不计** |
| 4 | UI 入口 | 第 3 个 balance card（替换 commit `fc0604b` 的灰色 placeholder），点击进商店页 |
| 5 | 不足/用完 UX | 按钮置灰 + 文案（"还差 X 金币" / "本周次数已用完，下周一重置"） |
| 6 | 兑换历史透明 | child UI 完整展示本周 + 历史兑换记录（含时间、商品名、消耗金币） |
| 7 | 游戏时间来源重构 | **只靠兑换**获得；任务不再直接奖励 game_time；历史 token_reward 事件保留不动 |
| 8 | bonus 发放时机 | 最后一个任务完成**立刻**发（实时反馈，不延迟到次日凌晨） |
| 9 | 任务撤销联动 | 撤销任务 → 回收金币 -1 + 回收 bonus -3（如果 bonus 已发） |
| 10 | 撤销后重做 | 撤销后孩子重新完成所有任务 → 再发一次 bonus（状态重置语义） |

### 2.2 边界 UX 细节

#### 余额不足 UX

```
商品卡片（10 金币 = 10 分钟游戏）：
┌──────────────────────────────────┐
│  🎮 游戏时间 10 分钟              │
│  💎 价格：10 金币                  │
│                                  │
│  [本周剩余: 3/3 次]               │
│                                  │
│  [🔒 还差 4 金币] (按钮置灰)      │
└──────────────────────────────────┘
```

文案规则：

- 当前金币 < 商品价格：`🔒 还差 X 金币`（X = 商品价格 - 当前金币）
- 当前金币 ≥ 商品价格：按钮可点，显示 `🎁 兑换 (+10 分钟游戏时间)`

#### 周次数用完 UX

```
┌──────────────────────────────────┐
│  🎮 游戏时间 10 分钟              │
│  💎 价格：10 金币                  │
│                                  │
│  [本周剩余: 0/3 次]               │
│                                  │
│  [⏰ 本周已用完，下周一重置] (置灰)│
└──────────────────────────────────┘
```

文案规则：

- 本周已兑换次数 ≥ 3：`⏰ 本周已用 X/3 次，下周一重置`
- 本周已兑换次数 < 3：正常显示剩余次数

#### 兑换成功后 UX

```
✅ 兑换成功！
   🎮 游戏时间 +10 分钟
   🪙 金币 -10
   ⏰ 本周剩余 2/3 次
   
   [查看兑换历史]  [继续逛商店]
```

#### bonus 发放反馈

孩子完成最后一个任务时，UI 弹出短提示（不阻塞，3 秒自动消失）：

```
🎉 全任务完成！+3 金币 bonus！
   🪙 当前金币：XX 金币
```

### 2.3 业务规则细节

#### 全任务完成判定算法

```sql
-- 判定当天是否所有 active 任务都完成
-- 输入: user_id, completed_date
-- 输出: TRUE / FALSE
SELECT
  (SELECT COUNT(*) FROM tasks
     WHERE is_active = 1)
  =
  (SELECT COUNT(*) FROM task_completions tc
     WHERE tc.user_id = ? 
       AND tc.completed_date = ?
       AND tc.status = 'active')
  AS is_all_complete;
```

注意：

- `is_active = 1` 的任务才算（PM 临时禁用的不计）
- `status = 'active'` 的完成才算（已撤销的不计）
- UNIQUE 约束保证每天每任务最多 1 条 active completion
- **不区分"请假"**：岑斐灏确认，v1 阶段不引入请假机制，PM 临时禁用任务即可表达"今天不要求做"

#### 撤销回收算法

```sql
-- 撤销任务时:
-- 1. 反向金币 -1 (总是执行)
INSERT INTO score_events (user_id, type, change_value, reason, status, submitted_by, source, source_ref, week_of)
  VALUES (?, 'coins', -1, 'revoke:task#' || ?, 'approved', 'pm', 'task', ?, ?);

-- 2. 检查今天是否曾发过 bonus (3 coins, reason LIKE 'bonus:%')
SELECT id FROM score_events 
  WHERE user_id = ? 
    AND type = 'coins' 
    AND change_value = 3 
    AND reason LIKE 'bonus:%' 
    AND source_ref = ?  -- ref = 'YYYY-MM-DD:user_id'
    AND status = 'approved';

-- 3. 如果找到 → 反向 -3 bonus
INSERT INTO score_events (user_id, type, change_value, reason, status, submitted_by, source, source_ref, week_of)
  VALUES (?, 'coins', -3, 'revoke:bonus:' || ?, 'approved', 'pm', 'task', ?, ?);
```

注意：

- 撤销回收走 `score_events` 写反向事件，**不修改**原事件（保留完整审计链）
- bonus 回收用 `source_ref = '<date>:<user_id>'` 标识，方便反查
- 如果撤销后孩子重做并再次全完成 → bonus 重新发放（状态重置语义）

#### 周限额校验

```sql
-- 检查本周已兑换次数
SELECT COUNT(*) FROM shop_redemptions
  WHERE user_id = ? 
    AND week_of = ?  -- '2026-W23'
    AND status IN ('active', 'consumed');

-- 如果 < 3 → 允许兑换
-- 如果 >= 3 → 拒绝，返回 429 或 UI 置灰
```

边界：

- 周一 00:00 (Asia/Shanghai) 严格重置
- ISO 周计算用 `date('now', 'localtime')` + JS 端 `Intl.DateTimeFormat` 双重保险
- 兑换成功后立刻写入 `shop_redemptions`，状态 = `consumed`（v1 简化，无 `pending` 状态）

### 2.4 不在 v1 范围

明确**不做**的功能（避免 scope creep）：

- 金币 → 零花钱兑换
- 金币排行榜 / 多孩对比
- 金币等级 / 称号系统
- 金币过期 / 衰减机制
- 商店多商品（v1 只 1 件：10 分钟游戏时间）
- PM 后台配置商品（v1 商品 hardcode 在 seed migration）
- 兑换审批流程（v1 直接兑换，不需要 PM 审批）
- 金币转账 / 赠送
- 历史 token_reward 数据迁移（明确"只对新生效，历史保留"）

---

## 3. 数据模型

### 3.1 Migration 规划

| Migration | 内容 | 风险 |
|-----------|------|------|
| `0007_coin_system.sql` | (a) `score_events.type` CHECK 加 `'coins'` (b) 新表 `shop_items` (c) 新表 `shop_redemptions` (d) seed 1 件商品 | 低：纯 ADD，不动现有数据 |

**命名约定**：延续 `0001_initial.sql` ~ `0006_deleted_records.sql` 编号，新 migration 为 `0007_coin_system.sql`。

### 3.2 Migration SQL（spec 性质）

```sql
-- =============================================================
-- Module: Coin System (RFC §3)
-- 改动: 
--   1. score_events.type CHECK 加 'coins'
--   2. 新表 shop_items (商品定义)
--   3. 新表 shop_redemptions (兑换流水)
--   4. seed 1 件商品 (10 分钟游戏时间 / 10 金币)
-- =============================================================

-- 1) 扩展 score_events.type (SQLite CHECK 重建)
-- 注意: SQLite 不支持 ALTER CHECK,需:
--   a) CREATE TABLE score_events_new (含 'coins')
--   b) INSERT INTO score_events_new SELECT * FROM score_events
--   c) DROP TABLE score_events
--   d) ALTER TABLE score_events_new RENAME TO score_events
--   e) 重建所有索引 (idx_score_events_*)
-- 实施时参考 0004_sleep_cutoff.sql 的表重建模式

-- 2) shop_items: 商品定义 (PM 后台可扩展, v1 只 1 件)
CREATE TABLE IF NOT EXISTS shop_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,              -- e.g. "游戏时间 10 分钟"
  kind            TEXT NOT NULL CHECK(kind IN ('game_time', 'pocket_money', 'custom')),
                                            -- v1 只用 'game_time', 预留扩展
  cost_coins      INTEGER NOT NULL CHECK(cost_coins > 0),
  reward_value    INTEGER NOT NULL CHECK(reward_value > 0),
                                            -- kind='game_time' 时=分钟数
  reward_type     TEXT NOT NULL CHECK(reward_type IN ('game_time', 'pocket_money', 'none')),
                                            -- 与 kind 冗余, 便于查询 (v1 简化为同义)
  description     TEXT,                       -- UI 展示文案
  icon            TEXT,                       -- emoji, e.g. '🎮'
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  weekly_limit    INTEGER NOT NULL DEFAULT 3 CHECK(weekly_limit >= 0),
                                            -- 每用户每周限兑次数, 0 = 不限
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_shop_items_active ON shop_items(is_active, sort_order);

-- 3) shop_redemptions: 兑换流水
CREATE TABLE IF NOT EXISTS shop_redemptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  item_id         INTEGER NOT NULL,
  week_of         TEXT NOT NULL,              -- ISO 8601 'YYYY-Www', 用于周限额查询
  cost_coins      INTEGER NOT NULL,           -- 冗余, 防止商品改价影响历史
  reward_value    INTEGER NOT NULL,           -- 冗余, 同上
  reward_type     TEXT NOT NULL,              -- 冗余
  status          TEXT NOT NULL DEFAULT 'consumed'
                    CHECK(status IN ('consumed', 'revoked')),
                                            -- v1 简化: 无 pending, 直接 consumed
  redeemed_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_at      INTEGER,                    -- 撤销时间
  revoked_by      INTEGER,                    -- PM user id
  -- 双 event 引用 (扣金币 + 加游戏时间)
  coin_event_id   INTEGER NOT NULL,           -- FK → score_events.id (type='coins', change_value=-cost)
  reward_event_id INTEGER NOT NULL,           -- FK → score_events.id (type='game_time', change_value=+reward)
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id)         REFERENCES users(id),
  FOREIGN KEY (item_id)         REFERENCES shop_items(id),
  FOREIGN KEY (coin_event_id)   REFERENCES score_events(id),
  FOREIGN KEY (reward_event_id) REFERENCES score_events(id),
  FOREIGN KEY (revoked_by)      REFERENCES users(id)
);

-- 关键索引: 周限额查询性能
CREATE INDEX IF NOT EXISTS idx_redemptions_user_week
  ON shop_redemptions(user_id, week_of);

CREATE INDEX IF NOT EXISTS idx_redemptions_user_created
  ON shop_redemptions(user_id, redeemed_at DESC);

-- 4) seed: 第 1 件商品 (v1 hardcode, PM 后台配置在 v2 引入)
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
```

### 3.3 复用现有结构

| 复用点 | 现有字段/索引 | 用法 |
|--------|--------------|------|
| `score_events.week_of` | TEXT, ISO 8601 | 金币事件同样填 week_of，便于周维度聚合 |
| `idx_score_events_week` | (week_of) | 金币事件的周查询复用此索引 |
| `idx_score_events_user_type` | (user_id, type) | 金币余额查询：`WHERE user_id=? AND type='coins'` |
| `task_completions.awarded_event_id` | INTEGER FK | 金币事件同样写入此字段，建立 task→event 链 |
| `audit_log` | 通用审计 | 金币 + 兑换 + 撤销全部走 audit_log |

### 3.4 数据守恒不变量

任何时刻，以下 4 条不变量必须成立（Qual 验收脚本会跑 SQL CHECK）：

```
INV-1: 用户的金币余额 = SUM(change_value WHERE type='coins' AND status='approved')
INV-2: 全完成 bonus 数量 ≤ 当天 active 任务完成数量 / 当天 active 任务总数 (向上取整 * 总数)
       -- 即: 一天最多 1 次 bonus (3 coins), 撤销后重做可再发
INV-3: shop_redemptions 总消耗金币 = SUM(coin_event.change_value WHERE status='approved')
INV-4: shop_redemptions 总奖励游戏时间 = SUM(reward_event.change_value WHERE status='approved')
```

### 3.5 不在 v1 数据模型范围

- ❌ 不引入金币等级 / 称号表（user_levels / badges）
- ❌ 不引入金币转账表（coin_transfers）
- ❌ 不引入商品分类表（item_categories）—— 用 `shop_items.kind` 简化
- ❌ 不改 `tasks` 表结构（v1 关闭 token_reward 写入，但不删字段，避免破坏历史数据语义）

---

## 4. API 设计

### 4.1 Hono Routes 概览

```
src/routes/
├── me/
│   ├── coins.ts           # NEW: GET /api/coins/balance, GET /api/coins/redemptions
│   └── ... (existing)
├── shop/
│   └── items.ts           # NEW: GET /api/shop/items
└── shop/
    └── exchange.ts        # NEW: POST /api/coins/exchange
```

**端点清单（4 个 new endpoints）**：

| Method | Path | Auth | 用途 |
|--------|------|------|------|
| GET  | `/api/coins/balance`     | public (child) | 返回当前金币余额 + 本周剩余兑换次数 |
| POST | `/api/coins/exchange`    | public (child) | 兑换商品（扣金币 + 加游戏时间） |
| GET  | `/api/shop/items`        | public (child) | 返回 active 商品列表 |
| GET  | `/api/coins/redemptions` | public (child) | 本周 + 历史兑换记录 |

**Hook 改造（不新增端点）**：

| 现有 endpoint | 改造点 |
|--------------|--------|
| `POST /api/me/tasks/:id/complete` | 完成后额外写入 1 条 coins +1 score_event，并检查 bonus |
| `POST /api/admin/task-completions/:id/revoke` | 撤销时额外写入 1 条 coins -1 + 可能 coins -3 (bonus) |

### 4.2 GET /api/coins/balance

**Request**: 无 body

**Response 200**：

```typescript
{
  user_id: number;
  coins: number;                    // 当前金币余额 (代数和)
  weekly_remaining: number;         // 本周剩余兑换次数 (默认上限 3)
  week_of: string;                  // 'YYYY-Www'
  as_of: number;                    // unix timestamp
}
```

**实现（spec）**：

```typescript
// 1. SUM coins events
SELECT COALESCE(SUM(change_value), 0) AS coins
  FROM score_events
  WHERE user_id = ? AND type = 'coins' AND status = 'approved';

// 2. COUNT 本周兑换
SELECT COUNT(*) AS used
  FROM shop_redemptions
  WHERE user_id = ? 
    AND week_of = ?
    AND status = 'consumed';

// 3. 计算 weekly_remaining = MAX(0, 3 - used)
```

**错误码**：

- 500: DB error

### 4.3 GET /api/shop/items

**Request**: 无 body

**Response 200**：

```typescript
{
  items: Array<{
    id: number;
    name: string;                   // "游戏时间 10 分钟"
    description: string;            // "用 10 金币兑换 10 分钟游戏时间"
    icon: string;                   // "🎮"
    cost_coins: number;             // 10
    reward_value: number;           // 10
    reward_type: 'game_time';       // 用于前端判断展示
    weekly_limit: number;           // 3
    sort_order: number;             // 1
  }>;
  as_of: number;
}
```

**实现**：直接 `SELECT * FROM shop_items WHERE is_active=1 ORDER BY sort_order`。

### 4.4 POST /api/coins/exchange

**Request**：

```typescript
{
  item_id: number;                  // 1 (10 分钟游戏时间)
}
```

**Response 200**：

```typescript
{
  redemption_id: number;
  item: { id, name, icon, cost_coins, reward_value };
  new_balance: { coins: number; game_time: number; };
  weekly_remaining: number;
  redeemed_at: number;
}
```

**错误码**：

| Status | Body | 触发条件 |
|--------|------|---------|
| 400 | `{ error: 'invalid_item_id' }` | item_id 不存在或 is_active=0 |
| 400 | `{ error: 'insufficient_coins' }` | 当前金币 < cost_coins |
| 429 | `{ error: 'weekly_limit_reached' }` | 本周已兑换次数 ≥ weekly_limit |
| 500 | `{ error: 'db_error' }` | DB error |

**实现（spec，关键事务）**：

```typescript
// 事务: 原子性 (扣金币 + 加游戏时间 + 写 shop_redemptions)
await db.batch([
  // 1. 扣金币 score_event
  `INSERT INTO score_events (user_id, type, change_value, reason, status, 
                            submitted_by, source, source_ref, week_of)
   VALUES (?, 'coins', -?, ?, 'approved', 'child', 'exchange', ?, ?)`,
  
  // 2. 加游戏时间 score_event
  `INSERT INTO score_events (user_id, type, change_value, reason, status, 
                            submitted_by, source, source_ref, week_of)
   VALUES (?, 'game_time', +?, ?, 'approved', 'system', 'exchange', ?, ?)`,
  
  // 3. 写 shop_redemptions
  `INSERT INTO shop_redemptions (user_id, item_id, week_of, cost_coins, 
                                 reward_value, reward_type, status,
                                 coin_event_id, reward_event_id)
   VALUES (?, ?, ?, ?, ?, ?, 'consumed', 
           last_insert_rowid()-1, last_insert_rowid())`
]);
```

**关键校验（按顺序短路）**：

1. item_id 存在且 is_active=1
2. 当前金币 ≥ cost_coins（防止 race：使用事务 + check-and-write）
3. 本周已兑换次数 < weekly_limit

**并发安全**：

- D1 单库串行执行，`db.batch` 在一个 tick 内原子
- 如果 race 导致 2 个 click 同时通过校验，第 2 个会因 weekly_limit 检查失败（写入后 COUNT 立刻变 1）
- 极端情况：2 个 click 都在余额检查前同时发起 → 第 2 个会看到 0 coins 余额（被第 1 个扣完），返回 insufficient_coins

### 4.5 GET /api/coins/redemptions

**Request**：query params: `?scope=week|history` (default: `history`)

**Response 200**：

```typescript
{
  scope: 'week' | 'history';
  redemptions: Array<{
    id: number;
    item_name: string;              // "游戏时间 10 分钟"
    item_icon: string;              // "🎮"
    cost_coins: number;             // 10
    reward_value: number;           // 10
    reward_type: 'game_time';
    status: 'consumed' | 'revoked';
    redeemed_at: number;            // unix timestamp
    week_of: string;                // 'YYYY-Www'
  }>;
  total_used_this_week: number;
  weekly_limit: number;
}
```

**实现**：

```sql
-- scope=week: WHERE week_of = 当前 ISO 周
-- scope=history: 最近 30 条 ORDER BY redeemed_at DESC
SELECT sr.*, si.name AS item_name, si.icon AS item_icon
  FROM shop_redemptions sr
  JOIN shop_items si ON sr.item_id = si.id
  WHERE sr.user_id = ?
    AND sr.status = 'consumed'  -- 默认只展示成功的
    [AND sr.week_of = ?]        -- scope=week 时
  ORDER BY sr.redeemed_at DESC
  LIMIT 30;
```

### 4.6 Task Completion Hook 改造

**现有 endpoint**: `POST /api/me/tasks/:id/complete` (in `src/routes/me/tasks.ts`)

**改造点**：

```typescript
// 现有: 写 1 条 score_event (task_completion 的 token_reward)
// 改造: 
//   1. 不再写 task 直接奖励 game_time / pocket_money 的 event (kind 关闭)
//   2. 写 1 条 type='coins' change_value=+1 event (reason='task:#task_id')
//   3. 检查"是否所有 active 任务都完成" → 如果是, 写 1 条 type='coins' change_value=+3 event (reason='bonus:<date>:<user_id>')

const tasksCount = db.prepare('SELECT COUNT(*) FROM tasks WHERE is_active=1').get();
const completionsCount = db.prepare(
  'SELECT COUNT(*) FROM task_completions WHERE user_id=? AND completed_date=? AND status="active"'
).get(userId, today);

const allComplete = (tasksCount === completionsCount);

// 写金币 +1
db.prepare(`INSERT INTO score_events ... type='coins', change_value=+1 ...`).run();

// 检查 + 写 bonus
if (allComplete) {
  // 检查今天是否已发过 bonus (防止并发重复)
  const existingBonus = db.prepare(
    `SELECT id FROM score_events WHERE user_id=? AND type='coins' 
       AND change_value=3 AND reason LIKE 'bonus:%' AND source_ref=?`
  ).get(userId, `${today}:${userId}`);
  
  if (!existingBonus) {
    db.prepare(`INSERT INTO score_events ... type='coins', change_value=+3 ...`).run();
  }
}
```

### 4.7 Task Revoke Hook 改造

**现有 endpoint**: `POST /api/admin/task-completions/:id/revoke` (in `src/routes/admin/task-completions.ts`)

**改造点**：

```typescript
// 现有: 写 1 条反向 game_time / pocket_money event
// 改造: 写反向金币 -1 + 检查并反向 bonus -3

// 1. 反向金币 -1
db.prepare(`
  INSERT INTO score_events (user_id, type, change_value, reason, status, 
                            submitted_by, source, source_ref, week_of)
  VALUES (?, 'coins', -1, ?, 'approved', 'pm', 'task', ?, ?)
`).run(userId, `revoke:task#${taskId}`, taskCompletionId, weekOf);

// 2. 检查今天是否发过 bonus → 反向 -3
const bonus = db.prepare(`
  SELECT id FROM score_events 
    WHERE user_id=? AND type='coins' AND change_value=3 
      AND source_ref=? AND status='approved'
`).get(userId, `${today}:${userId}`);

if (bonus) {
  db.prepare(`
    INSERT INTO score_events (user_id, type, change_value, reason, status, 
                              submitted_by, source, source_ref, week_of)
    VALUES (?, 'coins', -3, ?, 'approved', 'pm', 'task', ?, ?)
  `).run(userId, `revoke:bonus:${today}:${userId}`, bonus.id, weekOf);
}
```

### 4.8 错误响应统一格式

```typescript
{
  error: string;                    // machine-readable code (snake_case)
  message: string;                  // human-readable (zh-CN)
  details?: Record<string, any>;    // optional context
}
```

所有 4xx 错误均带 `Cache-Control: no-store`，防止前端缓存失败响应。

---

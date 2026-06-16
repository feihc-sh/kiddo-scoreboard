# Coin Shop v1.1 RFC — Admin 商品 CRUD UI

> **给 code-agent (v1.1 PR) + qual-agent (e2e + visual) 的 spec**
> v1.1 增量 spec，基于 `docs/coin-system-rfc.md` (v1)
> Branch: 待 v1 PR merge + 部署后开 `feat/coin-shop-v1.1`
> Author: PM Agent
> Created: 2026-06-15
> Status: 📋 待 feihao 拍板 + v1 部署后启 subagent

---

## 0. 跟 v1 RFC 的关系

v1 RFC `docs/coin-system-rfc.md` 完整 spec v1 (1527 lines, 6 modules)。本 RFC 是 **v1.1 增量 spec**,只写新增 / 改动 / 锁定 / 风险,其他引用 v1 RFC 章节。

**v1.1 范围 (PM + feihao 2026-06-15 拍板)**:
- Admin 端: 商品 CRUD UI + 4 个 API (列 / 增 / 改 / 软删)
- 数据模型: **不动 v1 schema** (`shop_items` 表已支持所有字段, v1.1 只是 expose 给 PM 编辑)
- UI: 新页 `/admin/shop-items.html` (列表 + 新建 form + edit form + 软删 confirm)
- 实施时机: v1 PR merge + 部署后开 (避免 v1 跟 v1.1 撞车)

---

## 1. 背景与目标

### 1.1 现状 (v1)

v1 `feat/coin-shop` PR (实施中, ETA 2026-06-15~16):
- 商品 hardcode 在 migration 0007 + 0008 seed data
- Admin 端无商品 CRUD 功能
- PM 想加 / 改 / 下架商品 → 走 SQL 直接改 migration + `wrangler d1 migrations apply`

### 1.2 目标 (v1.1)

PM 能在 admin 后台**可视化**管理商品 (增 / 改 / 软删),无需碰 SQL。

### 1.3 非目标 (v1.1 不做)

- ❌ 商品硬删 (DELETE FROM shop_items) — 永远走软删
- ❌ 商品 `kind` 跟 `reward_type` 改 — 锁定 (拍板 #1 B)
- ❌ 商品导入 / 导出 / 批量编辑
- ❌ 商品图片上传 (icon 仅 emoji, 1-4 chars)
- ❌ 多语言 (中文 only, 跟 v1 一致)
- ❌ Admin 角色权限分级 (现有 PM 1 个角色, 跟 v1 一致)
- ❌ 商品 analytics / 兑换率 / 库存告警 (后续 v2 引入)

### 1.4 成功指标

- PM 能在 iPad Safari 后台 `/admin/shop-items.html` 完成 增 / 改 / 软删 3 操作
- 每个操作 ≤ 5 秒完成 (不卡顿)
- 改动后 child UI 立即看到新商品 (iPad cache 提示硬刷)
- audit_log 3 类 action 全部记录
- e2e (functional + visual regression) 全过

---

## 2. 需求清单 (feihao 2026-06-15 拍板)

| # | 事项 | 拍板 |
|---|---|---|
| 1 | CRUD 字段范围 | **B**: 9 字段可改 (name / cost / reward / limit / desc / icon / active / sort),`kind` + `reward_type` 锁定 |
| 2 | 删除方式 | **A**: 软删 (`is_active=0`) |
| 3 | 改 weekly_limit 后本周已兑次数 | **A**: 清零 (新 limit 从 0 开始数, 历史 record 保留作 audit) |
| 4 | admin UI 形态 | **A**: 新页 `/admin/shop-items.html` (列表 + form) |
| 5 | 并发处理 | **A**: 不加锁 (PM 1 人, last-write-wins) |
| 6 | 实施分阶段 | **B**: 2 module (M1 API+UI, M2 e2e+docs) |

**Default 走 (feihao 拍 "其他按 default 走")**:
- API 风格: REST (跟 v1 §4 一致)
- audit_log: 3 actions (`shop_item_created` / `shop_item_updated` / `shop_item_deactivated`)
- i18n: 中文 only
- visual regression: 3-5 个 screenshot (iPad viewport 1180x820)

---

## 3. 数据模型

### 3.1 不动 v1 schema

v1 migration 0007_coin_system.sql 已含 `shop_items` 表 (12 字段 + CHECK 约束),v1.1 **不**加 migration。PM 编辑用现有字段。

`shop_items` schema 现状 (v1):
```sql
CREATE TABLE shop_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK(kind IN ('game_time', 'pocket_money', 'custom')),
  cost_coins      INTEGER NOT NULL CHECK(cost_coins > 0),
  reward_value    INTEGER NOT NULL CHECK(reward_value > 0),
  reward_type     TEXT NOT NULL CHECK(reward_type IN ('game_time', 'pocket_money', 'none')),
  description     TEXT,
  icon            TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  weekly_limit    INTEGER NOT NULL DEFAULT 0 CHECK(weekly_limit >= 0),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
```

### 3.2 v1.1 新增 (无)

- 不加新表
- 不加新列
- 不动现有 CHECK 约束

### 3.3 v1.1 字段锁定 (PM 不能改的 2 个)

- `kind` (game_time / pocket_money / custom): PM 只能在**创建**时定,创建后**不能改**
- `reward_type`: 同 kind,创建后**不能改**

PM 想换 kind 流程: 创建新商品 (新 kind) + 软删旧商品 (`is_active=0`)

### 3.4 v1.1 字段可改 (9 个)

`PATCH /api/admin/shop/items/:id` 接受以下字段 (任选, partial update):

| 字段 | 类型 | 约束 | 默认 |
|---|---|---|---|
| `name` | string | NOT NULL, 1-50 chars | — |
| `description` | string \| null | 0-200 chars, nullable | NULL |
| `icon` | string \| null | 1-4 chars (emoji 渲染), nullable | NULL |
| `cost_coins` | int | > 0 | — |
| `reward_value` | int | > 0 | — |
| `weekly_limit` | int | >= 0 (0 = 不限) | 0 |
| `is_active` | int 0/1 | — | 1 |
| `sort_order` | int | (任意) | 0 |

**改 cost_coins 副作用**: 历史已兑换的 `shop_redemptions` 不受影响 (按当时 cost_coins 入账),但 `GET /api/shop/items` 返回新 cost_coins, child UI 立即看到新价 (iPad cache 需硬刷, F9)

**改 reward_value 副作用**: 同 cost_coins, 历史已兑换按当时 reward_value, 新兑换用新 reward_value

**改 weekly_limit 副作用** (拍板 #3 A 清零 — 实施细节见 §5.4):
- 本周该 user 该 item 的 `shop_redemptions` 记录**保留** (audit)
- 但 `GET /api/shop/items` 计算 `weekly_limit_remaining` 时,改 limit 后**忽略**改前已兑记录 (即视为 0)
- 下周一 ISO week 重置后,新一周正常数

**改 is_active 副作用**:
- `is_active=0`: `GET /api/shop/items` (child 端) **过滤** `is_active=1`, child UI 立即看不到
- 历史已兑换 `shop_redemptions` 仍可见 (兑换历史页面不变)
- admin 列表仍能看到 (`GET /api/admin/shop/items` 不过滤, F1)

**改 sort_order 副作用**: 列表展示顺序立即变 (admin 列表按 `sort_order ASC, id ASC`)

---

## 4. API 设计 (4 个 REST endpoints)

### 4.1 `GET /api/admin/shop/items` (列所有商品,含 `is_active=0`)

(PM only, `requirePm` middleware)

```json
// Response 200
[
  {
    "id": 1,
    "name": "游戏时间 10 分钟",
    "kind": "game_time",
    "cost_coins": 10,
    "reward_value": 10,
    "reward_type": "game_time",
    "description": "玩 10 分钟游戏时间",
    "icon": "🎮",
    "is_active": 1,
    "weekly_limit": 3,
    "sort_order": 0,
    "created_at": 1750000000,
    "updated_at": 1750000000,
    "weekly_redemption_count_this_week": 2
  },
  ...
]
```

`weekly_redemption_count_this_week`: 该 user 本周 (ISO 8601 `week_of`) 已成功兑换次数,展示用 (PM 决定是否需要再调整 limit)

排序: `sort_order ASC, id ASC`

### 4.2 `POST /api/admin/shop/items` (创建)

(PM only)

```json
// Request
{
  "name": "新商品",
  "kind": "game_time",            // 必填
  "reward_type": "game_time",     // 必填 (kind=pocket_money→pocket_money, kind=custom→none)
  "cost_coins": 20,
  "reward_value": 15,
  "description": "可选",
  "icon": "🎯",
  "weekly_limit": 1,
  "sort_order": 99
}

// Response 201
{ "id": 3, ...商品 object }

// 错误 (跟 v1 §4.8 统一格式):
// 400 invalid_kind (∉ {game_time, pocket_money, custom})
// 400 invalid_reward_type (∉ {game_time, pocket_money, none})
// 400 invalid_cost_coins (<= 0)
// 400 invalid_reward_value (<= 0)
// 400 invalid_icon (空 或 > 4 chars)
// 400 invalid_name (空 或 > 50 chars)
```

`kind` ↔ `reward_type` 配套规则 (server 端强制,前端也提示):
- `kind=game_time` → `reward_type=game_time` (强制)
- `kind=pocket_money` → `reward_type=pocket_money` (强制)
- `kind=custom` → `reward_type=none` (强制)
- 客户端可传,server 二次校验

### 4.3 `PATCH /api/admin/shop/items/:id` (更新 9 字段)

(PM only)

```json
// Request (9 字段任选, partial update)
{
  "name": "新商品名",               // optional
  "cost_coins": 25,                 // optional
  "reward_value": 20,               // optional
  "weekly_limit": 2,                // optional
  "description": "新描述",          // optional
  "icon": "🎲",                     // optional
  "is_active": 1,                   // optional
  "sort_order": 5                   // optional
  // 严禁传 kind / reward_type — 见 ADR-1
}

// Response 200
{ "id": 1, ...更新后商品 object }

// 错误:
// 400 kind_locked (传了 kind 字段)
// 400 reward_type_locked (传了 reward_type 字段)
// 400 invalid_*
// 404 not_found
```

**关键**: PATCH **拒收** `kind` 和 `reward_type` 字段 (RFC §3.3 锁定),返 400 `kind_locked` / `reward_type_locked`

**audit_log 写**: 写 1 条 `shop_item_updated`,`details` 含 diff (old_value + new_value for each changed field)

### 4.4 `POST /api/admin/shop/items/:id/soft-delete` (软删 + 重新启用 toggle)

(PM only)

```json
// Request: 空 body
// Response 200
{
  "id": 2,
  "is_active": 0,                  // 软删后返 0,重新启用返 1
  "soft_deleted_at": 1750001234
}

// 错误:
// 404 not_found
// 409 already_deleted (is_active=0, 重复软删返 409) — 或 toggle 行为: 见下
```

**行为** (idempotent toggle):
- 已是 `is_active=1` → 软删 (is_active=0) + 写 audit `shop_item_deactivated`
- 已是 `is_active=0` → 重新启用 (is_active=1) + 写 audit `shop_item_reactivated`
- 同一个 endpoint 处理 toggle,前端按钮文字按状态变 ("🗑 软删" / "✓ 启用")

**历史保留**: `shop_redemptions.item_id` FK 仍 valid, history 完整 (F7)

### 4.5 错误响应统一格式

```json
{ "error": "error_code", "message": "人类可读", "details": { ... } }
```

跟 v1 §4.8 一致

---

## 5. 业务流程

### 5.1 流 A: PM 创建新商品

1. PM 打开 `/admin/shop-items.html`
2. 点 "[+ 新建商品]" 按钮 → 弹 inline form (modal or 折叠, 选折叠, 不挡列表)
3. form 字段: name (必) / kind (必, select) / reward_type (auto, 跟 kind) / cost_coins (必) / reward_value (必) / description (选) / icon (选) / weekly_limit (默认 0) / sort_order (默认 0)
4. 点 "[✓ 保存]" → `POST /api/admin/shop/items`
5. 成功 → toast "✅ 商品已创建" + 列表刷新
6. 失败 → form inline error + 字段红色框

### 5.2 流 B: PM 编辑商品

1. PM 列表页点某商品 "[✏️ 编辑]" 按钮 → inline form (同 create form, 但 `kind` + `reward_type` 字段**只读** + 锁图标 🔒)
2. PM 改 name / cost / reward / limit / desc / icon / active / sort (kind/type 锁)
3. 点 "[✓ 保存]" → `PATCH /api/admin/shop/items/:id`
4. 成功 → toast "✅ 商品已更新" + 列表刷新
5. 失败 → form inline error

### 5.3 流 C: PM 软删 / 重新启用

1. PM 列表页点某商品 "[🗑 软删]" 按钮 → confirm 弹窗
   - 文案: "确定软删 <商品名>? 历史兑换保留, child UI 立即下架"
2. 确认 → `POST /api/admin/shop/items/:id/soft-delete`
3. 成功 → toast "✅ 商品已下架" + 列表刷新 (该行灰显)
4. 软删后, 该行按钮变 "[✓ 启用]" → 再点 toggle 重新启用

### 5.4 流 D: PM 改 weekly_limit 后清零本周已兑 ⚠️ 实施 TODO

**拍板**: feihao #3 A "改 weekly_limit 后清零" — 意思是改 limit 后, child 本周可重新兑换 (无视改前已兑)

**实施矛盾**:
- v1 §4.3 `GET /api/shop/items` 的 `weekly_limit_remaining` 算法 = `weekly_limit - COUNT(shop_redemptions WHERE item_id=:id AND user_id=:user AND week_of=:now AND status='approved')`
- 改 weekly_limit 后, **如果** 不动已兑 record, count 仍是老的, `remaining` 仍是 `new_limit - count` (可能 < 0)
- 实际"清零" = 改 limit 后,**effective count = 0** (无视改前 count)

**3 个实施选项 (实施时拍, 本 RFC TODO)**:

| 选项 | 实施 | 复杂度 | 跟"清零"语义一致性 |
|---|---|---|---|
| **X1** audit log 标记 | PATCH weekly_limit 时写 `audit_log.action='shop_item_weekly_limit_changed'`, GET 计算 `effective_count = COUNT(redemptions WHERE created_at > last_change_time)` | ~20 min SQL + 1 migration 列 (可选) | 严格一致 (历史保留) |
| **X4** GET 直接返 weekly_limit | 改 limit 后, GET 返 `weekly_limit_remaining = weekly_limit` (忽略已兑), 下周一重置 | ~5 min | "清零"字面理解,但历史 record 实际不参与 remaining 计算 (语义模糊) |
| **X2** 软删老 redemption | PATCH limit 时 `UPDATE shop_redemptions SET status='revoked' WHERE ... AND week_of=:now` | ~10 min | 严格,但破坏历史 (audit 还在, 但 status 改了) |

**PM 拍板 X1 / X4 / X2 (实施时定)**: 写入 §11 ADR-3 跟 RFC 一致

**默认走 X4** (实施简单, "清零" 字面理解, audit 历史完整) — feihao 看完 RFC 反馈

### 5.5 异常流: 并发 edit 同一商品

- 不加锁 (拍板 #5 A), 2 个 PM 同时 PATCH:
  - last-write-wins (后写覆盖前写)
  - 无 409 conflict
  - 实际: PM 1 人, 撞概率 < 1%, 接受 (ADR-4)

---

## 6. UI 设计

### 6.1 路由

- 新页 `/admin/shop-items.html` (跟现有 `/admin/index.html` 风格一致)
- 改 `/admin/index.html` 顶部 nav 加 "[🛍 商品管理]" 链接 → 跳 `/admin/shop-items.html`

### 6.2 列表页布局

```
┌────────────────────────────────────────────────────────────┐
│ Admin 后台 › 🛍 商品管理                                    │
├────────────────────────────────────────────────────────────┤
│ [+ 新建商品]                                                │
├────────────────────────────────────────────────────────────┤
│ ID │ 图 │ 名称            │ kind │ cost │ weekly │ active │ 操作       │
│ 1  │ 🎮 │ 游戏时间 10 分钟 │ game │ 10   │ 3      │ ✓     │ ✏️ 🗑       │
│ 2  │ 🧱 │ 小乐高          │ cust │ 50   │ 1      │ ✓     │ ✏️ 🗑       │
│ 3  │ 🎯 │ 下架商品         │ game │ 20   │ 0      │ ✗ 灰  │ ✏️ ✓启用    │
└────────────────────────────────────────────────────────────┘
```

排序: `sort_order ASC, id ASC`
灰显: `is_active=0` 行

### 6.3 新建 / 编辑 form (inline 折叠, 不跳页)

**字段** (create mode 9 + 2 auto = 11, edit mode 9 + 2 锁 = 11):

| 字段 | create | edit | 控件 |
|---|---|---|---|
| name | 必 | 可改 | `<input type="text" maxlength=50>` |
| kind | 必 | 锁 🔒 | `<select>` (game_time / pocket_money / custom) |
| reward_type | auto (跟 kind) | 锁 🔒 | auto-filled, read-only |
| cost_coins | 必 | 可改 | `<input type="number" min=1>` |
| reward_value | 必 | 可改 | `<input type="number" min=1>` |
| description | 选 | 可改 | `<textarea maxlength=200>` |
| icon | 选 | 可改 | `<input type="text" maxlength=4>` (emoji picker? v1.1 不做, 手动输入) |
| weekly_limit | 默认 0 | 可改 | `<input type="number" min=0>` |
| is_active | 默认 1 | 可改 | `<input type="checkbox">` |
| sort_order | 默认 0 | 可改 | `<input type="number">` |

**按钮**: "[✓ 保存]" (create/update) / "[取消]"
**错误**: inline 红色提示 (字段下方)

### 6.4 视觉 (跟 v1 admin 风格一致)

- Mecha 风: 深空金属 + 霓虹蓝 + 工业风 (跟 `/admin/index.html` 一致)
- 表格: 暗色行 + 霓虹蓝边框
- 主操作按钮: 霓虹蓝
- 软删按钮: 警示橙
- 锁字段: 灰底 + 🔒 图标 (视觉提示 PM 不能改)

### 6.5 移动端

- iPad Safari 主战场, viewport 1180x820 (跟 v1 一致)
- 手机不优化 (v1.1 不做, 跟 v1 admin 风格一致)

---

## 7. 验收清单 (F1..F10)

### F1: PM 列表页能看所有商品 (含 `is_active=0`)

- **GIVEN**: 商品表有 3 个商品 (2 active, 1 soft-deleted)
- **WHEN**: PM `GET /admin/shop-items.html`
- **THEN**: 表格列 3 行, soft-deleted 行灰显, 排序按 sort_order

### F2: PM 创建新商品 (kind=game_time)

- **GIVEN**: PM 在 form 输入 name="新商品" / kind="game_time" / cost_coins=20 / reward_value=15
- **WHEN**: 点 "[✓ 保存]"
- **THEN**: 201, 列表多 1 行, `audit_log` 写 `shop_item_created` (含 id + name + kind + cost)

### F3: PM 编辑商品 name / cost / reward / limit / desc / icon / active / sort (9 字段)

- **GIVEN**: 现有商品 id=1
- **WHEN**: PATCH `{ "name": "新名", "cost_coins": 25 }`
- **THEN**: 200, 商品 name 变更 + cost_coins 变更, `audit_log` 写 `shop_item_updated` (含 diff: `name: "游戏时间 10 分钟" → "新名"`)

### F4: PM 尝试改 `kind` 字段被拒

- **GIVEN**: 商品 id=1, kind=game_time
- **WHEN**: PATCH `{ "kind": "custom" }`
- **THEN**: 400 `kind_locked`, kind 字段不变, `audit_log` 不写

### F5: PM 软删商品

- **GIVEN**: 商品 id=1, is_active=1
- **WHEN**: 点 "[🗑 软删]" → confirm
- **THEN**: 200, is_active=0, `audit_log` 写 `shop_item_deactivated`

### F6: 软删商品不出现在 child UI 列表

- **GIVEN**: 商品 id=1 软删
- **WHEN**: child `GET /api/shop/items`
- **THEN**: id=1 不在返回 (过滤 is_active=1)

### F7: 软删商品历史兑换仍可见

- **GIVEN**: 商品 id=1 软删前 child 已兑 2 次
- **WHEN**: child `GET /api/coins/redemptions`
- **THEN**: 仍看到 2 条记录 (item_id=1, history 完整)

### F8: 改 weekly_limit 后本周可重新兑换 (清零语义)

- **GIVEN**: 商品 id=1, weekly_limit=3, child 本周已兑 3 次
- **WHEN**: PM PATCH `{ "weekly_limit": 5 }` (或任意新值)
- **THEN**: child 立即可再兑 (effective count 视 0)
- ⚠️ 实施细节: X1 / X4 / X2 拍板见 §5.4 (默认 X4)

### F9: 改 cost_coins 后 child UI 显示新价

- **GIVEN**: 商品 id=1, cost_coins=10
- **WHEN**: PM PATCH `{ "cost_coins": 20 }`
- **THEN**: child `GET /api/shop/items` 返 cost_coins=20
- **iPad Safari cache 提示**: 硬刷 (Cmd+Shift+R / 无痕模式 / `?v=timestamp`)

### F10: PM 重新启用软删商品 (toggle)

- **GIVEN**: 商品 id=1, is_active=0
- **WHEN**: PM 点 "[✓ 启用]"
- **THEN**: is_active=1, child UI 重新看到, `audit_log` 写 `shop_item_reactivated`

---

## 8. 风险与边界 (5 项)

| # | 风险 | 缓解 |
|---|---|---|
| 1 | 改 cost/reward 后 iPad Safari cache | 实施完开 dev tunnel 让 feihao 验, 提示硬刷 (Cmd+Shift+R / 无痕 / `?v=`) |
| 2 | 改 weekly_limit "清零" vs SQL 算法矛盾 (§5.4) | 实施时拍 X1 / X4 / X2, 写 ADR-3, 走 default X4 |
| 3 | 软删商品历史 redemption FK 完整 | v1 schema FK 验证过, 软删只改 is_active, 关联保留 (F7 验证) |
| 4 | 2 个 PM 同时 edit 同一商品 (last-write-wins) | 不加锁 (拍板 A), PM 1 人, 风险低, 接受 (ADR-4) |
| 5 | kind 锁定后, PM 偶尔需要 "换 kind" | 流程: 创建新商品 (新 kind) + 软删旧商品 — 简单直接 (ADR-1) |

---

## 9. 实施分阶段 (2 Module)

### M1: API + Admin UI (~75 min)

**任务清单**:

| # | 任务 | 文件 | 预估 |
|---|---|---|---|
| 1.1 | 4 个 API endpoints (列 / 增 / 改 / 软删 toggle) | `src/routes/admin/shop-items.ts` | 30 min |
| 1.2 | shop-items.html 列表页 + 新建/编辑 inline form | `public/admin/shop-items.html` | 25 min |
| 1.3 | shop-items.js 逻辑 (load / submit / soft-delete toggle / 表单 validation) | `public/admin/shop-items.js` | 15 min |
| 1.4 | admin/index.html nav 加 "[🛍 商品管理]" 链接 | `public/admin/index.html` | 5 min |
| 1.5 | unit test: PATCH 拒收 kind/reward_type, soft-delete toggle idempotency, weekly_limit 清零 (X4 算法) | `tests/unit/admin-shop-items.test.ts` | 10 min |

**验收**:
- `npm run typecheck` 0 错
- `npm test` 全过 (含新 unit)
- curl 4 endpoints 返 200 / 201 / 400 (kind_locked) / 404 / 409 正确
- admin UI 列表 + form + soft-delete 在 iPad Safari 跑通

**依赖**: v1 PR merge + 部署 (shop_items 表 + GET /api/shop/items 端点已就位)

---

### M2: e2e + visual regression + docs (~60 min)

**任务清单**:

| # | 任务 | 文件 | 预估 |
|---|---|---|---|
| 2.1 | e2e 6 functional tests (F1 + F2 + F3 + F4 + F5 + F9 + F10, 选 6 个 + 跟 v1 e2e 集成) | `tests/e2e/admin-shop-items.spec.ts` | 25 min |
| 2.2 | visual regression 4 个 (列表页 / 新建 form / 编辑 form / 软删 confirm) | `tests/e2e/admin-shop-items-visual.spec.ts` | 20 min |
| 2.3 | docs 同步: FEATURE_MATRIX 表 C +1 行 (Admin Shop Items CRUD) + TEST_PLAN §3.17 + INDEX +1 link + PROGRESS v3.1 entry | 4 docs | 15 min |

**验收**:
- e2e 6/6 + visual 4/4 pass
- typecheck 0 错
- 全 v1 e2e 不 regression
- 4 docs 同步, cross-ref 正确

**依赖**: M1 (API + UI ready)

---

### 依赖关系

```
M1 (API + UI)  →  M2 (e2e + docs)
```

1 PR 涵盖 M1+M2 (跟 v1 PR 风格一致, 不分 PR)

---

## 10. Reference

- v1 RFC: `docs/coin-system-rfc.md` (1527 lines) — 全 v1 spec
- v1 Test Plan: `docs/coin-system-test-plan.md` (1087 lines) — F1-F12 + TC-X1-X8
- v1 Requirements: `docs/coin-shop-requirements.md` (359 lines) — feihao 拍板 + 冲突报告
- v1 migration: `migrations/0007_coin_system.sql` + `migrations/0008_coin_shop.sql` (feat/coin-shop 计划)
- v1 utils: `src/utils/coin.ts` (14 exports)
- v1 admin style: `public/admin/index.html` + `public/admin/admin.js` (Mecha 风参考)

---

## 11. ADR (Architecture Decision Records)

### ADR-1: `kind` + `reward_type` 锁定 (PM 不能改)

- **拍板**: feihao 2026-06-15, RFC §2 #1 B
- **原因**: `kind` 决定 status 流程 (`custom` 走 PM 手动 fulfill pending→approved, `game_time` / `pocket_money` 走自动 approve), PM 想换 kind 走 "新建 + 软删旧" 流程
- **实施**: PATCH 拒收 `kind` / `reward_type` 字段, 返 400 `kind_locked` / `reward_type_locked`
- **测试**: F4 验证

### ADR-2: 软删 (不硬删)

- **拍板**: feihao 2026-06-15, RFC §2 #2 A
- **原因**: 保留 audit, FK 完整, child 兑换历史不变
- **实施**: `POST /api/admin/shop/items/:id/soft-delete` toggle `is_active=0↔1`, 不删 record
- **测试**: F5 + F6 + F7 验证

### ADR-3: 改 weekly_limit 清零本周已兑

- **拍板**: feihao 2026-06-15, RFC §2 #3 A
- **实施细节 TODO**: v1.1 实施时拍 §5.4 X1 / X4 / X2, **default X4** (GET 直接返 `weekly_limit_remaining = weekly_limit`, 改 limit 后本周已兑 count 视 0, 下周一 ISO 重置)
- **测试**: F8 验证 (按实施选项)

### ADR-4: 不加并发锁

- **拍板**: feihao 2026-06-15, RFC §2 #5 A
- **原因**: PM 1 人, last-write-wins 可接受
- **实施**: 不加 version 列, PATCH 无 `If-Match` header
- **风险**: 2 PM 同时 PATCH 后写覆盖前写 — 实际 PM 1 人, 撞概率 < 1%

### ADR-5: 软删 toggle 走同一 endpoint

- **原因**: 软删 / 重新启用 是同一操作的 2 个方向, 1 个 endpoint 简化 client + 减少 route 数量
- **实施**: `POST /api/admin/shop/items/:id/soft-delete` 检查当前 `is_active`, toggle, 写不同 audit action (`shop_item_deactivated` / `shop_item_reactivated`)

---

## 12. 变更日志

- **2026-06-15**: v1.1 RFC 初版 (PM 写, 6 项 feihao 拍板, ADR-1~5 锁定, §5.4 X1/X4/X2 TODO)

---

**Status**: 📋 v1.1 RFC 写完, 待 v1 PR merge + 部署后开 v1.1 PR (预计 2026-06-16~17)

**需 feihao 注意的 1 个 TODO**: §5.4 / ADR-3 "改 weekly_limit 清零实施细节" — RFC default 走 X4 (实施简单), 如要 X1 (严格 audit log 标记) 实施时再 switch。

# 儿子计分板 PRD（产品需求文档）

**版本:** v2.0
**日期:** 2026-06-04
**作者:** PM Agent（代岑斐灏）
**状态:** 待用户最终确认
**目标读者:** 用户（产品负责人）、Code Agent（实施者）、Qual Agent（验收者）

---

## 1. 项目背景

### 1.1 问题陈述
用户（爸爸）原本用纸面记录儿子的奖励/惩罚情况，但随着规则变多（晚睡扣分、偷玩游戏扣分、周末发"工资"、作业奖励等），纸面记录混乱、扣项重叠、无法追溯。

儿子有 2 个独立的"口袋"：
- **🎮 游戏时间**（按分钟计算）
- **💰 零花钱**（按元计算）

两个口袋的换算关系是 **1 分钟游戏 = 1 元 = 1 代币**，PM 可以发起"兑换"操作（系统不强制双向流转）。

### 1.2 目标
构建一个**轻量、清晰、可追溯**的计分板 Web 应用，让：
- **儿子**能在 iPad 上看双账户余额、完成任务、提交加减分申请、首次填名字
- **爸爸（PM）**能在任何设备上审批/撤销、配置任务、发放周额度、定期审计
- 所有操作有**审计 log**，PM 可事后反悔

### 1.3 非目标
- ❌ 不是"记账 App"或"家庭财务管理"
- ❌ 不是多人多孩子的通用系统
- ❌ 不做主动推送通知（PM 每天主动打开看）
- ❌ 不做复杂数据可视化

### 1.4 成功指标
- PM 能用 ≤ 30 秒/次 处理一次审批或任务配置
- 儿子能"看懂"自己的两个账户余额
- 任何一次加减分都能追溯到"谁、何时、为什么、是否被撤销"

---

## 2. 用户角色

### 2.1 角色清单
| 角色 | 数量 | 设备 | 登录方式 |
|------|------|------|----------|
| 儿子（child） | 1 | iPad Safari | 无需登录（公开访问）|
| PM（爸爸） | 1 | 任何浏览器 | PIN 码 + Cookie session |

### 2.2 能力矩阵

| 能力 | 儿子 | PM |
|------|------|-----|
| 看自己双账户余额 | ✅ | ✅ |
| 看事件 log | ✅ | ✅ |
| 看任务完成情况 | ✅ | ✅ |
| 完成任务（点快捷键）| ✅ | ✅（帮儿子记）|
| 提交加减分申请 | ✅ | ✅ |
| **首次填名字** | ✅（一次性）| ❌ |
| 改名字 | ❌ | ❌（v2 砍掉）|
| 审批/拒绝申请 | ❌ | ✅ |
| 撤销已通过/任务完成 | ❌ | ✅ |
| 直接编辑记录 | ❌ | ✅ |
| 发放周额度 | ❌ | ✅ |
| **配置任务模板（增删改）** | ❌ | ✅ |
| 发起双账户兑换 | ❌ | ✅ |
| 看审计 log | ❌ | ✅ |

### 2.3 PM 认证
- **PIN 码**: 4 位数字（用户自定义）
- **存储**: bcrypt 哈希存 D1
- **Session**: HttpOnly + Secure + SameSite=Strict cookie
- **锁定策略**: 连续 5 次错误锁 5 分钟
- **登出**: 显式按钮

---

## 3. 业务规则

### 3.1 双账户模型（核心）

| 账户 | 单位 | 图标 | 颜色 | 数据类型 |
|------|------|------|------|----------|
| 游戏时间 | 分钟 | 🎮 | 绿色 | INTEGER |
| 零花钱 | 元 | 💰 | 金色 | INTEGER（避免浮点）|

**换算关系**: 1 分钟游戏 ⇄ 1 元零花钱（**1:1 等价**，PM 手动发起兑换）

**兑换操作**: PM 在"兑换"页选择"30 元 → 30 分钟游戏"或反之，生成一条**兑换事件**（双向记录：源账户 -30 + 目标账户 +30 的事务记录）。

### 3.2 扣分规则（双账户维度）

| 触发条件 | 扣分账户 | 数量 | 备注 |
|----------|----------|------|------|
| 晚睡 1 分钟 | 🎮 游戏时间 | -1 分钟 | 申请时填具体分钟数 |
| 偷偷玩游戏超 1 分钟 | 🎮 游戏时间 | -1 分钟 | 同上 |

**注**: 扣分默认只扣游戏时间账户（因为儿子最在意这个）。零花钱账户默认不被动。

### 3.3 奖励机制（"发工资"）

| 规则 | 默认 | PM 可调整 |
|------|------|----------|
| 周末发零花钱 | +60 元 | 任意金额 |
| 周末发游戏时间 | 0（默认不发，PM 可选）| 任意分钟 |
| 周内任务完成 | 任务配置决定 | 任务设置 |

PM 发放周额度时选择"60 元 → 零花钱账户"或"30+30"或"全发游戏时间"。

### 3.4 任务系统（v2 新增）

#### 任务模板（PM 后台配置）
| 字段 | 类型 | 说明 |
|------|------|------|
| name | TEXT | 任务名称（如"按时上床"）|
| token_reward | INTEGER | 完成奖励代币数（正数）|
| target_account | TEXT | 奖励到哪个账户：`game_time` / `pocket_money` |
| icon | TEXT | emoji（🎯/📚/🛏️）|
| category | TEXT | `habit` 习惯 / `study` 学习 / `chore` 家务 / `custom` 自定义 |
| is_active | INTEGER | 1=启用，0=停用 |
| sort_order | INTEGER | 显示顺序 |

**默认任务**（PM 首次配置时可一键导入）：
- 🎯 按时上床 → +5 代币 → 游戏时间
- 📚 英语题 1 道 → +2 代币 → 零花钱
- 📐 数学题 1 道 → +2 代币 → 零花钱
- 🛏️ 自己整理床铺 → +3 代币 → 游戏时间
- 🍽️ 帮忙摆碗筷 → +2 代币 → 零花钱
- 🧹 自己倒垃圾 → +3 代币 → 零花钱

#### 任务完成规则
- **每个任务每天只能完成 1 次**（防刷分，简单方案）
- 完成任务**自动 approved**（无需 PM 审批）
- PM 可**撤销**任务完成（关联的 score_event 也会变 revoked）
- 撤销后该任务**当天**可重新完成（按"每天 1 次"逻辑，今天还剩 0 次 → 撤销后回到 1 次可用）
- 写 audit_log: `actor`, `action=task_complete`, `target_event_id`, `details={task_id, task_name}`

### 3.5 边界 case
- **超额申请**: 儿子可申请"扣 200 分钟"（即使余额不足），PM 自行判断
- **周额度跨周**: 余额不归零，跨周累积（除非 PM 手动清零）
- **双账户透支**: 兑换时允许负数（如 30 元 → 60 分钟游戏，零花钱变 -30 元），由 PM 自行判断合理性
- **任务重复完成**: 儿子尝试完成已今天的任务 → API 返回 409 冲突

---

## 4. 计分维度

### 4.1 游戏时间
- **单位**: 分钟（整数）
- **类型值**: `game_time`
- **UI 颜色**: 绿色
- **图标**: 🎮
- **余额计算**: `SUM(change_value WHERE type='game_time' AND status='approved')`

### 4.2 零花钱
- **单位**: 元（整数，1 元 = 100 分内部存储但 UI 显示元）
- **类型值**: `pocket_money`
- **UI 颜色**: 金色
- **图标**: 💰
- **余额计算**: `SUM(change_value WHERE type='pocket_money' AND status='approved')`

### 4.3 任务（v2 维度）
- 不独立存余额，通过 score_event 间接影响两个账户
- 完成任务 = 创建一条 `status='approved'` + `submitted_by` 取决于谁按的 score_event
- **快捷键**展示当前 is_active 的任务

---

## 5. 交互流程

### 5.1 首次填名字流程（v2 新增，替代"改名字"）
```
[儿子 iPad 第一次访问]
  │
  │  1. 浏览器打开 /
  │  2. 系统检测 users.child.name IS NULL
  │  3. 全屏弹窗：🎮 欢迎来到你的计分板！
  │     - 输入框：请输入你的名字
  │     - 按钮：开始
  │  4. 儿子输入名字 → 点开始
  │  5. ✨ 触发彩纸动画（canvas-confetti 1.5 秒）
  │  6. 弹窗显示：欢迎 XX！👋
  │  7. 持久化到 D1
  │
  ▼
[之后访问 /]
  │
  │  不再显示弹窗，直接进主页
```

### 5.2 儿子完成任务流程（v2 新增）
```
[儿子 iPad]
  │
  │  1. 主页顶部显示"快捷键"一行按钮：
  │     [🎯 按时上床 +5] [📚 英语题 1 道 +2] ...
  │  2. 儿子按"📚 英语题 1 道 +2"
  │  3. 按钮变灰，显示"✅ 今日已完成"
  │  4. 余额 +2（💰 零花钱）
  │  5. log 列表新增条目
  │
  ▼
[API: POST /api/me/tasks/:id/complete]
  │
  │  → 校验：今天是否已完成过？是 → 409
  │  → 插入 task_completion + 关联 score_event
  │  → 写 audit_log
  │
  ▼
[余额自动重算 + 按钮变灰]
```

### 5.3 PM 撤销任务完成流程（v2 新增）
```
[PM 浏览器]
  │
  │  1. 看"任务完成记录"列表（带"撤销"按钮）
  │  2. 点"撤销"
  │  3. 弹窗确认："撤销后该任务今天可重做，确定？"
  │  4. 点确定
  │
  ▼
[API: POST /api/admin/task-completions/:id/revoke]
  │
  │  → 更新 score_event: status='revoked'
  │  → 任务今天状态回到"未完成"
  │  → 写 audit_log
```

### 5.4 PM 配置任务流程（v2 新增）
```
[PM 浏览器 /admin/tasks]
  │
  │  1. 看到当前任务列表
  │  2. 点"+ 新建任务"
  │  3. 弹窗表单：
  │     - 名称：___
  │     - 图标（emoji 选择器）：___
  │     - 奖励代币：___ 数字
  │     - 目标账户：游戏时间 / 零花钱
  │     - 分类：习惯/学习/家务/自定义
  │  4. 点保存
  │  5. 列表新增一行，儿子端快捷键同步显示
  │
  ▼
[API: POST /api/admin/tasks]
  │
  │  → 插入 tasks 表
  │  → 写 audit_log
```

### 5.5 儿子提交流程（同 v1，但提交时指定目标账户）
```
[儿子 iPad]
  │
  │  1. 点「📝 提交申请」
  │  2. 弹窗：
  │     - 目标账户：游戏时间 / 零花钱
  │     - 方向：+ 奖励 / - 扣分
  │     - 数量：___ 分钟 / 元
  │     - 原因：___ 必填
  │  3. 点「提交」
  │
  ▼
[API: POST /api/me/events]
  │
  │  → 写入 D1: status=pending
```

### 5.6 PM 审批流程（同 v1）
```
[PM 浏览器]
  │
  │  1. /admin 待审批列表
  │  2. 点「通过」/「拒绝」/「撤销」
```

### 5.7 双账户兑换流程（v2 新增）
```
[PM 浏览器 /admin/exchange]
  │
  │  1. 选择方向：
  │     - 零花钱 → 游戏时间（如 30 元 → 30 分钟）
  │     - 游戏时间 → 零花钱
  │  2. 输入数量
  │  3. 点「兑换」
  │
  ▼
[API: POST /api/admin/exchange]
  │
  │  → 创建 1 条特殊 score_event:
  │     reason="兑换: 30 元零花钱 → 30 分钟游戏"
  │     change_value 按 type 区分（一正一负）
  │  → 或者 2 条独立 event（更易审计）
  │
  ▼
[双账户余额联动更新]
```

### 5.8 周额度发放流程（同 v1，但可分配两个账户）
```
[PM 浏览器 /admin/grant]
  │
  │  1. 选择周编号
  │  2. 输入零花钱金额 + 游戏时间分钟数
  │  3. 点「发放」
```

---

## 6. 数据模型（v2 修订）

### 6.1 ER 图
```
┌──────────────┐       ┌──────────────────┐
│    users     │       │  score_events    │
├──────────────┤       ├──────────────────┤
│ id (PK)      │◀──────│ user_id (FK)     │
│ name         │       │ id (PK)          │
│ role         │       │ type             │
│ pin_hash     │       │ change_value     │
│ created_at   │       │ reason           │
│ updated_at   │       │ status           │
└──────────────┘       │ submitted_by     │
                       │ source           │ ← 新增
                       │ reviewed_by (FK) │   'manual' | 'task:<id>' | 'exchange' | 'weekly_grant'
                       │ reviewed_at      │
                       │ week_of          │
                       │ created_at       │
                       └──────────────────┘

┌──────────────────┐        ┌────────────────────────┐
│    audit_log     │        │        tasks           │
├──────────────────┤        ├────────────────────────┤
│ id (PK)          │        │ id (PK)                │
│ actor            │        │ name                   │
│ action           │        │ token_reward           │
│ target_event_id  │        │ target_account         │  ← 新增表
│ details (JSON)   │        │ icon                   │
│ created_at       │        │ category               │
└──────────────────┘        │ is_active              │
                            │ sort_order             │
                            │ created_at             │
                            └────────────────────────┘
                                       │
                                       ▼
                            ┌────────────────────────┐
                            │  task_completions      │
                            ├────────────────────────┤
                            │ id (PK)                │  ← 新增表
                            │ task_id (FK)           │
                            │ user_id (FK)           │
                            │ completed_at           │
                            │ awarded_event_id (FK)  │
                            │ UNIQUE(task_id, user_id, date) │
                            └────────────────────────┘
```

### 6.2 字段说明

#### users（同 v1）
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | INTEGER | ✅ | 主键 |
| name | TEXT | ✅ | 儿子**首次访问时填**，不可改 |
| role | TEXT | ✅ | `'child'` / `'pm'` |
| pin_hash | TEXT | ❌ | 仅 PM 有 |
| created_at | INTEGER | auto | |
| updated_at | INTEGER | auto | |

#### score_events（v2 增加 `source` 字段）
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | INTEGER | ✅ | |
| user_id | INTEGER | ✅ | |
| type | TEXT | ✅ | `'game_time'` / `'pocket_money'` |
| change_value | INTEGER | ✅ | 正数=奖，负数=扣 |
| reason | TEXT | ✅ | |
| status | TEXT | ✅ | pending/approved/rejected/revoked |
| submitted_by | TEXT | ✅ | child/pm/system |
| **source** | TEXT | ✅ | `'manual'` / `'task:<task_id>'` / `'exchange'` / `'weekly_grant'` |
| reviewed_by | INTEGER | ❌ | |
| reviewed_at | INTEGER | ❌ | |
| week_of | TEXT | ❌ | |
| created_at | INTEGER | auto | |

#### tasks（v2 新增）
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | INTEGER | ✅ | |
| name | TEXT | ✅ | "按时上床" |
| token_reward | INTEGER | ✅ | 5（正数）|
| target_account | TEXT | ✅ | `'game_time'` / `'pocket_money'` |
| icon | TEXT | ❌ | "🎯" |
| category | TEXT | ❌ | habit/study/chore/custom |
| is_active | INTEGER | ✅ | 0/1 |
| sort_order | INTEGER | ❌ | 默认 0 |
| created_at | INTEGER | auto | |

#### task_completions（v2 新增）
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | INTEGER | ✅ | |
| task_id | INTEGER | ✅ | FK → tasks.id |
| user_id | INTEGER | ✅ | FK → users.id |
| completed_at | INTEGER | auto | unix 时间戳 |
| awarded_event_id | INTEGER | ❌ | FK → score_events.id（撤销时一起改）|
| **UNIQUE(task_id, user_id, date(completed_at))** | | | 每天 1 次 |

#### audit_log（同 v1，新增 action 类型）
新增 action：
- `task_complete` — 完成任务
- `task_revoke` — 撤销任务完成
- `task_create` / `task_update` / `task_delete` — 任务配置
- `exchange` — 双账户兑换

### 6.3 余额计算（同 v1，**双账户聚合**）
```sql
-- 游戏时间余额
SELECT SUM(change_value) FROM score_events
WHERE user_id = ? AND type = 'game_time' AND status = 'approved';

-- 零花钱余额
SELECT SUM(change_value) FROM score_events
WHERE user_id = ? AND type = 'pocket_money' AND status = 'approved';
```

---

## 7. API 设计（v2 修订）

### 7.1 端点清单

| Method | Path | 角色 | 说明 |
|--------|------|------|------|
| GET | `/api/public/balance?user_id=1` | 公开 | 双账户余额 |
| GET | `/api/public/events?user_id=1&status=&type=&limit=50` | 公开 | 事件列表 |
| GET | `/api/public/events/:id` | 公开 | 事件详情 |
| GET | `/api/public/user/:id` | 公开 | 用户信息（是否已填名字）|
| **GET** | **`/api/public/tasks?user_id=1&active=true`** | 公开 | 启用的任务列表 |
| **GET** | **`/api/public/tasks/today-status?user_id=1`** | 公开 | 今日已完成的任务 id 列表 |
| POST | `/api/me/events` | 儿子 | 提交申请 |
| **PATCH** | **`/api/me/profile`** | 儿子 | **首次填名字（一次性）** |
| **POST** | **`/api/me/tasks/:id/complete`** | 儿子 | 完成任务（每天 1 次）|
| POST | `/api/admin/auth/login` | PM | PIN 码登录 |
| POST | `/api/admin/auth/logout` | PM | 登出 |
| POST | `/api/admin/events/:id/approve` | PM | 审批通过 |
| POST | `/api/admin/events/:id/reject` | PM | 拒绝 |
| POST | `/api/admin/events/:id/revoke` | PM | 撤销 |
| PUT | `/api/admin/events/:id` | PM | 编辑 |
| POST | `/api/admin/weekly-grant` | PM | 发放周额度（双账户）|
| **POST** | **`/api/admin/exchange`** | PM | 双账户兑换 |
| **GET** | **`/api/admin/tasks`** | PM | 任务列表（含停用）|
| **POST** | **`/api/admin/tasks`** | PM | 新建任务 |
| **PUT** | **`/api/admin/tasks/:id`** | PM | 编辑任务 |
| **DELETE** | **`/api/admin/tasks/:id`** | PM | 删除/停用任务 |
| **GET** | **`/api/admin/task-completions?date=&user_id=`** | PM | 任务完成记录 |
| **POST** | **`/api/admin/task-completions/:id/revoke`** | PM | 撤销任务完成 |
| PATCH | `/api/admin/users/:id` | PM | 改儿子名（v2 已砍，保留但禁用）|
| GET | `/api/admin/audit-log?limit=100&actor=` | PM | 审计 log |

### 7.2 关键请求/响应示例

#### PATCH /api/me/profile（v2 改为首次填名字）
**Request:**
```json
{ "name": "小明" }
```
**Response 200:**
```json
{
  "id": 1,
  "name": "小明",
  "is_first_time": false,
  "updated_at": 1717470000
}
```
**Error 409**（重复请求）:
```json
{ "error": { "code": "ALREADY_SET", "message": "名字已设置，不可修改" } }
```

#### POST /api/me/tasks/:id/complete
**Request:** （空 body）
**Response 201:**
```json
{
  "task_id": 1,
  "task_name": "按时上床",
  "token_awarded": 5,
  "target_account": "game_time",
  "new_balance": { "game_time": 50, "pocket_money": 30 },
  "event_id": 42
}
```
**Error 409**（今日已完成）:
```json
{ "error": { "code": "ALREADY_COMPLETED_TODAY", "message": "该任务今天已完成" } }
```

#### POST /api/admin/exchange
**Request:**
```json
{
  "from_account": "pocket_money",
  "to_account": "game_time",
  "amount": 30
}
```
**Response 200:**
```json
{
  "new_balance": { "game_time": 75, "pocket_money": 0 },
  "event_id": 43
}
```

#### POST /api/admin/tasks
**Request:**
```json
{
  "name": "按时上床",
  "token_reward": 5,
  "target_account": "game_time",
  "icon": "🎯",
  "category": "habit",
  "sort_order": 1
}
```
**Response 201:**
```json
{ "id": 1, ... }
```

---

## 8. 状态机

### 8.1 score_event 状态转换（同 v1）
```
              submit
                │
                ▼
          ┌──────────┐
          │ pending  │
          └──────────┘
             │   │   │
     approve │   │ reject
             ▼   │   ▼
    ┌──────────┐ │ ┌──────────┐
    │ approved │ │ │ rejected │
    └──────────┘ │ └──────────┘
         │       │
  revoke │       │ revoke
         ▼       ▼
      ┌──────────┐
      │ revoked  │ (终态)
      └──────────┘
```

### 8.2 task_completion 状态（v2 新增）
```
       complete          revoke
   ┌──────────┐      ┌──────────┐
   │ ACTIVE   │─────>│ REVOKED  │
   └──────────┘      └──────────┘
        │                  │
   (完成时间还在今天)   (今日可重新 complete)
   
   跨天后：ACTIVE 自动失效（"今天"窗口滚动）
```

### 8.3 任务每日窗口（v2 新增）
```
  Day N 00:00         Day N 23:59    Day N+1 00:00
      │                   │               │
      ▼                   ▼               ▼
   ┌────────────────────────────────────────────┐
   │  Task X 每日窗口                          │
   │  - 0 次完成 → 可 complete                  │
   │  - 1 次 ACTIVE → 409                       │
   │  - 1 次 REVOKED → 可再 complete（仍今天） │
   └────────────────────────────────────────────┘
```

---

## 9. 安全考虑

### 9.1 认证（同 v1）
- PM PIN bcrypt
- Session JWT, HttpOnly + Secure + SameSite=Strict
- PIN 5 次错误锁 5 分钟

### 9.2 授权（v2 增加）
- 儿子不能伪造"任务完成"（source 字段记录 task_id）
- 任务模板只能 PM 修改（/api/admin/tasks 强制 session）
- 儿子看到的是只读 tasks（GET /api/public/tasks）

### 9.3 任务刷分防护（v2 新增）
- UNIQUE(task_id, user_id, date) 数据库约束（防并发刷）
- 撤销后 task_completion 状态变 REVOKED，但 UNIQUE 约束仍存在（防同一日重复）
- 实际逻辑：API 校验"今天这个 task 是否有 ACTIVE 的 completion"
- PM 定期审计 audit_log 查 task_complete 频率

### 9.4 审计（同 v1）
- 所有写操作后自动写 audit_log
- 记录 actor / action / target_event_id / details

### 9.5 数据导出
- PM 后台"导出 JSON 备份"

---

## 10. 验收标准

### 10.1 功能验收清单（PM 拍板用）

| # | 项 | 验收标准 |
|---|----|----------|
| F1 | 首次填名字 | 第一次访问弹窗 → 输入 → 彩纸动画 → "欢迎 XX!" → 持久化；第二次访问不再弹 |
| F2 | 双账户余额显示 | 顶部 2 个大字：🎮 45 分钟 + 💰 30 元 |
| F3 | 任务快捷键（儿子端）| 顶部一行按钮，点了之后变灰显示"✅ 今日已完成" |
| F4 | 完成任务加分 | 余额立即更新，log 新增条目，audit_log 记录 task_complete |
| F5 | 任务每日 1 次 | 第二次点同一任务 → 弹"今日已完成"提示，409 状态码 |
| F6 | PM 配置任务 | /admin/tasks 列表 + 新建/编辑/停用/删除 |
| F7 | PM 撤销任务完成 | /admin/task-completions 列表 + 撤销按钮，撤销后任务当日可重做 |
| F8 | 任务快捷键（PM 端）| PM 端也能看到 + 点击（帮儿子记录）|
| F9 | 提交申请 | 弹窗：目标账户（游戏/零花）+ 方向（+/−）+ 数量 + 原因 |
| F10 | PM 审批 | 待审批列表，通过/拒绝/撤销 |
| F11 | 双账户兑换 | /admin/exchange 选方向 + 数量，生成事件，余额联动 |
| F12 | 周额度发放 | /admin/grant 双账户分配 |
| F13 | 审计 log | 时间线视图，含 task_complete / task_revoke / exchange 等 |
| F14 | 路由守卫 | 儿子访问 /admin/* 跳转登录 |
| F15 | iPad 适配 | Safari 横屏触摸友好，字体 ≥ 18px |
| F16 | 部署 | 一键部署 Cloudflare，PM 远程访问 |

### 10.2 测试验收
- `npm test` 全绿
- 后端覆盖率 > 80%
- 关键流程 Playwright e2e：首次填名字、完成任务、撤销、兑换

### 10.3 性能验收
- 余额查询 < 100ms
- 任务完成 < 300ms
- 任务列表加载 < 500ms

---

## 11. 未来扩展（v2+）

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P1 | 任务每日上限自定义 | 每个任务单独配每天最多 N 次 |
| P1 | 任务 streak 统计 | 连续完成 N 天奖励额外代币 |
| P2 | 数据可视化 | 30 天余额趋势图 |
| P2 | 多孩子支持 | 切换不同 user_id |
| P2 | 邮件/通知推送 | PM 端收到待审批/异常提醒 |
| P3 | 微信小程序迁移 | 用 uni-app 复用业务逻辑 |
| P3 | 数据导出 CSV | 月度报表 |
| P3 | 周额度自动发放 | Cloudflare Cron |

---

## 附录 A: 与 plan 的对应关系

- 数据模型 → plan §2（含 v2 tasks + task_completions）
- API 设计 → plan §3（含 v2 任务相关端点）
- 前端页面 → plan §4
- 部署架构 → plan §5
- 开发阶段 → plan §6

## 附录 B: 修订记录

| 版本 | 日期 | 作者 | 说明 |
|------|------|------|------|
| v1.0 | 2026-06-04 | PM Agent | 初稿 |
| v2.0 | 2026-06-04 | PM Agent | **重大修订**：双账户模型（Y）+ 任务系统 + 首次填名字（替代改名字）|

## 附录 C: v1 → v2 变更摘要

| 维度 | v1 | v2 |
|------|----|----|
| 计分模型 | 游戏时间 + 零花钱（两列分别存）| 双账户并行，1:1 互通 |
| 改名 | "改我的名字" 按钮 + 仪式感 | "首次填名字" 弹窗 + 彩纸（一次性）|
| 任务系统 | 无 | 完整任务系统（PM 后台配置 + 快捷键 + 每日 1 次 + 可撤销）|
| 数据源 | users.name 可改 | users.name 首次设置后不可改 |
| 周额度 | 仅游戏时间 | 可分配到两个账户 |
| 兑换 | 无 | /admin/exchange 双账户互通 |
| API 端点 | ~15 | ~22（+任务/兑换相关）|
| 数据表 | 3 张 | 5 张（+tasks +task_completions）|

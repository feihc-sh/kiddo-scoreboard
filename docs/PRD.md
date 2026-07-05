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
| **cutoff_time** | **TIME** | **可选，'HH:MM' 格式（Asia/Shanghai）。NULL = 无截止（普通任务）。仅在 §3.12 准时上床等自锁任务使用** |
| **is_self_lockout** | **INTEGER** | **0/1 标志。1 = 截止后 child UI 按钮变灰 + server 拒绝 /complete。0 = 无时间校验（普通任务）** |

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
- **§3.12 自锁任务（cutoff）**: 若 `is_self_lockout=1` 且当前 Asia/Shanghai 时间 > `cutoff_time` → server 返回 400 `CUTOFF_PASSED`，拒绝 /complete。Client 端额外在 UI 倒计时到 0 后禁用按钮（防卡顿造成的"刚跨线还能点"），但**以 server 校验为准**

### 3.12 准时上床（self-lockout 任务类型，v2.1 新增）

**用户原话** (2026-06-06 拍板): "002 不要填时间了吧，我们就留一个打卡任务，准时上床就可以了"，"超过 930 之后打卡按钮变灰色不可打。那个按钮上需要加个倒计时提醒超过 930 就不可以打了"

**触发场景**:
- 三年级 (8-9岁) 晚上 9:30 应该上床
- 痛点: 妈妈/爸爸在加班时, 没人盯就忘了时间
- 解决: 任务按钮自带倒计时, 9:30 后自动 lockout, 孩子**没法**自己乱点

**业务规则**:
- **任务名**: "准时上床" (PM 可改)
- **奖励**: `+1 min/天` (PM 可改), 计入 `game_time` 账户
- **不打卡的惩罚**: 0 (不扣分, 不想给孩子压力)
- **取消**了之前 per-minute 算法 (早 1min+1 / 晚 1min-1) — 简化方案
- **跨天重置**: 00:00 之后 cutoff 不再生效, 按钮重新激活 (新的一天)

**UI 行为** (child view):
- 按钮文字内嵌实时倒计时: "🛏️ 准时上床  ·  距离 21:30 还剩 02:15:33"
- 倒计时每秒更新 (`setInterval(1s)`), 显示到秒
- **9:30 之前**: 按钮可点 (绿色 / 正常态)
- **9:30 之后**: 按钮**变灰 + disabled** (CSS `.task-btn-locked` 灰态), 不可点
- **已完成状态**: 按钮显示 "✓ 任务完成 (点击撤销)", 跟普通任务一样
- **已撤销状态**: 按钮显示 "系统休眠中", 不可点 (PR #27 Mecha redesign 文案, 原 "明天再来 🌙")

**Server 行为** (`POST /api/me/tasks/:id/complete`):
- 校验 `is_self_lockout=1` 且 `cutoff_time` 不为 NULL
- 用 `nowShanghaiHHMM()` (Asia/Shanghai) 与 `cutoff_time` 比较
- `now > cutoff` → 400 `CUTOFF_PASSED`, `message: "已过打卡时间 HH:MM"`
- `now ≤ cutoff` → 正常奖励流程

**API 变化**:
- `POST /api/admin/tasks` body 新增可选字段 `cutoff_time: 'HH:MM' | null`, `is_self_lockout: 0 | 1`
- `PUT /api/admin/tasks/:id` body 新增可选字段同上 (允许 PM 编辑修改)
- `GET /api/public/tasks?user_id=X&active=true` 返回每个 task 的 `cutoff_time` + `is_self_lockout`
- `POST /api/me/tasks/:id/complete` 在已有 active 校验前, 新增 cutoff 校验 (400 `CUTOFF_PASSED`)

**Database 变化**:
- Migration `0004_sleep_cutoff.sql` 在 `tasks` 表加 `cutoff_time TIME` + `is_self_lockout INTEGER NOT NULL DEFAULT 0`
- 已有任务不受影响 (cutoff_time 默认 NULL, is_self_lockout 默认 0)
- 兼容旧数据: 不需要 backfill, 新字段是 opt-in

**配置 PM 端 (admin 表单)**:
- 新增 "截止时间 (可选)" input, type=time, placeholder "21:30", pattern `[0-2][0-9]:[0-5][0-9]`
- 新增 "截止后自动锁" checkbox, 勾上表示 `is_self_lockout=1`
- 不勾 / 不填 = 普通任务, 无时间校验

**时区**:
- Client 端: 浏览器知道 iPad 本地时区 (Asia/Shanghai), 倒计时显示 client local time
- Server 端: 用 `nowShanghaiHHMM()` (UTC + 8h, hard-code, 因为用户在中国无 DST)
- **Client 篡改防御**: Client disabled 只是 UX, server 端仍会二次校验 → 双重保护

**风险**:
- 🟢 复用现有 task 框架 + 任务完成流程
- 🟢 不破坏旧 task 行为 (新增字段都是 opt-in)
- 🟢 不影响其他 endpoint (`/submit`, `/exchange`, `/grant` 都不变)
- 🟢 自动 lockout 替代了之前"PM 审核异常单"机制, PM 不用盯着

**未来扩展** (未拍板, 留作 NIGHTLY-TODO):
- 多个 cutoff 任务 (不只是 21:30 上床, 还有 7:00 起床, 16:00 写作业...)
- PM 可配置 "今天第 N 次提醒" (在 21:00 / 21:15 / 21:25 弹 toast 提醒)
- 跨设备同步 lockout 状态 (目前依赖 localStorage + reload)

### 3.5 边界 case
- **超额申请**: 儿子可申请"扣 200 分钟"（即使余额不足），PM 自行判断
- **周额度跨周**: 余额不归零，跨周累积（除非 PM 手动清零）
- **双账户透支**: 兑换时允许负数（如 30 元 → 60 分钟游戏，零花钱变 -30 元），由 PM 自行判断合理性
- **任务重复完成**: 儿子尝试完成已今天的任务 → API 返回 409 冲突

#### 硬删 (Hard Delete)（v2.2 新增, Item #009）
- **触发场景**: PM 软删（`status='revoked'`）某条打卡后, 记录仍在 `task_completions` UNIQUE 约束里, 孩子当天**不能**再打卡。需要把记录**完全抹掉**, 让孩子能重新打卡。
- **范围**: 两条数据源都要支持硬删
  - `score_events` (申请审批 + 任务完成产生的事件)
  - `task_completions` (任务完成记录, 撤销后 `status='revoked'`)
- **端点** (PM only, 二次确认弹窗):
  - `POST /api/admin/events/:id/hard-delete`
  - `POST /api/admin/task-completions/:id/hard-delete`
  - `GET /api/admin/deleted-records` (列出已被硬删的快照, 灰显标记)
- **服务端行为**:
  1. 物理删原表行 (`DELETE FROM ... WHERE id = ?`)
  2. INSERT 到 `deleted_records` 表 (`record_type`, `original_id`, `original_data JSON`, `original_table`, `deleted_at`, `deleted_by`)
  3. 写 `audit_log`: `action='event_hard_deleted'` 或 `'completion_hard_deleted'`, `details` 含原数据 + deleted_records id
  4. 余额自动重算 (下一次 `computeBalance` 排除已删行)
- **客户端行为**:
  - "撤销" 按钮旁加 "🗑 永久删除" 按钮, 点击后 `confirm()` 弹窗
  - 已硬删的记录在列表里**灰显** + 标记 `(已删除 YYYY-MM-DD HH:MM by PM)`
- **参考**: 删后**允许**孩子再打卡 (因为 `source` 表已无记录, UNIQUE / "今日已完成" 校验通过)
- **风险**: 🔴 高 (物理删, 不可逆; 只能靠 `deleted_records` + `audit_log` 找回)

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

## 12. 金币系统（v2.1 新增 — 🪙 coins）

**背景：** v2 已有游戏时间（🎮）+ 零花钱（💰）两个并行账户。v2.1 引入第 3 个账户 **🪙 金币（coins）** 作为"任务激励 + 商店兑换"维度，与现有账户平行但语义独立。

**核心设计理念：** 让孩子体验"完成任务 → 攒金币 → 兑换游戏时间"的完整闭环，游戏时间来源收敛到"主动努力换来的"，而不是被动奖励。

**详细 RFC：** `docs/coin-system-rfc.md`（1527 行完整设计）— 本节为 PRD 摘要。

### 12.1 业务动机（岑斐灏 v2.1 反馈）

1. **任务奖励种类单一** — 现在任务只往 game_time / pocket_money 加分，孩子感受不到"努力攒东西"的乐趣
2. **游戏时间来源分散** — 任务奖励 + PM 周额度 + 双账户兑换都产出游戏时间，来源不清晰
3. **缺乏中期目标** — 现有奖励都是即时的（任务完成立刻给 30 分钟游戏），没有"攒 → 兑"成就感
4. **撤销逻辑不闭环** — 缺少"全任务完成 bonus"这类正向激励的回收机制

### 12.2 需求清单（10 条已锁）

| # | 需求 | 关键决策 |
|---|------|---------|
| 1 | 商店架构预留扩展 | `shop_items` + `shop_redemptions` 两表分离，`item.kind` 预留多商品类型 |
| 2 | 周定义 | 自然周，ISO 8601 `YYYY-Www`，周一 00:00 (Asia/Shanghai) ~ 周日 23:59 |
| 3 | 任务全完成判定 | **严格**：当天 active 任务数 = 完成任务数（请假/禁用不计）|
| 4 | UI 入口 | 第 3 个 balance card（替换 commit `fc0604b` 的灰色 placeholder），点击进商店页 |
| 5 | 不足/用完 UX | 按钮置灰 + 文案（"还差 X 金币" / "本周次数已用完，下周一重置"）|
| 6 | 兑换历史透明 | child UI 完整展示本周 + 历史兑换记录 |
| 7 | 游戏时间来源重构 | **只靠兑换**获得；任务不再直接奖励 game_time；历史 token_reward 事件保留不动 |
| 8 | bonus 发放时机 | 最后一个任务完成**立刻**发（实时反馈，不延迟到次日凌晨）|
| 9 | 任务撤销联动 | 撤销任务 → 回收金币 -1 + 回收 bonus -3（如果 bonus 已发）|
| 10 | 撤销后重做 | 撤销后孩子重新完成所有任务 → 再发一次 bonus（状态重置语义）|

### 12.3 数据模型

#### 12.3.1 现有表改动

```sql
-- migrations/0007_coin_system.sql
-- 1. score_events.type 加 'coins'
ALTER TABLE score_events DROP CONSTRAINT IF EXISTS score_events_type_check;
-- SQLite 不支持修改 CHECK 约束，需要重建表或忽略（实际 D1 SQLite 支持）
-- 实际做法:新建表 + 数据迁移（见 RFC §3.2 完整 DDL）

-- 2. 复用现有字段
-- score_events.week_of 已有 → 自然周限额查询
-- score_events.source = 'task' / 'exchange' 已有 → 金币写入直接复用
-- idx_score_events_week 已有 → 周限额查询性能 OK
```

#### 12.3.2 新增 `shop_items` 表

```sql
CREATE TABLE shop_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,                  -- '🎮 游戏时间 10 分钟'
  kind          TEXT NOT NULL CHECK(kind IN ('game_time', 'pocket_money', 'custom')),
  reward_type   TEXT,                            -- 'minutes' / 'yuan' / null (custom)
  reward_value  INTEGER,                         -- 10 (分钟/元)
  cost_coins    INTEGER NOT NULL CHECK(cost_coins > 0),
  weekly_limit  INTEGER NOT NULL DEFAULT 3,      -- 周限额
  icon          TEXT,                            -- emoji
  is_active     INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_shop_items_active ON shop_items(is_active, sort_order);
```

#### 12.3.3 新增 `shop_redemptions` 表

```sql
CREATE TABLE shop_redemptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  item_id         INTEGER NOT NULL,
  week_of         TEXT NOT NULL,                 -- ISO 8601 '2026-W23'
  cost_coins      INTEGER NOT NULL,              -- 冗余存，避免 JOIN
  reward_event_id INTEGER,                       -- FK → score_events.id (游戏时间 +10 那条)
  cost_event_id   INTEGER,                       -- FK → score_events.id (金币 -10 那条)
  status          TEXT NOT NULL DEFAULT 'consumed' CHECK(status IN ('consumed', 'revoked')),
  redeemed_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_at      INTEGER,
  FOREIGN KEY (user_id)         REFERENCES users(id),
  FOREIGN KEY (item_id)         REFERENCES shop_items(id),
  FOREIGN KEY (reward_event_id) REFERENCES score_events(id),
  FOREIGN KEY (cost_event_id)   REFERENCES score_events(id)
);

CREATE INDEX idx_redemptions_user_week ON shop_redemptions(user_id, week_of);
CREATE INDEX idx_redemptions_user_redeemed ON shop_redemptions(user_id, redeemed_at DESC);
```

#### 12.3.4 tasks 表变化（重要）

- **`token_reward` 字段保留** — 历史任务奖励记录不变（向后兼容）
- **新任务不再往 game_time 写 score_event** — v3 兼容开关关闭，tasks → 只写 coins (+1)
- **全任务完成判定**走 `tasks.is_active = 1` + `task_completions.status = 'active'` 实时查询

### 12.4 API 设计（Hono routes）

| 端点 | 方法 | 功能 | 备注 |
|------|------|------|------|
| `/api/coins/balance` | GET | 返回当前金币余额（`SUM(change_value) WHERE type='coins' AND status='approved'`）| 复用 score_events 代数和 |
| `/api/coins/redemptions` | GET | 返回本周 + 历史兑换记录 | `?week_of=2026-W23` 可选过滤 |
| `/api/shop/items` | GET | 返回 active 商品列表 | 按 sort_order 排序 |
| `/api/coins/exchange` | POST | 兑换：扣金币 + 加游戏时间 + 写 shop_redemptions | 服务端校验余额 + 周限额 |
| `/api/tasks/complete` | POST (改) | 完成任务 → 写 +1 金币 → 检查 bonus → 写 +3 (如有) | **改动现有端点**，追加金币逻辑 |
| `/api/tasks/revoke` | POST (改) | 撤销任务 → 写反向 -1 金币 → 检查 bonus → 反向 -3 | **改动现有端点**，追加金币回收 |

**关键约束**：
- 所有金币写入走 `score_events`（type='coins'），余额 = 代数和（不存余额字段）
- bonus 判定在 task complete 端点内**实时**触发（不在 cron / 次日凌晨）
- 兑换走 db.batch()（扣金币 + 加游戏时间 + 写 shop_redemptions 三条原子操作）

### 12.5 UI 设计

#### 12.5.1 第 3 个 Balance Card（替换 `fc0604b` placeholder）

```
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│  🎮 游戏时间             │  │  💰 零花钱                │  │  🪙 金币                 │
│     45 分钟              │  │     30 元                 │  │     23 🪙               │
│                         │  │                         │  │                         │
│  [点 card 详情]         │  │  [点 card 详情]         │  │  [点 card 进商店]       │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
```

- 默认显示余额（大字）
- hover / tap 显示"点我进商店"提示
- 余额更新时数字翻转动画（参考 fc0604b commit 风格）

#### 12.5.2 商店页（点击第 3 个 card 后）

```
[Header: ← 返回 | 商店]

本周剩余: 3/3 次                  总金币: 23 🪙

┌────────────────────────────────────────┐
│  🎮 游戏时间 10 分钟                    │
│  💎 10 金币                            │
│                                        │
│  [本周剩余: 3/3 次]                    │
│                                        │
│  [🎁 兑换 (+10 分钟游戏时间)]          │
└────────────────────────────────────────┘

--- 兑换历史 (本周) ---
2026-06-11 14:32  🎮 游戏时间 10 分钟  -10 🪙
2026-06-09 19:15  🎮 游戏时间 10 分钟  -10 🪙
```

#### 12.5.3 不足 / 用完 UX（按钮置灰）

- **余额不足**：`[🔒 还差 X 金币]`（置灰，不可点）
- **周次数用完**：`[⏰ 本周已用 X/3 次，下周一重置]`（置灰，不可点）
- **可兑换**：`[🎁 兑换 (+10 分钟游戏时间)]`（可点）

### 12.6 验收清单（Coin System 专属）

| # | 项 | 验收标准 | Given/When/Then |
|---|----|----------|-----------------|
| F1 | 任务完成 +1 金币 | 完成任务后金币立即 +1，child UI 第 3 个 card 数字更新 | Given: 金币 = 10<br>When: 完成 1 个 active 任务<br>Then: 金币 = 11，1s 内 UI 更新 |
| F2 | 全任务完成 +3 bonus | 当天所有 active 任务完成时，bonus +3 金币，弹出"🎉 全任务完成！"提示 3 秒 | Given: 5 个 active 任务，已完成 4 个<br>When: 完成第 5 个<br>Then: 金币 +3（含任务本身的 +1 = +4），弹提示 |
| F3 | 撤销任务回收 -1 | PM 撤销任务，金币 -1，UI 立即更新 | Given: 金币 = 11<br>When: PM 撤销该任务<br>Then: 金币 = 10，audit_log 写 revoke:task#X |
| F4 | 撤销任务回收 bonus -3 | 撤销触发过 bonus 的任务，bonus 也回收 -3 | Given: 当天已发过 +3 bonus<br>When: PM 撤销其中一个任务<br>Then: 金币 -1 (任务) -3 (bonus) = -4 |
| F5 | 撤销后重做再发 bonus | 撤销 → 重新完成所有任务 → 再发一次 +3 bonus | Given: 撤销过 1 个任务<br>When: 重新完成所有任务<br>Then: 写入新 bonus +3 score_event，audit_log 标记 |
| F6 | 兑换扣金币 + 加游戏时间 | 兑换成功 → 金币 -10，游戏时间 +10，shop_redemptions 写入 | Given: 金币 = 20, 周限额 3/3 没用<br>When: 点击"兑换"<br>Then: 金币 = 10, 游戏时间 +10, redemptions.status = consumed |
| F7 | 周限额 3 次 | 本周第 4 次兑换被拒绝，按钮置灰 | Given: 本周已兑换 3 次<br>When: 尝试第 4 次兑换<br>Then: API 返 429 / UI 按钮置灰显示"本周已用完" |
| F8 | 跨周自动重置 | 周一 00:00 (Asia/Shanghai) 后，周限额重置为 3 | Given: 上周已兑换 3 次<br>When: 周一 00:00 后<br>Then: 周限额显示 3/3，可兑换 |
| F9 | 按钮置灰（余额不足）| 金币 < 商品价格时按钮置灰 + 文案 | Given: 金币 = 5, 商品价格 = 10<br>When: 查看商店页<br>Then: 按钮显示"🔒 还差 5 金币"，置灰不可点 |
| F10 | 按钮置灰（周次数用完）| 周次数用完时按钮置灰 + 文案 | Given: 本周已兑换 3 次<br>When: 查看商店页<br>Then: 按钮显示"⏰ 本周已用 3/3 次，下周一重置"，置灰不可点 |
| F11 | 兑换历史展示 | child UI 透明展示本周 + 历史兑换记录 | Given: 本周兑换过 2 次<br>When: 打开商店页<br>Then: "兑换历史 (本周)" 区显示 2 条记录，含时间/商品名/消耗金币 |
| F12 | 第 3 个 balance card | child UI 显示金币余额，点击进商店页 | Given: child UI 加载<br>When: 看到 3 个 balance card<br>Then: 第 3 个显示"🪙 金币 XX"，点击跳转商店页 |

### 12.7 实施分阶段（6 个 Module）

| Module | 内容 | 估计工时 | 依赖 |
|--------|------|----------|------|
| M1 | migrations (0007_coin_system.sql) + types + utils (weekOf / bonus 判定 / 撤销回收) | 30 min | — |
| M2 | 任务金币 API（hook 进 /api/tasks/complete + /revoke，bonus 实时触发）| 60 min | M1 |
| M3 | 商店 API（/api/shop/items + /api/coins/exchange + /api/coins/redemptions）| 45 min | M1 |
| M4 | child UI（第 3 个 balance card + 商店页 + 兑换历史）| 60 min | M2, M3 |
| M5 | e2e spec（coin-system.spec.ts ~15 tests，F1-F12 覆盖）| 45 min | M4 |
| M6 | 文档同步（TEST_PLAN.md + FEATURE_MATRIX.md + PROGRESS.md + 部署）| 30 min | M5 |

**总估计：~4.5 小时**（PM §6 模块分段开发模式）

### 12.8 风险与边界

| 风险 | 应对 |
|------|------|
| 跨周撤销（周一 23:59 发 bonus，周二 00:01 撤销 → ISO 周变更）| bonus 回收走 source_ref（日期 + user_id），不依赖 week_of 字段 |
| 周次数 race condition（同时 2 个 click）| 兑换走 db.batch() 原子操作 + 服务端二次校验 |
| 兑换后立刻撤销任务（游戏时间已加，bonus 还在）| 撤销只回收金币和 bonus，不回收兑换出的游戏时间（设计如此，避免循环）|
| 历史 token_reward 事件处理 | **只对新生效，历史保留**（不写 migration 回滚历史数据）|
| 多孩场景（目前 1 个 child）| schema 已 support 多孩（所有表都带 user_id FK），UI 层 v1 只显示当前 child |

### 3.13 打卡日历 (Item #006, v2.x)

**用户原话** (2026-06-17 拍板): "B + 折叠 + 所有日期, 可切月份"

**已拍板**:
1. **方案 = B (标准月历)**: 折叠月历视图, 标准 7×6 网格, 每格点击可看当天打卡明细 (任务名 + 积分)
2. **Q1 触发 = 折叠**: child UI 顶部"📅 月历"按钮点击展开/收起 (跟现在 child UI 风格一致)
3. **Q2 数据 = 所有日期 (可切月份)**: 显示全部历史, ◀/▶ 按钮切月份, 长跨度成就感

**数据来源**: `task_completions` 表 (现有 schema, 无需改), 按 `child_id + completed_at` 聚合每天打卡数

**颜色档位** (GitHub 风, 4 档):
| 档位 | 打卡次数 | 背景 | 边框 |
|------|----------|------|------|
| Tier 0 | 0 次 | rgba(255,255,255,0.02) | rgba(0,245,255,0.06) |
| Tier 1 | 1 次 | rgba(0,245,255,0.12) | rgba(0,245,255,0.25) |
| Tier 2 | 2 次 | rgba(0,245,255,0.25) | rgba(0,245,255,0.45) |
| Tier 3 | 3+ 次 | rgba(0,245,255,0.4) | --cyan + 霓虹 glow |

**API 端点**:
| Method | Path | 功能 |
|--------|------|------|
| GET | `/api/public/calendar/checkins?child_id=&year=&month=[&task_ids=1,3]` | 返回 `{ checkins: { "2026-06-15": [{task_id, task_icon, task_name, count}, ...], ... } }` 按月聚合 **per-task** 打卡明细 (Item #012 §1 改: 从 count 扩展到 array) |
| GET | `/api/public/calendar/tasks` | 返回 `{ tasks: [{id, name, icon, category, sort_order}, ...] }` 列出所有 `is_active=1` tasks, 供 tab bar 渲染 (Item #012 §1 新增) |
| GET | `/api/public/calendar/details?child_id=&date=` | 返回 `{ completions: [{ id, task_name, task_icon, completed_at, token_reward, target_account }] }` |

**Item #012 v2.x** (2026-06-22 拍板, 4 decisions):
1. **Cell icons (A3+)**: 横排所有 task icon, 无数字无 +N; **当天 5 个 task 都打** → 显示 ⭐ 单 icon (overflow 避免 cell 拥挤)
2. **Tab 多选 OR (B2)**: 月历顶部加 tab bar, 多选 pill, 选 N 个 task → 显示 N 个 task **任一完成** 的格子 (OR logic, server 端 WHERE filter 避免 client 拿全表再 filter)
3. **Tab 来源 (C1)**: 所有 `is_active=1` tasks 都成 tab (按 sort_order ASC 排列), 现在 5 个 (刷牙/整理玩具/阅读/运动/帮助做家务); 5+ 时 tab bar 横向滚动 (overflow-x: auto), 未来 10+ task 再考虑 C2 "添加筛选" 按钮
4. **localStorage 持久化 (D2)**: `localStorage.calendarSelectedTaskIds` 保存选中 task_id 数组 (`[]` = 全部, `[1,3]` = 刷牙 + 阅读), reload 后恢复

**实现文件** (Item #012 增量):
- `src/routes/public/calendar.ts` — 加 `task_ids` query param + JOIN tasks 返 icon/name (Item #012 §1)
- `src/routes/public/calendar-tasks.ts` — 新 `/api/public/calendar/tasks` endpoint (Item #012 §1)
- `src/worker.ts` — register `/api/public/calendar` route mount 3 个子路由
- `public/app.js` — `loadCalendarTasks()` + `renderCalendarTabs()` + localStorage 读写, `renderCalendar()` 改 cell 渲染 (icons 横排, 5+ → ⭐) (Item #012 §2+3)
- `public/app.css` — `.calendar-tab-bar` + `.calendar-tab` + `.calendar-tab--active` (cyan glow) + `.calendar-cell-icons` + `.calendar-cell-icon` + `.calendar-cell-overflow` (⭐) 样式
- `public/index.html` — `<div id="calendar-tab-bar">` 加在 `.calendar-grid` 后 (Item #012 §3)
- `tests/unit/calendar-tasks.test.ts` — 5 tests (新 endpoint, is_active filter, sort)
- `tests/unit/calendar-checkins-filter.test.ts` — 7 tests (新 response structure, task_ids filter, invalid silent filter)
- `tests/e2e/ui-calendar-icons.spec.ts` — 8 e2e (icon render + tab interaction + localStorage persistence)

**视觉对齐**: 复用 Mecha HUD cyan tokens (`--cyan: #00F5FF` 等), 与 #005 进度条 + #010 sprint modal + #011 running map 同色板; tab active state cyan glow + 1px border

**可关闭性**: 折叠按钮再次点击收起; ESC 键关闭; localStorage 记忆折叠状态

**风险**: 🟢 (UI-only, 复用 #010 modal CSS + 现有 task_completions schema)

### 3.14 任务装备/机甲化 (Item #008, v2.x)

**用户原话** (2026-06-08): "在 NIGHTLY-TODO 里加个 idea: 把任务做成机甲风格, 小朋友喜欢机甲"

**已拍板** (feihao 2026-06-17):
1. **方案 = B (机甲 HUD)**: 任务按钮框做成**机甲 HUD 角括号** + 霓虹青边框 + 扫描线
2. **Q1 冲击 = 夸张**: **全屏 HUD 风格**, 任务像"装备舱", 改 child UI 任务区主布局
3. **Q2 关联 #007 = 独立**: #008 自己一套, 跟 #007 Pacific Rim Jaeger 解耦, 不等 #007 拍板

**设计元素** (全屏覆盖 child UI 任务区):
- **角括号 (Corner Brackets)**: 任务卡片四角加 ◢◤◣◥ 装饰 (`.mecha-corner.tl/tr/bl/br`), CSS clip-path + cyan glow
- **扫描线 (Scanline)**: 任务区背景 `@keyframes mecha-scanline-move` 上下移动 (cyan 0.05 opacity, 跟 #011 running map 同套)
- **霓虹青光 (Neon Glow)**: 边框 `box-shadow: 0 0 8px #00d4ff` + hover 加深到 `0 0 12px + 0 0 24px`
- **数据流背景 (Data Flow)**: 任务区背景 `repeating-linear-gradient` 网格底 (跟 #011 running map 同色板)

**装备激活动画** ("装备舱"模式):
- 任务完成时按钮**展开** → 显示"装备激活"动画 (类似机甲开机) → 短暂 hold 0.5s → 折回
- `.mecha-equip-active` class 触发: `transform: scale(1.0) → scale(1.05) → scale(1.0)` + `box-shadow: 0 0 0px → 0 0 20px → 0 0 0px` (0.5s)
- 触发顺序: 装备激活 → 现有 🎉 confetti (per #005 进度条) → balance card 更新

**视觉对齐**:
- cyan 调色板 (`--cyan: #00F5FF`) 跟 #005 进度条 + #010 sprint modal + #011 running map 一致
- mobile (max-width: 480px): 关闭全屏 scanline 保留 corner (60fps 性能)
- mobile (max-width: 480px): 隐藏 corner (避免小屏挤压)

**实现文件** (Item #008 Stage 1-4):
- `public/app.css` — `.mecha-frame` + `.mecha-corner` + `.mecha-scanline` + `.mecha-glow` + `.mecha-equip-active` + 4 个 `@keyframes`
- `public/app.js` — `renderTasks()` 渲染 .mecha-frame + 4 corner divs (per task), `triggerEquipActivation(taskId)` 在 submitTask 成功 callback
- `tests/unit/task-mecha-button.test.ts` (11 tests): 4 state DOM 验证 + 4 corner 元素 + mecha-glow class + happy-dom click test
- `tests/unit/mecha-equip-activation.test.ts` (8 tests): triggerEquipActivation 4 state + setTimeout 500ms
- `tests/e2e/ui-task-mecha-frame.spec.ts` (4 spec): iPad viewport 768x1024, 2 tasks → 2 frames → 8 corners, hover shadow 改变
- `tests/e2e/ui-equip-activation.spec.ts` (6 spec): 装备激活 + confetti 顺序 + CSS transition + mobile 降级

**可关闭性**: 视觉风格本身没有 toggle 按钮 (PM 拍板: 全屏总是开, 关闭可加 "🔧 经典模式" toggle 留二期)

**风险**: 🔴 (UI-only 但全屏 HUD 改 child UI 任务区主区域, 跟 #005/#006/#010/#011 视觉有冲突, 需全量 regression; 跟 #007 解耦, 不等 #007 拍板)

**Commit 序列**:
- `1612a28` (Stage 1: HUD frame CSS 组件库, on main)
- `e813339` (Stage 2: apply HUD frame to task buttons, feat/008-mecha-stage2-4)
- `c6647fd` (Stage 3: fullscreen HUD cockpit + equip activation)
- (pending Stage 4: docs + visual alignment + perf + regression)

### 3.15 Task Lifecycle — Suspend/Resume (Item #014, v2.x)

**用户场景** (NIGHTLY-TODO Item #014, 2026-07-04 拍板):
暑假来了，孩子不用每天打卡"按时上床"了，但不想删除这个任务（历史记录要保留）。PM 可以**暂停**任务，暂停后 child UI 不显示该任务；开学后 PM 再**恢复**，child UI 重新显示。

**核心设计**:
- **State machine**: `active` (is_active=1) ↔ `suspended` (is_active=0)
- **PM 操作**: toggle switch inline in admin task list
- **Child UI**: `is_active=0` 自动隐藏（`me/tasks.ts` L63 + L254 已有逻辑）
- **Audit**: `task_suspended` / `task_resumed` 写入 `audit_log`

**API**:
- `POST /api/admin/tasks/:id/toggle` — PM 切换 is_active 状态（0→1 或 1→0）
  - Request body: `{}` (空)
  - Response 200: `{ id, name, is_active, updated_at }`
  - Response 401: 未登录
  - Response 403: 非 PM

**audit_log action**:
| 操作 | action |
|------|--------|
| active → suspended | `task_suspended` |
| suspended → active | `task_resumed` |

**Child UI 行为**:
- `GET /api/public/tasks?user_id=2&active=true` 默认只返回 `is_active=1` 任务（已有逻辑，无需改动）
- `GET /api/admin/tasks` 返回所有任务（含 suspended），admin 列表可见 toggle switch
- suspended 任务若有 active completion，PM 可正常撤销（不受 is_active 影响）

**Admin UI**:
- Task list 每行右侧 inline toggle switch（cyan glow on/off 对应 active/suspended）
- Toggle 即时触发 POST /toggle + reload 任务列表

**风险**: 🟢
- 复用现有 `is_active` 字段，无 schema 改动
- toggle 操作幂等，PM 可随时切换
- child UI 已原生过滤 `is_active=0`

**引用**: Item #014 / NIGHTLY-TODO §

### 13. 跑步小地图 (Item #011, v2.x)

**用户原话** (2026-06-17): "在 Nightly Todo 里再增加一个功能：记录跑步的每次公里数，并绘制一个小地图。每一次跑了多远的距离，会在一个虚拟的小地图上，从一个点移动到另一个点。当到达一个新的点位时（比如跑到10公里），可以开一个小礼包，礼包里有一个随机的积分"

**已拍板**:
1. **多张地图 + 第一张 = 上海→苏州**: 起点上海普陀区, 终点苏州. 总距离 ~95 km. **不均距**切 10 个目标.
2. **风格 = 科技风手绘**: 跟现有 child UI 视觉一致 (cyan glow + 网格底), 路径为自由曲线 SVG.
3. **推进方式 = C2**: 累计总公里数推进小人位置; 距离增长与本次打卡距离成正比; 一次打卡小人只前进一步.
4. **积分概率分布 (D3)**: 60% 小奖 1-5, 35% 中奖 5-10, 5% 大奖 10-20. 每到一个**新点位** roll 一次.
5. **录入 = E1**: 孩子点 🏃 emoji → 弹输入框填公里数 → 提交.
6. **PM 可撤销** (X1 修订): PM 在 admin UI 看到 running_records 列表, 可点 "↩ 撤销" → 写入 revoked_at + revoked_by + **扣回积分** + **回退累计 km** + 写 audit_log. 二次确认防误操作.
7. **多图通关**: 第一张跑完后孩子界面弹大图恭喜 modal → 撒花动画 → "查看下一张地图" 按钮 → 自动激活下一张地图 (本期只做第 1 张, 后两张占位 is_active=0).

#### 13.1 数据模型 (4 张表)

```sql
-- running_maps: 主题地图清单 (多张地图, 可切换 + 通关解锁)
CREATE TABLE running_maps (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  theme          TEXT    NOT NULL,
  total_km       REAL    NOT NULL CHECK(total_km > 0),
  is_active      INTEGER NOT NULL DEFAULT 0,
  display_order  INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);

-- running_points: 每张地图的节点 (起点 0 km + 多个 + 终点 total_km)
CREATE TABLE running_points (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  map_id      INTEGER NOT NULL REFERENCES running_maps(id),
  name        TEXT    NOT NULL,
  order_index INTEGER NOT NULL,
  cum_km      REAL    NOT NULL CHECK(cum_km >= 0)
);

-- running_records: 每次跑步打卡 (含撤销语义)
CREATE TABLE running_records (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  child_id          INTEGER NOT NULL REFERENCES users(id),
  map_id            INTEGER NOT NULL REFERENCES running_maps(id),
  km                REAL    NOT NULL CHECK(km > 0),
  awarded_point_id  INTEGER REFERENCES running_points(id),
  awarded_minutes   INTEGER,
  created_at        INTEGER NOT NULL,
  revoked_at        INTEGER,
  revoked_by        INTEGER REFERENCES users(id)
);

-- running_progress: child-level cum_km 写穿缓存 (Item #011 §4)
CREATE TABLE running_progress (
  child_id      INTEGER NOT NULL,
  map_id        INTEGER NOT NULL,
  cum_km        REAL    NOT NULL DEFAULT 0,
  last_updated  INTEGER NOT NULL,
  PRIMARY KEY (child_id, map_id)
);
```

#### 13.2 API 设计

| Method | Path | 角色 | 说明 |
|--------|------|------|------|
| POST | `/api/running/records` | 孩子 | 提交 km → 写 record + score_event + audit + UPSERT running_progress |
| GET | `/api/running/maps/active` | 孩子 | 返回当前地图 + 点位 + cum_km |
| POST | `/api/running/maps/:id/complete` | 孩子 | 通关 → 激活下一张地图 |
| GET | `/api/admin/running/records` | PM | 列表所有 running_records (含已撤销) |
| POST | `/api/admin/running/records/:id/revoke` | PM | 撤销: UPDATE revoked_at + INSERT -game_time + UPSERT running_progress + audit_log |

#### 13.3 撤销语义 (X1 修订)

PM 撤销跑步记录时, 原子执行:
1. `UPDATE running_records SET revoked_at=NOW, revoked_by=pm_user_id WHERE id=?`
2. 若 awarded_minutes > 0: `INSERT INTO score_events (user_id, type='game_time', change_value=-awarded_minutes, reason='跑步打卡撤销', ...)`
3. 重新计算 cum_km: `SELECT SUM(km) FROM running_records WHERE child_id=? AND map_id=? AND revoked_at IS NULL AND id != ?` → UPSERT running_progress
4. `INSERT INTO audit_log (action='running_record_revoke', ...)`

#### 13.4 点位设计 (上海→苏州, 10 个)

| # | 名称 | 累计 km |
|---|------|---------|
| 0 | 🏁 上海·普陀区 (起点) | 0 |
| 1 | 嘉定新城 | ~8 |
| 2 | 太仓 | ~22 |
| 3 | 昆山花桥 | ~32 |
| 4 | 昆山城区 | ~45 |
| 5 | 阳澄湖 | ~58 |
| 6 | 苏州相城区 | ~72 |
| 7 | 苏州姑苏区 | ~82 |
| 8 | 苏州工业园区 | ~89 |
| 9 | 🚩 苏州·金鸡湖 (终点) | ~95 |

### 3.15 Kid Coin Request (审批流) — Item #015 (v2.x)

**用户原话** (2026-07-04 拍板): "kid 觉得自己做了好事 → 想申请金币奖励 → 提交申请 → 等 PM 审核 → 通过后自动到账 + 流水记录"

**已拍板**:
1. **入口**: kid UI 主页顶部 "🪙 申请金币" 按钮 → modal (数量 1-999 + 理由 1-200 字)
2. **状态机**: `pending → approved` (写 score_events) / `pending → rejected` (驳回,无 score_events)
3. **PM 端**: admin 后台 "🪙 金币申请" section, 待审 list + approve/reject 按钮 + confirm modal
4. **写 score_events**: `type='coins'`, `source='manual'`, `source_ref='coin_request:<id>'` — 复用现有 coin 余额计算
5. **拒绝必填理由**: 防止 PM 随意拒绝, 留 audit trail
6. **无 daily/weekly 上限**: PM 审核时自行判断合理性

**API** (5 个端点):
| Method | Path | 角色 | 说明 |
|--------|------|------|------|
| POST | `/api/coins/request` | 儿子 | 提交申请, body: `{amount, reason}` |
| GET | `/api/coins/requests` | 儿子 | 历史, ≤50 条, 按 requested_at DESC |
| GET | `/api/admin/coin-requests?status=pending` | PM | 待审 list |
| POST | `/api/admin/coin-requests/:id/approve` | PM | 批准, body: `{note?}` |
| POST | `/api/admin/coin-requests/:id/reject` | PM | 驳回, body: `{note REQUIRED}` |

**Database**: `coin_requests` 表
```sql
CREATE TABLE coin_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  amount        INTEGER NOT NULL CHECK(amount BETWEEN 1 AND 999),
  reason        TEXT    NOT NULL CHECK(length(reason) BETWEEN 1 AND 200),
  status        TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  requested_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  reviewed_at   INTEGER,
  reviewed_by   INTEGER REFERENCES users(id),
  review_note   TEXT
);
CREATE INDEX idx_coin_requests_user ON coin_requests(user_id, requested_at DESC);
CREATE INDEX idx_coin_requests_status ON coin_requests(status, requested_at DESC);
```

**audit_log 动作**:
- `coin_request_approved`: `details = {request_id, user_id, amount, reason, approver_id, approved_at, note?}`
- `coin_request_rejected`: `details = {request_id, user_id, amount, reason, rejector_id, rejected_at, note REQUIRED}`

**关联**:
- 跟 #014 (admin task toggle) 风格一致: admin 后台 inline UI + optimistic update + audit_log
- 复用现有 `score_events` 表 + `audit_log` 表, 无新核心表
- coin 余额计算复用 `SUM(change_value) WHERE type='coins' AND status='approved'`, 无 balance 缓存

**风险**: 🟡 (新 schema + 多 endpoint + kid/admin UI 都改, 但 PM 拍板后 5 阶段无重大返工)

### 12.9 Reference

- **完整 RFC**：`docs/coin-system-rfc.md`（1527 行详细设计 + DDL + 流程图 + edge case）
- **基础架构**：`migrations/0001_initial.sql`（users / score_events / tasks / task_completions 表）
- **现有 API 风格**：`src/routes/`（Hono routes + D1 batch pattern）
- **现有 UI 风格**：`public/index.html` + `app.js` + `app.css`（含 fc0604b commit 的 3-col balance card 框架）
- **撤销联动参考**：commit `5000d0f` (P0 #24) + `71a77a1` (P0 #26) 的 task_completion / score_event 软删除模式

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

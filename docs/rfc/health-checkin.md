# 健康打卡 (Health Check-in) RFC

**版本:** v1.0 (draft)
**日期:** 2026-06-14
**作者:** PM Agent（代岑斐灏 / feihao 决策）
**状态:** 待用户最终确认
**目标读者:** 用户（产品负责人）、Code Agent（实施者）、Qual Agent（验收者）

> 本 RFC 引入 kiddo-scoreboard 的第 4 个账户外维度——**🏥 健康打卡**。
> 跟 🎮 游戏时间 / 💰 零花钱 / 🪙 金币 不同，**健康打卡不参与积分计算**，只负责"事件状态记录 + 历史日历回顾"。
> 配套 commit `9eadc0c` 在 `feat/health-checkin` branch 上已 ahead origin/main 1 commit，本 RFC 从此 base 推进。

---

## 1. 背景与目标

### 1.1 现状

kiddo-scoreboard v2 现有 3 个并行账户 + 1 个任务系统：

| 维度 | 数据来源 | 用途 |
|------|----------|------|
| 🎮 游戏时间 (game_time, 分钟) | 任务奖励 + PM 周额度 + 金币兑换 | 玩 Switch / iPad |
| 💰 零花钱 (pocket_money, 元) | 任务奖励 + PM 周额度 + 双账户兑换 | 实体商品 / 攒钱 |
| 🪙 金币 (coins) | 任务 +1 + 全完成 +3 bonus + 商店兑换 | 兑换游戏时间 |
| ✅ 任务 (tasks + completions) | 日常打卡 → 给奖励 | 行为激励 |

**当前痛点（岑斐灏 v2.2 反馈）：**

1. **孩子健康事件无独立记录** — 溃疡/发烧/咳嗽/受伤/过敏/头晕/呕吐 这些"小病小痛"过去只能口头跟 PM 说，没留痕。下次复发或看医生时，"上次喉咙发炎是什么时候？""最近一个月发烧几次？"答不上来。
2. **缺乏"病程跟踪"视角** — 一个"咳嗽"可能持续 3-5 天，断断续续；用单日 timestamp 表达不出来。需要 start_date / end_date 范围。
3. **健康事件 ≠ 积分** — 不应该因为生病"扣分"或"奖励"，也不应该影响 🎮/💰/🪙 余额。健康打卡是"状态记录器"而非"积分来源"。
4. **谁打卡？** — 儿子（"我今天头晕"）和 PM（"孩子昨天吐了"）双方都可能需要记录，schema 要 support。

### 1.2 目标

引入 **🏥 健康打卡** 作为独立的事件记录维度：

- ✅ **8 种 event_type hardcode**：溃疡 / 发烧 / 咳嗽 / 受伤 / 过敏 / 头晕 / 呕吐 / 其他（emoji 区分）
- ✅ **日期范围模型**：start_date + end_date（NULL = 进行中）而非单点 timestamp
- ✅ **谁都能创建**：儿子（child）+ PM 双方都能新增
- ✅ **续接 UX**：点"打卡"按钮时，若同类型有 active 事件，弹窗问"已愈 / 还在继续 / 又起新"
- ✅ **月历回顾**：主页新 tab「健康」，内嵌 8 个子 tab，每个子 tab 显示该 type 的月度日历
- ✅ **不参与积分**：健康事件不写入 score_events，不影响 🎮/💰/🪙 余额
- ✅ **完整 audit log**：所有 health event 变更进 audit_log（health_event_create / health_event_resolve / health_event_delete）

### 1.3 非目标（明确不做）

- ❌ **不参与积分** — 不写 score_events，不影响 game_time / pocket_money / coins 余额
- ❌ **不做健康趋势分析** — 不画"月发烧次数"统计图（v2 引入）
- ❌ **不做提醒通知** — 不发"孩子上次咳嗽已 7 天"提醒
- ❌ **不做医生/医院关联** — 纯事件记录，无医疗机构字段
- ❌ **不导入历史数据** — v1 从零开始，不支持批量导入
- ❌ **不开放更多 event_type** — v1 hardcode 8 种，PM 后台配置 v2 引入
- ❌ **不修改事件** — 只能 create / resolve（end_date）/ delete（PM 后台硬删），不修改 event_type 或 start_date

### 1.4 成功指标

| 指标 | 目标值 | 衡量方式 |
|------|--------|----------|
| 孩子每月主动打卡次数 | ≥ 3 次 | health_events WHERE submitted_by='child' AND created_at > now-30d |
| PM 记录与口述一致率 | 100% | 主观对比（岑斐灏观察） |
| 月历渲染性能 | < 200ms（单 type 单月） | API 响应时间 + DOM render |
| 续接 UX 弹窗触发准确率 | 100% | 不漏检同 type active 事件 |

### 1.5 与现有系统的关系

```
┌──────────────────────────────────────┐
│  主页 Tab 结构 (现有 3 + 新 1)        │
├──────────────────────────────────────┤
│ [✅ 任务] [💰 余额] [🪙 商店] [🏥 健康]│  ← 新 tab
│                                       │
│ 任务 tab:  现有 task UI 不变          │
│ 余额 tab:  现有 BalanceCard 不变      │
│ 商店 tab:  现有 ShopPage 不变         │
│ 健康 tab:  ┌─溃疡─发烧─咳嗽─受伤─过敏─│  ← 8 子 tab
│           │ 头晕─呕吐─其他            │
│           │                          │
│           │ <月度日历>                │
│           │  ▢ ▢ ▣ ▢ ▢ ▢ ▢         │
│           │  1 2 3 4 5 6 7          │
│           │                          │
│           │  [+ 打卡] 按钮            │
│           └──────────────────────────┘
└──────────────────────────────────────┘
```

**关键边界**：
- health_events 表**独立**于 score_events，不参与积分
- audit_log 复用现有（actor + action 扩展 'health_event_*'）
- 不需要 D1 事务联动（health events 跟 score events 完全解耦）

---

## 2. 锁定需求（已 feihao 拍板）

### 2.1 决策表

| # | 决策项 | 选择 | 备注 |
|---|--------|------|------|
| D1 | UI 位置 | 主页新 tab「健康」 | 4 个主 tab 并列 |
| D2 | 谁打卡 | 儿子 + PM 双方 | 双方都能创建 + 查看 |
| D3 | event_type | T1 + 头晕/呕吐 | 8 种 hardcode |
| D4 | 日历粒度 | V2 每个 type 1 张 | 8 个子 tab 各 1 个月历 |
| D5 | 数据模型 | 日期范围 | start_date / end_date |
| D6 | 续接 UX | 弹窗 3 选项 | 已愈 / 还在继续 / 又起新 |
| D7 | 参与积分 | 否 | 完全独立 |
| D8 | 撤销/修改 | 只能 resolve + PM 硬删 | 不修改 type / start_date |

### 2.2 8 种 event_type 完整定义

```ts
export const HEALTH_EVENT_TYPES = [
  { type: 'ulcer',      label: '溃疡', emoji: '🤕' },
  { type: 'fever',      label: '发烧', emoji: '🤒' },
  { type: 'cough',      label: '咳嗽', emoji: '😷' },
  { type: 'injury',     label: '受伤', emoji: '🩹' },
  { type: 'allergy',    label: '过敏', emoji: '🤧' },
  { type: 'dizzy',      label: '头晕', emoji: '😵' },
  { type: 'vomit',      label: '呕吐', emoji: '🤮' },
  { type: 'other',      label: '其他', emoji: '🌀' },
] as const;
```

**emoji 决定日历格子的视觉标识**（不用颜色 → 父子共用界面，色盲友好）。

### 2.3 续接 UX 三选项流程

```
用户点 [+ 打卡] (溃疡子 tab)
   │
   ▼
查 health_events WHERE event_type='ulcer' AND end_date IS NULL
   │
   ├─ 0 个 active → 弹新建表单（start_date=今天, type=溃疡, note=可选）
   │
   └─ ≥1 个 active → 弹"续接"对话框:
       │
       「上次溃疡 (6/10 起) 现在怎么样？」
       │
       ┌─────────┬──────────────┬──────────┐
       │ 已愈     │ 还在继续      │ 又起新的   │
       └────┬────┴──────┬───────┴────┬─────┘
            │           │            │
            ▼           ▼            ▼
        弹日期选择器    no-op        close 旧 + 开新
        end_date=X   (保持 active)   (原子 db.batch)
```

**关键设计点**：
- "已愈" 弹日期选择器（默认 = 今天）→ PATCH end_date
- "还在继续" 不操作（直接关闭弹窗）
- "又起新的" 原子操作：close 旧 + open 新（避免 active 事件重叠）

---

## 3. 数据模型

### 3.1 新表 `health_events`

```sql
CREATE TABLE health_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,                       -- 多孩 schema 已 support
  event_type      TEXT NOT NULL CHECK(event_type IN (
                    'ulcer','fever','cough','injury',
                    'allergy','dizzy','vomit','other'
                  )),
  start_date      TEXT NOT NULL,                          -- 'YYYY-MM-DD' (Asia/Shanghai)
  end_date        TEXT,                                   -- NULL = 进行中
  is_resolved     INTEGER NOT NULL DEFAULT 0 CHECK(is_resolved IN (0, 1)),
  note            TEXT,                                   -- 备注
  submitted_by    TEXT NOT NULL CHECK(submitted_by IN ('child', 'pm')),
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved_at     INTEGER,                               -- end_date 写入时间
  resolved_by     INTEGER,                               -- 操作 resolve 的人 (pm_user_id)
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id)     REFERENCES users(id),
  FOREIGN KEY (resolved_by) REFERENCES users(id)
);

-- 索引: 查某用户某 type 的 active 事件 (续接 UX 关键查询)
CREATE INDEX idx_health_events_user_type_active
  ON health_events(user_id, event_type, is_resolved, start_date DESC);

-- 索引: 月历查询 (查某用户某月所有事件)
CREATE INDEX idx_health_events_user_date
  ON health_events(user_id, start_date);

-- 索引: 进行中事件 (end_date IS NULL 过滤)
CREATE INDEX idx_health_events_user_undone
  ON health_events(user_id, end_date) WHERE end_date IS NULL;
```

**字段说明**：
- `start_date / end_date` 存 `'YYYY-MM-DD'` 字符串（Asia/Shanghai），不用 unix timestamp → 跨时区直观
- `end_date IS NULL` 等价于 `is_resolved = 0`（查询时两个条件可互换）
- `note` 自由文本，PM 或 child 写"今天开始咳嗽，有点痰"等

**`is_resolved` vs `end_date` 双写**：
- `end_date IS NULL` 是 SOT（single source of truth）
- `is_resolved` 是冗余字段，便于索引快速过滤
- 写入时必须同时更新两个（CHECK 约束保证一致性：end_date IS NULL ↔ is_resolved = 0）

### 3.2 跟现有表的关系

```
users ──────┬──── health_events
            │
            ├──── score_events (🎮/💰/🪙 余额来源, 跟 health_events 无关)
            ├──── task_completions
            └──── audit_log  ← 复用,新增 health_event_* action
```

**重要**：`health_events` 跟 `score_events` **零关联**。两个表独立存在，独立读写，不互相同步。

### 3.3 audit_log action 扩展

```ts
// src/db/types.ts: AuditAction 联合类型加 3 个值
export type AuditAction =
  | ... // 现有
  | 'health_event_create'   // 孩子/PM 创建 health event
  | 'health_event_resolve'  // 设置 end_date
  | 'health_event_delete';  // PM 硬删 (admin 专用)
```

---

## 4. API 设计

### 4.1 端点总览

| Method | Path | Auth | 用途 | 写入 audit |
|--------|------|------|------|-----------|
| GET | `/api/public/health/events` | 任意 | 月历查询 + 活跃检查 | ❌ |
| POST | `/api/me/health/events` | child | 儿子打卡 | ✅ health_event_create (actor=child) |
| POST | `/api/admin/health/events` | pm | PM 打卡 (代孩子记录) | ✅ health_event_create (actor=pm) |
| PATCH | `/api/admin/health/events/:id/resolve` | pm | 标记已愈 + end_date | ✅ health_event_resolve |

**4 个端点**，不开放修改 event_type / start_date，不开放非 PM 删除。

### 4.2 详细规范

#### 4.2.1 `GET /api/public/health/events`

**用途**：月历渲染 + 续接 UX active 检查

**Query params**：
- `user_id` (required, int) — 查询哪个孩子的健康事件
- `event_type` (optional, string) — 限定 1 种 type，不传 = 返回全部
- `month` (optional, 'YYYY-MM') — 限定某月（按 start_date 过滤），不传 = 返回所有 active + 最近 30 天
- `active_only` (optional, 'true'/'false', default 'false') — 只返回 end_date IS NULL

**Response 200**：
```json
{
  "events": [
    {
      "id": 42,
      "user_id": 1,
      "event_type": "cough",
      "start_date": "2026-06-10",
      "end_date": null,
      "is_resolved": false,
      "note": "有点痰, 不是很严重",
      "submitted_by": "child",
      "created_at": 1781354161,
      "resolved_at": null
    },
    {
      "id": 38,
      "user_id": 1,
      "event_type": "cough",
      "start_date": "2026-05-28",
      "end_date": "2026-06-05",
      "is_resolved": true,
      "note": null,
      "submitted_by": "pm",
      "created_at": 1781100000,
      "resolved_at": 1781300000
    }
  ]
}
```

**性能要求**：月历查询 < 200ms（实测用本地 D1 + idx_health_events_user_date 索引）

#### 4.2.2 `POST /api/me/health/events`

**用途**：儿子自己打卡

**Auth**：child session（从 session cookie 拿 child user_id）

**Request body**：
```json
{
  "event_type": "cough",
  "start_date": "2026-06-14",       // optional, default=today (Asia/Shanghai)
  "note": "今天开始有点咳嗽"          // optional
}
```

**Behavior**：
1. 校验 event_type ∈ 8 种 hardcode
2. start_date 默认 = today (Asia/Shanghai)
3. INSERT health_events (submitted_by='child', is_resolved=0, end_date=NULL)
4. 写 audit_log (actor='child', action='health_event_create', details=JSON 描述)
5. 返回新 event row

**Response 201**：新 event 对象（同 4.2.1 单个 event shape）

**错误码**：
- 400 INVALID_EVENT_TYPE
- 401 UNAUTHORIZED
- 400 INVALID_DATE_FORMAT (start_date 不是 'YYYY-MM-DD')

#### 4.2.3 `POST /api/admin/health/events`

**用途**：PM 代孩子记录（"孩子昨天吐了，但昨天没打卡"）

**Auth**：pm session

**Request body**：
```json
{
  "user_id": 1,                       // required
  "event_type": "vomit",
  "start_date": "2026-06-13",
  "note": "晚饭后吐了 1 次, 没发烧"
}
```

**Behavior**：
1. 同 4.2.2 校验逻辑
2. user_id 来自 request body（PM 帮任意孩子记录，schema support 多孩）
3. INSERT (submitted_by='pm', actor='pm')
4. 写 audit_log (actor='pm', action='health_event_create')

**Response 201**：新 event 对象

#### 4.2.4 `PATCH /api/admin/health/events/:id/resolve`

**用途**：标记已愈 + 设置 end_date

**Auth**：pm session

**Request body**：
```json
{
  "end_date": "2026-06-20"            // required, 'YYYY-MM-DD', >= start_date
}
```

**Behavior**：
1. 查 event by id
2. 校验：event exists && !is_resolved
3. 校验：end_date >= start_date
4. UPDATE health_events SET end_date=?, is_resolved=1, resolved_at=now, resolved_by=pm_user_id, updated_at=now
5. 写 audit_log (actor='pm', action='health_event_resolve', details=含 end_date)
6. 返回更新后的 event

**Response 200**：更新后的 event 对象

**错误码**：
- 400 INVALID_DATE (end_date < start_date)
- 404 NOT_FOUND
- 409 ALREADY_RESOLVED
- 401 UNAUTHORIZED

### 4.3 原子操作（"又起新" 路径）

前端调 2 个 API 实现"又起新"（避免 1 次 API 干太多事）：
1. PATCH `/api/admin/health/events/:id/resolve` 关闭旧
2. POST `/api/me/health/events` 或 `/api/admin/health/events` 开新

**为什么不让"又起新"成为 1 个 API**：避免后端逻辑复杂（要管理"close 旧 + open 新"原子性），前端简单 2 步就够。失败时前端重试 resolve 已幂等。

### 4.4 不做的 API

- ❌ `DELETE /api/admin/health/events/:id` — PM 硬删不在 v1 范围（已拍板非目标）
- ❌ `PUT /api/admin/health/events/:id` — 不开放修改 event_type / start_date
- ❌ `GET /api/public/health/events/active` — 续接 UX 复用 `GET /api/public/health/events?active_only=true`，不重复造轮子

---

## 5. UX 流程

### 5.1 主 tab + 子 tab 结构

**index.html** 新增（参考现有 4 个 main tab 实现）：

```html
<nav class="tab-bar" role="tablist" aria-label="主导航">
  <button class="tab-btn tab-btn-active" data-tab="tasks" role="tab">✅ 任务</button>
  <button class="tab-btn" data-tab="balance" role="tab">💰 余额</button>
  <button class="tab-btn" data-tab="shop" role="tab">🪙 商店</button>
  <button class="tab-btn" data-tab="health" role="tab" aria-controls="tab-health">
    🏥 健康
  </button>
</nav>

<section id="tab-health" class="tab-pane" role="tabpanel" hidden>
  <div class="health-subtab-bar" role="tablist" aria-label="健康类型">
    <!-- 8 个子 tab, 动态生成 -->
  </div>
  <div class="health-calendar" id="health-calendar">
    <!-- 月历主体, 动态渲染 -->
  </div>
  <button class="btn btn-primary health-checkin-btn" id="health-checkin-btn">
    + 打卡
  </button>
</section>
```

**子 tab 渲染**（app.js 新增）：
```js
function renderHealthSubtabs() {
  const bar = $('.health-subtab-bar');
  HEALTH_EVENT_TYPES.forEach((t, i) => {
    const btn = document.createElement('button');
    btn.className = 'health-subtab' + (i === 0 ? ' health-subtab-active' : '');
    btn.dataset.type = t.type;
    btn.textContent = `${t.emoji} ${t.label}`;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    btn.addEventListener('click', () => switchHealthType(t.type));
    bar.appendChild(btn);
  });
}
```

### 5.2 月历渲染

**每天格子逻辑**：
```js
function renderMonth(year, month, events) {
  // events: API 返回的当月所有 health events
  // 1. 生成日历网格 (6 行 × 7 列)
  // 2. 遍历每天: 若 start_date ≤ date ≤ end_date 或 (start_date = date && end_date IS NULL) → 显示 emoji
  //    - 1 个事件: 显示单个 emoji
  //    - 多事件: 显示最多 3 个 emoji + "+N"
  // 3. 当前日高亮 (background highlight)
  // 4. 点击日期 → 显示该日事件详情 (modal)
}
```

**辅助函数**（复用现有 `src/utils/week.ts`）：
```js
import { shanghaiDateString, todayShanghai } from '../utils/week.ts';

function isDateInEvent(dateStr, event) {
  if (dateStr < event.start_date) return false;
  if (event.end_date == null) return dateStr === event.start_date;
  return dateStr <= event.end_date;
}
```

### 5.3 续接 UX 弹窗

**触发条件**（点击 [+ 打卡] 时）：
1. 取当前子 tab 的 event_type
2. 调 `GET /api/public/health/events?user_id=...&event_type=...&active_only=true`
3. 若返回 events.length > 0 → 弹续接对话框
4. 否则 → 弹新建表单

**续接对话框 UI**：
```html
<div class="modal" id="health-resume-modal" hidden>
  <div class="modal-content">
    <h3>上次{{type_label}} ({{start_date}} 起) 现在怎么样？</h3>
    <button data-action="resolve">已愈</button>
    <button data-action="continue">还在继续</button>
    <button data-action="new">又起新的</button>
  </div>
</div>
```

**"已愈" 点击后** → 弹日期选择器（`<input type="date" min="${start_date}" max="${today}">`）→ 调 PATCH resolve。

**"又起新的" 点击后**：
1. 调 PATCH resolve 旧 (end_date = yesterday)
2. 调 POST 新 (start_date = today)
3. 全部成功 → 关闭弹窗 + 刷新月历

### 5.4 视觉风格

- 复用现有 modal CSS class
- 健康子 tab 用更紧凑的 `font-size: 0.85em` (8 个 tab 横排要 wrap)
- 月历格子大小 = 现有任务日历一致 (32px × 32px)
- emoji 字号 = 18px (跟任务 icon 区分)
- 进行中事件用 `background: rgba(255, 100, 100, 0.1)` 高亮

### 5.5 边界情况 UX

| 场景 | 行为 |
|------|------|
| 用户未登录 | 跳登录页 (现有逻辑) |
| 续接弹窗 → 取消 | 直接关闭弹窗，无操作 |
| 打卡时网络错误 | Toast 提示"打卡失败，请重试"，按钮恢复可点 |
| 月份切换 (前后月) | 调 API 重新拉数据，loading skeleton |
| 多孩 (schema support) | v1 只用 user_id=1 (单孩)，但 UI 要 ready to support N kids |
| 8 个子 tab 在窄屏 | 横向滚动 + sticky 当前 tab |

---

## 6. 实施拆解（M1-M4）

### 6.1 M1: 后端基础（migration + 4 API）

**Owner**: Code Agent
**时间估计**: 60-80 min
**Commit 数量**: 1 个 atomic commit

**交付物**：
1. `migrations/0008_health_events.sql`（§3.1 SQL 完整 spec）
2. `src/db/types.ts` 扩展 `HealthEventType` / `HealthEvent` / `AuditAction`
3. `src/utils/health-events.ts` 通用 query helper（可选，减少路由文件重复）
4. `src/routes/public/health.ts` (GET endpoint)
5. `src/routes/me/health.ts` (POST endpoint)
6. `src/routes/admin/health.ts` (POST + PATCH resolve endpoints)
7. `src/worker.ts` 挂载 3 个新路由

**验收**（PM 委派 qual-agent 验证）：
- typecheck pass (`npx tsc --noEmit`)
- 单测: 8 种 type INSERT/QUERY 正确，end_date IS NULL 过滤正确
- e2e: curl 4 个 endpoint 拿到正确 status + body

**🚫 M1 不做**：前端 UI、续接弹窗、sub tab、月历渲染

### 6.2 M2: 前端 tab + 月历 + 子 tab

**Owner**: Code Agent (前端逻辑) + Designer (视觉, 如需要)
**时间估计**: 60-90 min
**Commit 数量**: 1 个前端 commit

**交付物**：
1. `public/index.html` 新增 `<section id="tab-health">` 骨架
2. `public/app.css` 新增 `.health-subtab-bar` / `.health-calendar` / `.health-checkin-btn` 样式
3. `public/app.js` 新增：
   - `HEALTH_EVENT_TYPES` 常量
   - `renderHealthSubtabs()` / `switchHealthType()`
   - `renderHealthCalendar(year, month)`
   - `loadHealthEvents(user_id, type, month)` (调 API)
   - `state.health` 状态 (active_type, current_month)

**验收**：
- 切到健康 tab → 8 个子 tab 显示
- 点溃疡子 tab → 显示 6/14 月历 (空)
- 调 API (wrangler dev) 拿 mock 数据 → 月历格子显示 emoji
- 视觉验证: PM 用 tunnel 截图给 feihao 看

**🚫 M2 不做**：打卡按钮逻辑、续接弹窗

### 6.3 M3: 续接 UX 弹窗 + 打卡流程

**Owner**: Code Agent
**时间估计**: 45-60 min
**Commit 数量**: 1 个前端 commit

**交付物**：
1. `public/index.html` 新增 `#health-resume-modal` + `#health-checkin-form` 弹窗
2. `public/app.js` 新增：
   - `onCheckinClick()` 入口
   - `showResumeDialog(activeEvent)` / `showNewEventForm(type)`
   - `doResolve(eventId, endDate)` (调 PATCH)
   - `doCreate(type, startDate, note)` (调 POST)
   - `doStartNew(oldEventId)` (PATCH + POST 链式)
3. 错误处理: Toast + 重试

**验收**：
- 无 active → 直接弹新建表单 → 提交 → 月历刷新
- 有 1 active → 弹续接对话框 → 3 按钮各自走通
- "已愈" 弹日期选择器 → 选今天 → 月历刷新 (active 消失)
- "又起新的" 链式操作成功 → 旧 active 消失 + 新 active 出现

**🚫 M3 不做**：PM 后台 manage 页（删除/编辑）

### 6.4 M4: seed 数据 + tunnel 视觉验证 + GitHub PR + Deploy

**Owner**: PM Agent
**时间估计**: 30-45 min

**交付物**：
1. Migrations seed data: 2-3 条样例 health events (e.g. 1 active 溃疡 + 1 resolved 咳嗽)
2. tunnel 部署 + 截图给 feihao 看 8 个子 tab + 月历
3. `docs/PRD.md` 更新: 加 health-checkin 章节
4. `docs/FEATURE_MATRIX.md` 更新: 标记 health-checkin shipped
5. GitHub PR (feat/health-checkin → main)
6. Deploy: 跟 coin-system 同款 wrangler pages deploy SOP
7. (可选) qual-agent 跑 e2e spec 覆盖 happy path

---

## 7. 风险与边界 case

### 7.1 已知风险

| 风险 | 缓解措施 |
|------|----------|
| D1 ALTER TABLE 失败（重建表模式） | M1 migration 用 `CREATE new + INSERT SELECT + DROP + RENAME` 模式 (参考 0007_coin_system.sql) |
| 月份切换 API 调用频繁 | 缓存当前月数据 + 30 秒内重复查询不重新拉 |
| 续接弹窗 active 检测漏检 | 用 `end_date IS NULL` 作 SOT，索引确保 < 50ms |
| 多孩 schema 误用 user_id=0 | 默认 child user_id=1 (现有 setup)，hardcode 可接受 |
| start_date 跨月 | 业务允许，UI 月历需正确处理"事件跨多个月"（格子 emoji 拼接） |
| 时间不用 timestamp 用 date string | 复用 `shanghaiDateString()` helper，避免时区问题 |

### 7.2 边界 case 处理

| 场景 | 处理 |
|------|------|
| end_date < start_date | 400 INVALID_DATE |
| end_date = start_date | 允许（单日事件） |
| end_date = future (今天之后) | 允许（提前标记已愈），但 UI 默认 max=today |
| 重复打卡同 type 同 start_date | 允许（一天可以 1 次以上），月历格子多 emoji 拼接 |
| PM 硬删 (v1 不做) | 404，提示"v1 不支持" |
| 修改 event_type / start_date | 404，提示"v1 不支持" |
| 并发 2 个 active 事件同 type | 允许（业务上"又起新的"会产生短时间 2 active），UI 月历正常显示 |
| user 不存在 | 404 USER_NOT_FOUND |
| 8 种之外的 event_type | 400 INVALID_EVENT_TYPE |

### 7.3 跟现有 system 兼容性

- ✅ `score_events` 表不动
- ✅ `task_completions` 表不动
- ✅ `audit_log` 表不动（仅扩展 AuditAction enum）
- ✅ `balance` 计算不引用 health_events
- ✅ 现有 4 个主 tab UI 不动
- ⚠️ `users` 表不动（v1 假设 user_id=1，schema 已支持多孩不需改）

---

## 8. 验收标准

### 8.1 实施验收 (M1-M4 完成时)

**M1 验收**：
- [ ] Migration apply 成功（本地 D1 + remote D1）
- [ ] 4 个 endpoint curl 测试通过（无 5xx 错误）
- [ ] typecheck 0 error
- [ ] audit_log 正确写入 3 个 action

**M2 验收**：
- [ ] 健康 tab 切到时显示 8 个子 tab
- [ ] 月历正确渲染 6/14 (空月)
- [ ] API 集成 (调用 `loadHealthEvents` 不报错)
- [ ] 视觉：emoji 清晰可读，子 tab 切换流畅

**M3 验收**：
- [ ] 3 续接场景都走通 (无 active / 1 active / "又起新")
- [ ] 错误处理: 网络错、参数错都有 toast 提示
- [ ] 月历刷新后新事件立刻可见

**M4 验收**：
- [ ] Seed data 2-3 条样例事件
- [ ] Tunnel 部署成功
- [ ] feihao 视觉确认 8 个子 tab + 月历 OK
- [ ] GitHub PR opened
- [ ] Production deploy 成功
- [ ] docs/PRD.md + FEATURE_MATRIX.md 更新

### 8.2 产品验收 (User sign-off)

- [ ] 健康 tab 显示在主页 4 个主 tab 之一
- [ ] 8 个子 tab 都能切换
- [ ] 打卡流程 1 次走通
- [ ] 续接弹窗 3 选项行为符合预期
- [ ] 月历 emoji 视觉清晰
- [ ] 不影响现有 🎮/💰/🪙 余额

---

## 9. 未来扩展（v2+ 路线图，不在本次实施范围）

- v2: PM 后台 health event 编辑/硬删页
- v2: 月发烧次数统计图（趋势可视化）
- v2: "最近一次 XXX"提醒（"上次咳嗽已 7 天"）
- v2: 9+ 种 event_type (PM 后台配置)
- v3: 医生/医院关联字段
- v3: 批量导入历史数据
- v3: 推送通知 (Web Push API)

---

## 10. 附录

### 10.1 关键文件清单

| 文件 | 状态 | Owner |
|------|------|-------|
| `docs/rfc/health-checkin.md` | 本文档 | PM |
| `migrations/0008_health_events.sql` | M1 新增 | CC |
| `src/db/types.ts` | M1 扩展 | CC |
| `src/utils/health-events.ts` | M1 新增 (可选) | CC |
| `src/routes/public/health.ts` | M1 新增 | CC |
| `src/routes/me/health.ts` | M1 新增 | CC |
| `src/routes/admin/health.ts` | M1 新增 | CC |
| `src/worker.ts` | M1 修改 (挂载路由) | CC |
| `public/index.html` | M2 + M3 修改 | CC |
| `public/app.css` | M2 + M3 新增样式 | CC |
| `public/app.js` | M2 + M3 新增逻辑 | CC |
| `docs/PRD.md` | M4 更新 | PM |
| `docs/FEATURE_MATRIX.md` | M4 更新 | PM |

### 10.2 参考资料

- `docs/coin-system-rfc.md` — Coin System RFC (Module 7 实战参考, 1527 行)
- `migrations/0007_coin_system.sql` — Migration 重建表模式 (Module 7)
- `src/db/types.ts` — TypeScript types + AuditAction enum 扩展模式
- `src/routes/admin/events.ts` — Hono route + db.batch() + audit_log 模式
- `src/utils/week.ts` — Shanghai 时区 date helper (复用 shanghaiDateString)

### 10.3 拍板记录

- 2026-06-13: D1-D8 全部拍板（健康打卡功能需求对齐）
- 2026-06-13: 数据模型选型（日期范围 vs 单点 timestamp，feihao 选日期范围）
- 2026-06-13: 续接 UX 3 选项（已愈/还在继续/又起新，feihao 确认）
- 2026-06-14: RFC 存放位置拍板（`docs/rfc/health-checkin.md`，随 branch 进 PR）
- 2026-06-14: M1 推进节奏拍板（一次走完 RFC + M1，CC 写 M1，PM 验证）

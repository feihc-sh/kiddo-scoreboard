# 儿子计分板 (Kiddo Scoreboard) — 实施 Plan (v2, CC 审核后)

> **For Hermes PM:** 已应用 CC 审核反馈（5 P0 + 关键 P1）。
> **For Code Agent:** 实施前必须加载 `karpathy-guidelines` skill + 遵循 TDD 流程。

**项目代号:** `kiddo-scoreboard`（暂定）
**目标:** 给儿子用的 Web PWA 计分板，支持奖励/扣分管理，含审批流、完整 log、PM 可撤销。
**架构:** Cloudflare Workers（**单 Worker 同时托管前后端**）+ D1 SQLite + Workers Static Assets
**技术栈:** Vanilla HTML/CSS/JS + Hono（Workers 框架）+ Wrangler（部署）+ Vitest + Miniflare（测试）

---

## 1. 背景与决策摘要

### 1.1 业务需求
- **使用者**: 儿子（iPad 前台）+ 爸爸/PM（后台管理）
- **计分维度**:
  1. 游戏时间（分钟）— 第一版核心
  2. 零花钱（元）— 数据模型预留，UI 暂不展示
- **扣分规则**:
  1. 晚睡 1 分钟 → 扣 1 分钟游戏时间
  2. 偷偷玩游戏超 1 分钟 → 扣 1 分钟游戏时间
- **奖励机制**:
  - 每周 60 分钟游戏时间（周末 2 天 × 30 分钟/天）= "发工资"
  - 累计扣分从奖励中扣除
- **痛点**: 纸面记录混乱，需清晰数字 log

### 1.2 已确认决策
| 决策点 | 选定方案 |
|--------|----------|
| 平台 | Web PWA（iPad Safari 打开）|
| 审批模式 | 儿子提交申请 → PM 审批通过才生效 |
| 零花钱 | 第一版只做游戏时间，预留数据模型 |
| 数据存储 | Cloudflare D1（SQLite）|
| 儿子设备 | iPad |
| 时区/周编号 | Asia/Shanghai + ISO 8601 周编号 `YYYY-Www` |
| 改名 | 儿子可自己改名字（"仪式感" UI）|
| 入口分离 | PM `/admin/*` + 儿子 `/`（**强制路由守卫**）|
| 微信小程序 | 砍掉 Phase 5（PWA "添加到主屏" 已给 95% 原生体验）|
| 离线功能 | 砍掉（YAGNI，联网才用）|

---

## 2. 数据模型（D1 SQLite Schema）

### 2.1 核心设计原则
- **单数据源**: 周额度也是 `score_events` 的一种（`submitted_by='pm'` + `reason='week_grant'` + `status='approved'`），**没有单独的 `weekly_allowance` 表**（CC 反馈 P0-1：避免双写不一致）
- **软撤销**: 撤销不删除记录，状态改 `revoked`（保留审计）
- **时区统一**: 全部 `unixepoch()` 存储，UI 层用 `Asia/Shanghai` 渲染

### 2.2 Schema

```sql
-- 用户表（暂时只有儿子 + PM 两个角色）
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,           -- 儿子可自己改，PM 端也能改
  role TEXT NOT NULL CHECK(role IN ('child', 'pm')),
  pin_hash TEXT,                -- PM 登录用，bcrypt
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- 核心事件表（所有加减分都在这一张表）
CREATE TABLE score_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('game_time', 'pocket_money')),
  change_value INTEGER NOT NULL,    -- 正数=奖, 负数=扣
  reason TEXT NOT NULL,            -- "晚睡30分钟" / "周末发工资" / "周额度发放(自动)"
  status TEXT NOT NULL DEFAULT 'pending' 
    CHECK(status IN ('pending', 'approved', 'rejected', 'revoked')),
  submitted_by TEXT NOT NULL CHECK(submitted_by IN ('child', 'pm', 'system')),
  reviewed_by INTEGER,             -- PM user_id
  reviewed_at INTEGER,
  week_of TEXT,                    -- YYYY-Www (ISO 8601)，用于周额度对齐
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_events_user_type_status 
  ON score_events(user_id, type, status);
CREATE INDEX idx_events_created 
  ON score_events(created_at DESC);
CREATE INDEX idx_events_week 
  ON score_events(user_id, week_of);

-- 审计 log（所有写操作都记录）
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,             -- 'child:<user_id>' | 'pm:<user_id>' | 'system'
  action TEXT NOT NULL,            -- 'submit' | 'approve' | 'reject' | 'revoke' | 'edit' | 'rename' | 'login' | 'logout'
  target_event_id INTEGER,
  details TEXT,                    -- JSON
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX idx_audit_actor ON audit_log(actor, created_at DESC);
```

### 2.3 余额计算（运行时聚合，**不用视图**）
```sql
-- 当前余额
SELECT 
  type,
  SUM(CASE WHEN status = 'approved' THEN change_value ELSE 0 END) AS balance
FROM score_events
WHERE user_id = ?
GROUP BY type;
```

### 2.4 周额度发放实现
PM 点击"发放周额度" → 服务端创建一个特殊 event：
```json
{
  "user_id": 1,
  "type": "game_time",
  "change_value": 60,
  "reason": "周额度发放 (2026-W23)",
  "status": "approved",          // 直接 approved，不需审批
  "submitted_by": "pm",
  "reviewed_by": 1,
  "week_of": "2026-W23"
}
```
**没有单独的 weekly_allowance 表**，避免双写不一致。

---

## 3. API 端点设计

### 3.1 路由前缀约定（关键！CC 反馈 P0-4）
```
/api/public/*      -- 公开端点（儿子端 + PM 端共用，只读）
/api/me/*          -- 儿子端写操作
/api/admin/*       -- PM 端写操作（**强制 session 校验，401 直接拒绝**）
```

### 3.2 端点清单

#### 公开读（不需登录）
```
GET  /api/public/balance?user_id=1        -- 余额
GET  /api/public/events?user_id=1&status=&type=&limit=50  -- 事件列表
GET  /api/public/events/:id               -- 单个事件详情
GET  /api/public/user/:id                 -- 用户信息（含可改的名字）
```

#### 儿子端写
```
POST /api/me/events                       -- 提交申请
  Body: { type, change_value, reason }
  Returns: { id, status: 'pending' }

PATCH /api/me/profile                     -- 改自己的名字（CC 反馈 P0-3 + 用户仪式感）
  Body: { name }
  Returns: { id, name, updated_at }
```

#### PM 端写（强制登录）
```
POST /api/admin/auth/login                -- PIN 码登录
  Body: { pin }
  Returns: { user: {id, name, role}, session_cookie_set }
  Cookie: Set-Cookie: pm_session=<jwt>; HttpOnly; Secure; SameSite=Strict

POST /api/admin/auth/logout

POST /api/admin/events/:id/approve        -- 审批通过
POST /api/admin/events/:id/reject         -- 拒绝
POST /api/admin/events/:id/revoke         -- 撤销
PUT  /api/admin/events/:id                -- 直接编辑（reason / value）

POST /api/admin/weekly-grant              -- 发放周额度（创建 approved event）
  Body: { user_id, week_of, game_time_minutes?, pocket_money_cents? }

PATCH /api/admin/users/:id                -- PM 改儿子名字（强制）
```

#### 审计（PM 端只读）
```
GET  /api/admin/audit-log?limit=100&actor= -- 审计 log
```

### 3.3 认证方案（CC 反馈 P1）
- **Cookie-based session**：HttpOnly + Secure + SameSite=Strict
- **JWT** 存 session token（HS256，secret 在 Workers env）
- **PIN 错误锁定**：连续 5 次错误锁 5 分钟
- **API 路由守卫**：Hono 中间件统一校验 `/api/admin/*` 路径

### 3.4 错误响应规范
```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "PM session required"
  }
}
```

---

## 4. 前端页面设计

### 4.1 路由结构（**强制分离**）
```
/                  -- 儿子端（公开，无需登录）
/admin             -- PM 端（强制登录，跳转 /admin/login）

/admin/login       -- PIN 码输入
/admin             -- 待审批列表
/admin/events      -- 全部事件
/admin/events/:id  -- 事件详情 + 编辑
/admin/audit       -- 审计 log
/admin/grant       -- 发放周额度
```

### 4.2 儿子端（`/`）
- **布局**（iPad 横屏）:
  - 顶部：余额大字（🎮 游戏时间 **45** 分钟）
  - 右上角：「改我的名字」按钮 → 弹出输入框 + 彩纸动画（**仪式感**）
  - 中部：「提交申请」按钮
    - 类型下拉：扣游戏时间 / 奖游戏时间
    - 数量输入
    - 原因输入（必填）
  - 下部：最近 20 条 log（带状态徽章）

### 4.3 PM 端（`/admin`）
- 待审批：醒目的 N 条卡片，每条有"通过/拒绝"按钮
- 全部事件：表格 + 筛选（状态/类型/时间）
- 审计 log：时间线视图
- 周额度发放：选择周编号 + 输入金额

### 4.4 设计风格
- 字号大（iPad 触摸）
- 颜色：游戏时间绿色、零花钱金色、扣分红色
- 状态徽章：待审批=灰、已通过=绿、已拒绝=红、已撤销=橙

---

## 5. 部署架构（**单 Worker 合并，CC 反馈 P1**）

```
GitHub Repo: feihc-sh/kiddo-scoreboard
   ↓ (git push)
Wrangler 直接部署
   ↓
┌────────────────────────────────────────┐
│  Cloudflare Worker (kiddo-scoreboard) │
│  ┌──────────────────┐                 │
│  │  Static Assets   │  ←  /index.html, /admin.html, /app.js
│  │  (前端)          │
│  └──────────────────┘                 │
│  ┌──────────────────┐                 │
│  │  Hono Router     │  ←  /api/public/*, /api/me/*, /api/admin/*
│  │  (后端 API)      │
│  └──────────────────┘                 │
│  ┌──────────────────┐                 │
│  │  D1 Binding      │  ←  SQLite
│  └──────────────────┘                 │
└────────────────────────────────────────┘
```

**收益**:
- 零 CORS（同域）
- 一个部署命令
- 零额外费用（Workers Static Assets 免费）

**域名**: `kiddo-scoreboard.<account>.workers.dev`（默认）

---

## 6. 开发阶段（Kanban 任务清单）

### 🚪 Phase Gate 0: PRD + Demo（**用户确认 gate**）
> 用户明确要求：先看 PRD + Demo → 确认 → 才补代码
- [ ] **G0.1** 写 PRD 文档（11 章，见 §7）
- [ ] **G0.2** Code Agent 写 demo HTML（单文件，~400 行，mock 数据）
- [ ] **G0.3** 本地启动 demo，截图/录屏给用户看
- [ ] **G0.4** 用户拍板确认 → 解锁 Phase 1

### 🚀 Phase 1: 项目脚手架（30 min）
- [ ] **T1.1** `gh auth login` 或手工创建 GitHub repo `feihc-sh/kiddo-scoreboard`
- [ ] **T1.2** 本地 clone 到 `~/workspace/kiddo-scoreboard`
- [ ] **T1.3** 初始化 `package.json` + `wrangler.toml`
- [ ] **T1.4** 创建 D1 database（`wrangler d1 create kiddo-scoreboard-db`）
- [ ] **T1.5** 写 `schema.sql`（3 张表 + 索引）
- [ ] **T1.6** 初始化 Hono + Workers 项目骨架
- [ ] **T1.7** 写 `README.md`（含部署说明 + PM PIN 初始值）

### 🗄️ Phase 2: 后端 TDD（Qual 先写测试 → Code 实现）

> **TDD 流程**: 每个 API 端点先 Qual 写 Vitest 测试（FAIL）→ Code 实现（PASS）→ Refactor → Commit
> **测试栈**: Vitest + `@cloudflare/vitest-pool-workers`（Cloudflare 官方推荐）

| 端点 | 测试文件 | 覆盖 case |
|------|----------|-----------|
| `GET /api/public/balance` | `tests/api/balance.test.ts` | 正常、空数据、多类型 |
| `GET /api/public/events` | `tests/api/events-list.test.ts` | 筛选、分页、状态过滤 |
| `POST /api/me/events` | `tests/api/submit.test.ts` | 正常、缺字段、负数 |
| `PATCH /api/me/profile` | `tests/api/rename.test.ts` | 正常、空名、超长 |
| `POST /api/admin/auth/login` | `tests/api/login.test.ts` | 正确、错误、锁定 |
| `POST /api/admin/events/:id/approve` | `tests/api/approve.test.ts` | 正常、已通过、二次审批 |
| `POST /api/admin/events/:id/reject` | `tests/api/reject.test.ts` | 正常、已拒绝 |
| `POST /api/admin/events/:id/revoke` | `tests/api/revoke.test.ts` | 正常、已撤销、撤销后审计 |
| `PUT /api/admin/events/:id` | `tests/api/edit-event.test.ts` | 修改 reason / value |
| `POST /api/admin/weekly-grant` | `tests/api/weekly-grant.test.ts` | 正常、重复发放（幂等）|
| `GET /api/admin/audit-log` | `tests/api/audit-log.test.ts` | 列表、actor 筛选 |
| **路由守卫** | `tests/api/admin-auth-guard.test.ts` | 未登录 401、儿子 token 401 |

**验收**: `npm test` 全绿，覆盖率 >80%

### 🎨 Phase 3: 儿子端 UI（1-1.5 h）
- [ ] **T3.1** 静态 HTML 骨架 + 余额组件
- [ ] **T3.2** 提交申请弹窗 + 表单
- [ ] **T3.3** 事件 log 列表（带状态徽章）
- [ ] **T3.4** **改名 UI**（输入框 + 彩纸动画）
- [ ] **T3.5** iPad 触摸优化
- [ ] **T3.6** Playwright e2e：提交流程（可选，CC 建议）

### 👨‍💼 Phase 4: PM 端 UI（1.5-2 h）
- [ ] **T4.1** 登录页 + 路由守卫
- [ ] **T4.2** 待审批列表（卡片 + 通过/拒绝按钮）
- [ ] **T4.3** 全部事件列表（表格 + 筛选）
- [ ] **T4.4** 事件详情 + 编辑/撤销
- [ ] **T4.5** 审计 log 时间线
- [ ] **T4.6** 周额度发放页
- [ ] **T4.7** Playwright e2e：审批流程

### 🚢 Phase 5: 部署 + 真机测试（30 min）
- [ ] **T5.1** Wrangler 部署 + D1 migration
- [ ] **T5.2** 初始化 PM PIN（脚本 + 文档）
- [ ] **T5.3** 初始化儿子账号（默认名"儿子"）
- [ ] **T5.4** iPad Safari 真机测试（端到端）
- [ ] **T5.5** PWA "添加到主屏" 测试
- [ ] **T5.6** 写部署文档 + 故障排查
- [ ] **T5.7** 数据导出 JSON 备份脚本

### 🔁 Phase 6: 迭代（用户使用后收集反馈）
- [ ] **T6.1** 零花钱维度上线
- [ ] **T6.2** 周额度自动发放（cron）
- [ ] **T6.3** 通知推送（可选）

---

## 7. PRD 文档大纲（11 章）

> 输出位置: `docs/PRD.md`

1. **项目背景** — 为什么做、解决什么痛点
2. **用户角色** — 儿子 / PM 的能力边界
3. **业务规则** — 扣分/奖励的具体规则、边界 case
4. **计分维度** — 游戏时间/零花钱的定义、单位
5. **交互流程** — 4 个核心流程的状态机图
6. **数据模型** — ER 图 + 字段说明
7. **API 设计** — 端点清单 + 请求/响应示例
8. **状态机** — score_event 状态转换图
9. **安全考虑** — PIN 锁定、路由守卫、审计不可篡改
10. **验收标准** — 功能验收清单（PM 拍板用）
11. **未来扩展** — 零花钱/通知/多用户/数据导出

---

## 8. Demo 网页设计（CC 建议）

### 8.1 实现规格
- **单文件 HTML**：~400 行，0 后端依赖
- **2 个 tab**：儿子端 / PM 端
- **Mock 数据**：3-5 条示例 events + 2 个用户
- **可点击交互**：提交流程跑通（仅前端，不持久化）
- **彩纸动画**：改名时触发（仪式感）

### 8.2 Demo 必须展示的功能
1. 儿子端余额显示
2. 儿子端提交申请
3. 儿子端改名字（彩纸动画）
4. PM 端待审批列表
5. PM 端审批通过/拒绝
6. PM 端审计 log
7. PM 端周额度发放

### 8.3 验收标准
- 用户看完 demo 后能直接说出"对，就是这个感觉"
- 用户能指出 demo 哪里和他想象的不一样

---

## 9. 测试策略

### 9.1 单元测试（**后端强制，前端业务逻辑**）
- **栈**: Vitest + `@cloudflare/vitest-pool-workers`（Cloudflare 官方）
- **覆盖率**: >80%，核心逻辑 100%
- **每个端点**: 正常路径 + 边界 case + 错误处理

### 9.2 E2E 测试（**前端关键流程**）
- **栈**: Playwright
- **覆盖**: 提交流程、审批流程、改名流程

### 9.3 集成测试
- 端到端：儿子提交 → DB pending → PM 审批 → DB approved → 余额更新
- 软撤销：撤销后余额回滚但记录保留

### 9.4 真机测试
- iPad Safari 全流程
- Chrome/Safari 兼容性
- 触摸交互

### 9.5 安全测试
- PIN 错误锁定
- `/api/admin/*` 未登录 401
- SQL 注入（用 D1 预编译参数化）

---

## 10. 风险与权衡

### 10.1 已识别风险（CC 反馈）
| 风险 | 缓解 |
|------|------|
| `weekly_allowance` 双写不一致 | **已修复**：删除该表，周额度用 score_event 表达 |
| 时区/WW 编号混乱 | **已规范**：Asia/Shanghai + ISO 8601 |
| 儿子绕过 PIN 改 PM 端 | **已修复**：路由守卫 + session cookie httpOnly |
| 离线数据不一致 | **已砍掉**：纯在线应用 |
| 微信小程序迁移工作量大 | **已砍掉 Phase 5**：PWA 已够用 |
| 改名功能缺仪式感 | **已补**：彩纸动画 + 仪式感 UI |
| Workers Static Assets GA 状态 | **待 Phase 1 时确认语法** |

### 10.2 YAGNI 边界（明确不做的）
- ❌ 复杂动画/音效（彩纸动画除外）
- ❌ 多用户/多角色（1 儿子 + 1 PM）
- ❌ 通知推送（PM 自己每天打开看）
- ❌ 数据可视化图表
- ❌ 国际化（先中文）
- ❌ 离线缓存
- ❌ 微信小程序（至少 v1 不做）

---

## 11. 决策已定时，立即执行

用户回复"开干 PRD+Demo"后，PM Agent 将：
1. 更新 todo list
2. 写 PRD 文档 → `docs/PRD.md`
3. 委派 Code Agent 写 demo HTML
4. 验收 demo，本地启动
5. 把 PRD + demo 链接给用户确认
6. 用户拍板 → 解锁 Phase 1-5 的 TDD 开发

按 PM 工作流：每个里程碑更新 `PROJECT_LOG.md`，每个任务流转更新 `WORK_LOG.md`。

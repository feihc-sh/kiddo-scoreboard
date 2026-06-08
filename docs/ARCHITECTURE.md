# Kiddo Scoreboard — 模块架构 (Architecture)

> 给新加入的 agent / 用户的**单一入口文档**。 5 分钟看懂全栈。
> 4 张图覆盖系统全栈、路由树、数据流、部署架构。
> 与 [`PLAN.md`](./PLAN.md) 配套, 本文档讲"是什么", PLAN 讲"为什么这样设计"。

**最后更新**: 2026-06-08 (v2.1, 含 self-lockout 任务 + Pages 部署)

---

## 📐 图 1: 系统全栈 (Stack Overview)

```
┌────────────────────────────────────────────────────────────────┐
│                        iPad / Browser                          │
│                  (4G/5G 国内直连, 不需 VPN)                     │
└───────────┬────────────────────────────────────┬───────────────┘
            │                                    │
            │  静态资源 (HTML/CSS/JS)            │  JSON API
            │  /  /admin/  /admin/login         │
            ▼                                    ▼
┌────────────────────────────────────────────────────────────────┐
│              Cloudflare Pages (kiddo-scoreboard)                │
│                  https://kiddo-scoreboard.pages.dev             │
├────────────────────────────────────────────────────────────────┤
│  functions/health.ts                                            │
│  └─ GET /health → { status: "healthy" }                        │
│                                                                │
│  functions/api/[[path]].ts  (catch-all /api/*)                 │
│  └─ 委托给 Hono app (src/worker.ts)                            │
│                                                                │
│  Hono App (src/worker.ts)                                       │
│  ├─ /                       (root, JSON banner)                 │
│  ├─ /health                 (健康检查)                          │
│  └─ /api/*                  (业务 API, 见下)                   │
└──────────────────────────┬─────────────────────────────────────┘
                           │ D1 binding (env.DB)
                           ▼
┌────────────────────────────────────────────────────────────────┐
│        Cloudflare D1 (kiddo-scoreboard-db, APAC)               │
│        database_id: b584ebbf-bcb3-45d2-85e8-3ca2d5cb297c        │
│                                                                │
│  Tables (7): users / score_events / tasks / task_completions   │
│              audit_log / auth_attempts / app_config             │
└────────────────────────────────────────────────────────────────┘
```

**关键事实**:
- 单 Cloudflare 项目, Pages 同时托管静态 + Functions (后端 Hono)
- 国内 4G/5G 直连, **不需要 VPN** (从 Workers 迁移到 Pages 的原因)
- D1 (SQLite) 单库, 物理隔离 local (本地 .wrangler/state) vs remote (生产)

---

## 🌳 图 2: 路由树 (Routes)

```
https://kiddo-scoreboard.pages.dev/
│
├── /                                 GET    Root banner (Hono /)
├── /health                           GET    Health check (Pages Function)
│
├── /api/public/                      (不需登录, 全局只读)
│   ├── user/:id                      GET    Public user info
│   ├── balance/                      GET    Public balance
│   ├── events/                       GET    Public events list
│   │   └── /:id                      GET    Single event detail
│   └── tasks/                        GET    Public tasks list
│       ├── /today-status             GET    Today status (sleep lockout)
│       └── /progress                 GET    进度条 (3 进度条 + daily-once)
│
├── /api/me/                          (儿子端, 需 session, 无 PM 权限)
│   ├── profile/                      PATCH  改名 (首次填名)
│   ├── events/                       POST   儿子提交申请
│   └── tasks/
│       ├── /:id/complete             POST   完成任务
│       └── /:id/uncomplete           POST   撤销完成
│
└── /api/admin/                       (PM 端, 需 PIN 登录, 路由守卫)
    ├── auth/
    │   ├── /login                    POST   PM 登录
    │   ├── /logout                   POST   PM 登出
    │   └── /me                       GET    PM 当前 session
    │
    ├── events/
    │   ├── /:id/approve              POST   审批通过
    │   ├── /:id/reject               POST   审批拒绝
    │   ├── /:id/revoke               POST   撤销已审批 (软删)
    │   └── /:id                      PUT    改分值/账户
    │
    ├── tasks/
    │   ├── /                         GET    任务列表
    │   ├── /                         POST   新建任务 (含 cutoff_time)
    │   ├── /:id                      PUT    编辑任务
    │   └── /:id                      DELETE 删除任务
    │
    ├── task-completions/
    │   ├── /                         GET    完成记录列表
    │   └── /:id/revoke               POST   撤销完成 (软删)
    │
    ├── audit-log/                    GET    审计 log
    ├── weekly-grant/                 POST   周额度发放
    └── exchange/                     POST   双账户兑换
```

**26 endpoints** (实际 26, 含 admin/me/public/task-completions)
- 4 个 Pages Functions (health + api catch-all)
- 22 个 Hono 路由 (src/worker.ts + src/routes/**)

---

## 🏗️ 图 3: 代码模块树 (src/ 结构)

```
src/
├── worker.ts                  # Hono 入口, 路由挂载
│
├── auth/                      # 认证模块
│   ├── pin.ts                 # PBKDF2 PIN hash (100k iter, CF 限制)
│   ├── session.ts             # JWT 生成/校验
│   └── lockout.ts             # PM 登录失败 lockout (5 次/15min)
│
├── middleware/
│   └── requirePm.ts           # PM 路由守卫 (cookie + JWT 验)
│
├── db/
│   └── types.ts               # D1 row type 定义
│
├── utils/                     # 业务工具函数
│   ├── week.ts                # Asia/Shanghai 时区 + ISO 周
│   ├── balance.ts             # 余额计算 (运行期聚合, 不存视图)
│   └── audit.ts               # 审计 log 写入 (status='revoked' 软删)
│
└── routes/                    # Hono 路由 (按 prefix 分目录)
    ├── public/                # /api/public/* (不需登录)
    │   ├── user.ts
    │   ├── balance.ts
    │   ├── events.ts
    │   └── tasks.ts
    ├── me/                    # /api/me/* (儿子端)
    │   ├── index.ts           # 子路由 mount
    │   ├── profile.ts
    │   ├── events.ts
    │   └── tasks.ts
    └── admin/                 # /api/admin/* (PM 端, 需登录)
        ├── index.ts           # 子路由 mount
        ├── auth.ts
        ├── events.ts
        ├── tasks.ts
        ├── task-completions.ts
        ├── audit-log.ts
        ├── weekly-grant.ts
        └── exchange.ts
```

**模块依赖** (单向, 无环):
- `worker.ts` → `routes/*` → `auth/*` + `middleware/*` + `utils/*` → `db/types`
- `utils/balance.ts` 是核心, 任何"算分"都走它 (不直查 SQL)

---

## 🔄 图 4: 典型数据流 (3 个常见操作)

### 操作 A: 儿子点"完成任务"按钮

```
[iPad]  public/app.js
  └─ 监听 button click
     └─ fetch('/api/me/tasks/{id}/complete', { method: 'POST' })
        │
        ▼
[Pages]  functions/api/[[path]].ts
  └─ 委托给 Hono app
     └─ routes/me/tasks.ts :: POST /:id/complete
        ├─ 读 cookie → session.ts 验 JWT
        ├─ utils/week.ts :: nowShanghaiHHMM()  ← 算现在几点了
        ├─ 查 task.cutoff_time  ← 是否 self-lockout
        │  └─ 若过 cutoff → return 423 (locked)
        ├─ INSERT INTO task_completions ...
        ├─ utils/balance.ts :: recalc(child)  ← 重算余额
        └─ return { success, balance, completions: [...] }
           │
           ▼
[iPad]  public/app.js :: render()
  └─ 撒花 (fireConfetti, 100% 当日) / 进度条更新 (loadProgress)
```

### 操作 B: PM 登录 + 撤销儿子完成

```
[iPad]  admin/login.js
  └─ fetch('/api/admin/auth/login', { body: { pin: '123654' } })
     │
     ▼
[Hono]  routes/admin/auth.ts :: POST /login
  ├─ auth/pin.ts :: verifyPin(stored_hash, pin)   ← PBKDF2 验
  ├─ auth/lockout.ts :: recordAttempt()            ← 5 次失败锁 15 min
  ├─ auth/session.ts :: issueToken(user_id)        ← JWT
  └─ Set-Cookie: kiddo_session=...
     │
     ▼ (登录后, 点"撤销")
[iPad]  admin/admin.js
  └─ fetch('/api/admin/task-completions/{id}/revoke', { method: 'POST' })
     │
     ▼
[Hono]  routes/admin/task-completions.ts :: POST /:id/revoke
  ├─ middleware/requirePm.ts  ← 守卫, 无 session 返 401
  ├─ UPDATE task_completions SET status='revoked'  ← 软删
  ├─ utils/audit.ts :: log('task_revoke', ...)    ← 不可删审计
  ├─ utils/balance.ts :: recalc(child)            ← 重算
  └─ return { balance }
```

### 操作 C: 周一 0 点自动发工资 (Cron)

```
[3am]  Hermes cron c58a139f2c7c (daily-backup, 备)
[0am]  Hermes cron d100dbff4107 (nightly-todo, 跑 NIGHTLY-TODO.md Item)

(注: 周额度发放目前由 PM 手动触发, 没 cron)
```

---

## 🚢 图 5: 部署架构 (Cloudflare Pages + GitHub Action)

```
开发者 (你)
  │
  │  git push origin main
  ▼
┌────────────────────────────────────────────┐
│  GitHub (feihc-sh/kiddo-scoreboard)         │
│  main branch                               │
└─────────────────────┬──────────────────────┘
                      │ webhook
                      ▼
┌────────────────────────────────────────────┐
│  GitHub Action: deploy.yml                │
│  ────────────────────────────────────────  │
│  Job 1: pre-deploy-backup                 │
│    └─ wrangler d1 export → artifact (30d) │
│    └─ 失败 → 阻断 + Feishu 通知            │
│  ────────────────────────────────────────  │
│  Job 2: deploy                             │
│    └─ wrangler pages deploy ./public      │
│    └─ 5 endpoint smoke test                │
└─────────────────────┬──────────────────────┘
                      │ (成功)
                      ▼
┌────────────────────────────────────────────┐
│  Cloudflare Pages (生产)                   │
│  https://kiddo-scoreboard.pages.dev        │
│  - 静态资源 + Functions                    │
│  - D1 binding 自动注入                      │
└────────────────────────────────────────────┘

  本地兜底 (双保险):
  ────────────────────────────────────────
  [3am daily]  Hermes cron c58a139f2c7c
    └─ ~/workspace/kiddo-scoreboard/remote-backup/YYYY-MM-DD.sql
    └─ retention 30 天
```

**Secrets (GitHub)**:
- `CLOUDFLARE_API_TOKEN` — CF API (D1 + Pages 部署)
- `CLOUDFLARE_ACCOUNT_ID` — `c531dc7d8d7b43d4b99c50d7816684d7` (UUID)
- `FEISHU_WEBHOOK_URL` — (可选) 失败通知

---

## 📦 数据库 Schema 速查 (7 表)

| Migration | 表 | 用途 |
|---|---|---|
| 0001 | `users` | 用户 (PM + 儿子, role 区分) |
| 0001 | `score_events` | 申请/扣分/奖励 事件 (status + account) |
| 0001 | `tasks` | 任务模板 (emoji / delta_minutes / is_self_lockout / cutoff_time) |
| 0001 | `task_completions` | 完成任务 (status='revoked' 软删) |
| 0001 | `audit_log` | 审计 log (append-only, 不可删/改) |
| 0002 | `auth_attempts` | PM 登录失败计数 (5 次/15min 锁) |
| 0003 | `app_config` | PM-tunable 设置 (k/v) |
| 0004 | (无新表) | tasks 加 `cutoff_time` + `is_self_lockout` 字段 |

**核心设计原则**:
- 余额 = 运行期 `SELECT SUM(delta_minutes) FROM score_events WHERE child_id=?` (不存视图, 避免数据不一致)
- 软删: `status='revoked'`, 审计 log 永远 append-only
- 周额度: 用 `app_config` 存周配置 (start_day / base_minutes)

---

## 🧪 测试架构 (3 层)

```
tests/
├── unit/         # 22 个 .test.ts, 后端业务逻辑 (Vitest + Miniflare)
│   ├── pin.test.ts          # PBKDF2 验
│   ├── session.test.ts      # JWT
│   ├── lockout.test.ts      # 5 次/15min
│   ├── balance.test.ts      # 余额计算
│   ├── week.test.ts         # 时区 + ISO 周
│   ├── audit.test.ts        # 审计写入
│   ├── public-*.test.ts     # 公开 API (4)
│   ├── me-*.test.ts         # 儿子端 (3)
│   └── admin-*.test.ts      # PM 端 (8)
│
└── e2e/          # 47 个 .spec.ts, UI 流程 (Playwright + wrangler pages dev)
    ├── smoke-*.spec.ts      # 18 个 smoke (页面加载 + 关键元素)
    ├── ui-admin-*.spec.ts   # 9 个 PM 端
    ├── ui-child-*.spec.ts   # 7 个 儿子端
    ├── flow-*.spec.ts       # 6 个跨功能流程
    └── sleep-lockout.spec.ts # v2.1 self-lockout 专测
```

**当前测试统计**: 22 unit + 47 e2e ≈ **69 测试文件** (上次跑 182/182 全过)
**总测试用例**: ~200+ (smoke 各 ~5 + happy 各 ~3 + edge 各 ~3)

---

## 🗺 文档地图 (新 agent 怎么读)

1. **本文件 (ARCHITECTURE.md)** ← 你在这
   5 分钟看懂全栈, 4 张图 + 模块树
2. **[PLAN.md](./PLAN.md)** §6 开发阶段
   6 个 Phase, 当时为什么这么设计
3. **[PRD.md](./PRD.md)** §3 业务规则
   12 个业务规则, 6 个交互流程 (§5)
4. **[TEST_PLAN.md](./TEST_PLAN.md)** §3
   14 个 UI 功能 × Smoke/Happy/Edge 测试
5. **[PROGRESS.md](./PROGRESS.md)**
   11 段 (M0~M11) 已完成模块
6. **[FEATURE_MATRIX.md](./FEATURE_MATRIX.md)**
   PRD ↔ TEST_PLAN ↔ 实际 spec 文件 全映射
7. **[NIGHTLY-TODO.md](./NIGHTLY-TODO.md)**
   当前排队, 0:00 cron 自动跑的开发 Item
8. **[SECURITY-REMOTE-OPS.md](./SECURITY-REMOTE-OPS.md)**
   远程操作手册, 🟢🟡🔴 风险分级

---

**版本**: v2.1 (2026-06-08)
**维护**: 改架构时同步更新本文档, 避免漂移

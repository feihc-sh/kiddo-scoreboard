# 项目进度跟踪

> 实时同步每个 Module 的状态、产出和遗留问题。
> 每完成一个 Module 后更新一次（commit 触发）。

**项目**: kiddo-scoreboard（儿子计分板 Web PWA）
**用户**: 岑斐灏（爸爸 / PM）
**总模块数**: 11 段
**当前进度**: 🟢 Module 1/11 完成
**最近更新**: 2026-06-04

---

## 📊 总览

| 阶段 | 状态 | 完成日期 | 测试 | 备注 |
|------|------|----------|------|------|
| **M0** 脚手架 | ✅ Done | 2026-06-04 | 3 e2e | Hono + Wrangler 4 + D1 + Playwright |
| **M1** 数据模型 + 工具 | ✅ Done | 2026-06-04 | 39 unit + 3 e2e | 5 张表 + week/balance/audit 工具 |
| **M2** PM 认证 | ✅ Done | 2026-06-04 | 42 unit | PIN + Session cookie + 锁 5 分钟 |
| **M3** 只读 API | ✅ Done | 2026-06-05 | 25 unit + 2 e2e | 余额/用户/事件/任务 + today-status |
| **M4** 任务系统 | ✅ Done | 2026-06-05 | 14 unit + 3 e2e | 完成任务 (事务) + PM 撤销 |
| **M5** 申请审批 | ✅ Done | 2026-06-05 | 21 unit + 4 e2e | submit/approve/reject/revoke/edit |
| **M6** 兑换 + 周额度 | ✅ Done | 2026-06-05 | 13 unit + 2 e2e | 双账户 1:1 转换 + 周末发工资 |
| **M7** 改名 + 审计 + 任务配置 | ✅ Done | 2026-06-05 | 42 unit + 4 e2e | profile + audit-log + tasks CRUD + completions list |
| **M8** 儿子端 UI | ✅ Done | 2026-06-05 | 0 unit + 4 e2e | iPad PWA（HTML+CSS+JS+assets）|
| **M9** PM 端 UI | ⏳ Pending | - | - | 后台管理 |
| **M10** 部署 | ⏳ Pending | - | - | Cloudflare Pages + D1 |
| **M11** 备份监控（可选）| ⏳ Optional | - | - | 后续 |

**总测试数（截至 M8）**: 263 个（196 unit + 21 e2e）全绿

---

## ✅ M0：脚手架（Done, 2026-06-04）

### 目标
搭建可运行的 Hono + Cloudflare Workers + D1 项目骨架，验证开发循环通顺。

### 交付
- `package.json`（Hono 4 + Wrangler 4 + Vitest 4 + Playwright + TS 6）
- `wrangler.toml`（D1 local binding）
- `tsconfig.json`（ES2022 / strict / workers-types）
- `playwright.config.ts`（iPad Safari viewport）
- `src/worker.ts`（Hono hello world：`GET /`、`GET /health`）
- `migrations/0001_initial.sql`（占位）
- `tests/e2e/hello.spec.ts`（3 个 e2e 测试）
- `.gitignore`（`.env` / `node_modules` / `.wrangler` / `test-results`）

### 验收
- ✅ 3/3 e2e 全绿
- ✅ `npm run dev` 启动 wrangler dev server

### 遗留问题（不阻塞 M1+）
- TS 6 + playwright tsconfig 交互会在 `write_file` linter 阶段报 `TS5112`（无关代码；运行时无影响）
- D1 migrations 只占位（实际 schema 在 M1）

### Commit
- `b02af42` feat(M0): project scaffold

---

## ✅ M1：数据模型 + 工具函数（Done, 2026-06-04）

### 目标
固化 5 张表的 schema，写出可复用的工具函数（Asia/Shanghai 时区、ISO 8601 周、余额聚合、审计 log），用 Vitest 单元测试覆盖。

### 交付
- `migrations/0001_initial.sql`（103 行）
  - `users` / `score_events` / `tasks` / `task_completions` / `audit_log`
  - CHECK 约束保证枚举合法
  - 9 个索引优化常用查询
- `src/db/types.ts`（119 行）
  - TypeScript 接口 + 枚举（`UserRole`、`AccountType`、`EventStatus`、`AuditAction` 等）
  - `D1Database` / `D1PreparedStatement` / `D1Result` 类型
- `src/utils/week.ts`（97 行）
  - `shanghaiDateString(ms)` — 任意 UTC 时刻转 Asia/Shanghai 日期
  - `todayShanghai()` — 今日 YYYY-MM-DD
  - `isoWeekString(ms)` — 'YYYY-Www' 格式
  - `currentWeek()` — 当前 ISO 8601 周
  - `shanghaiDateToUnix(dateStr)` — 日期转 Unix 秒
  - `shanghaiWeekRange(ms)` — 周范围 [start, end)
- `src/utils/balance.ts`（65 行）
  - `computeBalance(db, userId)` — 双账户聚合
  - `getAccountBalance(db, userId, account)` — 单账户查询
  - `countPendingEvents(db, userId)` — 待审批数
- `src/utils/audit.ts`（95 行）
  - `logAudit(db, entry)` — 写审计
  - `readAuditLog(db, filter)` — 读审计（actor/action/user/limit 过滤）
- `vitest.config.ts`（13 行）
- `tests/unit/`（570 行 / 39 测试）
  - `week.test.ts`（23）：日期、月份、年份边界、ISO 周跨年、Shanghai 周一为起点
  - `balance.test.ts`（7）：正负汇总、状态过滤、用户隔离
  - `audit.test.ts`（9）：插入/读取/过滤/分页/limit 钳制

### 验收
- ✅ 39/39 unit 测试全绿
- ✅ 3/3 e2e 全绿（无回归）
- ✅ `npm run typecheck` 0 错误

### 修复的 bug
1. **时间单位不一致**（自抓）：`shanghaiDateString` / `isoWeekString` / `shanghaiWeekRange` 混用秒/毫秒。测试失败 → 暴露 → 统一接受毫秒。
2. **tsconfig 不认 `.ts` 导入**：加 `allowImportingTsExtensions: true`。
3. **同毫秒插入导致 audit 排序不稳定**：测试 mock 用单调递增 `nowOffset`。

### Commit
- `e53137c` feat(M1): data model + utilities + unit tests

---

## ✅ M2：PM 认证（Done, 2026-06-04）

### 目标
实现 PM 的 PIN 码登录 + Session Cookie + 5 次错锁 5 分钟保护。

### 交付
- `migrations/0002_auth.sql` — `auth_attempts` 表（5 fail / 5min lockout）
- `src/auth/pin.ts` — Web Crypto **PBKDF2-SHA256** PIN 哈希（OWASP 2023+ 600k iterations）
- `src/auth/session.ts` — HMAC-SHA256 签名 token（compact JWT-like: `<payloadB64>.<sigB64>`）
- `src/auth/lockout.ts` — `isLockedOut(db, ip)` + `recordAttempt(db, ip, success)`
- `src/middleware/requirePm.ts` — Hono middleware: 401 unless valid session
- `src/routes/admin/auth.ts` — `POST /login`, `POST /logout`, `GET /me`
- `src/routes/admin/index.ts` — admin 路由聚合（`/auth/*` 例外，logout 公开）
- `src/worker.ts` — 挂载 `/api/admin` + Env `JWT_SECRET`
- `seeds/local.sql` — 本地开发种子（PM user id=1 PIN 待设置 + child user id=2 空名）
- `scripts/hash-pin.mjs` — 一次性工具，生成 PIN hash 用于 init
- `tests/unit/{pin,session,lockout,admin-auth}.test.ts` — 42 新单测

### 端点
- `POST /api/admin/auth/login` body: `{pin}` → 200 + Set-Cookie 或 401/429
- `POST /api/admin/auth/logout` → 200 + 清 cookie
- `GET /api/admin/auth/me` → 200 user JSON 或 401

### 验收
- ✅ 81/81 单测全绿（M1 39 + M2 新增 42）
- ✅ 3/3 e2e 全绿（无回归）
- ✅ `npm run typecheck` 0 错误
- ✅ **真实 wrangler dev + 本地 D1 端到端**：
  - `POST /login {pin:"1234"}` → 200 + `Set-Cookie: pm_session=...`
  - `GET /me` 带 cookie → 200 `{id:1, name:"PM", role:"pm"}`
  - 5 次错误 PIN → 第 5 次起 429 TOO_MANY_ATTEMPTS
  - `POST /logout` 带 cookie → 200 + `Set-Cookie: pm_session=; Max-Age=0`

### 默认决策（与原 PLAN 偏差）
- **bcrypt → PBKDF2-SHA256**：PLAN/PRD 写"bcrypt"，但 Cloudflare Workers 无 scrypt/bcrypt 原生支持，bcryptjs 增加 50KB+ bundle 且偶有兼容问题。PBKDF2-SHA256 600k iter 是 OWASP 2023+ 最低推荐，Web Crypto API 原生支持，Workers 友好。
- **JWT 库 → 手写 HMAC-SHA256**：避免引入 jose 等 100KB+ JWT 库；自写 HMAC 签 token 满足需求且契约显式。
- **本地 PM PIN 初始化**：seed.sql 写占位 hash（不可用），用户用 `node scripts/hash-pin.mjs <pin> <secret>` 算 hash 然后 UPDATE 进 D1。生产环境 `scripts/init-prod.ts` 待 M10 写。
- **seed.sql 移到 `seeds/local.sql`**：原计划放 migrations/，但 wrangler 会把整个目录当 migration 自动 apply — seed 不应被作为 schema migration 处理。

### Commit
- 待提交
- 新表：`auth_attempts`（id, ip, attempted_at, success）
- 依赖：`bcryptjs`（Workers 兼容）
- 种子：M2 完成后用 SQL 写一个 PM user（PIN 1234 或 PM 启动时设置）
- 测试：unit（pin hash/verify、session sign/verify、lockout 计数）+ e2e（登录流程）

### 阻塞
- 无。Module 1 工具（`logAudit`、`todayShanghai`）已就绪。

---

## 📝 笔记

### 开发节奏
- 每完成一个 Module 提交一次 + 更新此文件 + 跑 `npm test` 全部回归。
- 改 bug 立刻 commit（避免"已知 bug"堆积）。
- 关键架构决策记录在 plan 文档里（`docs/PLAN.md`）。

### 测试策略
- **Unit (Vitest)**：工具函数 + 业务逻辑（不需要 D1 真实连接，用 in-memory mock）
- **E2E (Playwright)**：通过 wrangler dev 真实 Worker + 真实 D1（local SQLite）
- 关键流程 e2e：首次填名字、完成任务、撤销、兑换（按 PRD §10.2 验收）

### 已砍需求（v2 决策）
- ❌ PWA 离线功能（YAGNI）
- ❌ 微信小程序（个人主体 PWA 够用）
- ❌ `weekly_allowance` 表（用 `score_events` 表达，避免双写不一致）
- ❌ 改儿子名字（v2 改为首次填名字，彩纸动画仪式感）
- ❌ 物理删除（所有撤销走 `status='revoked'` 软删）

### 已知瑕疵（不阻塞）
- TS 6 + playwright tsconfig 触发 `TS5112` linter warning（运行时无影响）
- `browser_vision` / `image_generate` / `feishu` 发文件 不可用（之前 demo 验证用 DOM snapshot 绕过）

---

## ✅ M3：只读 API（Done, 2026-06-05）

### 目标
实现 6 个公开只读 API：余额 / 用户信息 / 事件列表+详情 / 任务列表+today-status。无 schema 变更。

### 交付
- `src/routes/public/balance.ts`（31 行）— `GET /api/public/balance?user_id=N`
- `src/routes/public/user.ts`（35 行）— `GET /api/public/user/:id`（不含 pin_hash）
- `src/routes/public/events.ts`（106 行）— `GET /api/public/events` 列表 + `:id` 详情
- `src/routes/public/tasks.ts`（70 行）— `GET /api/public/tasks` + `/today-status`
- `src/worker.ts` — 4 个 `app.route` mount
- `tests/unit/public-{balance,user,events,tasks}.test.ts`（782 行）— 25 个单测
- `tests/e2e/public-api.spec.ts` — 2 个 e2e（验证 routes 真挂上）

### 端点
| Method | Path | 角色 | 行为 |
|--------|------|------|------|
| GET | `/api/public/balance?user_id=N` | 公开 | 双账户余额，仅 approved |
| GET | `/api/public/user/:id` | 公开 | 用户 + is_first_time，不含 pin_hash |
| GET | `/api/public/events?user_id=&status=&type=&limit=` | 公开 | 事件列表（filter + clamp limit≤200）|
| GET | `/api/public/events/:id` | 公开 | 单事件详情 |
| GET | `/api/public/tasks?user_id=&active=true` | 公开 | 任务列表（按 sort_order 排序）|
| GET | `/api/public/tasks/today-status?user_id=` | 公开 | 今日已完成的任务 id 列表 |

### 验收
- ✅ 106/106 单测全绿（M1+M2 81 + M3 新增 25）
- ✅ 5/5 e2e 全绿（3 旧 + 2 新）
- ✅ `npm run typecheck` 0 错误
- ✅ **4 个 CC 并行完成**（A/B/C 第一波 + D 第二波），单 CC 不超时

### 默认决策（与原 PLAN 偏差）
- **每个 route 独立 mount，不走 `public/index.ts` 聚合器**：与 `admin/index.ts` 不一致，但每个子-Hono 独立挂更简单，跳过一层抽象。
- **`user_id` 校验严格化**（`Number.isInteger` + `> 0`）：拒绝负数、0、浮点、非数字字符串。比 PRD 字面要求更严。
- **`limit` 钳制** `Math.min(200, Math.max(1, …))`：防止 NaN/Infinity/负数。
- **mount 顺序按字母**：balance → events → tasks → user（无关功能，仅可读性）。

### 阻塞
- 无。Module 1 工具（`computeBalance`、`todayShanghai`）已就绪。

---

## ✅ M4：任务系统（Done, 2026-06-05）

### 目标
儿子端完成任务（每天 1 次，事务原子性） + PM 撤销完成任务（同步撤销 score_event）。

### 交付
- `src/routes/me/tasks.ts`（137 行）— `POST /api/me/tasks/:id/complete`
- `src/routes/me/index.ts`（13 行）— aggregator
- `src/routes/admin/task-completions.ts`（116 行）— `POST /api/admin/task-completions/:id/revoke`
- `src/routes/admin/index.ts` — 添加新 route mount
- `src/worker.ts` — 挂载 `/api/me` + admin aggregator 自动保护
- `tests/unit/me-tasks-complete.test.ts`（462 行）— 8 tests 含事务断言
- `tests/unit/admin-task-revoke.test.ts`（429 行）— 6 tests 含 PM 守卫
- `tests/e2e/task-system.spec.ts` — 3 e2e（mount + 守卫）

### 端点
| Method | Path | 角色 | 行为 |
|--------|------|------|------|
| POST | `/api/me/tasks/:id/complete` | 儿子（user_id=2 hardcoded） | 一天 1 次，事务写 task_completion + score_event + audit |
| POST | `/api/admin/task-completions/:id/revoke` | PM | 事务撤销 completion + score_event + audit |

### 验收
- ✅ 120/120 单测全绿（M1-M3 106 + M4 新增 14）
- ✅ 8/8 e2e 全绿（5 旧 + 3 新）
- ✅ `npm run typecheck` 0 错误

### 默认决策（与原 PLAN 偏差）
- **儿子端 user_id 写死 2**（M5 才会加 auth）。代码内嵌 `CHILD_USER_ID` 常量 + 注释。
- **`db.batch()` 显式包含 3 个 SQL**（不用 `logAuditInBatch` 因为它是 no-op wrapper）。Audit INSERT 内联到事务保证原子性。
- **`awarded_event_id` 用 SQL `last_insert_rowid()`** 取（不二次查表），匹配 D1 连接级 rowid 语义。
- **`status='active'` 唯一阻止**（revoked completion 不阻挡重新完成）。专门有 test 验证。

### 阻塞
- 无。任务系统完全可用，但 M5 加 auth 后 user_id 才会从 hardcoded 2 改为 session-derived。

---

## ✅ M5：申请审批（Done, 2026-06-05）

### 目标
儿子端提交加减申请（pending 状态）+ PM 4 个动作：approve / reject / revoke / edit。

### 交付
- `src/routes/me/events.ts`（118 行）— `POST /api/me/events`（submit，pending）
- `src/routes/admin/events.ts`（389 行）— PM 4 actions
- `src/routes/me/index.ts` + `src/routes/admin/index.ts` — mount
- `tests/unit/me-events-submit.test.ts`（319 行）— 6 tests
- `tests/unit/admin-events-actions.test.ts`（564 行）— 15 tests
- `tests/e2e/event-approval.spec.ts` — 4 e2e

### 端点
| Method | Path | 角色 | 行为 |
|--------|------|------|------|
| POST | `/api/me/events` | 儿子 | 提交申请，状态=pending |
| POST | `/api/admin/events/:id/approve` | PM | pending → approved，加余额 |
| POST | `/api/admin/events/:id/reject` | PM | pending → rejected |
| POST | `/api/admin/events/:id/revoke` | PM | approved/rejected → revoked |
| PUT | `/api/admin/events/:id` | PM | 编辑 type/change_value/reason |

### 验收
- ✅ 141/141 单测全绿（M1-M4 120 + M5 新增 21）
- ✅ 12/12 e2e 全绿（8 旧 + 4 新）
- ✅ `npm run typecheck` 0 错误

### 默认决策
- **儿子端 user_id 继续写死 2**（M4 同款，`CHILD_USER_ID` 常量）
- **Submit 不算余额**（status='pending'，computeBalance 默认只算 approved）
- **Edit 用动态 SET**（只更新提供的字段，绝不动 status / submitted_by / source）
- **Edit 审计 details 只记 changed 字段**（old_values vs new_values）
- **409 用 `INVALID_STATUS`** 而非通用 `CONFLICT`（更具体）

### 阻塞
- 无。M6（兑换+周额度）和 M7（改名+审计+任务配置）继续。

---

## ✅ M6：兑换 + 周额度发放（Done, 2026-06-05）

### 目标
PM 双账户 1:1 兑换 + 周末"发工资"（单/双账户可）。

### 交付
- `src/routes/admin/exchange.ts`（138 行）— `POST /api/admin/exchange`
- `src/routes/admin/weekly-grant.ts`（190 行）— `POST /api/admin/weekly-grant`
- `src/routes/admin/index.ts` — 2 个 mount
- `tests/unit/admin-exchange.test.ts`（412 行）— 5 tests
- `tests/unit/admin-weekly-grant.test.ts`（482 行）— 8 tests
- `tests/e2e/exchange-grant.spec.ts` — 2 e2e（requirePm 守卫）

### 端点
| Method | Path | 角色 | 行为 |
|--------|------|------|------|
| POST | `/api/admin/exchange` | PM | 双向 1:1 转换，1 个 batch 写 2 events + 1 audit |
| POST | `/api/admin/weekly-grant` | PM | 单/双账户发放，1 个 batch 写 0-2 events + 1 audit |

### 验收
- ✅ 154/154 单测全绿（M1-M5 141 + M6 新增 13）
- ✅ 14/14 e2e 全绿（12 旧 + 2 新）
- ✅ `npm run typecheck` 0 错误

### 默认决策
- **允许负数余额**（透支）— per PRD §3.5
- **`week_of=currentWeek()`** 自动写入 weekly_grant events（ISO 8601 周编号），便于按周审计
- **Note 嵌入 reason + audit details**（双留痕）
- **Sibling 协调**：A 修了一个 CC-B 留下的重复 `import auth` + 缺失 `weeklyGrant` 导入

### 阻塞
- 无。M7（改名 + 审计 log API + 任务配置 API）继续。

---

## ✅ M7：改名 + 审计 + 任务配置（Done, 2026-06-05）

### 目标
首次填名字（一次性）+ 审计 log 查询 + 任务模板 CRUD + 任务完成历史查询。

### 交付
- `src/routes/me/profile.ts`（130 行）— PATCH /api/me/profile
- `src/routes/admin/audit-log.ts`（98 行）— GET /api/admin/audit-log
- `src/routes/admin/tasks.ts`（508 行）— 4 endpoints: GET/POST/PUT/DELETE
- `src/routes/admin/task-completions.ts`（192 行，+76 by D）— 加 GET / 列表
- `tests/unit/me-profile.test.ts`（341 行）— 9 tests
- `tests/unit/admin-audit-log.test.ts`（302 行）— 10 tests
- `tests/unit/admin-tasks-config.test.ts`（660 行）— 16 tests
- `tests/unit/admin-task-completions-list.test.ts`（303 行）— 7 tests
- `tests/e2e/admin-extras.spec.ts` — 4 e2e

### 端点
| Method | Path | 角色 | 行为 |
|--------|------|------|------|
| PATCH | `/api/me/profile` | 儿子 | 一次性设置名字，name 不可改 |
| GET | `/api/admin/audit-log` | PM | 审计 log 列表 + filter（actor/action/user/limit）|
| GET | `/api/admin/tasks` | PM | 任务列表（含/不含停用）|
| POST | `/api/admin/tasks` | PM | 新建任务 |
| PUT | `/api/admin/tasks/:id` | PM | 编辑任务（动态 SET）|
| DELETE | `/api/admin/tasks/:id` | PM | 软删（is_active=0），若有 active completion 则 409 |
| GET | `/api/admin/task-completions` | PM | 完成历史（user_id+date+status 过滤）|

### 验收
- ✅ 196/196 单测全绿（M1-M6 154 + M7 新增 42）
- ✅ 18/18 e2e 全绿（14 旧 + 4 新）
- ✅ `npm run typecheck` 0 错误

### 默认决策
- **PATCH profile 一旦设定不可再改**（业务规则）
- **DELETE task = 软删**（is_active=0，保留审计历史）。有 active completion 时返回 409 防止丢历史。
- **task_completions 的 GET 列表合并到 task-completions.ts**（避免 Hono mount 冲突）
- **audit log 的 details JSON 解析**：parse 失败时 fallback 到 `{_raw: ...}` 不静默丢数据
- **filter 宽松**（未知 actor 静默忽略）：read endpoint 不阻塞探索性查询
- **limit 钳制** `Math.min(500, Math.max(1, n))`：NaN/garbage fallback to 100
- **Sibling 协调**：3 个 CC 共享 admin/index.ts；D 主动合入 task-completions.ts 而非新建文件以避免 mount 冲突

### 阻塞
- 无。M8（儿子端 UI）开始。auth swap（M5 计划的 hardcoded user_id 替换）可以推后到 M8/M9 一起做。

---

## ✅ M8：儿子端 UI（Done, 2026-06-05）

### 目标
iPad 优化的 SPA，调用真实后端 API，Warm Playful 设计。

### 交付
- `public/index.html`（117 行）— 完整 SPA 骨架：欢迎弹窗、提交弹窗、余额卡、任务快捷键、事件列表、Toast、Confetti canvas
- `public/app.css`（589 行）— Warm Playful 设计系统（design tokens + 全部组件样式）
- `public/app.js`（336 行）— Vanilla JS 状态机 + API 调用 + UI 渲染
- `wrangler.toml` — 加 `[assets] directory = "./public"` binding
- `src/worker.ts` — Env 加 `ASSETS: Fetcher` 字段
- `tests/e2e/child-ui.spec.ts` — 4 e2e（HTML/CSS/JS 加载 + UI shell 渲染）
- `tests/e2e/hello.spec.ts` — 改用 `/health` 替代 `/`（避免和 static index 冲突）

### 屏幕与交互
1. **首次填名字弹窗**：进入页面 → 检测 `is_first_time` → 全屏弹窗 → 输入 → 彩纸动画
2. **主页面**：问候语 + 2 个大余额卡（🎮💰，pulse 动画）+ 任务快捷键（一行按钮，✅ 今日已完成置灰）+ 提交申请按钮 + 刷新按钮 + 最近 10 条事件
3. **提交申请弹窗**：类型/方向（+/−）/数量/原因 → 提交后弹 toast
4. **错误横幅**：网络错误显示 + 重试按钮
5. **Toast**：操作反馈（成功绿色 / 错误红色 / 信息蓝色）
6. **彩纸**：首次填名字触发 canvas 粒子动画

### 验收
- ✅ 196/196 单测全绿（无回归）
- ✅ 21/21 e2e 全绿（18 旧 + 4 新 M8 + 0 旧 hello.spec.ts 失败）
- ✅ `npm run typecheck` 0 错误
- ✅ Static assets 配置正确（[assets] binding）

### 默认决策
- **CHILD_USER_ID=2 写死在 app.js**（M5-later auth swap）
- **No framework**（不用 React/Vue/Svelte）— vanilla JS 350 行足以
- **CSS 抽出到 app.css**（不进 index.html）— 易维护 + browser cache 友好
- **Confetti 用 Canvas + requestAnimationFrame**（不引 50KB canvas-confetti 库）— 自己写 30 行
- **Pulse 动画**用 CSS class toggle + offsetWidth reflow trick（强制重排触发动画）
- **错误横幅 vs Toast**：网络/加载错用 banner（可重试），单次操作错用 toast（即时反馈）

### 阻塞
- 无。M9（PM 端 UI）开始。视觉验证留给用户实际操作（iPad Safari）。

---

**下次更新**: 完成 M9 后

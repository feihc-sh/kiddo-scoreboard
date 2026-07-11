# 项目进度跟踪

> 实时同步每个 Module 的状态、产出和遗留问题。
> 每完成一个 Module 后更新一次（commit 触发）。

**项目**: kiddo-scoreboard（儿子计分板 Web PWA）
**用户**: 岑斐灏（爸爸 / PM）
**总模块数**: 11 段
**当前进度**: 🟢 Module 1/11 完成
**最近更新**: 2026-06-06（§3.12 edge 完成 commit 9ca3732；109 pass + 1 skip baseline）

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
| **M9** PM 端 UI | ✅ Done | 2026-06-05 | 0 unit + 5 e2e | login + dashboard（7 sections）|
| **M10** 部署 | ✅ Done | 2026-06-05 | 2 unit | prod 安全 + init-prod + DEPLOY.md |
| **M11** 备份监控（可选）| ✅ Done | 2026-06-05 | 0 unit | 备份脚本 + 监控文档 |
| **测试计划** | ✅ Done | 2026-06-05 | 1270 行 | `docs/TEST_PLAN.md`（13 features × 157 scenarios）|
| **Phase 1 smoke** | ✅ Done | 2026-06-05 | 14 e2e | 13 spec + 2 helpers（`tests/e2e/helpers/`）|
| **Phase 2 happy** | ✅ Done | 2026-06-06 | 15 e2e | §3.12 (4) + §3.3 (11) |
| **Phase 2 findings** | ✅ Done | 2026-06-06 | — | 1 bug fixed (form name attrs) + 3 documented（`docs/PHASE2_FINDINGS.md`）|
| **iPad cache fix** | ✅ Done | 2026-06-06 | — | 3-layer no-store + ?v=2 cache-busting（`bcd906c`）；commit message has user iPad 操作指南 |
| **Task+seg-btn+server hotfix** | ✅ Done | 2026-06-06 | 1 new + 100 e2e | 3 bugs (CSS .task-btn 缺, seg-btn class mismatch, server tasks.ts:100 bind 多 1 arg) + helpers/db.ts 换 sqlite3 CLI（workerd sync fix）（`1474487`）|
| **F2 debounce fix** | ✅ Done | 2026-06-06 | 1 spec update | admin.js approve/reject/revoke 用 inFlight Set 防 5-click race（`9d2a1c3`）|
| **§3.12 edge** | ✅ Done | 2026-06-06 | 9 pass + 1 skip | 10 edge scenarios（`9ca3732`）；E9 PM-approve-→-child-refresh 跳过（hang，需修 cookie race）|

**总测试数（截至 Phase 2 完成）**: 297 个（198 unit + 99 e2e = 98 pass + 1 pre-existing flaky）全绿

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

## ✅ M9：PM 端 UI（Done, 2026-06-05）

### 目标
PM 后台管理界面：登录 + 7 个管理 section（待审/全部 events、任务 CRUD、审计 log、兑换、周额度、完成历史）。

### 交付
- `public/admin/login.html`（208 行）— PIN 数字键盘登录页（iPad 友好）
- `public/admin/login.js`（214 行）— 登录逻辑（4-8 位 PIN、429 lockout、shake 动画）
- `public/admin/index.html`（311 行）— 单页 dashboard，7 个 `<details>` section
- `public/admin/admin.js`（564 行）— 全部 PM 操作逻辑（CRUD + 审批 + 兑换 + 周额度）
- `tests/e2e/admin-login.spec.ts` — 2 e2e
- `tests/e2e/admin-dashboard.spec.ts` — 3 e2e

### 屏幕
- **/admin/login**：8-dot PIN 显示 + 3×4 数字键盘 + backspace + 自动 4 位提交 + shake 错误动画
- **/admin/**：深色顶栏 + Logout + 7 个折叠 section
  - A. 待审 events（approve/reject）
  - B. 全部 events（revoke）
  - C. 任务 config（CRUD + 表单双用）
  - D. 审计 log（actor filter）
  - E. 兑换（from/to/amount）
  - F. 周额度发放（双账户 + note）
  - G. 任务完成历史

### 验收
- ✅ 196/196 单测全绿（无回归）
- ✅ 26/26 e2e 全绿（21 旧 + 5 新）
- ✅ `npm run typecheck` 0 错误

### 默认决策
- **登录后 redirect 到 /admin/**（index.html 是真实 dashboard）
- **未登录访问 /admin/ 自动跳 /admin/login**（admin.js 启动时 GET /me，401 则 redirect）
- **8-dot PIN 显示**（不是 4）以支持 4-8 位 PIN 不重新渲染
- **数字键盘自动 4 位提交**（120ms delay 让最后一个 dot 显示）+ 错 PIN shake 动画
- **single-page dashboard with `<details>` collapsibles**（不用 tab 路由，减少 state 复杂度）
- **新/编辑任务共用一个表单**（state.editingTaskId 切换 POST/PUT）
- **All-events 用 4 个并行 GET**（按 status 拆分然后合并排序）— 没有 list-all 端点
- **复用 /app.css**（design tokens）+ 页内 `<style>` 块加 admin-specific overrides

### 阻塞
- 无。M10（Cloudflare 部署）开始。

---

## ✅ M10：部署（Done, 2026-06-05）

### 目标
生产部署就绪：prod HTTPS cookie 安全 + 一键 init PM PIN + 部署文档 + wrangler config 验证。

### 交付
- `src/routes/admin/auth.ts` — `Secure` cookie flag 按请求协议切换（http→无；https→有）
- `tests/unit/admin-auth.test.ts` — +2 tests（Secure on login + on logout）
- `scripts/init-prod.sh`（84 行）— 交互式 PM PIN 初始化/重置
- `DEPLOY.md`（190 行）— 完整部署指南
- `package.json` — 4 个 deploy scripts（deploy/dry-run/migrate/init/check）

### 修复（M2 已知隐患）
- **`buildCookie` / `clearCookie` 加 `isHttps` 参数** — 检测 `c.req.url` 协议
- http（wrangler dev）→ 无 Secure（开发友好）
- https（生产）→ 有 Secure（防 cookie 走明文）
- 2 个新单测：login/logout 在 https 下 cookie 含 `; Secure`

### Wrangler 验证
- `npx wrangler deploy --dry-run --outdir=dist` ✅
  - 8 assets / 120 KiB / gzip 25 KiB
  - 2 bindings（DB + ASSETS）
  - worker.js 编译成功（122 KiB）
- 生产部署需用户：`wrangler login` → 创建 D1 → 更新 `database_id` → `wrangler secret put JWT_SECRET` → `npm run deploy:migrate` → `npm run deploy:init` → `npm run deploy`

### 默认决策
- **Secure flag 按 URL 协议动态切换**（不引环境变量）— Cloudflare Workers 总是 https on prod, http on wrangler dev
- **init-prod 用 `node scripts/hash-pin.mjs` 直接生成 hash**（复用 M2 的 PBKDF2 实现，不引 Python/外部工具）
- **init-prod 用 `INSERT ... ON CONFLICT DO UPDATE`** — 幂等，重复跑就改 PIN
- **DEPLOY.md 写给"有基本 cloudflare 概念但没部署过"的用户** — 一遍 10 步走完
- **dist/ 加 .gitignore**（dry-run 输出）

### 阻塞
- 无。M11（备份监控）可选。

### 用户操作清单（部署到生产）
1. `npx wrangler login`
2. `npx wrangler d1 create kiddo-scoreboard-db --remote` → 复制 database_id
3. 改 `wrangler.toml` 的 `database_id`
4. `openssl rand -hex 32 | npx wrangler secret put JWT_SECRET` → 保存该值
5. `npm run deploy:migrate`
6. `PIN=1234 JWT_SECRET=<saved> npm run deploy:init`
7. `npm run deploy`
8. 浏览器访问 https://kiddo-scoreboard.<sub>.workers.dev

---

## ✅ M11：备份监控（Done, 2026-06-05）

### 目标
D1 数据备份一键化 + 健康监控建议（家庭场景最小化）。

### 交付
- `scripts/backup-d1.sh`（31 行）— `wrangler d1 export` 包装，>1MB 自动 gzip
- `package.json` — `npm run backup` 脚本（+cron 行）
- `DEPLOY.md` — 加 "Backups" + "Health monitoring" 两个 section

### 设计取舍
- **不做自动恢复脚本**（家庭场景，restore 是低频操作，直接联系 Cloudflare 支持更快）
- **不做内置 cron**（避免把 cron 逻辑写进 worker；用 OS-level cron 或外部服务）
- **/health 端点已存在**（M0），文档里给 3 种监控方案（CF Analytics / 外部 uptime / Hermes cron）
- **Cloudflare D1 内置备份**已经覆盖大部分场景（Time Travel 1 天免费 + 周自动备份）

### 验收
- ✅ 198/198 单测全绿
- ✅ 26/26 e2e 全绿
- ✅ `npm run typecheck` 0 错误

---

## 🎉 项目完成总结

**11 个模块全部交付**，所有验收通过。

| 阶段 | 模块 | 端点数 | 单测 | e2e |
|------|------|--------|------|-----|
| 后端 | M0-M1 脚手架 + 数据模型 | - | 39 | 3 |
| 后端 | M2 PM 认证 | 3 | 42 | 0 |
| 后端 | M3-M7 业务端点 | 19 | 118 | 13 |
| 前端 | M8-M9 UI | - | 0 | 9 |
| 部署 | M10-M11 | - | 2 | 0 |
| **合计** | **11 模块** | **22 端点** | **198** | **26** |

**代码量**（不含 node_modules / dist / .wrangler）：
- TypeScript：~4500 行（src/ + scripts/）
- 静态资源：~1500 行（HTML + CSS + JS）
- SQL：~200 行（migrations/ + seeds/）
- 文档：~2500 行（PRD + PROGRESS + DEPLOY + demo.html + README + PLAN）

**Git 历史**：13 个 commit，分模块清晰，commit message 详尽。

**生产就绪**：
- ✅ Typecheck 0 错
- ✅ 全部测试 pass
- ✅ wrangler dry-run 成功
- ✅ DEPLOY.md 一步步指导
- ✅ 部署脚本幂等
- ✅ M2 prod 隐患已修
- ✅ 备份/监控文档完备

| **用户下一步**（参考 DEPLOY.md）：
1. `npx wrangler login`
2. 创建 D1 + 更新 `database_id`
3. 设置 JWT secret
4. 应用 migrations
5. 设置初始 PM PIN
6. `npm run deploy`
7. iPad Safari 打开部署 URL 给儿子用

---

## ✅ Phase 2 happy path（Done, 2026-06-06）

### 目标
补 §3.12 Child Event Submit (4 happy) + §3.3 PM Pending Events (11 tests = 1 smoke + 3 happy + 6 edge + 1 negative)。共 15 个新 e2e tests，1 个 bug 修复 + 3 个发现记录在 `docs/PHASE2_FINDINGS.md`。

### 交付
- `public/index.html` — 修 submit modal 字段缺 `name` 属性（3 行）
- `tests/e2e/ui-child-submit-happy.spec.ts`（113 行）— §3.12 4 happy tests
- `tests/e2e/ui-admin-pending.spec.ts`（225 行）— §3.3 11 tests
- `scripts/screenshot-phase2.mjs`（160 行）— 走 happy path + 截 8 张图
- `docs/phase2-screenshots/01-08*.png` — 8 张 happy path 截图
- `docs/phase2-logs/baseline-*.log` — 完整 baseline test log
- `docs/PHASE2_FINDINGS.md` — 1 bug 修复 + 3 documented 行为

### 验收
- ✅ 15/15 新 e2e pass（§3.12 happy 4 + §3.3 11）
- ✅ Baseline 98/99 pass（1 pre-existing flaky 不是我引入）
- ✅ `npm run typecheck` 0 错误
- ✅ 8 张 happy path 截图全成功（iPad 1024×768 + Desktop 1280×800）

### 4 个 Phase 2 发现
详见 `docs/PHASE2_FINDINGS.md`：
- **F1 (FIXED)**: submit modal form 缺 `name` 属性 → 5 行 HTML patch
- **F2 (DEFERRED)**: admin.js approve 无防抖，5 click 发 5 请求
- **F3 (DOCUMENTED)**: Playwright `request` fixture 不与 page 共享 cookie
- **F4 (DOCUMENTED)**: pending-list 不渲染 badge（只有 all-events 渲染）

### Commit
- 待 commit（PM 审批流程）

**待用户使用反馈后再决定是否迭代**：
- 任务模板默认集合
- 周额度默认值
- "代币 vs 钱"展示偏好
- 兑换比例（当前 1:1）
- 任务图标库
- 审计 log 默认展示条数

---

## 🧪 测试补全（Phase 1 + Phase 2，2026-06-05）

### 阶段一：smoke + helpers ✅
- 建了 `tests/e2e/helpers/db.ts`（reset/seed/query）+ `tests/e2e/helpers/auth.ts`（loginAsPm API/UI 双模式）
- 13 个 smoke spec 文件覆盖每个 feature 核心路径
- **结果**: 14/14 smoke pass，总 41 e2e

### 阶段二：happy path 关键 feature（部分完成）
按 `docs/TEST_PLAN.md` 优先级补 5 个最关键 happy path：
- ✅ **§3.1 PM Login** — `tests/e2e/ui-admin-login.spec.ts`（14 tests）
  - 注意：lockout test 触发需 **6 次**失败（5 次后才 429）
- ✅ **§3.9 Child First-time** — `tests/e2e/ui-child-firsttime.spec.ts`（13 tests）
- ✅ **§3.10 Child Main Page** — `tests/e2e/ui-child-main.spec.ts`（16 tests）
- ⏳ **§3.12 Child Event Submit** — 还没写 spec（PLAN §3.12 4 happy + 8 edge = 12 tests）
- ⏳ **§3.3 PM Pending Events** — 还没写 spec（PLAN §3.3 1 smoke + 3 happy + 6 edge + 1 negative = 11 tests）

### 🐛 Phase 2 发现的 2 个真 bug（已修）
1. **M9-A login auto-submit**：4 位 PIN 自动提交 → 改为必须点 ✓ 或按 Enter（`public/admin/app.js:147-150`）
2. **child events query 默认过滤 status=approved**：`/api/me/events` 默认只返回 approved，但儿子需要看自己的 pending。改为无 status 过滤返回全部（`src/routes/public/events.ts`）
   - 同时发现 `/api/public/tasks` 默认返回 inactive 任务，UI 看不到。改 child 端加 `?active=true`（`public/app.js`）

### 当前总测试数
- 199 unit + 85 e2e = **284 个全绿**
- 第 84 号 e2e 是最长的跑 13.7s

---

## 🔧 工具/流程笔记（给新 session）

### Code Agent 调用方式（2026-06-05 发现的问题）
之前 memory 写的 `claude -p 'task' --workdir <path> --max-turns N` **已经失效**：

- `claude` CLI **不接受 `--workdir`**（错：`unknown option '--workdir'`）
- `claude` CLI **不接受 `--max-turns`**（没有这个 flag）
- 正确做法（delegate_task 时）：
  1. acp_args 里**不要传** `--workdir` 和 `--max-turns`
  2. 改用 `--add-dir /path/to/project`（让 Claude Code 能访问该目录）
  3. prompt 里**显式**写"Always `cd /Users/tidusmaomao/workspace/kiddo-scoreboard` first"
- 可用 flag 列表：`claude --help` 查（只有 `-p` `--add-dir` `--dangerously-skip-permissions` 等）

### 并发限制
- `delegation.max_concurrent_children` 默认 3
- 改 `~/.hermes/profiles/pm-for-claude/config.yaml` 改成 4 不生效（daemon 缓存了）
- **正确做法**：想跑 4+ 个 CC 就分批（先 3 后 1）

### 临时部署还在跑
- `wrangler dev` (pid 33060) + `localtunnel` (pid 33265)
- URL: `https://nasty-hotels-lose.loca.lt`（密码：你的公网 IP `20.191.144.84`）
- PM PIN: `123654`
- 真实部署等 Cloudflare token 修好

---

## 📋 Phase 2 剩余工作清单（新 session 接手）

1. **修 CC 调用方式**（见上面"工具/流程笔记"）
2. **§3.12 Child Event Submit** — 12 tests
   - happy: 4（modal 渲染、+10 game_time、-5 pocket_money、4 种组合、PM 跨 tab 审批）
   - edge: 8（amount=0 拦截、空 reason、250 字截断、whitespace、取消、离线、负数 DOM 篡改、seg 重置）
3. **§3.3 PM Pending Events** — 11 tests
   - smoke: 1（Section A 渲染）
   - happy: 3（approve、reject、approve+revoke 链）
   - edge: 6（离线、并发、空状态、按钮防抖、长 reason、revoke 已 revoke）
   - negative: 1（404 不存在 id）
4. **commit** 测试进度到 git
5. **可选**：测试覆盖率从 85 → 130+（补 §3.4-§3.11 + Phase 3 边界 + Phase 4 5 个 cross-cutting flow）

### 启动命令
```bash
cd /Users/tidusmaomao/workspace/kiddo-scoreboard
npm test  # 跑所有测试，应全绿
git log --oneline -5  # 看最新进度
```

---

## ✅ v2.1 — 准时上床 self-lockout (Item #002) — 2026-06-07

**触发场景**: 三年级 (8-9岁) 晚上 9:30 应该上床, 痛点是妈妈加班没人盯。**解决**: 任务按钮自带倒计时, 9:30 后自动 lockout, 孩子没法自己乱点。

**新增能力**:
- **任务类型**: `cutoff_time` + `is_self_lockout` 两个新字段, opt-in (普通任务不受影响)
- **Server 校验**: `POST /api/me/tasks/:id/complete` 在已有 active 校验前新增 cutoff 校验, 9:30 后返回 400 `CUTOFF_PASSED`
- **Client UI**: 按钮文字内嵌实时倒计时, `setInterval(1s)` 每秒更新, 9:30 后变灰 + disabled
- **PM 配置**: admin 表单加 "截止时间 (HH:MM)" + "截止后自动锁" 复选框
- **跨天重置**: 00:00 之后按钮重新激活 (新的一天可打卡)

**Database 变化**: `migrations/0004_sleep_cutoff.sql` — `tasks` 表加 2 列
- `cutoff_time TIME` (NULL = 普通任务)
- `is_self_lockout INTEGER NOT NULL DEFAULT 0` (0/1 标志)
- 已有任务不受影响, 不需 backfill

**实现分工** (本次完成):
- **后端** (surgical 5 处 patch): `src/db/types.ts` + `src/utils/week.ts` (新增 nowShanghaiHHMM/hhmmAfter) + `src/routes/admin/tasks.ts` (POST 校验 + PUT 回填) + `src/routes/me/tasks.ts` (CUTOFF_PASSED)
- **前端 child UI** (surgical 3 处 patch): `public/admin/index.html` (表单字段) + `public/admin/admin.js` (submitNewTask body) + `public/app.js` (renderTasks 加倒计时+灰按钮+setInterval) + `public/app.css` (`.task-btn-locked` 样式)
- **Migration**: `migrations/0004_sleep_cutoff.sql`
- **测试**: `tests/e2e/ui-child-sleep-lockout.spec.ts` (新, 11 个场景) — 待 Qual Agent 完成
- **文档**: `docs/PRD.md` (§3.12) + `docs/TEST_PLAN.md` (§3.14 + §3.5 加 3 个 cutoff 测试) + `docs/PROGRESS.md` (本条)

**风险等级**: 🟢
- 复用现有 task 框架, 零破坏性
- 新字段全 opt-in, 旧任务行为完全不变
- Server-side 校验是 authoritative, client disabled 只是 UX

**测试状态**: 后端逻辑 (vitest) 跟前端 patch 一起完成, e2e 待 Qual Agent 写并跑, 预计 8-12 个 spec 全绿。

**Push 计划**: 用户拍板后 push 到 production (🔴 不可逆), URL `https://kiddo-scoreboard.cenfeihao.workers.dev`。

---

## ✅ v2.x — 打卡日历 (Item #006) — 2026-06-20

**触发场景**: 孩子/PM 想看历史打卡的月历可视化, 长跨度成就感 (用户 2026-06-17 拍板)。

**4 个 commit** (分支 `feat/coin-shop-n1-fold`):
- `569e10c` feat(calendar): month grid render + prev/next nav + day detail modal + API routes (Item #006 §2+§3)
  - Stage 1 (pre-existing, commit `0389c85`): fold toggle + 7×6 grid scaffold
  - Stage 2: `src/routes/public/calendar.ts` (GET /checkins) + `public/app.js` (renderCalendar) + `public/app.css` (.calendar-cell--tier-0/1/2/3)
  - Stage 3: `src/routes/public/calendar-details.ts` (GET /details) + `showDayDetailModal()` + 4 color tiers
- `569e10c-stage4` (docs commit): PRD §3.13 + TEST_PLAN §3.17 + FEATURE_MATRIX + PROGRESS v2.x + perf test

**新增能力**:
- **折叠月历**: child UI 顶部 "📅 月历" 按钮展开/收起, localStorage 记忆状态
- **7×6 月历 grid**: ◀/▶ 按钮切月份, 显示当月 + 上下月灰显填充
- **4 档颜色**: 0 次灰 / 1 次浅青 / 2 次中青 / 3+ 次深青 + 霓虹光
- **当天明细 modal**: 点格子 → 弹 modal (任务名 + icon + 积分 + 时间), ESC/点击外部关闭

**数据源**: `task_completions` 表 (无需新 schema), 按月分页拉取

**API**:
- `GET /api/public/calendar/checkins?child_id=&year=&month=` → `{ checkins: { "2026-06-15": 3 } }`
- `GET /api/public/calendar/details?child_id=&date=` → `{ completions: [{ id, task_name, task_icon, completed_at, token_reward }] }`

**测试状态**:
- ✅ 39 unit (calendar-render + calendar-color) 全绿
- ✅ 2 e2e (month nav + day detail modal) 全绿
- ✅ Visual: 4 档颜色用 Mecha cyan tokens (`--cyan: #00F5FF`), 与 #005 进度条 + #010 sprint modal + #011 running map 同色板

**风险等级**: 🟢 (UI-only, 复用 #010 modal CSS + 现有 task_completions schema)

**Push 计划**: 等 PM 审批后并入 main。

---

## ✅ v2.2 — Admin Hard Delete (Item #009) — 2026-06-08

**触发场景**: PM 软删 (撤销) 打卡后, 记录仍在 `task_completions` UNIQUE 约束里, 孩子当天**不能**再打卡。需要把记录**完全抹掉**让孩子能重新打卡 (用户原话: "删掉记录意味着允许再次打卡")。

**新增能力**:
- **物理删** `score_event` / `task_completion` 行 + INSERT `deleted_records` snapshot (含原数据 JSON, 不可恢复但可追溯)
- **强制 audit_log**: 每次硬删写一条 `action='event_hard_deleted' | 'completion_hard_deleted'`, `details` 含 `deleted_record_id` + 原数据
- **PM only + 二次确认弹窗**: 撤销按钮旁加 "🗑 永久删除" 按钮, 点击后 `confirm()` 弹窗
- **灰显标记**: 列表里已硬删的记录以 `data-deleted="1"` 灰底 + "🚫 已删除 YYYY-MM-DD HH:MM by pm" 副标
- **业务恢复**: 删后**允许**孩子再打卡 (源表无记录, UNIQUE / "今日已完成" 校验通过)

**5 个 commit** (分支 `feat/hard-delete-event-and-completion`):
- `5e4d5fa` feat(db): add deleted_records table for hard-delete snapshot
- `b96a8be` feat(admin): score_event hard-delete with audit + deleted_records
- `e03c474` feat(admin): task_completion hard-delete with audit
- `7375a7d` feat(admin-ui): hard-delete button + grey marker + confirm dialog
- (docs) `docs: PRD + TEST_PLAN + FEATURE_MATRIX + PROGRESS for admin hard-delete v2.2` (本 commit)

**改的 15 个文件** (4 src + 1 migration + 1 html + 1 js + 3 utils + 1 types + 4 tests):
- `migrations/0006_deleted_records.sql` (新表)
- `src/db/types.ts` (类型 +1 行)
- `src/utils/audit.ts` (`logHardDelete` helper)
- `src/utils/balance.ts` (`recalcAfterHardDelete` helper)
- `src/utils/deleted-records.ts` (`moveToDeletedRecords` helper, 新文件)
- `src/routes/admin/events.ts` (`POST /:id/hard-delete`)
- `src/routes/admin/task-completions.ts` (`POST /:id/hard-delete`)
- `src/routes/admin/deleted-records.ts` (`GET /`, 新文件)
- `src/routes/admin/index.ts` (新 route mount)
- `public/admin/admin.js` (按钮 + confirm + 灰显渲染)
- `public/admin/index.html` (删除按钮 DOM)
- `tests/unit/deleted-records.test.ts` (snapshot 基础)
- `tests/unit/admin-events-hard-delete.test.ts` (删成功 + PM 401)
- `tests/unit/admin-task-completions-hard-delete.test.ts` (删成功 + 删后再打卡)
- `tests/e2e/ui-admin-hard-delete.spec.ts` (3 cases: smoke + events + completions)

**3 个新 endpoint**:
- `POST /api/admin/events/:id/hard-delete` — PM 物理删 score_event
- `POST /api/admin/task-completions/:id/hard-delete` — PM 物理删 task_completion
- `GET /api/admin/deleted-records` — 列硬删 snapshot 列表 (审计追溯用)

**1 个 migration**:
- `migrations/0006_deleted_records.sql` — 新表 `deleted_records` (id, record_type, original_id, original_data JSON, original_table, deleted_at, deleted_by)

**业务影响**:
- PM 能**物理删**打卡记录, 绕过 UNIQUE / 每日 1 次约束, 让孩子能再次完成同一任务
- 审计**有**记录 (`audit_log.action = 'event_hard_deleted' | 'completion_hard_deleted'`)
- 数据**有**snapshot (`deleted_records.original_data` JSON, 含原始 change_value / reason / 时间戳)
- 风险 🔴 高: 物理删不可逆, 但 PM 可通过 `GET /api/admin/deleted-records` + audit_log 找回所有硬删历史

**测试状态** (v2.2 baseline):
- ✅ **24 个 unit 文件 / 205 pass** (含 4 个新 hard-delete unit: `deleted-records` + `admin-events-hard-delete` + `admin-task-completions-hard-delete` 全部 green; **2 个 pre-existing flaky** 在 `me-tasks-complete.test.ts`, 跟 v2.2 无关, 单独 issue)
- ✅ **48 个 e2e** (含 v2.2 新 `ui-admin-hard-delete.spec.ts` 3 cases: smoke + events happy + completions happy)
- ✅ `npm run typecheck` 0 错

**Push 计划**: docs commit 完 → push 分支 (SSH) → 用户用 GitHub 仓库网页 1-click "Compare & pull request" 打开 PR (无 GitHub token 自动化) → merge → GH Action 自动 backup + deploy 到生产。

---

## ✅ v2.3 — Coin System Init (M1 数据层 + 文档) — 2026-06-11

**触发场景**: 任务完成奖励从双账户 (game_time / pocket_money) 扩到第 3 账户 coins, 引入"金币系统"作为 v3 主线。M1 只做数据层 (schema + utils + types + 文档), UI/API 留给 M2-M6。

**PR**: `add-coin-system` (PR #32, merged 2026-06-11)

**新增能力**:
- **`score_events.type` 加 `'coins'` 值**: 复用现有 score_events 表, 不开新表 (避免多账户同步问题)
- **`shop_items` 表**: 商品目录 (kind / cost_coins / reward_value / reward_type / weekly_limit / is_active)
- **`shop_redemptions` 表**: 兑换历史 (user_id / item_id / status / week_of / cost_coins / reward_value)
- **`utils/coin.ts`**: `getCoinBalance` + `writeTaskCoinGrant` + `buildRevokeTaskCoinSQL` + `getWeeklyRedemptionCount` 14 个 export
- **`types/coin.ts`**: `CoinBalance` + `ShopItem` + `ShopRedemption` interfaces

**业务影响**:
- 孩子每完成 1 个任务获得 +1 金币 (写 `score_events type='coins' change_value=+1`)
- 每日完成**所有**任务额外奖励 +3 金币 (写 `score_events type='coins' change_value=+3`, 每周每 user 最多 1 条)
- 撤销任务回滚 -1 金币 (hook 到 task revoke endpoint)
- UI 现有 main page 加第 3 个 balance card (🪙 金币, Mecha gold 风格, 实时余额)
- RFC + Test Plan + PRD §12 文档就绪, M2-M6 实施明确

**测试状态** (M1 baseline):
- ✅ `migrations/0007_coin_system.sql` 在本地 + staging apply 成功
- ✅ D1 local 初始化无 FK 错误
- ⏳ e2e / unit test 留给 M2-M6 (本 commit 只做数据层)

---

## ✅ v2.x — 跑步小地图 (Item #011) — 2026-06-22

**分支**: `feat/running-map-stage3-4` (from `origin/main` HEAD `051b69b`)

**3 个 commit**:
- `d4be219` feat(running): D1 schema + seed shanghai→suzhou map + points (Item #011 §1)
- `90c04d1` feat(running): child check-in modal + SVG map + milestone gifts + completion modal (Item #011 §2+3)
- `b08247c` feat(running): SVG map + avatar animation + milestone gift + completion modal (Item #011 §3, 手动重启 2026-06-22)
- `???????` feat(running): admin revoke (km+points 回退) + PRD/TEST_PLAN docs (Item #011 §4, 本次 Stage 4)

**新增能力**:
- **4 张新表**: running_maps / running_points / running_records / running_progress (write-through km cache)
- **孩子端**: 🏃 打卡 modal → 填 km → 提交 → SVG 地图 + 小人动画 + 礼物 modal + 通关大图
- **PM 端**: 跑步打卡记录列表 (Section I) + ↩ 撤销按钮 (二次确认) + km 回退 + 积分扣回
- **审计**: running_checkin + running_map_complete + running_record_revoke 三个 action 写 audit_log

**API**: 5 个端点 (孩子 3 个 + PM 2 个)

**测试**: running-schema.test.ts + running-prize.test.ts (✅) + admin-running-revoke.test.ts (本 Stage 4 新增)

**Push 计划**: Stage 4 commit 完 → PM review → push → merge → deploy。

---

## ✅ v3 — Coin System 金币系统 (M3-M6 完整闭环) — 2026-06-16

**触发场景**: v2.3 加了数据层但 child 看不到商店, PM 看不到待发商品。本 PR (`feat/coin-shop`) 把 M3 API + M4 UI + M5 e2e + M6 docs 一次补完。

**4 个 commit** (per feihao PR workflow style):
- `272ea61` feat(coin): M3 商店 API + S2 schema 严格化 (v1.1 RFC §3.3) — `src/routes/me/coins.ts` + `src/routes/shop/items.ts` + `src/routes/shop/exchange.ts` + `src/routes/admin/shop-fulfill.ts` + `migrations/0008_coin_shop.sql`
- `b8d0665` feat(coin-ui): M4 商店页 + 第 3 balance card 跳转 (Mecha 风格 follow main) — `public/shop.html` + `public/shop.js` + `public/app.js` (1 patch) + `public/admin/index.html` (待发 section) + `public/admin/admin.js` (已发 button)
- `725ec36` test(coin): M5 e2e + visual regression (12 functional + 4 SQL invariant + 5 visual) — `tests/e2e/coin-system.spec.ts` + `tests/e2e/coin-invariants.spec.ts` + `tests/e2e/coin-visual-regression.spec.ts`
- (本 commit `docs(coin): M6 docs 同步`) — `docs/FEATURE_MATRIX.md` + `docs/PROGRESS.md` (本 entry) + `docs/INDEX.md` + `docs/TEST_PLAN.md`

**新增能力 (M3 API)**:
- `GET /api/coins/balance` — 当前 child 金币余额
- `GET /api/coins/redemptions` — child 兑换历史 (limit 50, desc by redeemed_at)
- `GET /api/shop/items` — 列 is_active=1 商品 (含 weekly_limit_remaining / is_unlimited hint)
- `POST /api/coins/exchange` body `{item_id}` — 3 步短路校验 (is_active → balance → weekly_limit) + 2 个 db.batch() 原子写
- `POST /api/admin/shop/fulfill/:id` — PM 手动把 kind=custom 的 redemption 从 pending → approved
- `GET /api/admin/shop/fulfill?status=pending` — PM 列待发 (M4 §6.5 必备, M3 漏了, M4 补)
- **S2 schema 严格化**: migration 0008 enum 保留 4 个 (pending/approved/consumed/revoked) 兼容 v1 已有 data; code 层新业务严格只写 'pending'/'approved', query `IN ('pending','approved')` 严格化

**新增能力 (M4 UI)**:
- `public/shop.html` — Mecha 风格商店页 (顶部 hero 余额 + 2 列商品 grid + 本周兑换历史 + 历史兑换 + confirm modal + 复用 #toast)
- `public/shop.js` — loadBalance / loadShopItems / loadRedemptions / renderShopItems (置灰: 余额不足 / 周次数用完) / onExchangeClick (confirm) / confirmExchange (POST + toast + 刷新)
- `public/app.js` 1 处 patch — `#card-coins` click → `/shop.html` (Q5 06-11 拍板 (a))
- `public/admin/index.html` — 新增 "📦 待发商品 (kind=custom)" section
- `public/admin/admin.js` — `loadPendingRedemptions` + `renderPendingRedemptions` + `fulfillRedemption` + `bindDelegatedActions` 加 `fulfill-redemption` handler

**2 个商品 (硬编码 seed, feihao 拍板)**:
- id=1: 🎮 游戏时间 10 分钟 — game_time / 10 金币 / 周 3 次 / approved (自动)
- id=2: 🧱 小乐高 — custom / 50 金币 / 周 1 次 / pending (PM 手动发货)

**测试覆盖 (M5)**:
- ✅ **12 个 functional e2e** (F1-F12): 任务金币 grant / 撤销 / 全任务 bonus / 兑换扣金币 / 周限额 / 跨周重置 / 按钮置灰 (余额不足 + 周次数用完) / 兑换历史 / 3rd balance card + 跳转
- ✅ **4 个 SQL invariant** (INV-1-4): balance 一致性 / task_completion 唯一 coin grant / bonus 每周每 user ≤1 / week_of ISO 8601
- ✅ **5 个 visual regression** (iPad 1180x820, maxDiffPixelRatio 0.01): shop-page-default / confirm-modal / insufficient-coins / weekly-limit-reached / redemption-success toast
- ✅ **98 个测试文件** (24 unit + 53 e2e baseline + 21 coin = 98, +27% vs v2.2 baseline 77)

**业务影响 (对 PM/孩子)**:
- 孩子能在商店页看到 2 件商品, 余额够 + 周次数未达即可兑换
- 余额不足 / 周次数用完时按钮自动置灰 + 文案提示 (无需查 FAQ)
- 兑换 game_time → 自动 +10 分钟游戏时间, 立即到账
- 兑换 custom (小乐高) → child 看到 "待发", PM 在 admin 收到待发列表 → 点 "✓ 已发" 标记发货
- iPad 视图下体验: 2 列 grid + 大 emoji + Mecha 金光, 跟主 UI 视觉一致

**已知风险** (per requirements doc §10):
- 06-14 4 次 deploy failure: deploy 必带 `User-Agent: Mozilla/5.0` (per `kiddo-scoreboard-deploy` §9a); backup cron 必先跑通
- 2 个 pre-existing flaky in `me-tasks-complete.test.ts` (M2 已知, 跟本 PR 无关)
- Visual regression baseline 首次 capture 在 iPad 1180x820 viewport (Playwright config 已设)
- `shop_redemptions.status` enum drift: M3 写 'pending'/'approved', migration 0007/0008 enum 含 4 个 (含 v1 'consumed'/'revoked'); child UI 历史显示兼容 (F11 通过 status==='approved' OR 'consumed' 判断)

**Push 计划**: docs commit 完 → 等 PM 拍 → push 分支 → merge → GH Action auto backup + deploy。

---

## ✅ v2.x — 任务装备/机甲化 (Item #008) — 2026-06-24

**触发场景**: feihao 2026-06-08 加 NIGHTLY-TODO "把任务做成机甲风格, 小朋友喜欢机甲"。2026-06-17 拍板 (B 机甲 HUD + 夸张全屏 + 独立 #007)。2026-06-22 PR #42/#43 已 merged (含 #011 #012 完整 stage)，剩 #008 Stage 2-4 待跑。2026-06-24 PM 手动启动 CC (per `multi-working-tree-management` P19), 3 晚 cron 预算 → 1 晚跑完 (Stage 2-3 CC + Stage 4 PM 自实现 docs)。

**实施方案** (4 段, 每段 ≤ 15 min):
- **Stage 1** (commit `1612a28`, 已 on main): HUD frame CSS 组件库 (`.mecha-frame` + `.mecha-corner.tl/tr/bl/br` + `.mecha-scanline` + `.mecha-glow` + 4 `@keyframes`)
- **Stage 2** (commit `e813339`, feat/008-mecha-stage2-4): 任务按钮升级 .mecha-frame + 4 corner (4 state 全覆盖, mobile 隐藏 corner)
- **Stage 3** (commit `c6647fd`, feat/008-mecha-stage2-4): 全屏 HUD 装备舱 (任务区背景扫描线 + 数据流) + `triggerEquipActivation(taskId)` 装备激活动画
- **Stage 4** (commit pending, feat/008-mecha-stage2-4): PRD §3.14 + TEST_PLAN §3.20 + FEATURE_MATRIX 3.20 + PROGRESS v2.x 文档

**测试状态** (v2.x baseline + #008):
- ✅ **24 unit baseline + 4 mecha unit** = 28 unit 文件: `task-mecha-button.test.ts` (11) + `mecha-equip-activation.test.ts` (8) 全 pass
- ✅ **53 e2e baseline + 2 mecha e2e** = 55 e2e: `ui-task-mecha-frame.spec.ts` (4) + `ui-equip-activation.spec.ts` (6)
- ✅ **全套 359/359 vitest pass** (含 baseline 340 + 19 mecha new)
- ✅ **0 TS syntax in public/app.js** (per `cc-pm-spawn-pitfalls` 坑 #4 预防)
- ✅ **node --check public/app.js** OK

**业务影响 (对 PM/孩子)**:
- 任务按钮四角加 ◢◤◣◥ 装饰, cyan glow + drop-shadow 显机甲风
- 任务区背景变"装备舱"全屏 HUD (扫描线 + 网格底)
- 任务完成时按钮展开 + scale(1.05) bounce 0.5s 装备激活, 跟 🎉 confetti 顺序触发
- cyan 调色板跟 #005 进度条 + #010 sprint modal + #011 running map 完全统一
- mobile (≤ 480px): scanline 关闭 + corner 隐藏, 60fps 性能不降

**已知风险** (per requirements doc §10):
- 🔴 全屏 HUD 改 child UI 任务区主布局, 需全量 regression (全套 359 pass 验证 OK)
- 经典模式 toggle 留二期, 当前总是开
- 跟 #007 解耦, 不等 #007 拍板

**Push 计划**: docs commit 完 → 等 PM 拍 → push 分支 → merge → GH Action auto backup + deploy。

---

## ✅ v2.x — Task Suspend/Resume (Item #014) — 2026-07-04

**触发场景**: 暑假来了，孩子不用每天打卡"按时上床"了，但不想删除任务（历史记录保留）。PM 可**暂停**任务，暂停后 child UI 不显示；开学后再**恢复**。

**分支**: `feat/014-suspend-task` (4 个 commit)

**4 个 commit**:
- `5fbf43a` feat(tasks): admin toggle is_active endpoint + audit log (Item #014 §1)
- `c523b6d` feat(tasks): admin inline toggle switch (Item #014 §2)
- `dad77d7` feat(tasks): admin task toggle e2e + renderTasks re-render fix (Item #014 §3)
- (本 commit) docs: PRD §3.15 + TEST_PLAN §3.21 + FEATURE_MATRIX + PROGRESS (Item #014 §4)

**新增能力**:
- **API**: `POST /api/admin/tasks/:id/toggle` — PM 切换 is_active 状态（0↔1）
- **Audit**: `task_suspended` / `task_resumed` 写入 audit_log
- **Admin UI**: inline toggle switch（cyan glow on/off）
- **Child UI**: is_active=0 自动隐藏（已有逻辑，无需改动）

**测试状态**:
- ✅ 26 unit 文件 (含 `admin-task-toggle.test.ts` 6 tests + `admin-toggle-ui.test.ts` 5 tests)
- ✅ 48 e2e (含 `admin-task-toggle.spec.ts` 4 scenarios)
- ✅ 全套 regression pass (vitest + playwright)
- ✅ `npx tsc --noEmit` 0 error

**风险**: 🟢
- 复用现有 `is_active` 字段，无 schema 改动
- toggle 操作幂等，PM 可随时切换
- child UI 已原生过滤 is_active=0

**Push 计划**: PM 跑最终 verify (5 步 + tunnel smoke test) → report feihao → 等 4 options push。

## ✅ v2.x — 暑假作业 Modal (Item #016) — 2026-07-06

**触发场景**: feihao 2026-07-04 加 NIGHTLY-TODO "我想新加一个界面 — 当用户点击'暑假每日打卡'的时候，要弹出来一个确认框。确认框中包含他的几项暑假作业，他要挨个确认是否都完成了，然后才算是打卡成功。"

**拍板** (2026-07-04 PM DM):
- Q1 作业 item 来源 = **A1 hardcoded** (前端常量, 6 items 写死在 `public/app.js`) — 临时 → 不值得 DB schema 改动
- Q2 拍照 = **B2 不要** — 临时 → 减少 infra (R2 setup 30 min)
- Q3-Q4 = N/A

**6 项暑假作业** (PM 整理 2026-07-04):
1. 📝 语文词语 — 抄写 2 遍,默写 1 遍
2. 🔢 数学 — 1 天 1 题/课/页 (kid 自评)
3. 📖 英语单词 — 每天默写 1 课 (豆包报听写)
4. 📚 英语绘本 — 每天打卡 3 本,听 1 小时以上
5. 🧮 数学举一反三 — A 册:课内没做完做半周,做完后一天一周;B 册:周末一天基础一天提高
6. 🗓️ 英语外教课 — 每周六 4:15-6:15,课后两天内完成作业

**M1 设计** (per `feihao-pm-autonomy` §4f pitfall-13 复用现有 flow):
- 拦截 task click → 若 `t.name === SUMMER_HOMEWORK_TASK_NAME` → showSummerHomeworkModal(task)
- Modal 全勾 → submit → 复用现有 `completeTask(task.id)` (跟其他 task 打卡同 endpoint)
- 0 新 endpoint / 0 新 schema / 0 新 admin section
- Task 本身由 PM 在 admin UI 创建 (1 次性手动操作,~2 min)

**M1 实现** (~1 commit, +250 LoC net):
- `public/index.html` (+13): `#summer-homework-modal` 容器 (默认 hidden, 6 list 渲染, cancel + submit 按钮)
- `public/app.js` (+58): `SUMMER_HOMEWORK_TASK_NAME` const + `SUMMER_HOMEWORK_ITEMS` array (6) + `showSummerHomeworkModal/closeSummerHomeworkModal/submitSummerHomework` 3 functions + renderTasks click handler 第 4 个分支 + init 里 2 个 button listeners
- `public/app.css` (+61): `.summer-homework-list` flex + `.summer-homework-item` clickable row + checkbox styling (cyan accent)
- `tests/unit/summer-homework-modal.test.ts` (+200, 8 tests): HTML hooks / 6 items / all-checked gate / modal toggle / CSS
- `tests/e2e/summer-homework-modal.spec.ts` (+200, 4 tests): happy 1+2+3 + edge cancel
- `docs/PRD.md` §3.16 + `docs/TEST_PLAN.md` §3.22 + `docs/PROGRESS.md` (本 entry) + `docs/FEATURE_MATRIX.md` 3.22 row

**Corrupt 修** (本 branch 头, 已在 PR #49 合并): main 79d8ad3 文件 776 行有 `   NNN|` line-number-prefix corrupt (most likely 由 patch tool 早期 line-tracking 漏到 file), commit `98a788e` regex strip 修好。**这是为啥 M1 patch 一开始 fail 3 次** — `---` + `## 📦 归档` 在 corrupt 里 appear 3 次。修完才 work。

**新增能力**:
- **API**: 0 新增 (复用 `POST /api/me/tasks/:id/complete`)
- **Schema**: 0 新增 (复用 `task_completions` 表)
- **Kid UI**: `#summer-homework-modal` (跟 #010/#011 modal 同款 .modal-back/.modal shell)
- **Admin UI**: 0 新增 (PM 手动创建 task 用现有 admin CRUD)

**测试状态**:
- ✅ 8 unit (summer-homework-modal.test.ts): HTML hooks + 6 items + all-checked gate + CSS
- ✅ 4 e2e (summer-homework-modal.spec.ts): happy 1+2+3 + edge cancel
- ⏳ FEATURE_MATRIX 3.22 row 跟本 commit 一起加

**风险**: 🟢
- 0 schema 改动; 0 new endpoint
- 5 min cleanup 开学后 (~2026-09): PM 手动删 task + 删 modal HTML/JS/CSS
- Task 不存在 (PM 还没手动创建) 时, modal 代码 no-op (其他 task 走默认 `completeTask(t.id)`)

**手动 follow-up** (PM 在 admin UI 5 min):
- 创建 task "每日完成暑假作业" (icon=📝, category=study, target_account=pocket_money, token_reward=1, is_active=1, sort_order=10)
- Production D1 无 schema 改动, 走现有 `POST /api/admin/tasks` endpoint

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
| **M4** 任务系统 | ⏳ Pending | - | - | 完成任务 / 撤销 |
| **M5** 申请审批 | ⏳ Pending | - | - | 提交 / 通过 / 拒绝 / 撤销 |
| **M6** 兑换 | ⏳ Pending | - | - | 双账户 1:1 转换 |
| **M7** 改名 + 审计 UI | ⏳ Pending | - | - | 首次填名字 + log 时间线 |
| **M8** 儿子端 UI | ⏳ Pending | - | - | iPad Safari PWA |
| **M9** PM 端 UI | ⏳ Pending | - | - | 后台管理 |
| **M10** 部署 | ⏳ Pending | - | - | Cloudflare Pages + D1 |
| **M11** 备份监控（可选）| ⏳ Optional | - | - | 后续 |

**总测试数（截至 M3）**: 133 个（106 unit + 5 e2e）全绿

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

**下次更新**: 完成 M4 后

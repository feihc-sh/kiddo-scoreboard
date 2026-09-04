# 🎮 kiddo-scoreboard

**儿子计分板** — Cloudflare Workers + D1 + Hono 驱动的家庭奖励/惩罚 Web PWA。

> 双账户（🎮 游戏时间 + 💰 零花钱）1:1 互通，PM（爸爸）可撤销任何操作，儿子只能提交申请。所有加减有完整审计 log。

**生产**: https://kiddo-scoreboard.pages.dev (5/5 endpoint 200) | **状态**: 🟢 上线 (2026-06-08) | **D1**: 4/4 migration | **e2e**: 182/182 pass

> **🚫 2026-09-04 feihao**: 暑假作业 feature 已禁用 (Item #016 §7,生产 D1 `tasks.is_active=0`,kid UI / modal / admin 报表全隐藏)。数据完整保留,详见 [`docs/SUMMER-HOMEWORK-DISABLED.md`](./docs/SUMMER-HOMEWORK-DISABLED.md)。

---

## 📑 文档索引 (其他 agent 必看)

**新来这个 repo? 先看 [`docs/INDEX.md`](./docs/INDEX.md)** — 5 秒跳到你需要的文档。

按角色:
- **新 Agent 上手** → [INDEX.md](./docs/INDEX.md) → [PRD.md](./docs/PRD.md) → [PROGRESS.md](./docs/PROGRESS.md) → [PLAN.md](./docs/PLAN.md)
- **Code Agent 改代码** → [PRD.md](./docs/PRD.md) + [TEST_PLAN.md](./docs/TEST_PLAN.md) + [PLAN.md](./docs/PLAN.md) + [NIGHTLY-TODO.md](./docs/NIGHTLY-TODO.md)
- **Qual Agent 跑测试** → [TEST_PLAN.md](./docs/TEST_PLAN.md) + [QUAL_CLEAN_RUN_CHECKLIST.md](./docs/QUAL_CLEAN_RUN_CHECKLIST.md)
- **PM / 部署运维** → [DEPLOY.md](./DEPLOY.md) + [SECURITY-REMOTE-OPS.md](./docs/SECURITY-REMOTE-OPS.md) + [INCIDENTS.md](./docs/INCIDENTS.md) (如有)

---

## ✨ 核心特性

- **双账户模型** — 游戏时间（分钟）和零花钱（元）独立余额，可 PM 手动发起 1:1 兑换
- **任务系统** — PM 配置任务模板，儿子/PM 一键点击完成（每天每任务 1 次，可撤销重做）
- **审批工作流** — 儿子提交加减申请 → PM 通过/拒绝/撤销
- **周额度发放** — 周末"发工资"，支持双账户分配
- **审计 log** — 所有写操作留痕，含 actor / action / 详情 JSON
- **iPad 优先 UI** — Warm Playful 风格（暖奶白 + 圆角 + 果冻动画）

---

## 🛠️ 技术栈

- **Runtime**: Cloudflare Workers（V8 isolates）
- **Storage**: Cloudflare D1（SQLite，免费 5GB / 50M reads/day）
- **Framework**: [Hono](https://hono.dev/) 4
- **DB Tool**: [Drizzle ORM](https://orm.drizzle.team/)（计划）
- **Tests**: Vitest（unit）+ Playwright（e2e，iPad Safari viewport）
- **Auth**: PIN + bcrypt + Cookie session
- **语言**: TypeScript 6（strict mode）

---

## 📁 项目结构

```
kiddo-scoreboard/
├── docs/
│   ├── PRD.md           # 产品需求文档 v2.0
│   ├── PLAN.md          # 实施计划（含 11 个 Module 切分）
│   ├── PROGRESS.md      # 实时进度跟踪
│   ├── demo.html        # 静态原型（已用 PRD v2 + Warm Playful 设计验证）
│   └── demo-screenshots/
├── migrations/
│   └── 0001_initial.sql # 5 张表 schema
├── src/
│   ├── worker.ts        # Hono app 入口
│   ├── db/types.ts      # TS interface + 枚举
│   └── utils/
│       ├── week.ts      # Asia/Shanghai 时区 + ISO 8601 周
│       ├── balance.ts   # 余额聚合查询
│       └── audit.ts     # 审计 log 写入/读取
├── tests/
│   ├── unit/            # Vitest (39 tests)
│   └── e2e/             # Playwright (3 tests, iPad Safari)
├── package.json
├── wrangler.toml
├── tsconfig.json
├── vitest.config.ts
└── playwright.config.ts
```

---

## 🚀 快速开始

```bash
# 安装
npm install

# 启动本地 dev server（wrangler + local D1）
npm run dev

# 跑单测
npm run test:unit

# 跑 e2e（iPad Safari viewport + 真实 wrangler dev）
npm test

# 类型检查
npm run typecheck
```

---

## 📊 当前状态

**进度**: 🟢 Module 1/11 完成（M0 脚手架 + M1 数据模型 + 工具 + 39 单测）

**测试**: 39 unit + 3 e2e 全绿（0 失败）

**数据库**: 5 张表已固化（users / score_events / tasks / task_completions / audit_log）

**下一步**: M2 — PM 认证（PIN + Session cookie + lockout）

完整进度见 [`docs/PROGRESS.md`](./docs/PROGRESS.md)。

---

## 🤖 Mecha-Challenge 小程序迁移 (Phase 0 + Phase 1)

> **品牌名**: 机甲挑战计分板 | **项目代号**: mecha-challenge-scoreboard | **PRD**: `~/.hermes/profiles/pm-for-claude/plans/mecha-challenge-scoreboard-PRD-V1.md`

### 目标
基于 kiddo-scoreboard 现有 Cloudflare Workers + D1 后端，新增微信小程序前端（机甲挑战计分板）。

### Phase 0 范围（已完成 2026-08-02）
- ✅ Monorepo 骨架: `apps/miniprogram/` + `packages/shared/` (npm workspaces)
- ✅ 数据模型扩展: `migrations/0016-0018` (families / questions / question_attempts) + `users.openid` 字段
- ✅ TS Domain 共享: `packages/shared/src/` (Family / Question / User + openid)
- ✅ TDD 测试框架: 22+ shared 单测 + vitest projects 配置
- ✅ PR 门禁: `scripts/pre-pr-check.sh` + husky + lint-staged + GitHub Actions (web-ci + miniprogram-ci)
- ✅ PR 模板: `.github/PULL_REQUEST_TEMPLATE.md`

### Phase 0 测试 baseline
- `npm run test:shared` → ✅ 全 PASS (Phase 0 直接产出)
- `npm run typecheck` → ✅ 无错
- `npm run test:unit` → ⚠️ 7 pre-existing happy-dom errors (详见 [`docs/MECHA-PHASE-0-BASELINE.md`](./docs/MECHA-PHASE-0-BASELINE.md)，非 Phase 0 引入)

### Phase 1 范围（已完成 2026-08-03）
- ✅ Taro 4 接入: `apps/miniprogram/` 初始化 + `dist/` 生成（1.77s）
- ✅ wx.login 桥: `POST /api/mp/auth`（7 tests，wx code2Session + openid 绑定）
- ✅ 4 选 1 题型 API: `GET /api/mp/questions/random` + `POST /api/mp/questions/attempt`（26 tests，anti-cheat）
- ✅ 小程序 UI: Warm Playful 风格（kiddo 配色 + 圆角 + 暖奶白背景）
- ✅ kiddo 现有代码未改动（`public/app.html` / `public/admin/` / `src/worker.ts` 保护）

### Phase 1 测试结果
- `npm run test:unit` mp-auth + mp-questions → **33 tests 全绿**
- `npx taro build --type weapp` → **Webpack compiled successfully**
- `npm run test:shared` → ✅ 全 PASS
- `npm run typecheck` → ✅ 无错

### Phase 1 关键决策（Plan-A, 2026-08-02 feihao 拍板）
- **不另起后端**: 复用 kiddo 现有 Cloudflare Workers + D1 + Hono 4
- **不切 pnpm**: 沿用 npm（避免 lockfile 重建 + 现有 81 devDeps 重装）
- **不重写 domain**: `packages/shared/` 从 `src/db/types.ts` 抽出子集，加 4 选 1 题型类型
- **只新增 3 张表**: families / questions / question_attempts
- **wx.login 桥**: CF Worker 直接 fetch wx code2Session（无云函数，最小代价）

### Phase 2 待办
详见 [`docs/mecha-challenge-phase1-task-card.md`](./docs/mecha-challenge-phase1-task-card.md) 和 [`docs/mecha-challenge-phase1-completion.md`](./docs/mecha-challenge-phase1-completion.md)

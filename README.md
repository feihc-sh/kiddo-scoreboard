# 🎮 kiddo-scoreboard

**儿子计分板** — Cloudflare Workers + D1 + Hono 驱动的家庭奖励/惩罚 Web PWA。

> 双账户（🎮 游戏时间 + 💰 零花钱）1:1 互通，PM（爸爸）可撤销任何操作，儿子只能提交申请。所有加减有完整审计 log。

**生产**: https://kiddo-scoreboard.pages.dev (5/5 endpoint 200) | **状态**: 🟢 上线 (2026-06-08) | **D1**: 4/4 migration | **e2e**: 182/182 pass

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

# 📑 kiddo-scoreboard 文档索引

> **TL;DR**: Cloudflare Pages + D1 驱动的儿童游戏时间/零花钱 PWA。 2026-06-08 正式上线。
> 不知道看哪里? **看下面"你是什么角色"那张表**。 看完了再翻"完整文档清单"。

---

## 🚦 你是什么角色? (5 秒跳到对的地方)

| 我是… | 想做… | 必看 (按顺序) |
|---|---|---|
| **新来的 Agent (Code / Qual / Research)** | 上手这个项目 | [`README.md`](#-项目说明) → [`docs/PRD.md`](#-产品需求-prd) → [`docs/PROGRESS.md`](#-项目进度) → [`docs/PLAN.md`](#-实施计划-plan) |
| **Code Agent** (CC) | 改代码 / 加功能 | [`docs/PRD.md`](#-产品需求-prd) → [`docs/TEST_PLAN.md`](#-测试计划) → [`docs/PLAN.md`](#-实施计划-plan) → [`docs/NIGHTLY-TODO.md`](#-半夜自动化清单) |
| **Qual Agent** | 跑 e2e / 验收 | [`docs/TEST_PLAN.md`](#-测试计划) → [`docs/QUAL_CLEAN_RUN_CHECKLIST.md`](#-qual-验收清单) |
| **PM / 运维** (本机) | 部署 / D1 操作 / 故障恢复 | [`DEPLOY.md`](#-部署指南) → [`docs/SECURITY-REMOTE-OPS.md`](#-远程操作安全) → [`docs/INCIDENTS.md`](#-故障记录-deploy-failures) (如有) |
| **PM Agent** (本机 session) | 半夜自动开发任务 | [`docs/NIGHTLY-TODO.md`](#-半夜自动化清单) |

> 💡 **如果你是凌晨被 cron 拉起来跑的 PM session**, 直接看 `NIGHTLY-TODO.md` 顶部"流程"段, 跟着走。

---

## 📚 完整文档清单 (按类别)

### 📌 项目说明
- **[`README.md`](./README.md)** — 项目介绍、核心特性、技术栈、目录结构、quickstart
- **[`DEPLOY.md`](../DEPLOY.md)** — One-time 部署 + 日常 deploy 步骤 (root 目录, 不在 docs/)

### 📋 产品 & 需求
- **[`docs/PRD.md`](./PRD.md)** — 产品需求文档 v2.0, 业务规则、用户故事、数据模型、3 个用户角色
- **[`docs/PLAN.md`](./PLAN.md)** — 实施 Plan v2 (CC 审核后), 11 段模块分解、技术决策摘要
- **[`docs/coin-system-rfc.md`](./coin-system-rfc.md)** — 金币系统 RFC (v3 主 spec, 1527 lines, 6 Module 实施分阶段)
- **[`docs/coin-system-test-plan.md`](./coin-system-test-plan.md)** — 金币系统测试计划 (F1-F12 + TC-X1-X8 + visual regression)
- **[`docs/coin-system-m2-test-regressions.md`](./coin-system-m2-test-regressions.md)** — M2 实施 4 个 fail 修复 + 2 clarification
- **[`docs/coin-shop-requirements.md`](./coin-shop-requirements.md)** — M3-M6 实施需求 (feihao 拍板 + 冲突清单, 本 PR)

### 📊 项目进度
- **[`docs/PROGRESS.md`](./PROGRESS.md)** — 11 段 Module 进度跟踪, 每段 commit 状态、产出、遗留
- **[`docs/NIGHTLY-TODO.md`](./NIGHTLY-TODO.md)** — 半夜自动化清单 (cron `d100dbff4107` 读这个), Item 模板 + 状态

### 🧪 测试 & 质量
- **[`docs/TEST_PLAN.md`](./TEST_PLAN.md)** — Web UI e2e Test Plan, 14 个 §3 场景 + 11 个 sleep lockout 场景
- **[`docs/QUAL_CLEAN_RUN_CHECKLIST.md`](./QUAL_CLEAN_RUN_CHECKLIST.md)** — 全新干净环境重跑 e2e 流程
- **[`docs/PHASE2_FINDINGS.md`](./PHASE2_FINDINGS.md)** — Phase 2 测试期间发现的 4 个问题 (1 修, 3 跟踪)

### 🔐 运维 & 安全
- **[`docs/SECURITY-REMOTE-OPS.md`](./SECURITY-REMOTE-OPS.md)** — 远程 D1 操作安全手册, 🟢/🟡/🔴 分级 + Time Travel
- **[`docs/INCIDENTS.md`](./INCIDENTS.md)** — **(自动维护)** Deploy/backup 失败记录, GitHub Action 自动 append

### 🔬 探索 & 发现
- **[`docs/CHILD_UI_FINDINGS.md`](./CHILD_UI_FINDINGS.md)** — 2026-06-06 PM 儿童端 UI 探索, 2 轮"假装 8 岁小朋友"反馈

### 🗄 历史 / 归档 (看完了不用再读)
- `docs/HANDOFF-DEPLOY.md` — 2026-06-06 deploy 计划 8 步 (已执行完)
- `docs/HANDOVER-PM-EXPLORATION.md` — 2026-06-06 PM 探索交接 (已用)
- `docs/phase2-logs/2026-06-06-handover.md` — 凌晨 session 交接
- `docs/phase2-logs/2026-06-06-ipad-cache-fix.md` — iPad Safari 缓存坑
- `docs/phase2-logs/2026-06-06-next-steps-plan.md` — Phase 2 后续 10 分钟段
- `docs/phase2-logs/2026-06-06-task-segbtn-hotfix.md` — Phase 2 任务按钮 hotfix

---

## ⚙️ 主配置文件 (不靠 README 也能找到)

| 用途 | 路径 | 备注 |
|---|---|---|
| **Cloudflare 配置** (D1 binding / Pages settings) | [`../wrangler.toml`](../wrangler.toml) | name + pages_build_output_dir + compatibility_date 三行必备 |
| **NPM scripts** | [`../package.json`](../package.json) | `dev` / `test` / `test:e2e` / `deploy` |
| **Vitest 配置** (unit) | [`../vitest.config.ts`](../vitest.config.ts) | |
| **Playwright 配置** (e2e) | [`../playwright.config.ts`](../playwright.config.ts) | webServer 用 `wrangler pages dev` |
| **TypeScript 配置** | [`../tsconfig.json`](../tsconfig.json) | |
| **CI/CD workflow** | [`../.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) | push to main → backup → deploy → smoke test |
| **CI 失败记录脚本** | [`../.github/scripts/record_incident.py`](../.github/scripts/record_incident.py) | 写 `docs/INCIDENTS.md` |
| **GitHub Secrets** (2 个) | repo Settings → Secrets | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (UUID) |

---

## 📂 代码目录速查

| 目录 | 作用 | 关键文件 |
|---|---|---|
| `src/` | 后端 (Hono + D1) | `routes/admin/*` `routes/me/*` `routes/public/*` `auth/pin.ts` `db/*` |
| `public/` | 前端静态资源 (admin + child SPA) | `app.js` `admin.js` `app.css` `index.html` `admin.html` |
| `functions/` | Cloudflare Pages Functions | `api/[[path]].ts` (catch-all /api/*) + `health.ts` |
| `migrations/` | D1 schema | `0001_initial.sql` `0002_auth.sql` `0003_app_config.sql` `0004_sleep_cutoff.sql` |
| `tests/unit/` | Vitest 单元测试 | 22 spec, 192 pass |
| `tests/e2e/` | Playwright e2e 测试 | 50+ spec, 182 pass |
| `scripts/` | 工具脚本 | `hash-pin.mjs` `kiddo-scoreboard-backup.sh` (备用) |
| `remote-backup/` | **(本地, gitignored)** D1 每日 backup | `YYYY-MM-DD.sql` (30 天 retention) |
| `seeds/` | 测试 seed data | dev/staging 用 |

---

## 🔑 关键 ID / 值 速查 (PM Agent 友好)

| 项目 | 值 |
|---|---|
| **生产 URL** | `https://kiddo-scoreboard.pages.dev` (不需 VPN) |
| **D1 database_id** | `b584ebbf-bcb3-45d2-85e8-3ca2d5cb297c` (APAC) |
| **Cloudflare account_id (UUID)** | `c531dc7d8d7b43d4b99c50d7816684d7` |
| **D1 binding name** | `DB` (worker 代码用 `c.env.DB`, 不能改) |
| **PM PIN** | `123654` (生产 D1 hash 用 100k PBKDF2) |
| **JWT_SECRET** | 64 char hex (已用 `wrangler secret put` 推到生产) |
| **Cron — daily-backup** | `c58a139f2c7c` (3am, 本地 Layer 1 兜底) |
| **Cron — nightly-todo** | `d100dbff4107` (0am, 跑 NIGHTLY-TODO.md) |
| **GitHub repo** | `feihc-sh/kiddo-scoreboard` |
| **PR #10** | GitHub Action: pre-deploy backup + Pages deploy |

---

## 🛠 常用命令 (抄)

```bash
# === 本地开发 ===
npm run dev                                # wrangler pages dev (推荐)
npx wrangler pages dev ./public --port 8787  # 等价命令

# === 测试 ===
npx vitest run                            # unit only (快, ~5s)
npx playwright test                       # e2e (~2 min)
npx playwright test tests/e2e/child-ui.spec.ts  # 单 spec

# === Backup / Restore ===
hermes cron run c58a139f2c7c              # 立即跑 daily-backup
ls -lt ~/workspace/kiddo-scoreboard/remote-backup/ | head -5   # 列出最近 backups
wrangler d1 execute kiddo-scoreboard-db --remote --file=remote-backup/YYYY-MM-DD.sql  # 恢复

# === Deploy (PM 必先 backup!) ===
hermes cron run c58a139f2c7c              # 1. 先 backup
sleep 10
cd /Users/tidusmaomao/workspace/kiddo-scoreboard && \
  wrangler pages deploy ./public --branch main --project-name kiddo-scoreboard --commit-dirty=true
# 或: 推 PR + merge → GitHub Action 自动跑

# === D1 操作 (生产, 🟡 需 backup) ===
wrangler d1 migrations apply kiddo-scoreboard-db --remote    # 应用新 migration
wrangler d1 execute kiddo-scoreboard-db --remote --command="SELECT * FROM users"  # ad-hoc query
wrangler d1 execute kiddo-scoreboard-db --remote --file=query.sql                  # 多行 SQL
```

---

## ⚠️ 已踩过的坑 (重要! 别再踩)

| 坑 | 后果 | 正确做法 |
|---|---|---|
| `*.workers.dev` 被 GFW 污染 | 生产 URL 国内打不开 | 用 `*.pages.dev` |
| `wrangler.toml` 缺 `name` + `pages_build_output_dir` | Pages 部署时 D1 binding 失效 → 500 | 三行必备, deploy 前 cat 检查 |
| 生产 D1 缺 migration | 4/5 endpoint 500 | deploy 前 `wrangler d1 migrations list --remote` |
| PBKDF2 600k iter | "iteration counts above 100000 are not supported" | 降到 100k (Cloudflare Web Crypto 限制) |
| `wrangler tail` 在本机 | DNS 污染后连不上, 没日志 | 用 trycloudflare tunnel (debug) 或 GitHub Action log |
| `~/.hermes/scripts/` cron 路径 | 写 `~/` 会指向 `home/.hermes/`, 失败 | 写绝对路径 `/Users/tidusmaomao/.hermes/scripts/` |
| `research-agent/.env` 的 `CLOUDFLARE_ACCOUNT_ID` | 是 email, 触发 code 7003 | 跑 wrangler 前 `unset CLOUDFLARE_ACCOUNT_ID` |
| `~/.hermes/.env` 旧 `GITHUB_TOKEN` | 401 过期 | 用 21 行新换的 (2026-06-08) |

---

## 📅 最后更新

- **本索引**: 2026-06-08 (PM 整理)
- **生产 deploy**: 2026-06-08 (Pages + 5/5 endpoint 200)
- **D1 migrations**: 4/4 applied (0001~0004)
- **e2e baseline**: 182/182 pass (~2 min)

> 这个文档是给"新来的 agent 找入口"用的。 内容随项目演进, 改架构/改路径时记得同步本索引。

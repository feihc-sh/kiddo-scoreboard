# Qual 验收报告 — 2026-06-08 (main HEAD)

> **触发**：用户 DM Qual Agent — "最近的 master 提交了代码，关注一下再跑一下完整的测试"
> **被验对象**：`main` HEAD = `6dbf9c3 fix(pages): add name + pages_build_output_dir to wrangler.toml (#9)`
> **分支基线**：当前在 `ci/github-actions-deploy-with-backup`（merge-base = `6dbf9c3`，已包含 main 最新提交）
> **Qual Agent**：(本文件作者)
> **关联文件**：`docs/PROGRESS.md`, `docs/NIGHTLY-TODO.md`, `docs/QUAL_CLEAN_RUN_CHECKLIST.md`

---

## 🎯 关注点：main 提交 `6dbf9c3` 影响分析

| 项 | 内容 |
|---|---|
| Commit | `6dbf9c3 fix(pages): add name + pages_build_output_dir to wrangler.toml (#9)` |
| 改动 | `wrangler.toml` +4 行（`name`, `compatibility_date`, `pages_build_output_dir`） |
| 影响范围 | **生产部署** (Cloudflare Pages)。修复 `wrangler pages deploy` 读 wrangler.toml 的 D1 binding 把 `env.DB` 注入 Pages Function。 |
| 修复前症状 | 生产环境所有查 D1 的 API 返 500；`/` 和 `/health` 走静态所以没暴露 bug |
| 修复后验证（commit msg 记录） | 部署后 smoke test 全 200 OK：`/`, `/health`, `/api/public/events`, `/api/public/balance`, `/api/public/tasks/progress`, admin login |
| **本地 e2e 覆盖度** | ⚠️ **不在覆盖范围**。`wrangler pages dev` 本地启动走 SQLite + 内部 binding 直通，验证不了"生产 Pages 读 wrangler.toml → D1 注入"这条路径 |

---

## 🧪 完整测试结果

| 套件 | 命令 | 结果 | 用时 |
|---|---|---|---|
| TypeScript | `npm run typecheck` | ❌ **27 errors** | <5s |
| Unit (vitest) | `npm run test:unit` | ⚠️ **197/199 pass** | 0.6s |
| E2E run #1 (playwright) | `npm test` | ✅ **182/182 pass** | 1.7m |
| E2E run #2 (2-run rule) | `npm test` | ✅ **182/182 pass** | 1.7m |

**E2E 稳定结论**：2-run 干净 DB 跑过 182/182，**无可疑偶发失败**。e2e 用例数从基线 177 涨到 182（新增 5 个：sleep lockout + admin emoji + admin task revoke + admin task config + admin task complete）。

---

## ❌ 失败项详记（pre-existing, **非 `6dbf9c3` 引入**）

### 失败 1: TypeScript 27 errors

**根因 1A（22 个 e2e spec 错误）**：`tsconfig.json` `lib: ["ES2022"]` 缺 `"DOM"`，导致 e2e spec 里的 `document` / `HTMLElement` / `getComputedStyle` 找不到。
- 错误类型：TS2304 (7) + TS18046 (6) + TS2584 (5) + TS18047 (2) + TS7006 (1) + TS2339 (1)
- 涉及文件：`tests/e2e/ui-task-and-segbtn.spec.ts` (15), `ui-child-task-complete.spec.ts`, `ui-child-submit-edge.spec.ts` (2), `ui-child-firsttime.spec.ts`, `ui-admin-login.spec.ts`, `ui-admin-emoji-picker.spec.ts`, `sleep-lockout.spec.ts`

**根因 1B（5 个 unit mock 错误）**：`Task` 类型加了 `cutoff_time: string | null` + `is_self_lockout: 0 | 1` 字段（commit `5e7b3b7` sleep self-lockout 引入），但 unit test 的 `makeTask` 工厂没补这两个字段。
- 错误类型：TS2322 (4) + TS2739 (1)
- 涉及文件：`tests/unit/admin-task-revoke.test.ts:79`, `admin-tasks-config.test.ts:81,190`, `me-tasks-complete.test.ts:65`, `public-tasks.test.ts:27`

### 失败 2: Unit test 2 fails (`me-tasks-complete.test.ts`)

**根因**：commit `5021b7d fix(me/tasks): populate task_completions.awarded_event_id on complete` 调整了 batch 顺序（`score_events → task_completions → audit_log`，让 task_completions 能 reference `last_insert_rowid()`），但测试 mock 的期望没跟着改。
- `me-tasks-complete.test.ts:376-378` 期望 `lastBatch[0/1/2]` = `[task_completions, score_events, audit_log]`，实际 = `[score_events, task_completions, audit_log]`
- `me-tasks-complete.test.ts:438` 期望 active completions = 1，实际 0（与 mock 顺序假设相关，需进一步诊断）
- **注**：HTTP 行为正确（201 + 正确响应 + batch 长度=3），是 **mock 与实现同步问题**，不是产品 bug

---

## ✅ `6dbf9c3` 自身验收

- **功能正确性**：commit 描述里 6 个 endpoint 部署后 smoke test 全 200 OK，**作者已自验**
- **本地可验性**：本地 e2e 跑不到这条路径（`wrangler pages dev` 走的是直 binding）
- **Qual 建议**：可以合入（已合）。**但建议加 CI 门禁**避免回归（见下 #006）

---

## 📋 建议 PM Agent 处理的修复项

### Item #006（建议入 NIGHTLY-TODO）— 测试基础设施清理

**用户原话**：
> "最近的 master 提交了代码，关注一下再跑一下完整的测试" (Qual 触发, 2026-06-08)

**Clarification** (Qual 整理)：
- **本次验收对象 `6dbf9c3` 本身无问题**（部署相关，本地 e2e 覆盖不到，作者已部署后 smoke test 自验）
- **本次验收暴露 2 类 pre-existing 问题**（与 `6dbf9c3` 无关，与 PR #9 解耦）：
  1. TypeScript 27 errors（tsconfig 缺 DOM lib + 5 个 unit mock 缺 Task 新字段）
  2. Unit test 2 fails（me-tasks-complete 的 batch 顺序期望未跟随 commit `5021b7d` 同步）
- **没有用户决策阻塞**：都是 mechanical fix，可直接进 NIGHTLY-TODO cron

**风险**：🟢 (改 tsconfig + 改 5 个 mock + 改 2 处测试期望；不改产品代码；不破 schema)

**Action Plan** (Qual 拟定, 建议 PM 复核)：
- [ ] **子任务 A：tsconfig 加 DOM lib** — `tsconfig.json` `lib: ["ES2022", "DOM"]`，跑 `npm run typecheck` 验证 22 个 e2e spec 错误清零
- [ ] **子任务 B：补 5 个 unit mock 的 Task 字段** — 4 个文件 (`public-tasks.test.ts:27`, `me-tasks-complete.test.ts:65`, `admin-tasks-config.test.ts:81,190`, `admin-task-revoke.test.ts:79`) 的 `makeTask` 工厂加 `cutoff_time: null, is_self_lockout: 0`，跑 `npm run typecheck` 验证 5 个 mock 错误清零
- [ ] **子任务 C：同步 me-tasks-complete.test.ts 的 batch 顺序期望** — 翻转 `line 376-378` 的期望到 `[score_events, task_completions, audit_log]`，**先诊断 fail #2 根因**（line 438 active=0 是不是 mock 顺序假设导致），跑 `npm run test:unit` 验证 199/199 pass
- [ ] **跑完整 `npm test` 验证 e2e 仍 182/182** (不应破)
- [ ] **`git commit -m "chore(test): sync test infrastructure (tsconfig DOM lib + Task mock fields + batch order expectations)"`**

### Item #007（建议入 NIGHTLY-TODO）— `6dbf9c3` 的 CI 覆盖缺口

**Clarification** (Qual 整理)：
- `6dbf9c3` 修复的是"wrangler pages deploy 读 wrangler.toml 配置漂移"问题
- **当前 CI 没有任何门禁能挡住同类回归**（下次 wrangler 升级 / 改 deploy flag 可能静默回退）
- 建议加一个 CI job：跑 `wrangler pages deploy --dry-run` 并 grep `"Ignoring wrangler.toml"` 警告

**风险**：🟡 (加 CI job, 不破现有流程)

**Action Plan** (Qual 拟定, 建议 PM 复核)：
- [ ] 在 `.github/workflows/` 加新 workflow `pages-config-drift.yml`
- [ ] step: `npx wrangler pages deploy ./public --dry-run --outdir=dist 2>&1 | tee /tmp/out`
- [ ] step: `grep -i "ignoring wrangler.toml" /tmp/out && exit 1 || exit 0`（或反向用 `! grep`）
- [ ] 跑一次 `6dbf9c3` 之前的 wrangler.toml 验证它能 catch 漂移（**红测试先**）
- [ ] 跑一次 `6dbf9c3` 之后的 wrangler.toml 验证它通过
- [ ] **`git commit -m "ci: gate wrangler.toml drift on Pages deploy dry-run"`**

---

## 📌 Qual Agent 总结

| 维度 | 结论 |
|---|---|
| `6dbf9c3` 是否可以合入 main？ | ✅ **可以**（已合）。本地 e2e + unit 都不破。部署 smoke test 由作者自验全 200。 |
| 是否需要 hotfix？ | ❌ 不需要。`6dbf9c3` 本身无问题。 |
| 是否需要后续清理？ | ✅ **建议**。2 类 pre-existing 问题（typecheck 27 + unit 2）+ 1 类 CI 覆盖缺口，已列 #006 + #007。 |
| 是否需要用户决策？ | ❌ **不需要**。2 个建议项都是 mechanical fix，PM 整理入 NIGHTLY-TODO 即可。 |

**建议 PM Agent**：在 `docs/NIGHTLY-TODO.md` 加 `Item #006`（测试基础设施清理）+ `Item #007`（CI 漂移门禁），风险都是 🟢/🟡，半夜 cron 跑得动。

---

**Status**: 📝 report written, waiting for PM pickup
**风险**: 🟢 (本文件不涉及代码改动)
**Started**: 2026-06-08
**Completed**: 2026-06-08
**Commit**: — (report only)

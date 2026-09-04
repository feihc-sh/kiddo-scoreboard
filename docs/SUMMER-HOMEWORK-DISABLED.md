# 暑假作业禁用记录 (Summer Homework Disabled)

> Item #016 §7 (2026-09-04 feihao) ✅ Done

## 背景

今天是 2026-09-04（9月1日开学）。暑假作业功能临时禁用，数据完整保留，明年暑假手动恢复。

## 状态

| 项 | 值 |
|---|---|
| **Status** | ✅ Deployed to production |
| **Disable date** | 2026-09-04 |
| **Commits** (5 modular commits on `main`) | `f05d651` backend · `e59a9dc` frontend · `5fee3c1` test · `df17e99` docs · `544cdb9` cleanup |
| **Production D1 verified** | `tasks.is_active = 0` for `每日完成暑假作业` (verified via `wrangler d1 execute`) |
| **Bonus logic verified** | `isAllTasksCompleted()` (`src/utils/coin.ts`) 第 1 行 `SELECT COUNT(*) FROM tasks WHERE is_active = 1` — 暑假作业不计入每日全打卡 |
| **All-time completion** | pre-pr-check PASS (47 unit files / 547 tests pass / 7 pre-existing baseline errors accepted per `MECHA-PHASE-0-BASELINE.md`) |
| **Push / Deploy** | `git push origin main` done; Cloudflare Pages auto-deployed |
| **Production D1 migration** | applied via `wrangler d1 migrations apply kiddo-scoreboard-db --remote` |

## 禁用范围

| 组件 | 禁用方式 | 恢复方式 (明年暑假) |
|------|---------|---------|
| **Kid 打卡入口** | `public/app.js` L1235: `t.is_active===1` 守卫,task 走普通打卡 (server 仍 TASK_INACTIVE 400) | 删除 `&& t.is_active === 1` |
| **Kid modal** | `public/index.html` L74: `hidden` + `aria-disabled="true"` + `title` | 删除这3个属性 |
| **Admin 月历** | `public/admin/index.html` L214: `<details ... hidden>` | 删除 `hidden` 属性 |
| **Admin 子项矩阵** | `public/admin/index.html` L238: `<details ... hidden>` | 删除 `hidden` 属性 |
| **Admin 加载守卫** | `public/admin/admin.js` L43: cache `state.summerHomeworkActive` flag; L531-532 / L1288 跳过 `loadSummerCalendar` + `loadSummerSubmatrix` | 删除相关 `if (!state.summerHomeworkActive)` |
| **Backend 打卡守卫** | `src/routes/me/tasks.ts` L97 + L230: subitems 处理加 `task.is_active===1` (defense-in-depth) | 删除守卫条件 |
| **Admin 历史数据查询** | `src/routes/admin/task-completions.ts`: `/by-task` 仍可查,返回响应加 historical notice | (无需恢复) |
| **D1 data** | `tasks.is_active = 0` (一行 SQL) | `UPDATE tasks SET is_active = 1` |
| **Migration file** | `migrations/0019_disable_summer_homework.sql` (创建) | (无需,D1 migration history 永久) |

## 恢复步骤 (明年暑假手动)

### Step 1 — 数据库恢复
```bash
# Source CF token (per pm-project-lifecycle §Phase 1.5)
TOKEN=$(grep CLOUDFLARE_API_TOKEN ~/.hermes/profiles/research-agent/.env | cut -d= -f2 | tr -d '"')

# Apply inverse migration (or write a new migration to reverse is_active)
CLOUDFLARE_API_TOKEN="$TOKEN" npx wrangler d1 execute kiddo-scoreboard-db \
  --remote --command "UPDATE tasks SET is_active = 1 WHERE name = '每日完成暑假作业';"
```

### Step 2 — 前端守卫移除
```bash
# public/app.js L1235
# 把:
else if (t.name === SUMMER_HOMEWORK_TASK_NAME && t.is_active === 1) {
# 改回:
} else if (t.name === SUMMER_HOMEWORK_TASK_NAME) {
```

```bash
# public/index.html L74
# 删除 3 个属性: hidden aria-disabled="true" title="..."
```

```bash
# public/admin/index.html L214, L238
# 删除两个 <details> 的 hidden 属性
```

### Step 3 — Admin 加载守卫移除 (optional,保留无害)
```bash
# public/admin/admin.js
# (1) L42-44: 删除 state.summerHomeworkActive 字段
# (2) L148-155 loadTasks(): 删除 summerHomeworkActive cache 段
# (3) L537-538 refreshAll(): 取消条件 wrapper
# (4) L1290 filter handler: 删除 if (!state.summerHomeworkActive) return;
```

### Step 4 — Backend 守卫移除 (optional,保留无害)
```bash
# src/routes/me/tasks.ts
# L97: && task.is_active === 1 删除
# L230: && task.is_active === 1 删除
```

### Step 5 — 验证
- [ ] Kid UI: 暑假作业任务出现在打卡列表,点进去 modal 可正常弹出
- [ ] Admin UI: 月历 + 子项矩阵 section 可见
- [ ] Admin API: `/by-task?task_id=<id>` 不带 `notice` 字段(或保持当前 notice 也 OK)
- [ ] Bonus: 完成所有 active task 后仍触发 +3 coin (暑假作业不再 active,排除出 bonus)

## 相关文件

### 新增 (5 files)
- `migrations/0019_disable_summer_homework.sql` — 数据迁移 (一行 `UPDATE`)
- `tests/e2e/summer-homework-disabled.spec.ts` — 4 e2e cases (kid 看不到 / force-call API 400 / admin section hidden / re-enable smoke)
- `docs/SUMMER-HOMEWORK-DISABLED.md` — 本文件

### 修改 (5 files)
- `src/routes/me/tasks.ts` — 打卡守卫 (defense-in-depth)
- `src/routes/admin/task-completions.ts` — historical notice
- `public/app.js` — Kid 打卡入口守卫 + state caching pattern
- `public/index.html` — Modal `hidden` + `aria-disabled` + `title`
- `public/admin/index.html` — 2 个 `<details hidden>`
- `public/admin/admin.js` — `state.summerHomeworkActive` + filter handler guards
- `tests/unit/summer-homework-modal.test.ts` — §7 describe block (modal HTML attrs)

## 测试

```bash
# 禁用状态测试 (4 cases)
npx playwright test tests/e2e/summer-homework-disabled.spec.ts --reporter=line

# 单元测试 (含 §7 disabled state)
npx vitest run tests/unit/summer-homework-modal.test.ts

# 完整测试套 (包含 pre-existing baseline)
npm run test:unit
```

## 历史数据

- `task_completions` 表: 暑假期间的打卡记录保留 (admin 可查历史月历)
- `summer_homework_subitems` 表: 6 个子项勾选状态保留 (admin 可查 dot matrix)
- Admin `/api/admin/task-completions/by-task` API: 仍可查询历史 (带 notice 提示当前 feature disabled)

## 临时 Tunnel (dev preview)

- **URL**: https://enjoying-binding-trader-reward.trycloudflare.com
- **Status**: dev mode (D1 = local SQLite),**不可** 用于验证 production D1 状态
- **何时 kill**: 等 main deploy 完毕 + 用户确认 production OK 后手动 kill

## Commits 摘要 (5 modular commits on `main`)

```
544cdb9 chore(summer-homework): drop PM-direct backend placeholder (6558614)
df17e99 docs(summer-homework): mark feature as post-暑假 disabled + next-year re-enable recipe
5fee3c1 test(summer-homework): e2e + unit cover disabled state
e59a9dc feat(summer-homework-ui): hide modal + admin sections when disabled
f05d651 feat(summer-homework): disable post-暑假 via tasks.is_active=0
```

## 相关文档

- `docs/PRD.md` §3.16 (原 feature spec)
- `docs/TEST_PLAN.md` §3.22 (原 test plan)
- `docs/FEATURE_MATRIX.md` (3.22 row — 已 deprecated,见 §后续维护)
- `docs/INCIDENTS.md` (无 incident — 此次 disable 是 feature change,不是 deploy 失败)
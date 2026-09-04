# 暑假作业禁用记录 (Summer Homework Disabled)

> Item #016 §7 (2026-09-04 feihao)

## 背景

今天是 2026-09-04（9月1日开学）。暑假作业功能临时禁用，数据完整保留，明年暑假手动恢复。

## 禁用范围

| 组件 | 禁用方式 | 恢复方式 |
|------|---------|---------|
| Kid 打卡入口 | `app.js` L1235: `t.is_active===1` 守卫，task 走普通打卡 | 删除守卫 |
| Kid modal | `index.html` L74: `hidden` + `aria-disabled` + `title` | 删除这3个属性 |
| Admin 月历 | `admin/index.html` L214: `<details hidden>` | 删除 `hidden` 属性 |
| Admin 子项矩阵 | `admin/index.html` L238: `<details hidden>` | 删除 `hidden` 属性 |
| Admin 后端 | 无变化，历史数据仍可查，带 notice | — |
| 后端打卡 | `tasks.ts` L97/L230: subitems 处理加 `task.is_active===1` 守卫 | 删除守卫条件 |

## 恢复步骤 (明年暑假)

```sql
-- Step 1: 数据库恢复
UPDATE tasks SET is_active = 1 WHERE name = '每日完成暑假作业';

-- Step 2: 前端 — app.js L1235
-- 把:
else if (t.name === SUMMER_HOMEWORK_TASK_NAME && t.is_active === 1) {
-- 改回:
} else if (t.name === SUMMER_HOMEWORK_TASK_NAME) {

-- Step 3: 前端 — index.html L74
-- 删除: hidden aria-disabled="true" title="..."

-- Step 4: 前端 — admin/index.html L214, L238
-- 删除两个 <details> 的 hidden 属性

-- Step 5: 验证
-- Kid UI: 暑假作业任务出现在打卡列表，modal 可正常弹出
-- Admin UI: 月历 + 子项矩阵 section 可见
-- Admin API: /by-task?task_id=<id> 不带 notice 字段
```

## 相关文件

- `migrations/0019_disable_summer_homework.sql` — 数据迁移（禁用）
- `src/routes/me/tasks.ts` — 后端打卡守卫
- `src/routes/admin/task-completions.ts` — Admin 历史数据查询
- `public/app.js` — Kid 打卡入口守卫
- `public/index.html` — Modal HTML
- `public/admin/index.html` — Admin 报表 HTML
- `public/admin/admin.js` — Admin 加载守卫
- `tests/e2e/summer-homework-disabled.spec.ts` — 禁用状态 e2e 测试
- `tests/unit/summer-homework-modal.test.ts` — 单元测试（§7 扩展）

## 测试

```bash
# 禁用状态测试
npx playwright test tests/e2e/summer-homework-disabled.spec.ts --reporter=line

# 单元测试
npx vitest run tests/unit/summer-homework-modal.test.ts
```

## 历史数据

- `task_completions` 表: 暑假期间的打卡记录保留
- `summer_homework_subitems` 表: 6个子项勾选状态保留
- Admin `/by-task` API: 仍可查询历史（带 notice 提示）

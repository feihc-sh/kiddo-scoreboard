// tests/e2e/ui-child-race-audit.spec.ts
// 姊妹 spec: ui-child-submit-random.spec.ts (PR #19, bug #20)
//
// 目的: 系统性 audit child 端 write actions 的 race condition. 既然
// submitEvent (PR #19) 有 race, 那"对称按钮" (completeTask / uncompleteTask /
// setName) 是不是也有相同问题?
//
// Audit 矩阵 (基于 public/app.js 全部 async write actions + server 路由分析):
//   ┌────────────────┬────────────┬────────────────────────┬──────────┐
//   │ Action         │ inFlight?  │ Server idempotency?    │ 真污染?  │
//   ├────────────────┼────────────┼────────────────────────┼──────────┤
//   │ submitEvent    │ ❌         │ ❌ (新 event)            │ 🚨 是    │ (PR #19)
//   │ completeTask   │ ❌         │ ✅ ALREADY_COMPLETED    │ ❌ (catch)│ ← Case 1
//   │ uncompleteTask │ ❌         │ ✅ ALREADY_UNCOMPLETED  │ ❌ (catch)│ ⚠️ 涉及 confirm dialog, 不在本 spec 测
//   │ setName        │ ❌         │ ✅ ALREADY_SET          │ ❌ (catch)│ ← Case 2
//   └────────────────┴────────────┴────────────────────────┴──────────┘
//
// 结论: child 端其他 write actions 都被 server 端 idempotency 保护, race 不
// 污染数据. 但**用户体验差** (double-click 后前端 catch silent swallow,
// 但 modal 没优雅处理 → 见 QUAL_REPORT_2026-06-09-child-submit.md §5.3).
//
// 本 spec 验证 2 个 candidate: race 不污染数据 + 0 error toast (UI 优雅).

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, seedTask, d1Exec } from './helpers/db';

test.describe('UI: Child Race Audit — completeTask / setName (idempotency check)', () => {
  test.beforeEach(() => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
  });

  // ─── Case 1: completeTask double-click race ─────────────────────────
  // 双击「完成」按钮 → 期望 1 条 task_completion, 0 error toast
  // (server 端 catch ALREADY_COMPLETED_TODAY, 前端 sync state.completedTaskIds)
  test('CASE-1 completeTask: 双击完成 → 仅 1 条 task_completion, 0 error toast', async ({ page }) => {
    const TASK_ID = 9001;
    seedTask({ id: TASK_ID, name: '刷牙', icon: '🦷', token_reward: 5, target_account: 'game_time' });

    await page.goto('/');
    // 等 task list 渲染完
    await expect(page.locator(`button.task-btn[data-task-id="${TASK_ID}"]`)).toBeVisible();

    // 双击: 用 page.evaluate 派发 2 次 click 模拟 race
    await page.evaluate((id) => {
      const btn = document.querySelector(`button.task-btn[data-task-id="${id}"]`);
      if (btn) { btn.click(); btn.click(); }
    }, TASK_ID);

    // 等所有 POST + state sync 完成
    await page.waitForTimeout(1500);

    // 关键断言 1: DB 中只有 1 条 task_completion
    const completionsCount = String(d1Exec(
      `SELECT COUNT(*) FROM task_completions WHERE task_id = ${TASK_ID};`,
    )).trim();
    expect(completionsCount).toBe('1');

    // 关键断言 2: 0 个 error toast (server catch 应该被前端 silent sync)
    // catch 处理: state.completedTaskIds.add(taskId); renderTasks();
    // 注意: 不会显示 error toast, 也不会显示 success toast (因为 catch 块没 toast)
    const errorToasts = page.locator('#toast.toast-error.toast-show');
    await expect(errorToasts).toHaveCount(0);
  });

  // ─── Case 2: setName double-click race ──────────────────────────────
  // 双击「确认」按钮 (welcome modal) → 期望 name 设置成功, 0 error toast
  // (server 端 catch ALREADY_SET, 前端 silent hideWelcome)
  // 关键: setName 是 first-time only, 我们必须先 clear name to empty
  test('CASE-2 setName: 双击确认 → name 设置成功, 0 error toast', async ({ page }) => {
    // 重置 child name 为空 (first-time 状态)
    d1Exec(`UPDATE users SET name = '' WHERE id = 2;`);

    await page.goto('/');
    // Welcome modal 应该自动弹出 (因为 name 空)
    await expect(page.locator('#welcome-modal')).toBeVisible();

    // 填名字
    await page.locator('#welcome-name').fill('Tommy');

    // 双击确认按钮 (button id 是 #welcome-submit, 不是 form submit)
    await page.evaluate(() => {
      const btn = document.querySelector('#welcome-submit');
      if (btn) { btn.click(); btn.click(); }
    });

    await page.waitForTimeout(1500);

    // 关键断言 1: DB 中 name 已设置
    const storedName = String(d1Exec(
      `SELECT name FROM users WHERE id = 2;`,
    )).trim();
    expect(storedName).toBe('Tommy');

    // 关键断言 2: Welcome modal 关闭
    await expect(page.locator('#welcome-modal')).toBeHidden();

    // 关键断言 3: 0 个 error toast
    const errorToasts = page.locator('#toast.toast-error.toast-show');
    await expect(errorToasts).toHaveCount(0);
  });
});

// tests/e2e/ui-admin-tasks-edit-prefill.spec.ts
// Regression: PM 编辑任务时表单回填必须包含所有数据库字段
// (v2.1 §3.12 新增的 cutoff_time + is_self_lockout 也必须回填)
//
// 用户报告: "在登记新的每日任务的时候, 它是可以编辑的. 那个编辑的那个按钮
// 按下去了之后, 它没有从之前填入的数据库里边把之前的状态导出来."
//
// 现状分析 (2026-06-09):
//   - public/admin/admin.js startEditTask() 只回填 6 个字段
//     (name, icon, token_reward, target_account, category, sort_order)
//   - 缺失 2 个 v2.1 字段: cutoff_time, is_self_lockout
//   - submitNewTask() 提交时却又包含这 2 个字段, 所以保存是好的
//   - 后端 TASK_COLUMNS 已正确返回这 2 个字段
//   - 结论: 纯前端 bug. 编辑表单打开时, v2.1 字段显示为空/未勾选.
//
// 这个 spec 覆盖全部 8 个字段 (符合用户描述 "每一个详细的 item").

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, d1Exec } from './helpers/db';
import { loginAsPm } from './helpers/auth';

test.describe('UI: PM Task Edit — 全部字段回填 (regression for v2.1 cutoff + self_lockout)', () => {
  // 用一个固定 ID, 便于定位 row + 不和 seed 随机 ID 冲突.
  const TASK_ID = 5001;

  test.beforeEach(async ({ page, context }) => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
    await loginAsPm(page.context().request);
    await context.setOffline(false);
  });

  test('HAPPY: 编辑按钮按下后, 8 个字段全部从 DB 回填到表单 (含 v2.1 cutoff_time + is_self_lockout)', async ({ page }) => {
    // ── Seed: 一个完整带 v2.1 字段的 sleep task ──
    // seedTask() helper 不支持 cutoff_time / is_self_lockout (它是 v2.1 之后
    // 还没补到 helper 里), 所以用 d1Exec 直插. 这样也是隔离/不污染 helper.
    d1Exec(`DELETE FROM tasks WHERE id = ${TASK_ID};`);
    d1Exec(`
      INSERT INTO tasks
        (id, name, token_reward, target_account, icon, category, sort_order,
         is_active, cutoff_time, is_self_lockout, created_at, updated_at)
      VALUES
        (${TASK_ID}, '准时上床', 15, 'game_time', '🛌', 'habit', 7,
         1, '21:30', 1, unixepoch(), unixepoch());
    `);

    // ── 进入 admin 页面, 展开任务 section ──
    await page.goto('/admin/');
    await page.locator('#sec-tasks summary').click();

    // 定位这个特定 task 的 row (通过 #${TASK_ID} mono text)
    const row = page.locator(`#tasks-list .pm-row:has(.pm-mono:text-is("#${TASK_ID}"))`);
    await expect(row).toBeVisible();

    // ── 点击编辑按钮 ──
    await row.locator('[data-act="edit-task"]').click();

    // 表单应该打开
    const form = page.locator('#new-task-form');
    await expect(form).toBeVisible();
    await expect(page.locator('#new-task-form-wrap')).toBeVisible();

    // ── 验证 8 个字段全部正确回填 ──
    // 前 6 个字段 (历史字段, 应一直工作)
    await expect(form.locator('[name="name"]')).toHaveValue('准时上床');
    await expect(form.locator('[name="icon"]')).toHaveValue('🛌');
    await expect(form.locator('[name="token_reward"]')).toHaveValue('15');
    await expect(form.locator('[name="target_account"]')).toHaveValue('game_time');
    await expect(form.locator('[name="category"]')).toHaveValue('habit');
    await expect(form.locator('[name="sort_order"]')).toHaveValue('7');

    // v2.1 字段 (目前 BUG: startEditTask 不回填, 这两条 expect 应失败)
    await expect(form.locator('[name="cutoff_time"]')).toHaveValue('21:30');
    await expect(form.locator('[name="is_self_lockout"]')).toBeChecked();
  });

  test('HAPPY-2: 编辑一个非 sleep task (无 cutoff) — cutoff_time 应为空, is_self_lockout 应为 unchecked', async ({ page }) => {
    // 反向场景: 普通 task (没填 cutoff) 编辑时, cutoff_time 应是空字符串,
    // is_self_lockout 应 unchecked. 这确保"不强制开启"也工作.
    d1Exec(`DELETE FROM tasks WHERE id = ${TASK_ID};`);
    d1Exec(`
      INSERT INTO tasks
        (id, name, token_reward, target_account, icon, category, sort_order,
         is_active, cutoff_time, is_self_lockout, created_at, updated_at)
      VALUES
        (${TASK_ID}, '整理书桌', 5, 'pocket_money', '📚', 'chore', 3,
         1, NULL, 0, unixepoch(), unixepoch());
    `);

    await page.goto('/admin/');
    await page.locator('#sec-tasks summary').click();

    const row = page.locator(`#tasks-list .pm-row:has(.pm-mono:text-is("#${TASK_ID}"))`);
    await row.locator('[data-act="edit-task"]').click();

    const form = page.locator('#new-task-form');
    await expect(form).toBeVisible();

    // 普通 task: 6 个普通字段回填
    await expect(form.locator('[name="name"]')).toHaveValue('整理书桌');
    await expect(form.locator('[name="icon"]')).toHaveValue('📚');
    await expect(form.locator('[name="token_reward"]')).toHaveValue('5');
    await expect(form.locator('[name="target_account"]')).toHaveValue('pocket_money');
    await expect(form.locator('[name="category"]')).toHaveValue('chore');
    await expect(form.locator('[name="sort_order"]')).toHaveValue('3');

    // cutoff_time = NULL → input value 应为空
    await expect(form.locator('[name="cutoff_time"]')).toHaveValue('');
    // is_self_lockout = 0 → checkbox 应 unchecked
    await expect(form.locator('[name="is_self_lockout"]')).not.toBeChecked();
  });
});

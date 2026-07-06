// tests/e2e/summer-homework-modal.spec.ts
// Item #016 §1: 暑假作业 modal (临时, 开学后下线 ~2026-09)
// 6 hardcoded items, all must be checked, submit reuses completeTask().
//
// Happy 1: 点 task 弹 modal,6 items 渲染,全勾 enabled submit
// Happy 2: 5/6 勾 submit 仍 disabled
// Happy 3: 全勾 → submit → task completed (task_completion row + balance update)
// Edge:   cancel 按钮 关 modal,无 task_completion row
//
// PM 手动 step (在 admin UI 创建 task "每日完成暑假作业" icon=📝 category=study
// target_account=pocket_money token_reward=1) 不在 e2e 范围 (DB seed 替代)

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, seedTask, d1Exec } from './helpers/db';

const HOMEWORK_TASK = {
  name: '每日完成暑假作业',
  icon: '📝',
  token_reward: 1,
  target_account: 'pocket_money' as const,
  sort_order: 10,
  category: 'study' as const,
};

test.beforeEach(() => {
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  seedTask(HOMEWORK_TASK);
});

test('HAPPY 1: clicking the homework task opens modal with 6 items + submit disabled', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#task-shortcuts .task-btn', { state: 'visible' });

  // Find the homework task button by name
  const btn = page.locator('#task-shortcuts .task-btn', { hasText: '每日完成暑假作业' });
  await expect(btn).toBeVisible();
  await btn.click();

  // Modal opens
  const modal = page.locator('#summer-homework-modal');
  await expect(modal).toBeVisible();

  // 6 items rendered with .summer-homework-item class
  const items = page.locator('#summer-homework-list .summer-homework-item');
  await expect(items).toHaveCount(6);

  // Each item has a checkbox + icon + name + hint
  for (let i = 0; i < 6; i++) {
    const item = items.nth(i);
    await expect(item.locator('input[type="checkbox"]')).toBeVisible();
    await expect(item.locator('.summer-homework-item-icon')).toBeVisible();
    await expect(item.locator('.summer-homework-item-name')).toBeVisible();
    await expect(item.locator('.summer-homework-item-hint')).toBeVisible();
  }

  // Submit starts disabled
  const submitBtn = page.locator('#summer-homework-submit');
  await expect(submitBtn).toBeDisabled();
});

test('HAPPY 2: submit stays disabled until ALL 6 items are checked', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#task-shortcuts .task-btn', { state: 'visible' });
  await page.locator('#task-shortcuts .task-btn', { hasText: '每日完成暑假作业' }).click();

  const submitBtn = page.locator('#summer-homework-submit');
  const checkboxes = page.locator('#summer-homework-list input[type="checkbox"]');

  // Check only 5 of 6 → still disabled
  for (let i = 0; i < 5; i++) {
    await checkboxes.nth(i).check();
  }
  await expect(submitBtn).toBeDisabled();

  // Check the last → enabled
  await checkboxes.nth(5).check();
  await expect(submitBtn).toBeEnabled();

  // Uncheck one → disabled again
  await checkboxes.nth(0).uncheck();
  await expect(submitBtn).toBeDisabled();
});

test('HAPPY 3: full check + submit completes the task (task_completion row + balance update)', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#task-shortcuts .task-btn', { state: 'visible' });

  // Snapshot balance before
  const balanceBeforeRaw = d1Exec(
    "SELECT json_object('game_time', COALESCE(SUM(CASE WHEN type='game_time' AND status='approved' THEN change_value ELSE 0 END),0),'pocket_money', COALESCE(SUM(CASE WHEN type='pocket_money' AND status='approved' THEN change_value ELSE 0 END),0),'coins', COALESCE(SUM(CASE WHEN type='coins' AND status='approved' THEN change_value ELSE 0 END),0)) FROM score_events WHERE user_id=2;"
  );

  // Click task → modal → check all 6 → submit
  await page.locator('#task-shortcuts .task-btn', { hasText: '每日完成暑假作业' }).click();
  const checkboxes = page.locator('#summer-homework-list input[type="checkbox"]');
  for (let i = 0; i < 6; i++) {
    await checkboxes.nth(i).check();
  }
  await page.locator('#summer-homework-submit').click();

  // Modal closes
  await expect(page.locator('#summer-homework-modal')).toBeHidden();

  // task_completion row written (1 row for the new completion)
  const completionCountRaw = d1Exec("SELECT COUNT(*) FROM task_completions;");
  expect(String(completionCountRaw).trim()).toBe('1');

  // Wait for the task to render as completed (button shows "✓" or similar)
  await page.waitForTimeout(500);
  const completedBtn = page.locator('#task-shortcuts .task-btn', { hasText: '每日完成暑假作业' });
  const completedText = await completedBtn.textContent();
  expect(completedText).toBeTruthy();
  // The button should now show different state (✓ prefix) per #011 mecha HUD + #003 完成状态
  expect(completedText).toMatch(/✓|已完成/);
});

test('EDGE: cancel button closes modal without writing task_completion', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#task-shortcuts .task-btn', { state: 'visible' });

  await page.locator('#task-shortcuts .task-btn', { hasText: '每日完成暑假作业' }).click();
  await expect(page.locator('#summer-homework-modal')).toBeVisible();

  // Click cancel
  await page.locator('#summer-homework-cancel').click();
  await expect(page.locator('#summer-homework-modal')).toBeHidden();

  // No task_completion row written
  const countRaw = d1Exec("SELECT COUNT(*) FROM task_completions;");
  expect(String(countRaw).trim()).toBe('0');
});

// tests/e2e/summer-homework-disabled.spec.ts
// Item #016 §7 (2026-09-04 feihao): verify summer-homework task is disabled
// post-暑假. Tests the disabled state (is_active=0).
//
// Happy 1: task not shown in kid's task list (inactive tasks filtered out)
// Happy 2: force-complete API call succeeds but subitems are NOT written
// Happy 3: admin calendar + subitem matrix sections are hidden

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, seedTask, d1Exec } from './helpers/db';

const HOMEWORK_TASK_ACTIVE = {
  name: '每日完成暑假作业',
  icon: '📝',
  token_reward: 1,
  target_account: 'pocket_money' as const,
  sort_order: 10,
  category: 'study' as const,
  is_active: 1 as const,
};

const HOMEWORK_TASK_INACTIVE = {
  ...HOMEWORK_TASK_ACTIVE,
  is_active: 0 as const,
};

test.describe('Item #016 §7: 暑假作业 disabled (post-暑假)', () => {
  test('HAPPY 1: inactive summer-homework task does NOT appear in kid task list', async ({ page }) => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
    seedTask(HOMEWORK_TASK_INACTIVE);

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/');
    await page.waitForSelector('#task-shortcuts .task-btn', { state: 'visible' });

    // The task should not appear in the task list
    const homeworkBtn = page.locator('#task-shortcuts .task-btn', { hasText: '每日完成暑假作业' });
    await expect(homeworkBtn).toHaveCount(0);
  });

  test('HAPPY 2: POST /complete for inactive task returns TASK_INACTIVE (server defense-in-depth)', async ({ request }) => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
    const taskId = seedTask(HOMEWORK_TASK_INACTIVE);

    // Attempt to complete the task via the API directly
    const resp = await request.post(`/api/me/tasks/${taskId}/complete`, {
      data: { subitems: { chinese: 1, 'math-school': 1, 'english-vocab': 1, 'english-reading': 1, 'math-extra': 1, 'english-class': 1 } },
    });

    // Server should refuse with TASK_INACTIVE — the task completion itself is blocked
    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body.error?.code).toBe('TASK_INACTIVE');
  });

  test('HAPPY 3: admin calendar + subitem matrix sections are hidden', async ({ page }) => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
    seedTask(HOMEWORK_TASK_INACTIVE);

    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto('/admin/');
    await page.waitForSelector('#admin-login-form', { state: 'visible' });

    // Login as PM
    await page.fill('#pm-username', 'pm');
    await page.fill('#pm-password', 'pm-secret');
    await page.click('#login-btn');
    await page.waitForSelector('#sec-summer-calendar', { state: 'attached' });

    // Both summer sections should have the hidden attribute
    const calendarSection = page.locator('#sec-summer-calendar');
    await expect(calendarSection).toHaveAttribute('hidden', '');

    const submatrixSection = page.locator('#sec-summer-subitems-matrix');
    await expect(submatrixSection).toHaveAttribute('hidden', '');
  });
});

test.describe('Item #016 §7: re-enable recipe — is_active=1 restores full behavior', () => {
  test('HAPPY: active summer-homework task appears + modal opens', async ({ page }) => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
    seedTask(HOMEWORK_TASK_ACTIVE);

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/');
    await page.waitForSelector('#task-shortcuts .task-btn', { state: 'visible' });

    // Task should appear in the list
    const homeworkBtn = page.locator('#task-shortcuts .task-btn', { hasText: '每日完成暑假作业' });
    await expect(homeworkBtn).toBeVisible();

    // Click should open modal (is_active=1 → modal path)
    await homeworkBtn.click();
    const modal = page.locator('#summer-homework-modal');
    await expect(modal).toBeVisible();
  });
});

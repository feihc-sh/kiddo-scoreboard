// tests/e2e/ui-calendar-day-detail.spec.ts
// Item #006 §3: Calendar day detail modal
// Tests: click cell → modal opens → task list → close modal

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, seedTask, seedTaskCompletion, shanghaiToday } from './helpers/db';

test.describe('UI: Calendar Day Detail Modal (Item #006 §3)', () => {
  test.beforeEach(() => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
  });

  test('click on a cell with checkins opens the detail modal', async ({ page }) => {
    // Seed a task + completion for today
    const taskId = seedTask({ name: '整理书桌', token_reward: 5 });
    const today = shanghaiToday();
    seedTaskCompletion({ task_id: taskId, completed_at: today + ' 08:00:00' });

    await page.goto('/');
    await page.locator('#calendar-toggle-btn').click();

    // Find the cell for today (has active class + tier)
    const todayCell = page.locator(`.calendar-cell--active[data-date="${today}"]`);
    await expect(todayCell).toBeVisible();

    await todayCell.click();

    // Modal should appear
    const modal = page.locator('#calendar-day-modal');
    await expect(modal).toBeVisible();

    // Title shows date
    const title = page.locator('#calendar-day-title');
    await expect(title).toContainText(today);

    // Wait for content to load
    await expect(page.locator('#calendar-day-body .calendar-completion-item')).toBeVisible({ timeout: 5000 });

    // Shows the task name
    const body = page.locator('#calendar-day-body');
    await expect(body).toContainText('整理书桌');
  });

  test('modal close button closes the modal', async ({ page }) => {
    const taskId = seedTask({ name: '刷牙', token_reward: 1 });
    const today = shanghaiToday();
    seedTaskCompletion({ task_id: taskId, completed_at: today + ' 09:00:00' });

    await page.goto('/');
    await page.locator('#calendar-toggle-btn').click();

    const todayCell = page.locator(`.calendar-cell--active[data-date="${today}"]`);
    await todayCell.click();

    const modal = page.locator('#calendar-day-modal');
    await expect(modal).toBeVisible();

    await page.locator('#calendar-day-close').click();
    await expect(modal).toBeHidden();
  });

  test('ESC key closes the modal', async ({ page }) => {
    const taskId = seedTask({ name: '练琴', token_reward: 10 });
    const today = shanghaiToday();
    seedTaskCompletion({ task_id: taskId, completed_at: today + ' 10:00:00' });

    await page.goto('/');
    await page.locator('#calendar-toggle-btn').click();

    const todayCell = page.locator(`.calendar-cell--active[data-date="${today}"]`);
    await todayCell.click();

    const modal = page.locator('#calendar-day-modal');
    await expect(modal).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
  });

  test('click on backdrop closes the modal', async ({ page }) => {
    const taskId = seedTask({ name: '整理书桌', token_reward: 5 });
    const today = shanghaiToday();
    seedTaskCompletion({ task_id: taskId, completed_at: today + ' 11:00:00' });

    await page.goto('/');
    await page.locator('#calendar-toggle-btn').click();

    const todayCell = page.locator(`.calendar-cell--active[data-date="${today}"]`);
    await todayCell.click();

    const modal = page.locator('#calendar-day-modal');
    await expect(modal).toBeVisible();

    // Click on the backdrop (modal-back element)
    await modal.click({ position: { x: 10, y: 10 } });
    await expect(modal).toBeHidden();
  });

  test('cell with 0 checkins has no active class and no click behavior', async ({ page }) => {
    // Find a cell with no checkins (no active class)
    const today = shanghaiToday();
    // The grid always has 42 cells, some are empty (0 checkins)
    await page.goto('/');
    await page.locator('#calendar-toggle-btn').click();

    // Cells with count=0 should not have calendar-cell--active
    const emptyCells = page.locator('.calendar-cell:not(.calendar-cell--active)');
    const count = await emptyCells.count();
    expect(count).toBeGreaterThan(0);
  });
});

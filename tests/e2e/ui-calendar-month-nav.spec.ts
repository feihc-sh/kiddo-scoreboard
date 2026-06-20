// tests/e2e/ui-calendar-month-nav.spec.ts
// Item #006 §2: Calendar month navigation
// Tests: expand → prev/next month navigation → data refresh → back

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, seedTask, seedTaskCompletion } from './helpers/db';

test.describe('UI: Calendar Month Navigation (Item #006 §2)', () => {
  test.beforeEach(() => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
    seedTask({ name: '整理书桌', token_reward: 5 });
  });

  test('collapsed by default; click toggle → calendar expands', async ({ page }) => {
    await page.goto('/');
    // Panel hidden
    const panel = page.locator('#calendar-panel');
    await expect(panel).toBeHidden();

    // Click toggle
    await page.locator('#calendar-toggle-btn').click();
    await expect(panel).toBeVisible();

    // Toggle label changes
    await expect(page.locator('#calendar-toggle-btn')).toContainText('收起');
  });

  test('shows current month label + 42 cells when expanded', async ({ page }) => {
    await page.goto('/');
    await page.locator('#calendar-toggle-btn').click();
    await expect(page.locator('#calendar-panel')).toBeVisible();

    // Label shows current month
    const label = page.locator('#calendar-month-label');
    const text = await label.textContent();
    expect(text).toMatch(/\d{4} 年 \d{1,2} 月/);

    // 42 cells: 7 weekday headers + 35 grid cells
    const cells = page.locator('#calendar-grid .calendar-cell');
    await expect(cells).toHaveCount(42);
  });

  test('◀ navigates to previous month; label updates', async ({ page }) => {
    await page.goto('/');
    await page.locator('#calendar-toggle-btn').click();

    const label = page.locator('#calendar-month-label');
    const before = await label.textContent();

    await page.locator('#calendar-prev-month').click();

    // Label changed
    const after = await label.textContent();
    expect(after).not.toBe(before);
  });

  test('▶ navigates to next month; label updates', async ({ page }) => {
    await page.goto('/');
    await page.locator('#calendar-toggle-btn').click();

    // Go prev first (to test next has a valid target)
    await page.locator('#calendar-prev-month').click();
    const before = await page.locator('#calendar-month-label').textContent();

    await page.locator('#calendar-next-month').click();
    const after = await page.locator('#calendar-month-label').textContent();

    expect(after).toBe(before); // back to original
  });

  test('▶ does NOT navigate past current month', async ({ page }) => {
    await page.goto('/');
    await page.locator('#calendar-toggle-btn').click();

    // Click next multiple times — panel should still show current or earlier months
    for (let i = 0; i < 24; i++) {
      await page.locator('#calendar-next-month').click();
    }

    // Label should not be in the future
    const text = await page.locator('#calendar-month-label').textContent() ?? '';
    const [y, m] = text.replace(/[^0-9]/g, ' ').trim().split(/\s+/).map(Number);
    const now = new Date();
    expect(y * 12 + m).toBeLessThanOrEqual(now.getFullYear() * 12 + now.getMonth() + 1);
  });

  test('◀ does NOT navigate before 2024-01', async ({ page }) => {
    await page.goto('/');
    await page.locator('#calendar-toggle-btn').click();

    // Navigate to 2024-01 first
    const now = new Date();
    const monthsBack = (now.getFullYear() - 2024) * 12 + (now.getMonth() + 1) - 1;
    for (let i = 0; i < monthsBack + 6; i++) {
      await page.locator('#calendar-prev-month').click();
    }

    const text = await page.locator('#calendar-month-label').textContent() ?? '';
    expect(text).toContain('2024');
  });

  test('calendar stays expanded after prev/next navigation', async ({ page }) => {
    await page.goto('/');
    await page.locator('#calendar-toggle-btn').click();
    await expect(page.locator('#calendar-panel')).toBeVisible();

    await page.locator('#calendar-prev-month').click();
    await expect(page.locator('#calendar-panel')).toBeVisible();

    await page.locator('#calendar-next-month').click();
    await expect(page.locator('#calendar-panel')).toBeVisible();
  });
});

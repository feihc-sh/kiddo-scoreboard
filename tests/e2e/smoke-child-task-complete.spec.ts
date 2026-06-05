// tests/e2e/smoke-child-task-complete.spec.ts
// Phase-1 smoke: a seeded task shows up in the task shortcuts row.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, seedTask } from './helpers/db';

test.describe('Smoke: Child task shortcuts', () => {
  test('seeded task renders a button in #task-shortcuts', async ({ page }) => {
    clearAllData();
    seedPmUser();
    seedChildUser('小蓝');
    seedTask({ name: '整理书桌' });
    await page.goto('/');
    // Wait for the JS to fetch tasks and render them.
    await expect(
      page.locator('#task-shortcuts button', { hasText: '整理书桌' })
    ).toBeAttached();
  });
});

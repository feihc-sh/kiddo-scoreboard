// tests/e2e/smoke-child-recent.spec.ts
// Phase-1 smoke: recent events list and count badge are attached.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser } from './helpers/db';

test.describe('Smoke: Child recent events', () => {
  test('#event-list and #event-count are attached', async ({ page }) => {
    clearAllData();
    seedPmUser();
    seedChildUser('小蓝');
    await page.goto('/');
    await expect(page.locator('#event-list')).toBeAttached();
    await expect(page.locator('#event-count')).toBeAttached();
  });
});

// tests/e2e/smoke-child-firsttime.spec.ts
// Phase-1 smoke: first-time child (name='') should see the welcome modal.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser } from './helpers/db';

test.describe('Smoke: Child first-time (welcome modal)', () => {
  test('welcome modal is visible when child has no name', async ({ page }) => {
    clearAllData();
    seedPmUser();
    seedChildUser('');  // first-time: name is empty string (NOT NULL in schema)
    await page.goto('/');
    await expect(page.locator('#welcome-modal')).toBeVisible();
  });
});

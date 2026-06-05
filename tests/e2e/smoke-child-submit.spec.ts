// tests/e2e/smoke-child-submit.spec.ts
// Phase-1 smoke: submit button is attached, clicking it opens the submit modal.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser } from './helpers/db';

test.describe('Smoke: Child submit modal', () => {
  test.beforeEach(() => {
    clearAllData();
    seedPmUser();
    seedChildUser('小蓝');
  });

  test('#btn-submit is attached', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#btn-submit')).toBeAttached();
  });

  test('clicking #btn-submit opens #submit-modal', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#submit-modal')).toBeHidden();
    await page.locator('#btn-submit').click();
    await expect(page.locator('#submit-modal')).toBeVisible();
  });
});

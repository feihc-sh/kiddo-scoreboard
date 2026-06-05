// tests/e2e/smoke-admin-audit.spec.ts
// Phase-1 smoke: audit log section + its list container are present.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser } from './helpers/db';
import { loginAsPm } from './helpers/auth';

test.describe('Smoke: PM audit log section', () => {
  test('sec-audit and #audit-list are attached', async ({ page, request }) => {
    clearAllData();
    seedPmUser();
    await loginAsPm(page.context().request);

    await page.goto('/admin/');
    await expect(page.locator('#sec-audit')).toBeAttached();
    await expect(page.locator('#audit-list')).toBeAttached();
  });
});

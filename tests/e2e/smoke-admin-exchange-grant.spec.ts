// tests/e2e/smoke-admin-exchange-grant.spec.ts
// Phase-1 smoke: exchange and grant sections + their forms are present.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser } from './helpers/db';
import { loginAsPm } from './helpers/auth';

test.describe('Smoke: PM exchange + grant sections', () => {
  test('sec-exchange, sec-grant, and both forms are attached', async ({ page, request }) => {
    clearAllData();
    seedPmUser();
    await loginAsPm(page.context().request);

    await page.goto('/admin/');
    await expect(page.locator('#sec-exchange')).toBeAttached();
    await expect(page.locator('#sec-grant')).toBeAttached();
    await expect(page.locator('#exchange-form')).toBeAttached();
    await expect(page.locator('#grant-form')).toBeAttached();
  });
});

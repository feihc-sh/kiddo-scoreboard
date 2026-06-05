// tests/e2e/smoke-admin-pending.spec.ts
// Phase-1 smoke: pending events section + its list container are present.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, seedEvent } from './helpers/db';
import { loginAsPm } from './helpers/auth';

test.describe('Smoke: PM pending events section', () => {
  test('sec-pending and #pending-list are attached', async ({ page, request }) => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
    await loginAsPm(page.context().request);
    seedEvent({ status: 'pending' });

    await page.goto('/admin/');
    await expect(page.locator('#sec-pending')).toBeAttached();
    await expect(page.locator('#pending-list')).toBeAttached();
  });
});

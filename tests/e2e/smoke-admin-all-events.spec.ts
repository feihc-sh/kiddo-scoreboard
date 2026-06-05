// tests/e2e/smoke-admin-all-events.spec.ts
// Phase-1 smoke: all-events section + its list container are present.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, seedEvent } from './helpers/db';
import { loginAsPm } from './helpers/auth';

test.describe('Smoke: PM all-events section', () => {
  test('sec-all-events and #all-events-list are attached', async ({ page, request }) => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
    await loginAsPm(page.context().request);
    seedEvent({ status: 'approved' });
    seedEvent({ status: 'rejected' });

    await page.goto('/admin/');
    await expect(page.locator('#sec-all-events')).toBeAttached();
    await expect(page.locator('#all-events-list')).toBeAttached();
  });
});

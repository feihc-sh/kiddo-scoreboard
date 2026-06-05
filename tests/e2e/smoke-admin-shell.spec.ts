// tests/e2e/smoke-admin-shell.spec.ts
// Phase-1 smoke: authenticated PM dashboard renders all 7 collapsible sections
// plus the topbar balance and logout button.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser } from './helpers/db';
import { loginAsPm } from './helpers/auth';

test.describe('Smoke: PM dashboard shell (authenticated)', () => {
  test('renders 7 sections, pm-balance number, and logout', async ({ page, request }) => {
    clearAllData();
    seedPmUser();
    seedChildUser('小蓝');
    await loginAsPm(page.context().request);

    await page.goto('/admin/');
    // 7 collapsible <details> sections in the dashboard
    await expect(page.locator('details.pm-section')).toHaveCount(7);
    // pm-balance should populate with digits after authed load
    await expect(page.locator('#pm-balance')).toContainText(/\d/);
    await expect(page.locator('#btn-logout')).toBeAttached();
  });
});

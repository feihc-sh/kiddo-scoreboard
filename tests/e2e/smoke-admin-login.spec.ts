// tests/e2e/smoke-admin-login.spec.ts
// Phase-1 smoke: PM login page renders the PIN pad, dots, and submit button.

import { test, expect } from '@playwright/test';

test.describe('Smoke: PM login page', () => {
  test('/admin/login renders login pad, dots, and submit', async ({ page }) => {
    await page.goto('/admin/login');
    await expect(page.locator('#login-pad')).toBeAttached();
    await expect(page.locator('#login-dots')).toBeAttached();
    // 8 dots total (4 visible + 4 extra for up-to-8 digit PINs)
    await expect(page.locator('#login-dots .login-dot')).toHaveCount(8);
    await expect(page.locator('#login-submit')).toBeAttached();
  });
});

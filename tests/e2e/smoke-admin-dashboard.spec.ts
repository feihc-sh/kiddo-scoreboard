// tests/e2e/smoke-admin-dashboard.spec.ts
// Phase-1 smoke: unauthenticated visit to /admin/ redirects to /admin/login
// (client-side redirect via the admin.js api() helper on 401).

import { test, expect } from '@playwright/test';

test.describe('Smoke: PM dashboard auth gate', () => {
  test('unauthenticated /admin/ redirects to /admin/login within 2s', async ({ page }) => {
    await page.goto('/admin/');
    await page.waitForURL(/\/admin\/login/, { timeout: 2000 });
    expect(page.url()).toMatch(/\/admin\/login/);
  });
});

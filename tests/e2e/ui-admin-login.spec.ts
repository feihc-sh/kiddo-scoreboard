// tests/e2e/ui-admin-login.spec.ts
// Phase-2 happy path + edge cases for PM login UI.
// Covers: 4/6/8 digit PIN, validation, lockout, keyboard, network errors.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser } from './helpers/db';
import { loginAsPm, logoutPm } from './helpers/auth';

test.describe('UI: PM Login', () => {
  test.beforeEach(() => {
    clearAllData();
    seedPmUser('123654');  // 6-digit PIN
  });

  // ---------- Happy path ----------

  test('4-digit PIN + ✓ submits and redirects to /admin/', async ({ page }) => {
    // Re-seed with 4-digit PIN for this test
    clearAllData();
    seedPmUser('1234');
    await page.goto('/admin/login');
    await page.locator('#login-pad .login-key[data-digit="1"]').click();
    await page.locator('#login-pad .login-key[data-digit="2"]').click();
    await page.locator('#login-pad .login-key[data-digit="3"]').click();
    await page.locator('#login-pad .login-key[data-digit="4"]').click();
    await page.locator('#login-submit').click();
    await page.waitForURL(/\/admin\/?$/, { timeout: 5000 });
    expect(page.url()).toMatch(/\/admin\/?$/);
  });

  test('6-digit PIN (123654) + ✓ submits and redirects to /admin/', async ({ page }) => {
    // The user's bug case: 6-digit PIN with NO auto-submit. This test would have
    // failed in M9-A when there was auto-submit-at-4-digits.
    await page.goto('/admin/login');
    for (const d of '123654') {
      await page.locator(`#login-pad .login-key[data-digit="${d}"]`).click();
    }
    // 6 dots should be filled
    const filledDots = await page.locator('#login-dots .login-dot.filled').count();
    expect(filledDots).toBe(6);
    // No auto-submit occurred (we should still be on login page)
    expect(page.url()).toMatch(/\/admin\/login/);
    // Now click submit
    await page.locator('#login-submit').click();
    await page.waitForURL(/\/admin\/?$/, { timeout: 5000 });
  });

  test('8-digit PIN (longest allowed) submits successfully', async ({ page }) => {
    clearAllData();
    seedPmUser('12345678');
    await page.goto('/admin/login');
    for (const d of '12345678') {
      await page.locator(`#login-pad .login-key[data-digit="${d}"]`).click();
    }
    await page.locator('#login-submit').click();
    await page.waitForURL(/\/admin\/?$/, { timeout: 5000 });
  });

  // ---------- Validation ----------

  test('3 digits + click ✓: button is disabled', async ({ page }) => {
    await page.goto('/admin/login');
    for (const d of '123') {
      await page.locator(`#login-pad .login-key[data-digit="${d}"]`).click();
    }
    await expect(page.locator('#login-submit')).toBeDisabled();
  });

  test('9th digit is ignored (max 8)', async ({ page }) => {
    await page.goto('/admin/login');
    for (const d of '123456789') {
      await page.locator(`#login-pad .login-key[data-digit="${d}"]`).click();
    }
    const filledDots = await page.locator('#login-dots .login-dot.filled').count();
    expect(filledDots).toBe(8);
  });

  test('wrong PIN: shake animation + PIN cleared, 0 dots', async ({ page }) => {
    clearAllData();
    seedPmUser('9999');
    await page.goto('/admin/login');
    for (const d of '1111') {
      await page.locator(`#login-pad .login-key[data-digit="${d}"]`).click();
    }
    await page.locator('#login-submit').click();
    // Wait for the 401 response + render
    await expect(page.locator('#toast.show')).toBeVisible({ timeout: 5000 });
    // After 401, dots are cleared
    await page.waitForFunction(
      () => document.querySelectorAll('#login-dots .login-dot.filled').length === 0,
      { timeout: 2000 }
    );
  });

  // ---------- Lockout ----------

  test('5+ wrong PINs triggers lockout banner and disables pad', async ({ page }) => {
    clearAllData();
    seedPmUser('9999');
    await page.goto('/admin/login');
    // Lockout threshold is 5 failed attempts → 6th attempt returns 429.
    for (let attempt = 0; attempt < 6; attempt++) {
      for (const d of '1111') {
        await page.locator(`#login-pad .login-key[data-digit="${d}"]`).click();
      }
      await page.locator('#login-submit').click();
      await page.waitForTimeout(400);
    }
    // Lockout banner should be visible (server returns 429 on 6th attempt)
    await expect(page.locator('#login-locked')).toBeVisible({ timeout: 3000 });
    // All keys should be disabled
    const disabled = await page.locator('#login-pad .login-key').first().isDisabled();
    expect(disabled).toBe(true);
  });

  // ---------- Keyboard ----------

  test('Esc key clears PIN', async ({ page }) => {
    await page.goto('/admin/login');
    for (const d of '123') {
      await page.locator(`#login-pad .login-key[data-digit="${d}"]`).click();
    }
    await expect(page.locator('#login-dots .login-dot.filled')).toHaveCount(3);
    await page.keyboard.press('Escape');
    await expect(page.locator('#login-dots .login-dot.filled')).toHaveCount(0);
  });

  test('hardware keyboard digits work', async ({ page }) => {
    await page.goto('/admin/login');
    for (const d of '123654') {
      await page.keyboard.press(d);
    }
    await expect(page.locator('#login-dots .login-dot.filled')).toHaveCount(6);
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/admin\/?$/, { timeout: 5000 });
  });

  test('Backspace key removes last digit', async ({ page }) => {
    await page.goto('/admin/login');
    await page.keyboard.press('1');
    await page.keyboard.press('2');
    await page.keyboard.press('3');
    await expect(page.locator('#login-dots .login-dot.filled')).toHaveCount(3);
    await page.keyboard.press('Backspace');
    await expect(page.locator('#login-dots .login-dot.filled')).toHaveCount(2);
  });

  // ---------- Logout flow ----------

  test('logout from /admin/ returns to /admin/login', async ({ page }) => {
    await loginAsPm(page.context().request, '123654');
    await page.goto('/admin/');
    await expect(page.locator('#btn-logout')).toBeVisible();
    await page.locator('#btn-logout').click();
    await page.waitForURL(/\/admin\/login/, { timeout: 5000 });
    // Now /admin/ should redirect back to login (session cleared)
    await page.goto('/admin/');
    await page.waitForURL(/\/admin\/login/, { timeout: 5000 });
  });

  // ---------- Persistence ----------

  test('session cookie persists across page reloads', async ({ page }) => {
    await loginAsPm(page.context().request, '123654');
    await page.goto('/admin/');
    await expect(page.locator('#pm-user')).toBeVisible();
    // Reload
    await page.reload();
    // Should still be on /admin/, not redirected to login
    expect(page.url()).toMatch(/\/admin\/?$/);
    await expect(page.locator('#pm-user')).toBeVisible();
  });

  // ---------- Auth gate ----------

  test('visiting /admin/ without session auto-redirects to /admin/login', async ({ page, context }) => {
    // Clear all cookies
    await context.clearCookies();
    await page.goto('/admin/');
    await page.waitForURL(/\/admin\/login/, { timeout: 5000 });
  });

  // ---------- Network errors ----------

  test('server error during login shows error banner with retry', async ({ page }) => {
    // Intercept the login API and force 500
    await page.route('**/api/admin/auth/login', (route) => route.fulfill({ status: 500, body: 'server error' }));
    await page.goto('/admin/login');
    for (const d of '123654') {
      await page.locator(`#login-pad .login-key[data-digit="${d}"]`).click();
    }
    await page.locator('#login-submit').click();
    await expect(page.locator('#error-banner')).toBeVisible({ timeout: 5000 });
  });
});

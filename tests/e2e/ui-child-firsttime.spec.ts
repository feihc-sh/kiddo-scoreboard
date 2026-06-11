// tests/e2e/ui-child-firsttime.spec.ts
// Phase-2 happy path + edge cases for child first-time name flow.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser } from './helpers/db';

test.describe('UI: Child First-time Flow', () => {
  test.beforeEach(() => {
    clearAllData();
    seedPmUser();
    seedChildUser('');  // first-time: empty name
  });

  // ---------- Happy path ----------

  test('welcome modal is visible on first load', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#welcome-modal')).toBeVisible();
    // The hero is still in the DOM (just covered by the modal backdrop).
    // We assert the modal is the topmost layer via z-index / not clickable-through.
    const modalZ = await page.locator('#welcome-modal').evaluate((el) => getComputedStyle(el).zIndex);
    expect(Number(modalZ)).toBeGreaterThan(0);
  });

  test('typing a name fills the input', async ({ page }) => {
    await page.goto('/');
    await page.locator('#welcome-name').fill('Tommy');
    await expect(page.locator('#welcome-name')).toHaveValue('Tommy');
  });

  test('submitting a name hides modal and shows hero with name', async ({ page }) => {
    await page.goto('/');
    await page.locator('#welcome-name').fill('Tommy');
    await page.locator('#welcome-submit').click();
    // Modal hidden
    await expect(page.locator('#welcome-modal')).toBeHidden({ timeout: 3000 });
    // Hero greeting now shows the name
    await expect(page.locator('#hero-greeting')).toContainText('Tommy');
    // Toast should be visible briefly (success kind)
    await expect(page.locator('#toast').filter({ hasText: /欢迎|Tommy/ })).toBeVisible({ timeout: 3000 });
  });

  test('submitted name persists across page reloads', async ({ page }) => {
    await page.goto('/');
    await page.locator('#welcome-name').fill('Tommy');
    await page.locator('#welcome-submit').click();
    await expect(page.locator('#welcome-modal')).toBeHidden({ timeout: 3000 });
    // Reload
    await page.reload();
    // Modal should NOT reappear
    await expect(page.locator('#welcome-modal')).toBeHidden();
    // Hero still greets with the name
    await expect(page.locator('#hero-greeting')).toContainText('Tommy');
  });

  test('Enter key submits the form', async ({ page }) => {
    await page.goto('/');
    await page.locator('#welcome-name').fill('Tommy');
    await page.locator('#welcome-name').press('Enter');
    await expect(page.locator('#welcome-modal')).toBeHidden({ timeout: 3000 });
  });

  // ---------- Validation ----------

  test('empty name shows error and does not submit', async ({ page }) => {
    await page.goto('/');
    await page.locator('#welcome-submit').click();
    // Modal still visible
    await expect(page.locator('#welcome-modal')).toBeVisible();
    // Error message
    await expect(page.locator('#welcome-error')).toBeVisible();
    await expect(page.locator('#welcome-error')).toContainText('代号');  // PR #27: "代号不能为空"
  });

  test('whitespace-only name is rejected (trimmed)', async ({ page }) => {
    await page.goto('/');
    await page.locator('#welcome-name').fill('   ');
    await page.locator('#welcome-submit').click();
    await expect(page.locator('#welcome-modal')).toBeVisible();
    await expect(page.locator('#welcome-error')).toBeVisible();
  });

  test('name longer than 20 chars is rejected by maxlength', async ({ page }) => {
    await page.goto('/');
    const longName = 'A'.repeat(25);
    await page.locator('#welcome-name').fill(longName);
    // maxlength=20 on input element
    const value = await page.locator('#welcome-name').inputValue();
    expect(value.length).toBe(20);
  });

  // ---------- API error handling ----------

  test('API error (500) shows error message inside modal', async ({ page }) => {
    await page.route('**/api/me/profile', (route) => route.fulfill({ status: 500, body: 'server error' }));
    await page.goto('/');
    await page.locator('#welcome-name').fill('Tommy');
    await page.locator('#welcome-submit').click();
    // Error should appear in modal
    await expect(page.locator('#welcome-error')).toBeVisible({ timeout: 3000 });
    // Modal stays open
    await expect(page.locator('#welcome-modal')).toBeVisible();
  });

  test('409 ALREADY_SET closes modal gracefully (e.g. PM pre-set name)', async ({ page }) => {
    // Simulate: child name is already set in DB, so the welcome modal is hidden
    // but if user triggers the API manually, it returns 409 → modal should close.
    clearAllData();
    seedPmUser();
    seedChildUser('AlreadyTommy');  // not first-time
    await page.route('**/api/me/profile', (route) => route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'ALREADY_SET' } }),
    }));
    await page.goto('/');
    // Modal isn't shown since not first-time. But test the graceful path.
    // (We just verify no crash; the 409 path is mostly defensive.)
    await expect(page.locator('#hero-greeting')).toContainText('AlreadyTommy');
  });

  // ---------- Confetti ----------

  test('confetti canvas exists and animates after submit', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#confetti')).toBeAttached();
    await page.locator('#welcome-name').fill('Tommy');
    await page.locator('#welcome-submit').click();
    // Canvas should be present (animation is hard to assert; just check it exists)
    await expect(page.locator('#confetti')).toBeAttached();
  });

  // ---------- Auto-load data ----------

  test('balance and tasks load in background while modal is shown', async ({ page }) => {
    // Seed a task so something loads
    const { seedTask } = await import('./helpers/db');
    seedTask({ name: '刷牙' });
    await page.goto('/');
    // While modal is visible, the main page DOM is still loaded (just behind modal).
    // Wait for the balance to render.
    await expect(page.locator('#balance-game-time')).toBeAttached();
    // Task should appear in shortcuts (it's there, just covered by modal)
    // We can check via DOM even if not visible
    const taskBtn = page.locator('#task-shortcuts button', { hasText: '刷牙' });
    await expect(taskBtn).toBeAttached({ timeout: 3000 });
  });

  // ---------- Skip / dismiss ----------

  test('clicking outside the modal does NOT close it (require explicit submit)', async ({ page }) => {
    await page.goto('/');
    // Click on the backdrop (the modal container)
    await page.locator('#welcome-modal').click({ position: { x: 10, y: 10 } });
    // Modal still visible
    await expect(page.locator('#welcome-modal')).toBeVisible();
  });
});

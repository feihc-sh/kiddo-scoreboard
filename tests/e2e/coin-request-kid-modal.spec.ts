// tests/e2e/coin-request-kid-modal.spec.ts
// Item #015 Stage 3: e2e tests for kid coin request modal + history (6 scenarios).
//
// Scenarios:
//   1. KID enters main page → sees "🪙 申请金币" button
//   2. Click → modal appears + amount input focused
//   3. Fill amount=50 + reason → submit button enabled
//   4. Click submit → modal closes + toast appears
//   5. History section shows new request (pending status)
//   6. Re-load → history persists (data saved to DB)

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, seedCoinRequest, d1Exec } from './helpers/db';

function d1Scalar(sql: string): string {
  return String(d1Exec(sql) ?? '').trim();
}

test.describe('UI: Kid Coin Request Modal + History (Item #015 §3)', () => {
  test.beforeEach(() => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
  });

  // ── 1. KID enters main page → sees "🪙 申请金币" button ──

  test('coin request button is visible on main page', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#btn-coin-request')).toBeVisible();
    await expect(page.locator('#btn-coin-request')).toContainText('申请金币');
  });

  // ── 2. Click → modal appears + amount input focused ──

  test('clicking button opens modal and focuses amount input', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-coin-request').click();
    await expect(page.locator('#coin-request-modal')).toBeVisible();
    await expect(page.locator('#coin-request-amount')).toBeFocused();
  });

  // ── 3. Fill amount=50 + reason → submit button enabled ──

  test('submit enabled when valid amount + reason filled', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-coin-request').click();
    await expect(page.locator('#coin-request-modal')).toBeVisible();

    // Fill amount + reason
    await page.locator('#coin-request-amount').fill('50');
    await page.locator('#coin-request-reason').fill('数学考100分,想奖励自己');

    // Submit button should be enabled
    const submitBtn = page.locator('#coin-request-submit');
    await expect(submitBtn).toBeEnabled();
  });

  test('submit disabled when reason is empty', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-coin-request').click();
    await page.locator('#coin-request-amount').fill('50');
    // Leave reason empty

    // Client-side: we test the validation fires by checking that submitting with
    // empty reason shows an error (not by disabling the button — we use HTML5 required).
    await page.locator('#coin-request-submit').click();
    // The form's HTML5 required attribute prevents submission for empty reason
    await expect(page.locator('#coin-request-modal')).toBeVisible();
  });

  // ── 4. Click submit → modal closes + toast appears ──

  test('SMOKE: submit → modal closes + toast appears + history updated', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-coin-request').click();
    await page.locator('#coin-request-amount').fill('50');
    await page.locator('#coin-request-reason').fill('数学考100分,想奖励自己');
    await page.locator('#coin-request-submit').click();

    // Modal closes
    await expect(page.locator('#coin-request-modal')).toBeHidden();

    // Toast appears
    await expect(page.locator('#toast')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#toast')).toContainText('申请已提交');

    // History section updated
    await expect(page.locator('#coin-request-count')).toHaveText('1');
    await expect(page.locator('.coin-request-item')).toHaveCount(1);
    await expect(page.locator('.coin-request-item')).toContainText('+50');
    await expect(page.locator('.coin-request-item')).toContainText('数学考100分');
  });

  // ── 5. History section shows request with correct pending status ──

  test('history shows pending badge after submit', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-coin-request').click();
    await page.locator('#coin-request-amount').fill('77');
    await page.locator('#coin-request-reason').fill('期末考试好成绩');
    await page.locator('#coin-request-submit').click();

    await expect(page.locator('.coin-request-item')).toContainText('⏳');
    await expect(page.locator('.coin-request-item')).toContainText('待审核');
  });

  // ── 6. Re-load → history persists ──

  test('history persists across page reloads', async ({ page }) => {
    // Submit a request
    await page.goto('/');
    await page.locator('#btn-coin-request').click();
    await page.locator('#coin-request-amount').fill('88');
    await page.locator('#coin-request-reason').fill('坚持跑步一个月');
    await page.locator('#coin-request-submit').click();
    await expect(page.locator('#coin-request-count')).toHaveText('1');

    // Reload page
    await page.reload();
    await expect(page.locator('#coin-request-count')).toHaveText('1');
    await expect(page.locator('.coin-request-item')).toContainText('+88');
    await expect(page.locator('.coin-request-item')).toContainText('坚持跑步一个月');
  });

  // ── Edge: cancel closes modal without submitting ──

  test('cancel closes modal without creating a request', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-coin-request').click();
    await page.locator('#coin-request-amount').fill('99');
    await page.locator('#coin-request-reason').fill('奖励自己');
    await page.locator('#coin-request-cancel').click();
    await expect(page.locator('#coin-request-modal')).toBeHidden();
    // No request in DB
    expect(d1Scalar(`SELECT COUNT(*) FROM coin_requests`)).toBe('0');
  });

  // ── Edge: pre-seeded requests show in history on load ──

  test('pre-seeded requests show in history on page load', async ({ page }) => {
    seedCoinRequest({ user_id: 2, amount: 25, reason: 'Pre-seeded request', status: 'pending' });
    seedCoinRequest({ user_id: 2, amount: 15, reason: 'Another pre-seed', status: 'approved' });

    await page.goto('/');
    await expect(page.locator('#coin-request-count')).toHaveText('2');
    await expect(page.locator('.coin-request-item')).toHaveCount(2);
    // Pending shows first (newest-first)
    const firstItem = page.locator('.coin-request-item').first();
    await expect(firstItem).toContainText('⏳');
    await expect(firstItem).toContainText('+25');
  });
});

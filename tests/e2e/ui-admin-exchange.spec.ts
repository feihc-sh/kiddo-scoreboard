// tests/e2e/ui-admin-exchange.spec.ts
// §3.7 PM Exchange (TEST_PLAN §3.7 lines 512-554)
//
// Coverage: 1 smoke + 2 happy + 2 edge = 5 tests.
// Skipped: very large amount, network error, double-submit (low value).

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, d1Exec } from './helpers/db';
import { loginAsPm } from './helpers/auth';

test.describe('UI: PM Exchange (Section E, §3.7)', () => {
  test.beforeEach(async ({ page, context }) => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
    // Seed some game_time so child can exchange.
    d1Exec(
      "INSERT INTO score_events (user_id, type, change_value, reason, status, submitted_by, source) " +
      "VALUES (2, 'game_time', 20, 'seed', 'approved', 'pm', 'manual')",
    );
    await loginAsPm(page.context().request);
    await context.setOffline(false);
  });

  test('SMOKE: exchange form renders with from/to/amount', async ({ page }) => {
    await page.goto('/admin/');
    await page.locator('#sec-exchange summary').click();
    await expect(page.locator('#exchange-form')).toBeVisible();
    // 2 selects (from, to) + 1 number input (amount) + submit.
    await expect(page.locator('#exchange-form select').first()).toBeVisible();
    await expect(page.locator('#exchange-form [name="amount"]')).toBeVisible();
  });

  test('HAPPY-1: exchange 10 game_time → 10 pocket_money', async ({ page }) => {
    await page.goto('/admin/');
    await page.locator('#sec-exchange summary').click();

    const from = page.locator('#exchange-form select[name="from"]');
    const to = page.locator('#exchange-form select[name="to"]');
    if (await from.count() === 0) {
      // try alternative selector
      await page.locator('#exchange-form select').first().selectOption('game_time');
      await page.locator('#exchange-form select').nth(1).selectOption('pocket_money');
    } else {
      await from.selectOption('game_time');
      await to.selectOption('pocket_money');
    }
    await page.locator('#exchange-form [name="amount"]').fill('10');

    // Submit.
    let postCalls = 0;
    page.on('request', (r) => {
      if (r.url().includes('/api/admin/exchange') && r.method() === 'POST') postCalls++;
    });
    await page.locator('#exchange-form button[type=submit]').click();
    await page.waitForTimeout(500);

    // Verify via /api/public/balance.
    const r = await page.context().request.get(
      'http://127.0.0.1:8787/api/public/balance?user_id=2',
    );
    expect(r.status()).toBe(200);
    const balance = await r.json();
    // game_time = 20 - 10 = 10, pocket_money = 0 + 10 = 10.
    expect(balance.game_time).toBe(10);
    expect(balance.pocket_money).toBe(10);
    expect(postCalls).toBe(1);
  });

  test('HAPPY-2: exchange overspend — negative balance allowed', async ({ page }) => {
    // Reset child to 5 game_time.
    d1Exec("DELETE FROM score_events WHERE user_id = 2");
    d1Exec(
      "INSERT INTO score_events (user_id, type, change_value, reason, status, submitted_by, source) " +
      "VALUES (2, 'game_time', 5, 'seed-small', 'approved', 'pm', 'manual')",
    );

    await page.goto('/admin/');
    await page.locator('#sec-exchange summary').click();
    const selects = page.locator('#exchange-form select');
    await selects.first().selectOption('game_time');
    await selects.nth(1).selectOption('pocket_money');
    await page.locator('#exchange-form [name="amount"]').fill('10');

    await page.locator('#exchange-form button[type=submit]').click();
    await page.waitForTimeout(500);

    // Verify via /api/public/balance (no auth required).
    const r = await page.context().request.get(
      'http://127.0.0.1:8787/api/public/balance?user_id=2',
    );
    expect(r.status()).toBe(200);
    const balance = await r.json();
    // game_time = 5 - 10 = -5 (overspend allowed per PRD).
    expect(balance.game_time).toBe(-5);
    expect(balance.pocket_money).toBe(10);
  });

  test('EDGE-1: amount=0 — min=1 validation blocks', async ({ page }) => {
    await page.goto('/admin/');
    await page.locator('#sec-exchange summary').click();
    const selects = page.locator('#exchange-form select');
    await selects.first().selectOption('game_time');
    await selects.nth(1).selectOption('pocket_money');
    await page.locator('#exchange-form [name="amount"]').fill('0');

    let postCalls = 0;
    page.on('request', (r) => {
      if (r.url().includes('/api/admin/exchange') && r.method() === 'POST') postCalls++;
    });
    await page.locator('#exchange-form button[type=submit]').click();
    await page.waitForTimeout(300);

    expect(postCalls).toBe(0);
  });

  test('EDGE-2: same account on both sides — API rejects 400', async ({ page }) => {
    await page.goto('/admin/');
    await page.locator('#sec-exchange summary').click();
    const selects = page.locator('#exchange-form select');
    await selects.first().selectOption('game_time');
    await selects.nth(1).selectOption('game_time');
    await page.locator('#exchange-form [name="amount"]').fill('5');

    // Either client-side blocks OR server returns 400.
    let apiStatus = 0;
    page.on('response', (r) => {
      if (r.url().includes('/api/admin/exchange') && r.request().method() === 'POST') {
        apiStatus = r.status();
      }
    });
    await page.locator('#exchange-form button[type=submit]').click();
    await page.waitForTimeout(500);

    // Verify via direct API call (the truth): should be 400.
    const r = await page.context().request.post('http://127.0.0.1:8787/api/admin/exchange', {
      data: { from: 'game_time', to: 'game_time', amount: 5 },
    });
    expect(r.status()).toBe(400);
  });
});

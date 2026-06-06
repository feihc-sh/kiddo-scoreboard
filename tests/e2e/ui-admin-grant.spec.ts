// tests/e2e/ui-admin-grant.spec.ts
// §3.8 PM Weekly Grant (TEST_PLAN §3.8 lines 558-606)
//
// Coverage: 1 smoke + 2 happy + 2 edge = 5 tests.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, d1Exec } from './helpers/db';
import { loginAsPm } from './helpers/auth';

test.describe('UI: PM Weekly Grant (Section F, §3.8)', () => {
  test.beforeEach(async ({ page, context }) => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
    await loginAsPm(page.context().request);
    await context.setOffline(false);
  });

  test('SMOKE: grant form has 2 number inputs + 1 text input + submit', async ({ page }) => {
    await page.goto('/admin/');
    await page.locator('#sec-grant summary').click();
    await expect(page.locator('#grant-form')).toBeVisible();
    // 2 number inputs (game_time, pocket_money) + 1 text (note).
    await expect(page.locator('#grant-form [name="game_time"]')).toBeVisible();
    await expect(page.locator('#grant-form [name="pocket_money"]')).toBeVisible();
    await expect(page.locator('#grant-form [name="note"]')).toBeVisible();
  });

  test('HAPPY-1: grant 30 game + 20 money with note', async ({ page }) => {
    await page.goto('/admin/');
    await page.locator('#sec-grant summary').click();

    await page.locator('#grant-form [name="game_time"]').fill('30');
    await page.locator('#grant-form [name="pocket_money"]').fill('20');
    await page.locator('#grant-form [name="note"]').fill('Week 1');

    let postCalls = 0;
    page.on('request', (r) => {
      if (r.url().includes('/api/admin/weekly-grant') && r.method() === 'POST') postCalls++;
    });
    await page.locator('#grant-form button[type=submit]').click();
    await page.waitForTimeout(500);

    // Verify balance.
    const r = await page.context().request.get(
      'http://127.0.0.1:8787/api/public/balance?user_id=2',
    );
    expect(r.status()).toBe(200);
    const balance = await r.json();
    expect(balance.game_time).toBe(30);
    expect(balance.pocket_money).toBe(20);
    expect(postCalls).toBe(1);
  });

  test('HAPPY-2: grant only game_time (pocket_money=0) — succeeds', async ({ page }) => {
    await page.goto('/admin/');
    await page.locator('#sec-grant summary').click();
    await page.locator('#grant-form [name="game_time"]').fill('15');
    await page.locator('#grant-form [name="pocket_money"]').fill('0');

    await page.locator('#grant-form button[type=submit]').click();
    await page.waitForTimeout(500);

    const r = await page.context().request.get(
      'http://127.0.0.1:8787/api/public/balance?user_id=2',
    );
    expect(r.status()).toBe(200);
    const balance = await r.json();
    expect(balance.game_time).toBe(15);
    expect(balance.pocket_money).toBe(0);
  });

  test('EDGE-1: grant with negative value — rejected (server 400)', async ({ page }) => {
    // Direct API call (bypass UI min=0 if present).
    const r = await page.context().request.post('http://127.0.0.1:8787/api/admin/weekly-grant', {
      data: { game_time: -5, pocket_money: 0, note: 'invalid' },
    });
    expect(r.status()).toBe(400);
  });

  test('EDGE-2: grant with long note — server should reject (or truncate)', async ({ page }) => {
    const longNote = 'x'.repeat(200);
    const r = await page.context().request.post('http://127.0.0.1:8787/api/admin/weekly-grant', {
      data: { game_time: 5, pocket_money: 0, note: longNote },
    });
    // Either 200 (truncated/stored) or 400 (rejected) — both are acceptable.
    expect([200, 400]).toContain(r.status());
  });
});

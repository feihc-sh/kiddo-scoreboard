// tests/e2e/flow-exchange.spec.ts
// §4 Flow D: Exchange (TEST_PLAN §4 lines 977-986)
//
// Single end-to-end test: PM exchanges → balance updates → audit row created.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, d1Exec } from './helpers/db';
import { loginAsPm } from './helpers/auth';

test.describe('§4 Flow D: Exchange (end-to-end)', () => {
  test('PM exchanges 10 game_time → pocket_money — balance updates, 2 events + audit row', async ({ page }) => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
    // Seed initial game_time=30.
    d1Exec(
      "INSERT INTO score_events (user_id, type, change_value, reason, status, submitted_by, source) " +
      "VALUES (2, 'game_time', 30, 'seed', 'approved', 'pm', 'manual')",
    );
    await loginAsPm(page.context().request);

    // 1. PM opens section E (exchange).
    await page.goto('/admin/');
    await page.locator('#sec-exchange summary').click();

    // 2. Fill the form: from=game_time, to=pocket_money, amount=10.
    const selects = page.locator('#exchange-form select');
    await selects.first().selectOption('game_time');
    await selects.nth(1).selectOption('pocket_money');
    await page.locator('#exchange-form [name="amount"]').fill('10');

    // 3. Submit.
    let postCalls = 0;
    page.on('request', (r) => {
      if (r.url().includes('/api/admin/exchange') && r.method() === 'POST') postCalls++;
    });
    await page.locator('#exchange-form button[type=submit]').click();
    await page.waitForTimeout(500);

    expect(postCalls).toBe(1);

    // 4. Public balance: game_time=20, pocket_money=10.
    const r = await page.context().request.get(
      'http://127.0.0.1:8787/api/public/balance?user_id=2',
    );
    expect(r.status()).toBe(200);
    const balance = await r.json();
    expect(balance.game_time).toBe(20);
    expect(balance.pocket_money).toBe(10);

    // 5. Audit log has exchange entry with details.
    const ar = await page.context().request.get(
      'http://127.0.0.1:8787/api/admin/audit-log?limit=20',
    );
    expect(ar.status()).toBe(200);
    const audit = await ar.json();
    const entries = audit.entries || audit;

    const exchangeEntry = entries.find(
      (e: { action: string; details: { from_account?: string; to_account?: string; amount?: number } }) =>
        e.action === 'exchange' &&
        e.details?.from_account === 'game_time' &&
        e.details?.to_account === 'pocket_money' &&
        e.details?.amount === 10,
    );
    expect(exchangeEntry).toBeTruthy();
  });
});

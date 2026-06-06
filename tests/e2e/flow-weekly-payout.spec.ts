// tests/e2e/flow-weekly-payout.spec.ts
// §4 Flow C: Weekly payout (TEST_PLAN §4 lines 966-975)
//
// Single end-to-end test: PM grants → balance updates → child sees → audit log shows.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser } from './helpers/db';
import { loginAsPm } from './helpers/auth';

test.describe('§4 Flow C: Weekly payout (end-to-end)', () => {
  test('PM grants 30 game + 20 money with note — balance updates, audit row created', async ({ page }) => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
    await loginAsPm(page.context().request);

    // 1. Seed child balance 0/0 (clearAllData already did this).

    // 2. PM opens section F (grant).
    await page.goto('/admin/');
    await page.locator('#sec-grant summary').click();
    await expect(page.locator('#grant-form')).toBeVisible();

    // 3. Fill the form.
    await page.locator('#grant-form [name="game_time"]').fill('30');
    await page.locator('#grant-form [name="pocket_money"]').fill('20');
    await page.locator('#grant-form [name="note"]').fill('Week 1');

    // 4. Submit.
    await page.locator('#grant-form button[type=submit]').click();
    await page.waitForTimeout(500);

    // 5. PM topbar balance updates to 30 / 20.
    const pmBalance = await page.locator('#pm-balance').textContent();
    expect(pmBalance).toContain('30');
    expect(pmBalance).toContain('20');

    // 6. Public API: child balance matches.
    const r = await page.context().request.get(
      'http://127.0.0.1:8787/api/public/balance?user_id=2',
    );
    expect(r.status()).toBe(200);
    const balance = await r.json();
    expect(balance.game_time).toBe(30);
    expect(balance.pocket_money).toBe(20);

    // 7. Audit log has 2 score_event entries (with unique source='weekly_grant').
    const ar = await page.context().request.get(
      'http://127.0.0.1:8787/api/admin/audit-log?limit=20',
    );
    expect(ar.status()).toBe(200);
    const audit = await ar.json();
    const entries = audit.entries || audit;

    // Find the weekly_grant audit row.
    const grantEntry = entries.find(
      (e: { action: string; details: { note?: string; game_time?: number; pocket_money?: number } }) =>
        e.action === 'weekly_grant' && e.details?.note === 'Week 1',
    );
    expect(grantEntry).toBeTruthy();
    expect(grantEntry.details.game_time).toBe(30);
    expect(grantEntry.details.pocket_money).toBe(20);
  });
});

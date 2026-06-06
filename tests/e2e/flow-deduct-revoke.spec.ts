// tests/e2e/flow-deduct-revoke.spec.ts
// §4 Flow B: Punishment (deduction) + Revoke (TEST_PLAN §4 lines 955-964)

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, d1Exec, seedEvent } from './helpers/db';
import { loginAsPm } from './helpers/auth';

test.describe('§4 Flow B: Deduction + Revoke (end-to-end)', () => {
  test('PM creates -5 event via API → child sees → PM revokes → balance restored', async ({ page }) => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
    // Seed initial balance: 30 game_time, 10 pocket_money.
    d1Exec(
      "INSERT INTO score_events (user_id, type, change_value, reason, status, submitted_by, source) " +
      "VALUES (2, 'game_time', 30, 'seed-gt', 'approved', 'pm', 'manual')",
    );
    d1Exec(
      "INSERT INTO score_events (user_id, type, change_value, reason, status, submitted_by, source) " +
      "VALUES (2, 'pocket_money', 10, 'seed-pm', 'approved', 'pm', 'manual')",
    );
    await loginAsPm(page.context().request);

    // 1. Verify initial balance 30/10.
    let br = await page.context().request.get(
      'http://127.0.0.1:8787/api/public/balance?user_id=2',
    );
    let balance = await br.json();
    expect(balance.game_time).toBe(30);
    expect(balance.pocket_money).toBe(10);

    // 2. PM creates -5 game_time event via direct D1 seed (admin has no POST event endpoint;
    //    per TEST_PLAN §4 Flow B note: "confirm API supports negative-admin event creation;
    //    if not, simulate via direct D1 seed").
    const tag = `deduct_${Date.now()}`;
    const ev = seedEvent({
      type: 'game_time',
      change_value: -5,
      reason: tag,
      status: 'approved',
    });
    expect(ev).toBeGreaterThan(0);

    // 3. Verify balance: 30 - 5 = 25.
    br = await page.context().request.get(
      'http://127.0.0.1:8787/api/public/balance?user_id=2',
    );
    balance = await br.json();
    expect(balance.game_time).toBe(25);
    expect(balance.pocket_money).toBe(10);

    // 4. PM revokes the deduction event.
    const rvR = await page.context().request.post(
      `http://127.0.0.1:8787/api/admin/events/${ev}/revoke`,
    );
    expect(rvR.status()).toBe(200);

    // 5. Balance restored to 30.
    br = await page.context().request.get(
      'http://127.0.0.1:8787/api/public/balance?user_id=2',
    );
    balance = await br.json();
    expect(balance.game_time).toBe(30);
    expect(balance.pocket_money).toBe(10);

    // 6. Audit log has revoke_event with target_event_id.
    const ar = await page.context().request.get(
      'http://127.0.0.1:8787/api/admin/audit-log?limit=20',
    );
    const audit = await ar.json();
    const entries = audit.entries || audit;
    const revokeEntry = entries.find(
      (e: { action: string; target_event_id: number }) =>
        e.action === 'revoke_event' && e.target_event_id === ev,
    );
    expect(revokeEntry).toBeTruthy();
  });
});

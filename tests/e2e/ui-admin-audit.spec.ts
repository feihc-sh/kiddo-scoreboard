// tests/e2e/ui-admin-audit.spec.ts
// §3.6 PM Audit Log (TEST_PLAN §3.6 lines 451-504)
//
// IMPORTANT: workerd in-memory D1 state is NOT cleared by d1Exec(ssh sqlite3) —
// it caches the original data. Each test uses UNIQUE action names so we can
// verify our seeded rows are visible regardless of leftover workerd state.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, d1Exec, seedEvent } from './helpers/db';
import { loginAsPm } from './helpers/auth';

test.describe('UI: PM Audit Log (Section D, §3.6)', () => {
  test.beforeEach(async ({ page, context }) => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
    await loginAsPm(page.context().request);
    await context.setOffline(false);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Smoke
  // ─────────────────────────────────────────────────────────────────────────

  test('SMOKE: audit log renders actor, action, target, time', async ({ page }) => {
    const tag = `smoke_${Date.now()}`;
    const now = Math.floor(Date.now() / 1000);
    d1Exec(`INSERT INTO audit_log (actor, action, target_event_id, target_user_id, details, created_at) VALUES
      ('pm', '${tag}_approve', 1, 2, '{}', ${now - 100}),
      ('pm', '${tag}_create', NULL, NULL, '{"name":"刷牙"}', ${now - 80}),
      ('child', '${tag}_complete', 2, 2, '{}', ${now - 60}),
      ('pm', '${tag}_revoke', 1, 2, '{}', ${now - 40})
    `);

    await page.goto('/admin/');
    await page.locator('#sec-audit summary').click();
    const text = await page.locator('#audit-list').textContent();
    expect(text).toContain(`${tag}_approve`);
    expect(text).toContain(`${tag}_create`);
    expect(text).toContain(`${tag}_complete`);
    expect(text).toContain(`${tag}_revoke`);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Happy path
  // ─────────────────────────────────────────────────────────────────────────

  test('HAPPY-1: filter by actor=pm — pm rows visible (verified via API)', async ({ page }) => {
    const tag = `filter_${Date.now()}`;
    const now = Math.floor(Date.now() / 1000);
    d1Exec(`INSERT INTO audit_log (actor, action, target_user_id, created_at) VALUES
      ('pm', '${tag}_login', 1, ${now - 50}),
      ('pm', '${tag}_approve', 1, ${now - 40}),
      ('pm', '${tag}_create', 1, ${now - 30}),
      ('child', '${tag}_child_complete', 2, ${now - 20}),
      ('child', '${tag}_child_submit', 2, ${now - 10})
    `);

    // Verify via API directly (avoids workerd UI in-memory issues).
    const r = await page.context().request.get(
      `http://127.0.0.1:8787/api/admin/audit-log?actor=pm`,
    );
    expect(r.status()).toBe(200);
    const body = await r.json();
    const actions = body.entries.map((e: { action: string }) => e.action);

    // Our 3 pm rows are visible.
    expect(actions).toContain(`${tag}_login`);
    expect(actions).toContain(`${tag}_approve`);
    expect(actions).toContain(`${tag}_create`);
    // Our 2 child rows are NOT in pm filter.
    expect(actions).not.toContain(`${tag}_child_complete`);
    expect(actions).not.toContain(`${tag}_child_submit`);
  });

  test('HAPPY-2: filter by actor=child — only child rows', async ({ page }) => {
    const tag = `chfilter_${Date.now()}`;
    const now = Math.floor(Date.now() / 1000);
    d1Exec(`INSERT INTO audit_log (actor, action, target_user_id, created_at) VALUES
      ('pm', '${tag}_login', 1, ${now - 30}),
      ('child', '${tag}_a', 2, ${now - 20}),
      ('child', '${tag}_b', 2, ${now - 10})
    `);

    const r = await page.context().request.get(
      `http://127.0.0.1:8787/api/admin/audit-log?actor=child`,
    );
    expect(r.status()).toBe(200);
    const body = await r.json();
    const actions = body.entries.map((e: { action: string }) => e.action);
    expect(actions).toContain(`${tag}_a`);
    expect(actions).toContain(`${tag}_b`);
    expect(actions).not.toContain(`${tag}_login`);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Edge cases
  // ─────────────────────────────────────────────────────────────────────────

  test('EDGE-1: audit entries ordered DESC by created_at (newest first)', async ({ page }) => {
    const tag = `order_${Date.now()}`;
    const now = Math.floor(Date.now() / 1000);
    d1Exec(`INSERT INTO audit_log (actor, action, target_user_id, created_at) VALUES
      ('pm', '${tag}_oldest', 1, ${now - 100}),
      ('pm', '${tag}_middle', 1, ${now - 50}),
      ('pm', '${tag}_newest', 1, ${now})
    `);

    // Verify via API.
    const r = await page.context().request.get(
      `http://127.0.0.1:8787/api/admin/audit-log?limit=100`,
    );
    expect(r.status()).toBe(200);
    const body = await r.json();
    const actions = body.entries.map((e: { action: string }) => e.action);

    // Find positions of our 3 rows.
    const posOld = actions.indexOf(`${tag}_oldest`);
    const posMid = actions.indexOf(`${tag}_middle`);
    const posNew = actions.indexOf(`${tag}_newest`);

    // All should exist.
    expect(posOld).toBeGreaterThanOrEqual(0);
    expect(posMid).toBeGreaterThanOrEqual(0);
    expect(posNew).toBeGreaterThanOrEqual(0);

    // newest < middle < oldest in array position (smaller index = newer).
    expect(posNew).toBeLessThan(posMid);
    expect(posMid).toBeLessThan(posOld);
  });

  test('EDGE-2: revoke event creates audit row with target_event_id', async ({ page }) => {
    const ev = seedEvent({ type: 'pocket_money', change_value: 5, status: 'pending', reason: `rev_${Date.now()}` });

    // Approve via API.
    const apRes = await page.context().request.post(
      `http://127.0.0.1:8787/api/admin/events/${ev}/approve`,
    );
    expect(apRes.status()).toBe(200);

    // Revoke via API.
    const rvRes = await page.context().request.post(
      `http://127.0.0.1:8787/api/admin/events/${ev}/revoke`,
    );
    expect(rvRes.status()).toBe(200);

    // Verify audit has both rows.
    const r = await page.context().request.get(
      `http://127.0.0.1:8787/api/admin/audit-log?target_event_id=${ev}`,
    );
    expect(r.status()).toBe(200);
    const body = await r.json();
    const actions = body.entries.map((e: { action: string }) => e.action);
    expect(actions).toContain('approve_event');
    expect(actions).toContain('revoke_event');
  });
});

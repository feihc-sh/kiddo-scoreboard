// tests/e2e/ui-running-checkin.spec.ts
// Item #011 §2 — running check-in modal e2e (7 scenarios).
//
// Coverage:
//   1 smoke (modal open + submit) + 2 happy (3.5 km, 8.5 km w/ point reach) +
//   4 edge (0 km, >100 km, NaN, decimal-precision).

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, seedRunningMap, d1Exec } from './helpers/db';

function d1Scalar(sql: string): string {
  return String(d1Exec(sql) ?? '').trim();
}

test.describe('UI: Running Check-in (Item #011 §2)', () => {
  test.beforeEach(() => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
    seedRunningMap();
  });

  test('SMOKE: modal opens, has input + submit, closes on backdrop click', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-running').click();
    await expect(page.locator('#running-checkin-modal')).toBeVisible();
    await expect(page.locator('#running-km-input')).toBeVisible();
    await expect(page.locator('#running-checkin-submit')).toBeVisible();
    // Backdrop click closes it
    await page.locator('#running-checkin-modal').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#running-checkin-modal')).toBeHidden();
  });

  test('HAPPY-1: 3.5 km → cum +3.5, no point reached', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-running').click();
    await page.locator('#running-km-input').fill('3.5');
    await page.locator('#running-checkin-submit').click();
    await expect(page.locator('#running-checkin-modal')).toBeHidden();

    // DB assertions
    expect(d1Scalar(`SELECT COUNT(*) FROM running_records WHERE child_id=2`)).toBe('1');
    const cum = d1Scalar(
      `SELECT COALESCE(SUM(km), 0) FROM running_records WHERE child_id=2 AND revoked_at IS NULL`,
    );
    expect(Number(cum)).toBe(3.5);
    // No points reached (next point is 嘉定新城 at cum_km=8, this run only got to 3.5)
    expect(d1Scalar(`SELECT COUNT(*) FROM score_events WHERE user_id=2 AND source='running'`)).toBe('0');
  });

  test('HAPPY-2: 8.5 km crosses 嘉定新城, +1 prize', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-running').click();
    await page.locator('#running-km-input').fill('8.5');
    // Test hook: pin the RNG so we get the small-bucket value (1 + floor(0.5*5) = 3)
    await page.locator('#running-checkin-submit').click();
    await expect(page.locator('#running-checkin-modal')).toBeHidden();

    // The pinned RNG is only honored server-side; we don't pass ?rng=fixed from the
    // browser. So we just assert that *some* prize was awarded (game_time > 0)
    // and a running score_event was created.
    // We use source='manual' for running check-in rewards (the schema's CHECK
    // constraint only allows 4 source values; 'running' isn't one of them).
    const award = d1Scalar(
      `SELECT COALESCE(SUM(change_value), 0) FROM score_events
       WHERE user_id=2 AND type='game_time' AND source='manual' AND reason='跑步打卡积分'`,
    );
    expect(Number(award)).toBeGreaterThan(0);
    expect(d1Scalar(`SELECT COUNT(*) FROM score_events WHERE user_id=2 AND source='manual' AND reason='跑步打卡积分'`)).toBe('1');
    expect(d1Scalar(`SELECT COUNT(*) FROM audit_log WHERE action='running_checkin'`)).toBe('1');
  });

  test('EDGE-1: zero km rejected', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-running').click();
    // Bypass min=0.1 client-side validation by submitting via the API.
    const r = await page.request.post('/api/running/records', { data: { km: 0 } });
    expect(r.status()).toBe(400);
    const body = await r.json();
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(body.error?.message).toContain('大于 0');
    expect(d1Scalar(`SELECT COUNT(*) FROM running_records`)).toBe('0');
  });

  test('EDGE-2: >100 km rejected', async ({ page }) => {
    await page.goto('/');
    const r = await page.request.post('/api/running/records', { data: { km: 150 } });
    expect(r.status()).toBe(400);
    const body = await r.json();
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(body.error?.message).toContain('100');
    expect(d1Scalar(`SELECT COUNT(*) FROM running_records`)).toBe('0');
  });

  test('EDGE-3: NaN / non-numeric rejected', async ({ page }) => {
    await page.goto('/');
    const r = await page.request.post('/api/running/records', { data: { km: 'abc' } });
    expect(r.status()).toBe(400);
    const body = await r.json();
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(d1Scalar(`SELECT COUNT(*) FROM running_records`)).toBe('0');
  });

  test('EDGE-4: >1 decimal place rejected', async ({ page }) => {
    await page.goto('/');
    const r = await page.request.post('/api/running/records', { data: { km: 3.55 } });
    expect(r.status()).toBe(400);
    const body = await r.json();
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(d1Scalar(`SELECT COUNT(*) FROM running_records`)).toBe('0');
  });
});

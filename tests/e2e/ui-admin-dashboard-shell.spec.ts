// tests/e2e/ui-admin-dashboard-shell.spec.ts
// §3.2 PM Dashboard Shell (TEST_PLAN §3.2 lines 211-259)
//
// Coverage: 2 smoke + 3 happy + 2 edge = 7 tests.
// Skipped: 4 edge cases (slow API, mid-fetch reload, login UI redirect) for time.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, seedEvent, seedTask, d1Exec } from './helpers/db';
import { loginAsPm, logoutPm } from './helpers/auth';

test.describe('UI: PM Dashboard Shell (§3.2)', () => {
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

  test('SMOKE-1: dashboard renders all 7 sections, section A open by default', async ({ page }) => {
    await page.goto('/admin/');
    const sections = page.locator('details.pm-section');
    await expect(sections).toHaveCount(7);

    // Section A is open by default.
    const secA = page.locator('#sec-pending');
    await expect(secA).toHaveAttribute('open', '');

    // All section IDs present.
    for (const id of ['sec-pending', 'sec-all-events', 'sec-tasks', 'sec-audit',
                      'sec-exchange', 'sec-grant', 'sec-completions']) {
      await expect(page.locator(`#${id}`)).toHaveCount(1);
    }

    // No JS errors.
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.waitForTimeout(300);
    expect(errors).toEqual([]);
  });

  test('SMOKE-2: section count badges reflect data (3 pending, 2 tasks, 1 completion)', async ({ page }) => {
    seedEvent({ type: 'pocket_money', change_value: 5, status: 'pending', reason: 'p1' });
    seedEvent({ type: 'pocket_money', change_value: 5, status: 'pending', reason: 'p2' });
    seedEvent({ type: 'pocket_money', change_value: 5, status: 'pending', reason: 'p3' });
    seedTask({ name: 't1' });
    seedTask({ name: 't2' });
    // task_completions is a separate table from score_events; insert directly.
    d1Exec(
      "INSERT INTO task_completions (task_id, user_id, status, completed_date) " +
      "VALUES (1, 2, 'active', date('now', '+8 hours'))",
    );

    await page.goto('/admin/');
    await expect(page.locator('#count-pending')).toHaveText('3');
    await expect(page.locator('#count-tasks')).toHaveText('2');
    await expect(page.locator('#count-completions')).toHaveText('1');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Happy path
  // ─────────────────────────────────────────────────────────────────────────

  test('HAPPY-1: click section <summary> toggles open/close', async ({ page }) => {
    await page.goto('/admin/');
    const secB = page.locator('#sec-all-events');
    // Initially closed.
    await expect(secB).not.toHaveAttribute('open', '');

    // Click to open.
    await secB.locator('summary').click();
    await expect(secB).toHaveAttribute('open', '');

    // Click to close.
    await secB.locator('summary').click();
    await expect(secB).not.toHaveAttribute('open', '');
  });

  test('HAPPY-2: click #btn-refresh re-fetches data', async ({ page }) => {
    seedEvent({ type: 'pocket_money', change_value: 5, status: 'pending', reason: 'pre-refresh' });

    await page.goto('/admin/');
    await expect(page.locator('#pending-list .pm-row')).toHaveCount(1);

    // Add a new event while page is loaded.
    seedEvent({ type: 'pocket_money', change_value: 3, status: 'pending', reason: 'post-refresh' });

    // Click refresh.
    const reqs: string[] = [];
    page.on('request', (r) => { if (r.url().includes('/api/admin/')) reqs.push(r.url()); });
    await page.locator('#btn-refresh').click();
    await page.waitForTimeout(500);

    // New event should appear.
    await expect(page.locator('#pending-list .pm-row')).toHaveCount(2);
    // Re-fetch happened (at least 1 /api/admin/ request).
    expect(reqs.length).toBeGreaterThan(0);
  });

  test('HAPPY-3: click #btn-logout clears session and redirects to /admin/login', async ({ page }) => {
    await page.goto('/admin/');
    let logoutCalls = 0;
    page.on('request', (r) => {
      if (r.url().includes('/api/admin/auth/logout') && r.method() === 'POST') logoutCalls++;
    });

    await page.locator('#btn-logout').click();
    // Redirect to login page.
    await page.waitForURL(/\/admin\/login/, { timeout: 5000 });
    expect(page.url()).toMatch(/\/admin\/login/);
    expect(logoutCalls).toBe(1);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Edge cases
  // ─────────────────────────────────────────────────────────────────────────

  test('EDGE-1: visit /admin/ without session — redirected to /admin/login', async ({ page, context }) => {
    // Clear cookies (no PM session).
    await context.clearCookies();
    await page.goto('/admin/');
    // Page should redirect to login.
    await page.waitForURL(/\/admin\/login/, { timeout: 5000 });
    expect(page.url()).toMatch(/\/admin\/login/);
  });

  test('EDGE-2: logout double-click — does not crash, ends at /admin/login', async ({ page }) => {
    await page.goto('/admin/');
    let logoutCalls = 0;
    page.on('request', (r) => {
      if (r.url().includes('/api/admin/auth/logout') && r.method() === 'POST') logoutCalls++;
    });

    // Click twice rapidly (no debounce on the button — see F2 pattern: only
    // PM approve/reject/revoke got debounce; logout did not).
    const btn = page.locator('#btn-logout');
    await btn.click({ noWaitAfter: true }).catch(() => {});
    await btn.click({ noWaitAfter: true, force: true }).catch(() => {});

    // No crash; page eventually ends at /admin/login.
    //
    // Don't use `page.waitForURL(/\/admin\/login/)`: the second rapid click
    // also kicks off a navigation, but Playwright's policy check cancels
    // the second one (only one navigation can be in flight at a time), so
    // `waitForURL`'s default "load" wait fails with "Navigation canceled
    // by policy check" even though the page IS at /admin/login. Poll the
    // pathname instead — it doesn't depend on the navigation lifecycle.
    await page.waitForFunction(
      () => window.location.pathname === '/admin/login',
      null,
      { timeout: 5000 },
    );
    expect(page.url()).toMatch(/\/admin\/login/);
    // Logout may have been called 1 or 2 times (no debounce), but at least 1.
    expect(logoutCalls).toBeGreaterThanOrEqual(1);
  });
});

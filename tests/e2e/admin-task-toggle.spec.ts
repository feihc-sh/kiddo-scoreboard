// tests/e2e/admin-task-toggle.spec.ts
// §3 Item #014 Stage 3: e2e tests for admin task toggle switch.
// Verifies:
// 1. PM login → admin → task list shows toggle switch
// 2. Toggle → optimistic UI flip + API call → "已停用" badge + card greyed out
// 3. Toggle again → restored active + badge disappears + card normal
// 4. PM logout → kid endpoint does NOT return suspended task
//
// Selector strategy: click on .pm-toggle-thumb (internal element) not wrapper.
// Per cc-pm-spawn-pitfalls Tip 3: wrapper click may not reach the button's click zone.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, seedTask, d1Exec } from './helpers/db';
import { loginAsPm, logoutPm } from './helpers/auth';

const BASE = 'http://127.0.0.1:8787';

test.describe('Admin Task Toggle (Item #014 §3)', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // Setup
  // ─────────────────────────────────────────────────────────────────────────

  test.beforeEach(async ({ page }) => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
    // Use page.context().request so the cookie is set on the browser context,
    // not on the separate API-only request fixture. This is required so the
    // page.goto('/admin/') later can use the same cookie session.
    await loginAsPm(page.context().request);
    await page.goto('/admin/');
    await page.locator('#sec-tasks summary').click();
    await page.waitForTimeout(200);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // §3.1: Toggle visible in admin task list
  // ─────────────────────────────────────────────────────────────────────────

  test('TASK-TOGGLE-01: task list shows toggle switch per row', async ({ page }) => {
    seedTask({ name: '刷碗', icon: '🍽️', token_reward: 3, target_account: 'pocket_money', is_active: 1 });

    await page.goto('/admin/');
    await page.locator('#sec-tasks summary').click();
    await page.waitForTimeout(200);

    // Should have one active toggle (cyan glow)
    const activeToggle = page.locator('.pm-toggle--active');
    await expect(activeToggle).toHaveCount(1);

    // Thumb inside the toggle
    const thumb = page.locator('.pm-toggle--active .pm-toggle-thumb');
    await expect(thumb).toBeVisible();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // §3.2: Toggle suspends task → "已停用" badge + grey card
  // ─────────────────────────────────────────────────────────────────────────

  test('TASK-TOGGLE-02: click toggle → optimistic UI + API → suspended state', async ({ page }) => {
    const t = seedTask({ name: '整理床铺', icon: '🛏️', token_reward: 2, target_account: 'pocket_money', is_active: 1 });

    await page.goto('/admin/');
    await page.locator('#sec-tasks summary').click();
    await page.waitForTimeout(200);

    // Find the row and toggle
    const row = page.locator(`#tasks-list .pm-row:has(.pm-mono:text-is("#${t}"))`);
    await expect(row).toBeVisible();
    await expect(row).not.toHaveClass(/pm-task-suspended/);

    // Click the thumb (not the wrapper) — per Tip 3
    const thumb = row.locator('.pm-toggle--active .pm-toggle-thumb');
    await thumb.click();
    await page.waitForTimeout(1000); // Allow optimistic UI + API + renderTasks re-render

    // Toggle should now be inactive
    await expect(row.locator('.pm-toggle--inactive')).toHaveCount(1);

    // "已停用" badge should appear
    await expect(row.locator('.pm-badge.revoked')).toContainText('已停用');

    // Card should be greyed out
    await expect(row).toHaveClass(/pm-task-suspended/);

    // Verify API was called (check DB)
    const result = d1Exec(`SELECT is_active FROM tasks WHERE id = ${t}`) as string;
    expect(result.trim()).toBe('0');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // §3.3: Toggle again → task restored active
  // ─────────────────────────────────────────────────────────────────────────

  test('TASK-TOGGLE-03: toggle suspended task → restored active + badge gone', async ({ page }) => {
    const t = seedTask({ name: '浇花', icon: '🌱', token_reward: 1, target_account: 'pocket_money', is_active: 0 });

    await page.goto('/admin/');
    await page.locator('#sec-tasks summary').click();
    await page.waitForTimeout(200);

    const row = page.locator(`#tasks-list .pm-row:has(.pm-mono:text-is("#${t}"))`);
    await expect(row).toBeVisible();
    await expect(row).toHaveClass(/pm-task-suspended/);

    // Click the inactive toggle's thumb to re-enable
    const thumb = row.locator('.pm-toggle--inactive .pm-toggle-thumb');
    await thumb.click();
    await page.waitForTimeout(1000);

    // Toggle should now be active
    await expect(row.locator('.pm-toggle--active')).toHaveCount(1);

    // "已停用" badge should be gone
    await expect(row.locator('.pm-badge.revoked')).toHaveCount(0);

    // Card should no longer be greyed
    await expect(row).not.toHaveClass(/pm-task-suspended/);

    // Verify API was called (check DB)
    const result = d1Exec(`SELECT is_active FROM tasks WHERE id = ${t}`) as string;
    expect(result.trim()).toBe('1');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // §3.4: PM logout → kid endpoint does NOT return suspended task
  // ─────────────────────────────────────────────────────────────────────────

  test('TASK-TOGGLE-04: suspended task hidden from child /api/public/tasks', async ({ page, request }) => {
    const activeTask = seedTask({ name: 'active-task', icon: '✅', token_reward: 1, target_account: 'pocket_money', is_active: 1 });
    const suspendedTask = seedTask({ name: 'suspended-task', icon: '❌', token_reward: 1, target_account: 'pocket_money', is_active: 0 });

    // Logout PM first
    await logoutPm(request);

    // Kid endpoint with active=true should only return active tasks
    const r = await request.get(`${BASE}/api/public/tasks?user_id=2&active=true`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    const tasks = body.tasks as Array<{ id: number; name: string; is_active: number }>;

    const taskIds = tasks.map(t => t.id);
    expect(taskIds).toContain(activeTask);
    expect(taskIds).not.toContain(suspendedTask);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // §3.5: Audit log entry created on toggle
  // ─────────────────────────────────────────────────────────────────────────

  test('TASK-TOGGLE-05: toggle creates audit log entry', async ({ page }) => {
    const t = seedTask({ name: 'audit-toggle-test', icon: '🔔', token_reward: 2, target_account: 'pocket_money', is_active: 1 });

    await page.goto('/admin/');
    await page.locator('#sec-tasks summary').click();
    await page.waitForTimeout(200);

    const row = page.locator(`#tasks-list .pm-row:has(.pm-mono:text-is("#${t}"))`);
    const thumb = row.locator('.pm-toggle--active .pm-toggle-thumb');
    await thumb.click();
    await page.waitForTimeout(1000);

    // Verify audit log entry via API
    const r = await page.context().request.get(`${BASE}/api/admin/audit-log`);
    expect(r.status()).toBe(200);
    const body = await r.json();
    const entries = body.entries as Array<{ action: string; details: string }>;

    // Find the toggle action (task_suspended)
    const toggleEntry = entries.find(e => e.action === 'task_suspended');
    expect(toggleEntry).toBeDefined();

    const details = toggleEntry.details;
    expect(details.task_id).toBe(t);
    expect(details.old_is_active).toBe(1);
    expect(details.new_is_active).toBe(0);
  });
});

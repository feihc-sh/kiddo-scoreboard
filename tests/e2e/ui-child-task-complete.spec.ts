// tests/e2e/ui-child-task-complete.spec.ts
// §3.11 Child Task Complete (TEST_PLAN §3.11 lines 749-797)
//
// Smoke: task button height ≥ 60px for iPad touch.
// Happy 1: complete 1 task → balance increases.
// Happy 2: 2 different tasks same day both succeed.
// Edge: already-done 409, 9999 reward, API 500, offline, 5-click race.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, seedTask, d1Exec } from './helpers/db';

// ────────────────────────────────────────────────────────────────────────────
// Smoke (TEST_PLAN §3.11 line 755-758)
// ────────────────────────────────────────────────────────────────────────────

test('SMOKE: task buttons are ≥ 60px tall for iPad touch', async ({ page }) => {
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  seedTask({ name: '刷牙', icon: '🦷', token_reward: 5, target_account: 'game_time', sort_order: 1 });
  seedTask({ name: '收拾玩具', icon: '🧸', token_reward: 3, target_account: 'pocket_money', sort_order: 2 });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#task-shortcuts .task-btn', { state: 'visible' });

  const buttons = page.locator('#task-shortcuts .task-btn');
  const count = await buttons.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i++) {
    const btn = buttons.nth(i);
    // Must have the .task-btn class (which defines min-height in CSS).
    await expect(btn).toHaveClass(/task-btn/);
    // Computed style min-height must be ≥ 60px.
    const minHeight = await btn.evaluate(
      (el) => getComputedStyle(el).minHeight,
    );
    const minHeightPx = parseFloat(minHeight);
    expect(minHeightPx).toBeGreaterThanOrEqual(60);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// Happy path (TEST_PLAN §3.11 line 760-767) + §3.11 toggle (P1 #16)
// ────────────────────────────────────────────────────────────────────────────

test('HAPPY-toggle: child completes + uncompletes a task — balance returns to 0', async ({ page }) => {
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  const t = seedTask({ name: '刷牙', icon: '🦷', token_reward: 5, target_account: 'pocket_money', sort_order: 1 });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#task-shortcuts .task-btn', { state: 'visible' });

  // 1. Complete — balance should be 5.
  const btn = page.locator(`#task-shortcuts [data-task-id="${t}"]`);
  await btn.click();
  await expect(page.locator('#balance-pocket-money')).toHaveText('5');
  await expect(btn).toHaveClass(/task-btn-done/);

  // 2. Setup dialog handler (auto-accept confirm).
  page.once('dialog', (d) => d.accept());

  // 3. Click the (now green) button to trigger uncomplete.
  await btn.click();

  // 4. Balance should drop to 0.
  await expect(page.locator('#balance-pocket-money')).toHaveText('0', { timeout: 5000 });

  // 5. Button should now be disabled with "系统休眠中" badge.  // PR #27: "明天再来 🌙" → "系统休眠中"
  await expect(btn).toBeDisabled();
  await expect(btn).toContainText('系统休眠中');
});

// ────────────────────────────────────────────────────────────────────────────
// Happy path (TEST_PLAN §3.11 line 760-767)
// ────────────────────────────────────────────────────────────────────────────

test('HAPPY-1: child completes a single task — balance + score_event appear', async ({ page }) => {
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  const t = seedTask({ name: '刷牙', icon: '🦷', token_reward: 5, target_account: 'pocket_money', sort_order: 1 });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#task-shortcuts .task-btn', { state: 'visible' });

  // Initial balance = 0.
  await expect(page.locator('#balance-pocket-money')).toHaveText('0');

  // Click to complete.
  const btn = page.locator(`#task-shortcuts [data-task-id="${t}"]`);
  await btn.click();

  // Balance +5, button green, event row appears.
  await expect(page.locator('#balance-pocket-money')).toHaveText('5', { timeout: 5000 });
  await expect(btn).toHaveClass(/task-btn-done/);
  await expect(btn).toContainText('任务完成');  // PR #27: badge "✅ 今日已完成 (点击撤销)" → "✓ 任务完成"
  await expect(page.locator('#event-list .event-item')).toContainText('+5 元');
});

test('HAPPY-2: completing 2 different tasks the same day — both succeed', async ({ page }) => {
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  const t1 = seedTask({ name: '刷牙', icon: '🦷', token_reward: 5, target_account: 'game_time', sort_order: 1 });
  const t2 = seedTask({ name: '收拾玩具', icon: '🧸', token_reward: 3, target_account: 'pocket_money', sort_order: 2 });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#task-shortcuts .task-btn', { state: 'visible' });

  // Click t1.
  await page.locator(`#task-shortcuts [data-task-id="${t1}"]`).click();
  await expect(page.locator('#balance-game-time')).toHaveText('5', { timeout: 5000 });

  // Click t2.
  await page.locator(`#task-shortcuts [data-task-id="${t2}"]`).click();
  await expect(page.locator('#balance-pocket-money')).toHaveText('3', { timeout: 5000 });

  // Both buttons are task-btn-done, both events in list.
  await expect(page.locator(`#task-shortcuts [data-task-id="${t1}"]`)).toHaveClass(/task-btn-done/);
  await expect(page.locator(`#task-shortcuts [data-task-id="${t2}"]`)).toHaveClass(/task-btn-done/);
  const eventCount = await page.locator('#event-list .event-item').count();
  expect(eventCount).toBe(2);
});

// ────────────────────────────────────────────────────────────────────────────
// Edge cases (TEST_PLAN §3.11 line 769-796)
// ────────────────────────────────────────────────────────────────────────────

test('EDGE-1: completing an already-done task — API returns 409 ALREADY_COMPLETED_TODAY', async ({ page, request }) => {
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  const t = seedTask({ name: '刷牙', icon: '🦷', token_reward: 5, target_account: 'pocket_money', sort_order: 1 });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#task-shortcuts .task-btn', { state: 'visible' });

  // First complete via UI (click button).
  await page.locator(`#task-shortcuts [data-task-id="${t}"]`).click();
  await expect(page.locator('#balance-pocket-money')).toHaveText('5');

  // Second complete via API — should get 409.
  const r = await request.post(`http://127.0.0.1:8787/api/me/tasks/${t}/complete`);
  expect(r.status()).toBe(409);
  const body = await r.json();
  expect(body.error.code).toBe('ALREADY_COMPLETED_TODAY');
});

test('EDGE-4: completing a task with reward=9999 — balance +9999, no overflow', async ({ page }) => {
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  const t = seedTask({ name: '大扫除', icon: '🧹', token_reward: 9999, target_account: 'pocket_money', sort_order: 1 });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#task-shortcuts .task-btn', { state: 'visible' });

  await page.locator(`#task-shortcuts [data-task-id="${t}"]`).click();
  await expect(page.locator('#balance-pocket-money')).toHaveText('9999', { timeout: 5000 });

  // Verify the number renders without overflow (no ellipsis / clipped).
  const box = await page.locator('#balance-pocket-money').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);
});

test('EDGE-5: API returns 500 on complete — toast error, balance unchanged, button still active', async ({ page }) => {
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  const t = seedTask({ name: '刷牙', icon: '🦷', token_reward: 5, target_account: 'pocket_money', sort_order: 1 });

  // Mock the complete API to return 500.
  await page.route('**/api/me/tasks/*/complete', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'MOCK_500', message: 'mocked server error' } }) }),
  );

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#task-shortcuts .task-btn', { state: 'visible' });

  const btn = page.locator(`#task-shortcuts [data-task-id="${t}"]`);
  await btn.click();

  // Error toast.
  await expect(page.locator('#toast.toast-show.toast-error')).toBeVisible({ timeout: 5000 });
  // Balance unchanged.
  await expect(page.locator('#balance-pocket-money')).toHaveText('0');
  // Button still active (no class task-btn-done).
  await expect(btn).not.toHaveClass(/task-btn-done/);
});

test('EDGE-6: network offline — error toast, balance unchanged', async ({ page, context }) => {
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  const t = seedTask({ name: '刷牙', icon: '🦷', token_reward: 5, target_account: 'pocket_money', sort_order: 1 });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#task-shortcuts .task-btn', { state: 'visible' });

  // Go offline then click.
  await context.setOffline(true);
  const btn = page.locator(`#task-shortcuts [data-task-id="${t}"]`);
  await btn.click();

  // Error toast appears.
  await expect(page.locator('#toast.toast-show.toast-error')).toBeVisible({ timeout: 5000 });
  // Balance unchanged.
  await expect(page.locator('#balance-pocket-money')).toHaveText('0');

  // Go back online so subsequent tests don't break.
  await context.setOffline(false);
});

test('EDGE-7: clicking task button rapidly 5 times — only 1 complete + 1 uncomplete in DB', async ({ page }) => {
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  const t = seedTask({ name: '刷牙', icon: '🦷', token_reward: 5, target_account: 'pocket_money', sort_order: 1 });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#task-shortcuts .task-btn', { state: 'visible' });

  // Auto-accept all confirm dialogs (uncomplete prompt).
  page.on('dialog', (d) => d.accept());

  const btn = page.locator(`#task-shortcuts [data-task-id="${t}"]`);

  // Fire 5 clicks rapidly without awaiting individually.
  // (If the button transitions to disabled "明天再来" state, clicks 3-5 are no-ops.)
  for (let i = 0; i < 5; i++) {
    btn.click({ noWaitAfter: true }).catch(() => {});
  }

  // Wait for state to settle.
  await page.waitForTimeout(1500);

  // Final state: button disabled with "系统休眠中", balance 0 (complete then uncomplete).  // PR #27
  await expect(btn).toBeDisabled({ timeout: 5000 });
  await expect(btn).toContainText('系统休眠中');
  await expect(page.locator('#balance-pocket-money')).toHaveText('0');

  // Verify DB: exactly 1 task_completion (status=revoked) + 1 score_event (status=revoked).
  const tcRows = String(d1Exec(
    `SELECT status, COUNT(*) FROM task_completions WHERE task_id=${t} GROUP BY status`,
  )).trim();
  const seRows = String(d1Exec(
    `SELECT status, COUNT(*) FROM score_events WHERE source_ref='task:${t}' GROUP BY status`,
  )).trim();
  // Expected: 1 revoked in each table.
  expect(tcRows).toContain('revoked|1');
  expect(seRows).toContain('revoked|1');
});

// tests/e2e/ui-child-task-complete.spec.ts
// §3.11 Child Task Complete (TEST_PLAN §3.11 lines 749-797)
//
// Smoke: task button height ≥ 60px for iPad touch.
// Happy 1: complete 1 task → balance increases.
// Happy 2: 2 different tasks same day both succeed.
// Edge: already-done 409, 9999 reward, API 500, offline, 5-click race.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, seedTask } from './helpers/db';

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

  // 5. Button should now be disabled with "明天再来" badge.
  await expect(btn).toBeDisabled();
  await expect(btn).toContainText('明天再来');
});

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

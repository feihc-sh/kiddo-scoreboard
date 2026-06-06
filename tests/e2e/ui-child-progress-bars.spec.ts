// tests/e2e/ui-child-progress-bars.spec.ts
// Item #005 — 3 progress bars (daily / monthly / yearly) + daily-once confetti.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, seedTask } from './helpers/db';

test('HAPPY: 3 progress bars render with correct text and counts after task complete', async ({ page }) => {
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  seedTask({ name: '刷牙', icon: '🦷', token_reward: 5, target_account: 'game_time', sort_order: 1 });
  seedTask({ name: '收拾玩具', icon: '🧸', token_reward: 3, target_account: 'pocket_money', sort_order: 2 });

  await page.goto('/');
  await page.waitForSelector('#pb-daily-text', { state: 'visible' });

  // Daily starts at 0/2 (2 active tasks seeded)
  await expect(page.locator('#pb-daily-text')).toHaveText(/今日\s+0\s+\/\s+2/);
  await expect(page.locator('#pb-monthly-text')).toHaveText(/本月\s+0\s+\/\s+100/);
  await expect(page.locator('#pb-yearly-text')).toHaveText(/本年\s+0\s+\/\s+1200/);

  // Complete one task → daily becomes 1/2, monthly 1/100, yearly 1/1200
  await page.locator('#task-shortcuts .task-btn').first().click();
  await page.waitForResponse((r) => r.url().includes('/api/me/tasks/') && r.url().endsWith('/complete'));

  await expect(page.locator('#pb-daily-text')).toHaveText(/今日\s+1\s+\/\s+2/);
  await expect(page.locator('#pb-monthly-text')).toHaveText(/本月\s+1\s+\/\s+100/);
  await expect(page.locator('#pb-yearly-text')).toHaveText(/本年\s+1\s+\/\s+1200/);
});

test('EDGE: daily 100% triggers daily-once confetti (lastConfettiAt set in localStorage)', async ({ page }) => {
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  // Seed a single task so 1 completion = 100% daily
  seedTask({ name: '刷牙', icon: '🦷', token_reward: 5, target_account: 'game_time', sort_order: 1 });

  // Ensure localStorage is clean before page load
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('lastConfettiAt'));
  await page.reload();
  await page.waitForSelector('#pb-daily-text', { state: 'visible' });

  // Complete the only task → daily 1/1 = 100%
  await page.locator('#task-shortcuts .task-btn').first().click();
  await page.waitForResponse((r) => r.url().includes('/api/me/tasks/') && r.url().endsWith('/complete'));

  // Wait for progress reload
  await expect(page.locator('#pb-daily-text')).toHaveText(/今日\s+1\s+\/\s+1/);

  // localStorage should have lastConfettiAt == today
  const lastFired = await page.evaluate(() => localStorage.getItem('lastConfettiAt'));
  const today = new Date().toISOString().slice(0, 10);
  expect(lastFired).toBe(today);
});

test('EDGE: daily-once — lastConfettiAt persists across page reloads (no re-fire)', async ({ page }) => {
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  seedTask({ name: '刷牙', icon: '🦷', token_reward: 5, target_account: 'game_time', sort_order: 1 });

  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('lastConfettiAt', new Date().toISOString().slice(0, 10)));

  // Reload — pre-seeded lastConfettiAt should not be overwritten just by loading
  await page.reload();
  await page.waitForSelector('#pb-daily-text', { state: 'visible' });

  const before = await page.evaluate(() => localStorage.getItem('lastConfettiAt'));
  const today = new Date().toISOString().slice(0, 10);

  // Complete the task — even though daily is 100%, the guard prevents re-marking
  await page.locator('#task-shortcuts .task-btn').first().click();
  await page.waitForResponse((r) => r.url().includes('/api/me/tasks/') && r.url().endsWith('/complete'));
  await expect(page.locator('#pb-daily-text')).toHaveText(/今日\s+1\s+\/\s+1/);

  // lastConfettiAt should still equal today's date (not re-set, not changed)
  const after = await page.evaluate(() => localStorage.getItem('lastConfettiAt'));
  expect(after).toBe(today);
  expect(after).toBe(before);
});

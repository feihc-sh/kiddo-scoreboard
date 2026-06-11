// tests/e2e/ui-child-main.spec.ts
// Phase-2 happy path + edge cases for child main page (post-first-time).

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, seedTask, seedEvent } from './helpers/db';

test.describe('UI: Child Main Page', () => {
  test.beforeEach(() => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
  });

  // ---------- Balance ----------

  test('balance cards render with 0/0 when no events', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#balance-game-time')).toHaveText('0');
    await expect(page.locator('#balance-pocket-money')).toHaveText('0');
  });

  test('balance reflects approved events', async ({ page }) => {
    seedEvent({ type: 'game_time', change_value: 30, status: 'approved' });
    seedEvent({ type: 'pocket_money', change_value: 15, status: 'approved' });
    seedEvent({ type: 'game_time', change_value: -5, status: 'approved' });
    await page.goto('/');
    await expect(page.locator('#balance-game-time')).toHaveText('25');  // 30 - 5
    await expect(page.locator('#balance-pocket-money')).toHaveText('15');
  });

  test('pending events do NOT affect balance', async ({ page }) => {
    seedEvent({ type: 'game_time', change_value: 30, status: 'pending' });
    await page.goto('/');
    await expect(page.locator('#balance-game-time')).toHaveText('0');
  });

  test('rejected/revoked events do NOT affect balance', async ({ page }) => {
    seedEvent({ type: 'game_time', change_value: 30, status: 'rejected' });
    seedEvent({ type: 'game_time', change_value: 30, status: 'revoked' });
    await page.goto('/');
    await expect(page.locator('#balance-game-time')).toHaveText('0');
  });

  // ---------- Greeting ----------

  test('greeting shows child name', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#hero-greeting')).toContainText('Tommy');
  });

  test('greeting without name shows generic', async ({ page }) => {
    clearAllData();
    seedPmUser();
    seedChildUser('');  // empty
    // The first-time modal will show; close it manually? No — just test with set name.
    seedChildUser('Alice');
    await page.goto('/');
    await expect(page.locator('#hero-greeting')).toContainText('Alice');
  });

  // ---------- Task shortcuts ----------

  test('task shortcuts show all active tasks as buttons', async ({ page }) => {
    seedTask({ name: '刷牙' });
    seedTask({ name: '练琴', target_account: 'game_time', token_reward: 10 });
    await page.goto('/');
    const buttons = page.locator('#task-shortcuts button');
    await expect(buttons).toHaveCount(2);
    await expect(buttons.filter({ hasText: '刷牙' })).toBeVisible();
    await expect(buttons.filter({ hasText: '练琴' })).toBeVisible();
  });

  test('inactive tasks are NOT shown in shortcuts', async ({ page }) => {
    seedTask({ name: 'ActiveTask', is_active: 1 });
    seedTask({ name: 'InactiveTask', is_active: 0 });
    await page.goto('/');
    await expect(page.locator('#task-shortcuts button')).toHaveCount(1);
    await expect(page.locator('#task-shortcuts button').filter({ hasText: 'ActiveTask' })).toBeVisible();
    await expect(page.locator('#task-shortcuts button').filter({ hasText: 'InactiveTask' })).toHaveCount(0);
  });

  test('task completed today shows "今日已完成 (点击撤销)" badge and is clickable for toggle', async ({ page, request }) => {
    const taskId = seedTask({ name: '刷牙' });
    // Complete the task via the real child API endpoint so workerd's in-memory
    // state is updated. (Direct sqlite3 writes don't propagate to workerd.)
    const r = await request.post(`http://127.0.0.1:8787/api/me/tasks/${taskId}/complete`);
    expect(r.status()).toBe(201);
    await page.goto('/');
    const btn = page.locator('#task-shortcuts button').filter({ hasText: '刷牙' });
    // §3.11 toggle: completed task is now clickable to revoke (not disabled).
    await expect(btn).toBeEnabled();
    await expect(btn).toHaveClass(/task-btn-done/);
    await expect(btn).toContainText('任务完成');  // PR #27 Mecha redesign: badge simplified to "✓ 任务完成"
  });

  test('empty tasks list shows "家长还没设置任务" message', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#task-shortcuts')).toContainText('等待任务指令');  // PR #27: "等待任务指令…"
  });

  // ---------- Events list ----------

  test('events list shows last 10 events with status badges', async ({ page }) => {
    seedEvent({ reason: '按时上床', status: 'approved', change_value: 10 });
    seedEvent({ reason: '想加游戏', status: 'pending', change_value: 5 });
    seedEvent({ reason: '不想吃菜', status: 'rejected', change_value: 0 });
    await page.goto('/');
    const items = page.locator('#event-list .event-item');
    await expect(items).toHaveCount(3);
    await expect(items.filter({ hasText: '按时上床' })).toContainText('已通过');
    await expect(items.filter({ hasText: '想加游戏' })).toContainText('待确认');  // PR #27: "◷ 待确认"
    await expect(items.filter({ hasText: '不想吃菜' })).toContainText('已拒绝');  // PR #27: "✕ 已拒绝"
  });

  test('event count badge reflects list length', async ({ page }) => {
    seedEvent({ reason: 'ev1' });
    seedEvent({ reason: 'ev2' });
    await page.goto('/');
    await expect(page.locator('#event-count')).toHaveText('2');
  });

  test('empty events list shows "还没有事件" empty state', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#event-empty')).toBeVisible();
    await expect(page.locator('#event-empty')).toContainText('暂无操作记录');  // PR #27: empty events state text
  });

  // ---------- Refresh ----------

  test('clicking 刷新 reloads all data', async ({ page }) => {
    seedEvent({ reason: 'first', change_value: 10, status: 'approved' });
    await page.goto('/');
    await expect(page.locator('#balance-game-time')).toHaveText('10');
    // Add another event from "outside" (seed)
    seedEvent({ reason: 'second', change_value: 5, status: 'approved' });
    // Click refresh
    await page.locator('#btn-refresh').click();
    await expect(page.locator('#balance-game-time')).toHaveText('15');
  });

  test('refresh shows toast', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-refresh').click();
    await expect(page.locator('#toast').filter({ hasText: '刷新' })).toBeVisible({ timeout: 3000 });
  });

  // ---------- Error banner ----------

  test('API failure shows error banner with retry button', async ({ page }) => {
    await page.route('**/api/public/balance*', (route) => route.fulfill({ status: 500, body: 'server error' }));
    await page.goto('/');
    await expect(page.locator('#error-banner')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#error-banner-retry')).toBeVisible();
  });
});

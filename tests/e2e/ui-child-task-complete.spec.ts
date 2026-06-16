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

test('TOGGLE-stays-0 (M2 by design per §5.3): complete + uncomplete — net balance 0', async ({ page }) => {
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  const t = seedTask({ name: '刷牙', icon: '🦷', token_reward: 5, target_account: 'pocket_money', sort_order: 1 });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#task-shortcuts .task-btn', { state: 'visible' });

  // 1. Complete — Coin System M2 (Q7): task completion no longer adds
  //    token_reward to pocket_money, only a +1 coin (not displayed in
  //    this version). Legacy pocket_money balance stays at 0.
  const btn = page.locator(`#task-shortcuts [data-task-id="${t}"]`);
  await btn.click();
  await expect(page.locator('#balance-pocket-money')).toHaveText('0');
  await expect(btn).toHaveClass(/task-btn-done/);

  // 2. Setup dialog handler (auto-accept confirm).
  page.once('dialog', (d) => d.accept());

  // 3. Click the (now green) button to trigger uncomplete.
  await btn.click();

  // 4. By design per RFC §5.3 + TC-F3 (write reverse event, do not flip original,
  //    see src/routes/me/tasks.ts:294): complete wrote +1 coin (no pocket_money),
  //    toggle writes -1 coin compensation. Net coins = 0, pocket_money stays 0.
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

  // Coin System M2 (Q7): task completion writes a +1 coin event instead
  // of a +5 pocket_money event. Pocket_money balance stays at 0 (the
  // +1 coin doesn't show up here — coin balance card lands in M4).
  await expect(page.locator('#balance-pocket-money')).toHaveText('0', { timeout: 5000 });
  await expect(btn).toHaveClass(/task-btn-done/);
  await expect(btn).toContainText('任务完成');  // PR #27 Mecha redesign: "✓ 任务完成 (点击撤销)"
  // Coin System M2 (Q9): completing the only active task also fires the
  // daily-bonus +3 event (all-tasks-done). So we expect 2 events total:
  //   1. +1 coin (task grant)
  //   2. +3 coin (daily bonus)
  // Playwright strict mode: 2 .event-item elements need .first() to pick one.
  const eventCount = await page.locator('#event-list .event-item').count();
  expect(eventCount).toBe(2);
  await expect(page.locator('#event-list .event-item').first()).toContainText('🪙 +1 枚');
  await expect(page.locator('#event-list .event-item').nth(1)).toContainText('🪙 +3 枚');
  // M2 observability: #balance-coins reflects net coin balance
  const coinBalance1 = Number(await page.locator('#balance-coins').textContent());
  expect(coinBalance1).toBeGreaterThanOrEqual(1);
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

  // Click t1 — Coin System M2 (Q7): legacy game_time balance stays at 0
  // (task no longer adds to it). Each complete writes a +1 coin event.
  await page.locator(`#task-shortcuts [data-task-id="${t1}"]`).click();
  await expect(page.locator('#balance-game-time')).toHaveText('0', { timeout: 5000 });

  // Click t2 — pocket_money balance stays at 0 too.
  await page.locator(`#task-shortcuts [data-task-id="${t2}"]`).click();
  await expect(page.locator('#balance-pocket-money')).toHaveText('0', { timeout: 5000 });

  // Both buttons are task-btn-done. With Coin System M2 (Q9): t1 = +1 coin
  // (not all-done yet, no bonus); t2 = +1 coin + +3 daily bonus (all-done).
  // Total events = 3.
  await expect(page.locator(`#task-shortcuts [data-task-id="${t1}"]`)).toHaveClass(/task-btn-done/);
  await expect(page.locator(`#task-shortcuts [data-task-id="${t2}"]`)).toHaveClass(/task-btn-done/);
  const eventCount = await page.locator('#event-list .event-item').count();
  expect(eventCount).toBe(3);
  // M2 observability: #balance-coins reflects net coin balance
  const coinBalance2 = Number(await page.locator('#balance-coins').textContent());
  expect(coinBalance2).toBeGreaterThanOrEqual(2);
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

  // First complete via UI (click button) — Coin System M2: pocket_money
  // stays at 0 (task no longer adds); +1 coin is the only effect.
  await page.locator(`#task-shortcuts [data-task-id="${t}"]`).click();
  await expect(page.locator('#balance-pocket-money')).toHaveText('0');

  // Second complete via API — should get 409. The 409 logic is keyed on
  // task_completions.status='active' (which is set correctly regardless
  // of the M2 balance changes), so this assertion still holds.
  const r = await request.post(`http://127.0.0.1:8787/api/me/tasks/${t}/complete`);
  expect(r.status()).toBe(409);
  const body = await r.json();
  expect(body.error.code).toBe('ALREADY_COMPLETED_TODAY');
});

test('EDGE-4 (M2 informational-only): task reward=9999 no longer flows to game_time/pocket_money; #balance-coins gains 1', async ({ page }) => {
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  const t = seedTask({ name: '大扫除', icon: '🧹', token_reward: 9999, target_account: 'pocket_money', sort_order: 1 });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#task-shortcuts .task-btn', { state: 'visible' });

  await page.locator(`#task-shortcuts [data-task-id="${t}"]`).click();
  // Coin System M2 (Q7): token_reward (9999) is informational only — it
  // no longer flows into the legacy game_time/pocket_money balance. The
  // pocket_money balance stays at 0 regardless of token_reward. The
  // overflow-safety check still matters (we're rendering '0' which is
  // trivially safe) but the *interesting* number is now 0 not 9999.
  await expect(page.locator('#balance-pocket-money')).toHaveText('0', { timeout: 5000 });

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

  // Complete → uncomplete → 3 follow-up rapid clicks.
  // NOTE: We must wait between click 1 and click 2 for the button to re-render
  // (state.completedTaskIds.add → renderTasks → new button with uncomplete
  // listener). Without this, rapid clicks all hit the same old button
  // (which still has the completeTask listener) and toggle never fires.
  // The 3 follow-up rapid clicks test that the disabled button absorbs them
  // as no-ops rather than re-triggering the cycle.
  await btn.click();
  await expect(btn).toHaveClass(/task-btn-done/);
  await btn.click();
  await expect(btn).toBeDisabled({ timeout: 5000 });
  for (let i = 0; i < 3; i++) {
    btn.click({ noWaitAfter: true, force: true }).catch(() => {});
  }
  // Final state: button disabled with "系统休眠中", balance 0 (complete then uncomplete).  // PR #27
  await expect(btn).toContainText('系统休眠中');
  await expect(page.locator('#balance-pocket-money')).toHaveText('0');

  // Verify DB by RFC §5.3 + TC-F3 (write reverse event, do not flip original,
  // see src/routes/me/tasks.ts:294): complete wrote 1 score_event +1 coin
  // (source_ref='task:N:date:userId'); toggle wrote 1 reverse score_event -1 coin
  // (source_ref='revoke:task:N:date:userId'). task_completion flips status=revoked.
  const tcRows = String(d1Exec(
    `SELECT status, COUNT(*) FROM task_completions WHERE task_id=${t} GROUP BY status`,
  )).trim();
  const seRows = String(d1Exec(
    `SELECT status, change_value, COUNT(*) FROM score_events WHERE source_ref LIKE 'task:${t}:%' OR source_ref LIKE 'revoke:task:${t}:%' GROUP BY status, change_value`,
  )).trim();
  const seSrcRefs = String(d1Exec(
    `SELECT source_ref FROM score_events WHERE source_ref LIKE 'task:${t}:%' OR source_ref LIKE 'revoke:task:${t}:%'`,
  )).trim();
  // task_completion row flipped to revoked ✓
  expect(tcRows).toContain('revoked|1');
  // +1 coin event stays 'approved' (original, by design per §5.3)
  expect(seRows).toContain('approved|1');
  // -1 coin compensation event exists (by design per §5.3, written by toggle)
  expect(seRows).toContain('approved|-1');
  // Both events have source_ref (no schema drift)
  expect(seSrcRefs).toContain(`task:${t}:`);
  expect(seSrcRefs).toContain(`revoke:task:${t}:`);
});

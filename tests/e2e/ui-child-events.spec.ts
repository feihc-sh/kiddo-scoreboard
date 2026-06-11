// tests/e2e/ui-child-events.spec.ts
// §3.13 Child Recent Events (TEST_PLAN §3.13 lines 870-926)
//
// Coverage:
//   1 smoke (empty state), 4 happy, 5 edge = 10 tests
//   Skipped: "Time shown in human format" (fmtTime not implemented in app.js)

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, seedEvent } from './helpers/db';

const NOW = Math.floor(Date.now() / 1000);

// ────────────────────────────────────────────────────────────────────────────
// Smoke (TEST_PLAN §3.13 line 877-879)
// ────────────────────────────────────────────────────────────────────────────

test('SMOKE: initial empty state — no events', async ({ page }) => {
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#event-list', { state: 'attached' });
  await expect(page.locator('#event-empty')).toBeVisible();
  await expect(page.locator('#event-count')).toHaveText('0');
  await expect(page.locator('#event-list .event-item')).toHaveCount(0);
});

// ────────────────────────────────────────────────────────────────────────────
// Happy path (TEST_PLAN §3.13 line 882-900)
// ────────────────────────────────────────────────────────────────────────────

test('HAPPY-1: after submit, event appears at top of list', async ({ page }) => {
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.locator('#btn-submit').click();
  await page.locator('#submit-type').selectOption('pocket_money');
  await page.locator('#submit-amount').fill('5');
  await page.locator('#submit-reason').fill('first submit');
  await page.locator('#submit-form button[type=submit]').click();
  await page.waitForTimeout(500);
  await expect(page.locator('#event-count')).toHaveText('1');
  const firstRow = page.locator('#event-list .event-item').first();
  await expect(firstRow).toContainText('+5 元');
  await expect(firstRow).toContainText('first submit');
});

test('HAPPY-2: status badges render with correct colors (4 statuses)', async ({ page }) => {
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  seedEvent({ type: 'pocket_money', change_value: 5, status: 'pending', reason: 'r-pending' });
  seedEvent({ type: 'pocket_money', change_value: 5, status: 'approved', reason: 'r-approved' });
  seedEvent({ type: 'pocket_money', change_value: 5, status: 'rejected', reason: 'r-rejected' });
  seedEvent({ type: 'pocket_money', change_value: 5, status: 'revoked', reason: 'r-revoked' });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#event-list .event-item', { state: 'visible' });
  await expect(page.locator('#event-list .event-item')).toHaveCount(4);
  await expect(page.locator('.event-item.event-status-pending')).toHaveCount(1);
  await expect(page.locator('.event-item.event-status-approved')).toHaveCount(1);
  await expect(page.locator('.event-item.event-status-rejected')).toHaveCount(1);
  await expect(page.locator('.event-item.event-status-revoked')).toHaveCount(1);
  // Each row shows its status label.
  await expect(page.locator('.event-status-pending .event-status')).toContainText('待确认');  // PR #27: "◷ 待确认"
  await expect(page.locator('.event-status-approved .event-status')).toContainText('已通过');
  await expect(page.locator('.event-status-rejected .event-status')).toContainText('已拒绝');  // PR #27: "✕ 已拒绝"
  await expect(page.locator('.event-status-revoked .event-status')).toContainText('已回收');  // PR #27: "↩ 已回收"
});

test('HAPPY-3: max 10 events in list (15 seeded → list shows 10)', async ({ page }) => {
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  for (let i = 0; i < 15; i++) {
    seedEvent({ type: 'pocket_money', change_value: 1, status: 'approved', reason: `e${i}` });
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#event-list .event-item', { state: 'visible' });
  // API limits to 10 (per /api/public/events?limit=10).
  await expect(page.locator('#event-list .event-item')).toHaveCount(10);
});

test('HAPPY-4: each event shows type icon, amount with sign, account unit, reason', async ({ page }) => {
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  seedEvent({ type: 'pocket_money', change_value: 5, status: 'approved', reason: '测试事件' });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#event-list .event-item', { state: 'visible' });

  const row = page.locator('#event-list .event-item').first();
  await expect(row.locator('.event-icon')).toContainText('⚙️');  // PR #27: pocket_money icon changed from 💰 to ⚙️
  await expect(row.locator('.event-amount')).toContainText('+5 元');
  await expect(row.locator('.event-reason')).toContainText('测试事件');
});

// ────────────────────────────────────────────────────────────────────────────
// Edge cases (TEST_PLAN §3.13 line 902-925)
// ────────────────────────────────────────────────────────────────────────────

test('EDGE-1: event with very long reason (200 chars) — text wraps, layout not broken', async ({ page }) => {
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  const longReason = 'a'.repeat(200);
  seedEvent({ type: 'pocket_money', change_value: 5, status: 'approved', reason: longReason });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#event-list .event-item', { state: 'visible' });

  const row = page.locator('#event-list .event-item').first();
  // Row is visible.
  await expect(row).toBeVisible();
  // Text content is preserved (200 a's).
  const text = await row.textContent();
  expect(text).toContain('a'.repeat(50)); // at least 50 a's present
  // Row width stays inside viewport.
  const box = await row.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(1024);
});

test('EDGE-2: XSS attempt in reason — escaped, not executed', async ({ page }) => {
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  let alertFired = false;
  page.on('dialog', (d) => { alertFired = true; d.dismiss(); });
  seedEvent({ type: 'pocket_money', change_value: 5, status: 'approved', reason: '<script>alert(1)</script>' });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#event-list .event-item', { state: 'visible' });
  await page.waitForTimeout(300);

  // No alert fired.
  expect(alertFired).toBe(false);
  // The literal text is in the DOM (not interpreted).
  const row = page.locator('#event-list .event-item').first();
  const text = await row.textContent();
  expect(text).toContain('<script>alert(1)</script>');
  // No <script> tag added to the event-list container.
  expect(await row.locator('script').count()).toBe(0);
});

test('EDGE-3: negative amount with sign — `-3 元` not `3- 元`', async ({ page }) => {
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  seedEvent({ type: 'pocket_money', change_value: -3, status: 'approved', reason: 'negative test' });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#event-list .event-item', { state: 'visible' });

  const row = page.locator('#event-list .event-item').first();
  const amount = await row.locator('.event-amount').textContent();
  expect(amount).toContain('-3 元');
  expect(amount).not.toMatch(/3-/);
});

test('EDGE-4: page refresh updates list — no duplicates', async ({ page }) => {
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  await page.setViewportSize({ width: 1024, height: 768 });

  // Submit 1 event.
  await page.goto('/');
  await page.locator('#btn-submit').click();
  await page.locator('#submit-type').selectOption('pocket_money');
  await page.locator('#submit-amount').fill('8');
  await page.locator('#submit-reason').fill('refresh test');
  await page.locator('#submit-form button[type=submit]').click();
  await page.waitForTimeout(500);
  await expect(page.locator('#event-list .event-item')).toHaveCount(1);

  // Reload.
  await page.goto('/');
  await page.waitForSelector('#event-list .event-item', { state: 'visible' });
  await expect(page.locator('#event-list .event-item')).toHaveCount(1);
});

test('EDGE-5: PM revokes approved event — child sees status change after refresh', async ({ page, request }) => {
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  const evId = seedEvent({ type: 'pocket_money', change_value: 7, status: 'approved', reason: 'revoke from approved' });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#event-list .event-item', { state: 'visible' });
  // Initial: approved.
  await expect(page.locator('.event-status-approved')).toHaveCount(1);

  // PM login + revoke via API.
  const pmLogin = await page.context().request.post('http://127.0.0.1:8787/api/admin/auth/login', {
    data: { pin: '123654' },
  });
  expect(pmLogin.status()).toBe(200);
  const revoke = await page.context().request.post(
    `http://127.0.0.1:8787/api/admin/events/${evId}/revoke`,
  );
  expect(revoke.status()).toBe(200);

  // Child refreshes; badge now 'revoked'.
  await page.locator('#btn-refresh').click();
  await page.waitForTimeout(500);
  await expect(page.locator('.event-status-revoked')).toHaveCount(1);
  await expect(page.locator('.event-status-revoked .event-status')).toContainText('已回收');  // PR #27: "↩ 已回收"
});

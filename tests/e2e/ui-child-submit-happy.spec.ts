// tests/e2e/ui-child-submit-happy.spec.ts
// Phase-2 happy path for child submit-event modal (TEST_PLAN §3.12).
// Covers: modal renders, 4 type/direction combos, balance unchanged while pending.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, seedEvent } from './helpers/db';

test.describe('UI: Child Submit (Happy Path)', () => {
  test.beforeEach(() => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
  });

  // ---------- Smoke ----------

  test('submit modal renders all 4 fields and 2 buttons when opened', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-submit').click();
    // Modal visible (no longer hidden)
    await expect(page.locator('#submit-modal')).toBeVisible();
    // Fields present
    await expect(page.locator('#submit-type')).toBeVisible();
    await expect(page.locator('.seg-btn[data-dir="1"]')).toBeVisible();
    await expect(page.locator('.seg-btn[data-dir="-1"]')).toBeVisible();
    await expect(page.locator('#submit-amount')).toBeVisible();
    await expect(page.locator('#submit-reason')).toBeVisible();
    // Buttons
    await expect(page.locator('#submit-cancel')).toBeVisible();
    await expect(page.locator('#submit-form button[type="submit"]')).toBeVisible();
  });

  // ---------- Happy path ----------

  test('submit +10 game_time: event appears as pending, balance unchanged', async ({ page }) => {
    // Pre-existing approved event so balance is non-zero (proves pending doesn't change it)
    seedEvent({ type: 'game_time', change_value: 5, status: 'approved', reason: 'old' });

    await page.goto('/');
    await expect(page.locator('#balance-game-time')).toHaveText('5');

    await page.locator('#btn-submit').click();
    await page.locator('#submit-type').selectOption('game_time');
    // Default dir=1 (➕), just set amount + reason
    await page.locator('#submit-amount').fill('10');
    await page.locator('#submit-reason').fill('今天主动整理书桌');
    await page.locator('#submit-form button[type="submit"]').click();

    // Modal closes
    await expect(page.locator('#submit-modal')).toBeHidden();
    // Toast (real class is 'toast-show' per app.js, not 'show')
    await expect(page.locator('#toast.toast-show').filter({ hasText: '申请已发送' })).toBeVisible({ timeout: 3000 });  // PR #27: toast "已提交，等家长审核～" → "申请已发送，等待指令确认…"
    // New pending event row in list
    const items = page.locator('#event-list .event-item');
    await expect(items).toHaveCount(2, { timeout: 5000 });
    const pendingRow = items.filter({ hasText: '今天主动整理书桌' });
    await expect(pendingRow).toBeVisible();
    await expect(pendingRow).toContainText('待确认');  // PR #27: "◷ 待确认"
    await expect(pendingRow).toContainText('+10');
    // Balance NOT yet changed (still 5, not 15)
    await expect(page.locator('#balance-game-time')).toHaveText('5');
  });

  test('submit -5 pocket_money (self-report penalty): balance unchanged', async ({ page }) => {
    seedEvent({ type: 'pocket_money', change_value: 20, status: 'approved', reason: 'old' });
    await page.goto('/');
    await expect(page.locator('#balance-pocket-money')).toHaveText('20');

    await page.locator('#btn-submit').click();
    await page.locator('#submit-type').selectOption('pocket_money');
    await page.locator('.seg-btn[data-dir="-1"]').click(); // ➖
    await expect(page.locator('.seg-btn[data-dir="-1"]')).toHaveClass(/seg-btn-active/);
    await page.locator('#submit-amount').fill('5');
    await page.locator('#submit-reason').fill('扣分：和弟弟抢玩具');
    await page.locator('#submit-form button[type="submit"]').click();

    await expect(page.locator('#submit-modal')).toBeHidden();
    const items = page.locator('#event-list .event-item');
    await expect(items).toHaveCount(2, { timeout: 5000 });
    const pendingRow = items.filter({ hasText: '扣分：和弟弟抢玩具' });
    await expect(pendingRow).toBeVisible();
    await expect(pendingRow).toContainText('待确认');  // PR #27: "◷ 待确认"
    await expect(pendingRow).toContainText('-5');
    // Balance still 20 (pending deduction not yet applied)
    await expect(page.locator('#balance-pocket-money')).toHaveText('20');
  });

  test('submit all 4 type/direction combos: 4 pending events created', async ({ page }) => {
    await page.goto('/');

    const combos = [
      { type: 'game_time', dir: 1, amount: 10, reason: 'gt+' },
      { type: 'pocket_money', dir: 1, amount: 5, reason: 'pm+' },
      { type: 'game_time', dir: -1, amount: 3, reason: 'gt-' },
      { type: 'pocket_money', dir: -1, amount: 2, reason: 'pm-' },
    ];

    for (const c of combos) {
      await page.locator('#btn-submit').click();
      await page.locator('#submit-type').selectOption(c.type);
      await page.locator(`.seg-btn[data-dir="${c.dir}"]`).click();
      await page.locator('#submit-amount').fill(String(c.amount));
      await page.locator('#submit-reason').fill(c.reason);
      await page.locator('#submit-form button[type="submit"]').click();
      await expect(page.locator('#submit-modal')).toBeHidden({ timeout: 3000 });
    }

    // 4 rows total, each is pending
    const items = page.locator('#event-list .event-item');
    await expect(items).toHaveCount(4, { timeout: 5000 });
    await expect(page.locator('#event-list .event-item.event-status-pending')).toHaveCount(4);
  });
});

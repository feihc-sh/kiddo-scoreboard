// tests/e2e/admin-coin-requests.spec.ts
// Item #015 §4: e2e tests for admin coin request approve/reject (5 scenarios).
//
// Scenarios:
//   1. PM login → admin → sees 🪙 金币申请 section with 1 pending request
//   2. Approve → confirm → 200 → toast "已批准" → row disappears
//   3. Reject  → prompt with reason → 200 → toast "已驳回" → row disappears
//   4. Audit log: 2 entries (coin_request_approved + coin_request_rejected)
//   5. Empty state: 0 pending → "暂无待审申请"

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, seedCoinRequest, d1Exec } from './helpers/db';
import { loginAsPm } from './helpers/auth';

function d1Scalar(sql: string): string {
  return String(d1Exec(sql) ?? '').trim();
}

test.describe('UI: Admin Coin Request Approve/Reject (Item #015 §4)', () => {
  test.beforeEach(() => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
  });

  // ── 1. PM login → sees 🪙 section with 1 pending request ──

  test('coin request section is visible with 1 pending request', async ({ page, request }) => {
    seedCoinRequest({ user_id: 2, amount: 50, reason: '数学考100分', status: 'pending' });
    await loginAsPm(request);

    await page.goto('/admin/');
    await expect(page.locator('#sec-coin-requests')).toBeVisible();
    await expect(page.locator('#count-coin-requests')).toHaveText('1');
    await expect(page.locator('.coin-request-item')).toHaveCount(1);
    // Row content
    const item = page.locator('.coin-request-item').first();
    await expect(item).toContainText('+50');
    await expect(item).toContainText('🪙');
    await expect(item).toContainText('Tommy');
    await expect(item).toContainText('数学考100分');
    // Approve + reject buttons present
    await expect(item.locator('.pm-approve-btn')).toBeVisible();
    await expect(item.locator('.pm-reject-btn')).toBeVisible();
  });

  // ── 2. Approve → confirm modal → 200 → toast → row disappears ──

  test('approve → confirm → success + row removed', async ({ page, request }) => {
    seedCoinRequest({ id: 90001, user_id: 2, amount: 50, reason: '数学考100分', status: 'pending' });
    await loginAsPm(request);
    await page.goto('/admin/');
    await expect(page.locator('.coin-request-item')).toHaveCount(1);

    // Intercept confirm: auto-accept
    page.on('dialog', (dialog) => { dialog.accept(); });

    await page.locator('.pm-approve-btn').first().click();

    // Toast
    await expect(page.locator('#toast')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#toast')).toContainText('已批准');

    // Row gone
    await expect(page.locator('.coin-request-item')).toHaveCount(0);
    await expect(page.locator('#count-coin-requests')).toHaveText('0');

    // DB: status updated to approved
    expect(d1Scalar(`SELECT status FROM coin_requests WHERE id=90001`)).toBe('approved');
  });

  // ── 3. Reject → prompt with reason → 200 → toast → row disappears ──

  test('reject → enter reason → success + row removed', async ({ page, request }) => {
    seedCoinRequest({ id: 90002, user_id: 2, amount: 30, reason: '想要零花钱', status: 'pending' });
    await loginAsPm(request);
    await page.goto('/admin/');
    await expect(page.locator('.coin-request-item')).toHaveCount(1);

    // Intercept prompt: type a reason
    page.on('dialog', (dialog) => {
      if (dialog.type() === 'prompt') {
        dialog.accept('理由不足');
      } else {
        dialog.accept();
      }
    });

    await page.locator('.pm-reject-btn').first().click();

    // Toast
    await expect(page.locator('#toast')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#toast')).toContainText('已驳回');

    // Row gone
    await expect(page.locator('.coin-request-item')).toHaveCount(0);
    await expect(page.locator('#count-coin-requests')).toHaveText('0');

    // DB: status updated to rejected
    expect(d1Scalar(`SELECT status FROM coin_requests WHERE id=90002`)).toBe('rejected');
    expect(d1Scalar(`SELECT review_note FROM coin_requests WHERE id=90002`)).toBe('理由不足');
  });

  // ── 4. Audit log: coin_request_approved + coin_request_rejected ──

  test('audit log entries are written for approve and reject actions', async ({ page, request }) => {
    seedCoinRequest({ id: 90003, user_id: 2, amount: 10, reason: 'Test A', status: 'pending' });
    seedCoinRequest({ id: 90004, user_id: 2, amount: 20, reason: 'Test R', status: 'pending' });
    await loginAsPm(request);
    await page.goto('/admin/');
    await expect(page.locator('.coin-request-item')).toHaveCount(2);

    page.on('dialog', (dialog) => {
      if (dialog.type() === 'prompt') { dialog.accept('reject reason'); }
      else { dialog.accept(); }
    });

    // Approve first request
    await page.locator('.coin-request-item').nth(0).locator('.pm-approve-btn').click();
    await expect(page.locator('#toast')).toContainText('已批准', { timeout: 3000 });

    // Reject second request
    await page.locator('.coin-request-item').nth(0).locator('.pm-reject-btn').click();
    await expect(page.locator('#toast')).toContainText('已驳回', { timeout: 3000 });

    // Verify audit log entries
    const approvedEntry = d1Scalar(
      `SELECT details FROM audit_log WHERE action='coin_request_approved' ORDER BY created_at DESC LIMIT 1`
    );
    const rejectedEntry = d1Scalar(
      `SELECT details FROM audit_log WHERE action='coin_request_rejected' ORDER BY created_at DESC LIMIT 1`
    );

    expect(approvedEntry).toContain('90003');
    expect(approvedEntry).toContain('10');
    expect(rejectedEntry).toContain('90004');
    expect(rejectedEntry).toContain('20');
    expect(rejectedEntry).toContain('reject reason');
  });

  // ── 5. Empty state: 0 pending → "暂无待审申请" ──

  test('empty state shown when no pending requests', async ({ page, request }) => {
    // Seed an already-approved request (not pending)
    seedCoinRequest({ user_id: 2, amount: 5, reason: 'Already done', status: 'approved' });
    await loginAsPm(request);
    await page.goto('/admin/');

    await expect(page.locator('#count-coin-requests')).toHaveText('0');
    await expect(page.locator('#coin-request-empty')).toBeVisible();
    await expect(page.locator('#coin-request-empty')).toContainText('暂无待审申请');
    await expect(page.locator('.coin-request-item')).toHaveCount(0);
  });
});

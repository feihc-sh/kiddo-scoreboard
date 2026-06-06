// tests/e2e/flow-new-user-day.spec.ts
// §4 Flow A: New user first day (TEST_PLAN §4 lines 933-953)
//
// Two browser contexts (child + PM) walking the full first-day scenario:
// - Child first-time setup → PM sees audit
// - PM creates 3 tasks → Child sees them
// - Child completes 1 task → submits 1 event → PM approves → Child sees balance

import { test, expect, chromium } from '@playwright/test';
import { clearAllData, seedPmUser, d1Exec } from './helpers/db';
import { loginAsPm } from './helpers/auth';

test.describe('§4 Flow A: New user first day (end-to-end)', () => {
  test('child first-time → PM creates tasks → child completes → PM approves', async ({ browser }) => {
    clearAllData();
    seedPmUser();
    // Seed a child user (id=2) with name='' so is_first_time=true (computed by API).
    d1Exec(
      "INSERT INTO users (id, name, role, created_at, updated_at) " +
      "VALUES (2, '', 'child', unixepoch(), unixepoch())",
    );
    // Note: when child submits name, PATCH /api/me/profile sets name='Tommy', is_first_time=false.

    // === Two browser contexts (child iPad + PM desktop) ===
    const ctxChild = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const ctxPm = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const childPage = await ctxChild.newPage();
    const pmPage = await ctxPm.newPage();

    try {
      // 1-2. Child opens / — welcome modal shown.
      await childPage.goto('/');
      await expect(childPage.locator('#welcome-modal')).toBeVisible();

      // 3. Type name, submit.
      await childPage.locator('#welcome-name').fill('Tommy');
      await childPage.locator('#welcome-submit').click();
      // Modal hides within 2s.
      await expect(childPage.locator('#welcome-modal')).toBeHidden({ timeout: 3000 });
      // Greeting updates.
      await expect(childPage.locator('#hero-greeting')).toContainText('Tommy');

      // 4. PM login.
      await loginAsPm(pmPage.context().request);

      // 5. Audit has profile_set entry.
      const ar = await pmPage.context().request.get(
        'http://127.0.0.1:8787/api/admin/audit-log?limit=50',
      );
      const audit = await ar.json();
      const entries = audit.entries || audit;
      const profileSet = entries.find(
        (e: { action: string; details: { name?: string } }) =>
          e.action === 'set_name' && e.details?.name === 'Tommy',
      );
      expect(profileSet).toBeTruthy();

      // 6. PM creates 3 tasks via API (faster than UI form-fill 3 times).
      const tasks = [
        { name: '整理书桌', icon: '📚', token_reward: 5, target_account: 'pocket_money', category: 'chore' },
        { name: '练琴30分钟', icon: '🎹', token_reward: 10, target_account: 'game_time', category: 'study' },
        { name: '刷牙', icon: '🦷', token_reward: 1, target_account: 'pocket_money', category: 'habit' },
      ];
      for (const t of tasks) {
        const r = await pmPage.context().request.post('http://127.0.0.1:8787/api/admin/tasks', {
          data: t,
        });
        expect([200, 201]).toContain(r.status());
      }

      // 7. Child refreshes — sees task buttons.
      await childPage.locator('#btn-refresh').click();
      await childPage.waitForTimeout(500);
      await expect(childPage.locator('#task-shortcuts .task-btn').filter({ hasText: '整理书桌' })).toBeVisible();
      await expect(childPage.locator('#task-shortcuts .task-btn').filter({ hasText: '练琴30分钟' })).toBeVisible();
      await expect(childPage.locator('#task-shortcuts .task-btn').filter({ hasText: '刷牙' })).toBeVisible();

      // 8. Child clicks 整理书桌.
      await childPage.locator('#task-shortcuts .task-btn').filter({ hasText: '整理书桌' }).click();
      await childPage.waitForTimeout(500);
      // Balance should show +5.
      await expect(childPage.locator('#balance-pocket-money, .balance-pocket-money, .pm-balance-pocket-money').first()).toContainText('5');

      // 9. Child submits +10 元 with reason 帮忙洗碗.
      // Open submit modal.
      await childPage.locator('#btn-submit').click();
      await expect(childPage.locator('#submit-modal, .submit-modal, [name="type"]').first()).toBeVisible();
      // Fill form.
      await childPage.locator('[name="type"]').selectOption('pocket_money');
      await childPage.locator('[name="amount"]').fill('10');
      await childPage.locator('[name="reason"]').fill('帮忙洗碗');
      await childPage.locator('button[type=submit]').filter({ hasText: /提交/ }).click();
      await childPage.waitForTimeout(500);

      // 10. PM sees pending event, approves it.
      await pmPage.goto('/admin/');
      // Find the event id via public API (admin has no GET list endpoint).
      const pendingR = await pmPage.context().request.get(
        'http://127.0.0.1:8787/api/public/events?user_id=2&status=pending&limit=20',
      );
      const pendingBody = await pendingR.json();
      const pending = (pendingBody.events || []).find(
        (e: { reason: string }) => e.reason === '帮忙洗碗',
      );
      expect(pending).toBeTruthy();
      const evId = pending.id;
      const apR = await pmPage.context().request.post(
        `http://127.0.0.1:8787/api/admin/events/${evId}/approve`,
      );
      expect(apR.status()).toBe(200);

      // 11. Child refreshes — balance updates to 15 元.
      await childPage.locator('#btn-refresh').click();
      await childPage.waitForTimeout(500);
      // Final balance: pocket_money = 5 (task) + 10 (event approved) = 15.
      await expect(childPage.locator('#balance-pocket-money, .balance-pocket-money, .pm-balance-pocket-money').first()).toContainText('15');

      // 12. Final audit assertions.
      const finalAr = await pmPage.context().request.get(
        'http://127.0.0.1:8787/api/admin/audit-log?limit=100',
      );
      const finalAudit = await finalAr.json();
      const finalEntries = finalAudit.entries || finalAudit;
      const actions = finalEntries.map((e: { action: string }) => e.action);

      // Should have: set_name, 3x task_create, 1x task_complete, 1x event_submit, 1x event_approve.
      expect(actions).toContain('set_name');
      const taskCreates = actions.filter((a: string) => a === 'task_create').length;
      expect(taskCreates).toBeGreaterThanOrEqual(3);
      expect(actions).toContain('task_complete');
      expect(actions).toContain('submit_event');
      expect(actions).toContain('approve_event');
    } finally {
      await ctxChild.close();
      await ctxPm.close();
    }
  });
});

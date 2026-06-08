// tests/e2e/ui-admin-hard-delete.spec.ts
// Stage 4 (NIGHTLY-TODO #009): UI end-to-end coverage for the
// hard-delete button on score_events and task_completions.
//   1. event hard-delete: row disappears, balance recomputes, deleted_records
//      + audit_log both have a row.
//   2. completion hard-delete: completion row disappears, child can
//      re-submit (the source score_event is still there).
//   3. audit + deleted_records: after a hard-delete, both stores reflect
//      the deletion with consistent record_type / original_id / deleted_by.

import { test, expect } from '@playwright/test';
import {
  clearAllData,
  seedPmUser,
  seedChildUser,
  seedEvent,
  seedTask,
  d1Exec,
} from './helpers/db';
import { loginAsPm } from './helpers/auth';

const BASE = 'http://127.0.0.1:8787';

test.describe('UI: PM Hard-Delete (Stage 4, §3.4)', () => {
  test.beforeEach(async ({ page, context }) => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
    await loginAsPm(page.context().request);
    await context.setOffline(false);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Case 1: event hard-delete → row gone, balance recomputes, markers set
  // ─────────────────────────────────────────────────────────────────────────

  test('CASE 1: hard-delete an approved event — balance reverses + audit + snapshot', async ({ page }) => {
    // Seed an approved +10 pocket_money event. Balance: 10.
    const evId = seedEvent({ type: 'pocket_money', change_value: 10, status: 'approved', reason: 'to-delete' });

    await page.goto('/admin/');
    await expect(page.locator('#pm-balance')).toContainText('10');

    // §3.4 click workaround: the <details> summary bubbles clicks that
    // land inside the section body, so we drive the delete via the
    // delegated click handler. We open the section, then dispatch the
    // click on the button directly. The confirm() dialog is auto-accepted
    // via page.on('dialog', d => d.accept()).
    page.on('dialog', (d) => d.accept());
    await page.locator('#sec-all-events summary').click();
    const row = page.locator(`#all-events-list .pm-row:has(.pm-mono:text-is("#${evId}"))`);
    await expect(row).toBeVisible();
    await row.locator('[data-act="hard-delete-event"]').click();

    // After hard-delete, the row should disappear from the list.
    await expect(
      page.locator(`#all-events-list .pm-row:has(.pm-mono:text-is("#${evId}"))`),
    ).toHaveCount(0);

    // Balance is now 0 (recomputed server-side without the deleted event).
    await expect(page.locator('#pm-balance')).toContainText('0');

    // API surface: GET /api/admin/deleted-records?record_type=score_event
    // returns a snapshot for the deleted event id.
    const drR = await page.context().request.get(
      `${BASE}/api/admin/deleted-records?record_type=score_event`,
    );
    expect(drR.status()).toBe(200);
    const drBody = await drR.json();
    const drList = drBody.records || [];
    const drMatch = drList.find(
      (r: { record_type: string; original_id: number }) =>
        r.record_type === 'score_event' && r.original_id === evId,
    );
    expect(drMatch).toBeTruthy();
    expect(drMatch.deleted_by).toBe(1); // seeded PM id

    // Audit log has a row with action='event_hard_deleted' and the
    // event id in target_event_id.
    const ar = await page.context().request.get(
      `${BASE}/api/admin/audit-log?action=event_hard_deleted&limit=10`,
    );
    const audit = await ar.json();
    const entries = audit.entries || audit;
    const ae = entries.find(
      (e: { action: string; target_event_id: number }) =>
        e.action === 'event_hard_deleted' && e.target_event_id === evId,
    );
    expect(ae).toBeTruthy();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Case 2: completion hard-delete → row gone, child can re-submit
  // ─────────────────────────────────────────────────────────────────────────

  test('CASE 2: hard-delete a task_completion — row gone + balance unchanged', async ({ page }) => {
    // Seed task + completion. Use D1 directly to create a completion row
    // and the matching score_event (the POST /complete endpoint is for
    // the child UI; we are staging the same data from PM-side).
    const taskId = seedTask({ token_reward: 5, target_account: 'pocket_money' });
    const now = Math.floor(Date.now() / 1000);
    const today = new Date(now * 1000).toISOString().slice(0, 10);

    // Score event (approved, +5) and matching completion row.
    const evId = seedEvent({ type: 'pocket_money', change_value: 5, status: 'approved', reason: 'task-completed' });
    d1Exec(
      `INSERT INTO task_completions (task_id, user_id, status, completed_date, completed_at, awarded_event_id) ` +
      `VALUES (${taskId}, 2, 'active', '${today}', ${now}, ${evId});`,
    );
    // Look up the completion id we just inserted.
    const compIdR = d1Exec(
      `SELECT id FROM task_completions WHERE awarded_event_id = ${evId} ORDER BY id DESC LIMIT 1;`,
    );
    const compId = Number(String(compIdR).trim());
    expect(compId).toBeGreaterThan(0);

    await page.goto('/admin/');
    // Balance = 5 from the awarded event.
    await expect(page.locator('#pm-balance')).toContainText('5');

    page.on('dialog', (d) => d.accept());
    await page.locator('#sec-completions summary').click();
    const row = page.locator(`#completions-list .pm-row:has(.pm-mono:text-is("#${compId}"))`);
    await expect(row).toBeVisible();
    await row.locator('[data-act="hard-delete-completion"]').click();

    // The completion row is gone from the UI.
    await expect(
      page.locator(`#completions-list .pm-row:has(.pm-mono:text-is("#${compId}"))`),
    ).toHaveCount(0);

    // Balance is still 5 (the source score_event is left in place by design).
    await expect(page.locator('#pm-balance')).toContainText('5');

    // API surface: deleted_records has the snapshot.
    const drR = await page.context().request.get(
      `${BASE}/api/admin/deleted-records?record_type=task_completion`,
    );
    const drBody = await drR.json();
    const drMatch = (drBody.records || []).find(
      (r: { record_type: string; original_id: number }) =>
        r.record_type === 'task_completion' && r.original_id === compId,
    );
    expect(drMatch).toBeTruthy();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Case 3: audit log + deleted_records contain the deletion (consistency)
  // ─────────────────────────────────────────────────────────────────────────

  test('CASE 3: hard-delete leaves matching rows in BOTH audit_log AND deleted_records', async ({ page }) => {
    const evId = seedEvent({ type: 'game_time', change_value: 7, status: 'approved', reason: 'consistency-check' });

    page.on('dialog', (d) => d.accept());
    await page.goto('/admin/');
    await page.locator('#sec-all-events summary').click();
    const row = page.locator(`#all-events-list .pm-row:has(.pm-mono:text-is("#${evId}"))`);
    await row.locator('[data-act="hard-delete-event"]').click();

    // Both stores must agree on the deletion.
    const drR = await page.context().request.get(`${BASE}/api/admin/deleted-records`);
    const ar = await page.context().request.get(
      `${BASE}/api/admin/audit-log?action=event_hard_deleted&limit=50`,
    );
    const dr = await drR.json();
    const audit = await ar.json();

    const drMatch = (dr.records || []).find(
      (r: { record_type: string; original_id: number; deleted_by: number }) =>
        r.record_type === 'score_event' && r.original_id === evId && r.deleted_by === 1,
    );
    const ae = (audit.entries || []).find(
      (e: { action: string; target_event_id: number; target_user_id: number }) =>
        e.action === 'event_hard_deleted' &&
        e.target_event_id === evId &&
        e.target_user_id === 1,
    );
    expect(drMatch).toBeTruthy();
    expect(ae).toBeTruthy();
  });
});

// tests/e2e/ui-admin-hard-delete-fk.spec.ts
// P0 REGRESSION (Qual 2026-06-09): hard-delete of a score_event fails with
// 500 INTERNAL when the event is referenced by a task_completion's
// `awarded_event_id` column.
//
// Root cause: src/utils/deleted-records.ts:moveToDeletedRecords wraps
//   INSERT deleted_records, DELETE FROM score_events
// in a single db.batch(). D1 enforces FOREIGN KEY constraints, so the
// DELETE fails with SQLITE_CONSTRAINT_FOREIGNKEY when a row in
// task_completions points at the event. The whole batch is rolled back
// (correct), the endpoint returns 500 (the bug), and the row stays put.
//
// The pre-existing ui-admin-hard-delete.spec.ts seeds events with
// seedEvent() (no matching task_completion), so the FK never fires —
// which is why this slipped through the Stage 4 regression suite.
//
// Expected behavior (after PM fix): one of the following, decided by PM:
//   (a) cascade — null out task_completions.awarded_event_id for any
//       completion that referenced the deleted event, then delete. The
//       completion row stays (audit-friendly).
//   (b) refuse — return 409 with a clear error message telling the PM
//       to revoke the completion first; do not delete.
//   (c) cascade-delete — drop the completion along with the event.
//       Most destructive, not recommended.
//
// Whichever option PM picks, the user-visible contract is:
//   - The endpoint does NOT return 500.
//   - The row is either gone (a/c) or visibly preserved (b).
//   - The deleted_records snapshot is consistent with what was deleted.

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

test.describe('P0 REGRESSION: hard-delete FK constraint (2026-06-09)', () => {
  test.beforeEach(async ({ page, context }) => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
    await loginAsPm(page.context().request);
    await context.setOffline(false);
    page.on('dialog', (d) => d.accept());
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CASE 1: UI button click — exact user flow that surfaced the bug
  // ─────────────────────────────────────────────────────────────────────────

  test('CASE 1: clicking 🗑 永久删除 on a task-sourced event must not 500', async ({ page }) => {
    // Seed: a real task + a real completion (with awarded_event_id → event).
    // This mirrors the bug-report scenario: the completion was created
    // through the child-UI flow (POST /api/me/tasks/:id/complete), so
    // the FK is non-null.
    const taskId = seedTask({ token_reward: 5, target_account: 'pocket_money', name: 'Brush teeth' });
    const evId = seedEvent({ type: 'pocket_money', change_value: 5, status: 'approved', reason: 'task reward' });
    const now = Math.floor(Date.now() / 1000);
    const today = new Date(now * 1000).toISOString().slice(0, 10);

    d1Exec(
      `INSERT INTO task_completions (task_id, user_id, status, completed_date, completed_at, awarded_event_id) ` +
      `VALUES (${taskId}, 2, 'active', '${today}', ${now}, ${evId});`,
    );

    // Login + open the all-events section (so the row is rendered).
    await page.goto('/admin/');
    await page.locator('#sec-all-events summary').click();
    const row = page.locator(`#all-events-list .pm-row:has(.pm-mono:text-is("#${evId}"))`);
    await expect(row).toBeVisible();

    // Capture every hard-delete response.
    const responses: Array<{ status: number; body: string }> = [];
    page.on('response', async (r) => {
      if (r.url().includes('/hard-delete')) {
        responses.push({ status: r.status(), body: await r.text() });
      }
    });

    // The user action: click the button. The contract is that the server
    // does not 500 — the row is either gone, or a clear 4xx is returned.
    await row.locator('[data-act="hard-delete-event"]').click();
    await page.waitForTimeout(1500);

    // Must NOT be a 500. The current buggy behavior returns 500.
    expect(responses.length).toBeGreaterThan(0);
    for (const r of responses) {
      expect(r.status, `hard-delete returned ${r.status}: ${r.body}`).not.toBe(500);
    }

    // If the server decided to actually delete the row (option a/c), the
    // row should be gone from the UI; if it refused (option b), the row
    // is still here and the API returned a 4xx. Either way, the response
    // body is JSON with a clear error.code (not "INTERNAL").
    const first = responses[0];
    const body = JSON.parse(first.body) as { error?: { code: string; message: string }; success?: boolean };
    if (first.status >= 400) {
      // Refused — error code must be specific, not the generic INTERNAL
      expect(body.error?.code).not.toBe('INTERNAL');
    } else {
      expect(body.success).toBe(true);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CASE 2: Direct API call (no UI) — confirms the bug is server-side
  // ─────────────────────────────────────────────────────────────────────────

  test('CASE 2: POST /api/admin/events/:id/hard-delete must not 500 when completion references it', async ({ page }) => {
    const taskId = seedTask({ token_reward: 5, target_account: 'pocket_money' });
    const evId = seedEvent({ type: 'pocket_money', change_value: 5, status: 'approved', reason: 'fk-test' });
    const now = Math.floor(Date.now() / 1000);
    const today = new Date(now * 1000).toISOString().slice(0, 10);

    d1Exec(
      `INSERT INTO task_completions (task_id, user_id, status, completed_date, completed_at, awarded_event_id) ` +
      `VALUES (${taskId}, 2, 'active', '${today}', ${now}, ${evId});`,
    );

    const r = await page.context().request.post(`${BASE}/api/admin/events/${evId}/hard-delete`);

    // Same contract as CASE 1: not 500.
    expect(r.status(), `hard-delete returned ${r.status()}: ${await r.text()}`).not.toBe(500);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CASE 3: After hard-delete (or refusal), the snapshot table reflects
  //         what actually happened — no half-state.
  // ─────────────────────────────────────────────────────────────────────────

  test('CASE 3: deleted_records + score_events must be consistent post-attempt', async ({ page }) => {
    const evId = seedEvent({ type: 'pocket_money', change_value: 5, status: 'approved', reason: 'consistency' });
    const now = Math.floor(Date.now() / 1000);
    const today = new Date(now * 1000).toISOString().slice(0, 10);
    d1Exec(
      `INSERT INTO task_completions (task_id, user_id, status, completed_date, completed_at, awarded_event_id) ` +
      `VALUES (1, 2, 'active', '${today}', ${now}, ${evId});`,
    );

    await page.context().request.post(`${BASE}/api/admin/events/${evId}/hard-delete`);

    // Either: event is gone AND a deleted_records row exists for it.
    // Or:     event is still there AND no deleted_records row for it.
    // Never:  event gone but no snapshot (lost data) — this is the real
    //         safety contract; the 500 is just a noisy symptom.
    const drR = await page.context().request.get(`${BASE}/api/admin/deleted-records?record_type=score_event`);
    const drBody = await drR.json();
    const drMatch = (drBody.records || []).find(
      (r: { record_type: string; original_id: number }) =>
        r.record_type === 'score_event' && r.original_id === evId,
    );
    const evStill = d1Exec(`SELECT id FROM score_events WHERE id = ${evId};`).trim();
    const evExists = evStill.length > 0;

    if (drMatch) {
      // If we have a snapshot, the source row must be gone.
      expect(evExists, 'snapshot exists but source row still present — inconsistent').toBe(false);
    } else {
      // If we don't have a snapshot, the source row must still be here.
      expect(evExists, 'no snapshot and source row gone — lost data, never acceptable').toBe(true);
    }
  });
});

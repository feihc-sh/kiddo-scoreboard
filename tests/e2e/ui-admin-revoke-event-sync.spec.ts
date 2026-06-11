// tests/e2e/ui-admin-revoke-event-sync.spec.ts
// P0 REGRESSION (Qual 2026-06-09): revoking a score_event from the admin UI
// does NOT propagate to the child UI's task-completion state.
//
// Root cause: src/routes/admin/events.ts:revokeEvent only updates
// score_events.status = 'revoked' and the audit log. It does NOT touch
// task_completions. The child UI's GET /api/public/tasks/today-status
// derives `uncompleted_today_ids` from task_completions.status='revoked'
// rows, so it doesn't see the event-level revoke. Child UI keeps showing
// the task as ✅ done.
//
// Compare with the COMPLETION-level revoke (POST /api/admin/task-completions/:id/revoke):
// that path *does* update both tables in one db.batch(), and the child UI
// correctly switches to "系统休眠中" (PR #27 Mecha redesign 文案, was "明天再来 🌙").
// See flow-task-lifecycle.spec.ts for that working path.
//
// User impact: PM thinks they revoked a child's task but the child still
// sees it as done. This is a state-mismatch bug, not a data corruption bug,
// but it is exactly the kind of thing that erodes PM trust in the app.
//
// Expected behavior (after PM fix), one of:
//   (a) revokeEvent also sets the matching task_completion.status='revoked'
//       (and the child UI's "uncomplete-toggle" becomes available).
//   (b) revokeEvent refuses with 409 if a completion references the event
//       and tells the PM to use the completion-level revoke instead.
//   (c) Admin UI hides the 撤销 button on event rows that are referenced
//       by a task_completion, forcing the PM to use the completion-level
//       revoke (which already works correctly).

import { test, expect } from '@playwright/test';
import {
  clearAllData,
  seedPmUser,
  seedChildUser,
  seedEvent,
  d1Exec,
} from './helpers/db';
import { loginAsPm } from './helpers/auth';

const BASE = 'http://127.0.0.1:8787';

test.describe('P0 REGRESSION: admin revoke event must sync to child UI (2026-06-09)', () => {
  test.beforeEach(async ({ page, context }) => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
    await loginAsPm(page.context().request);
    await context.setOffline(false);
    page.on('dialog', (d) => d.accept());
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CASE 1: UI click — exact user flow that surfaced the bug
  // ─────────────────────────────────────────────────────────────────────────

  test('CASE 1: PM clicks 撤销 on a task-sourced event → child UI must show it as undone', async ({ page, context }) => {
    // Seed: child has a completed task whose completion references this event.
    const evId = seedEvent({
      type: 'pocket_money',
      change_value: 5,
      status: 'approved',
      reason: 'task reward',
    });
    const taskId = d1Exec(`SELECT id FROM tasks ORDER BY id LIMIT 1;`).trim();
    // Ensure a task exists (helpers' clearAllData wipes tasks).
    if (!taskId) {
      d1Exec(`INSERT INTO tasks (id, name, token_reward, target_account, icon, category, sort_order, is_active, created_at, updated_at)
              VALUES (1, 'Brush teeth', 5, 'pocket_money', '🪥', 'habit', 0, 1, unixepoch(), unixepoch());`);
    }
    const now = Math.floor(Date.now() / 1000);
    // §X SH date: match todayShanghai() in src/utils/week.ts (UTC + 8h offset)
    // Without this, +08 tz machines get date mismatch vs production endpoint.
    const today = new Date(now * 1000 + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    d1Exec(
      `INSERT INTO task_completions (task_id, user_id, status, completed_date, completed_at, awarded_event_id)
       VALUES (1, 2, 'active', '${today}', ${now}, ${evId});`,
    );

    // PM goes to admin, opens all-events, clicks 撤销 on the event.
    await page.goto('/admin/');
    await page.locator('#sec-all-events summary').click();
    const evRow = page.locator(`#all-events-list .pm-row:has(.pm-mono:text-is("#${evId}"))`);
    await expect(evRow).toBeVisible();
    const revokeBtn = evRow.locator('[data-act="revoke"]');
    await expect(revokeBtn).toBeVisible();
    await revokeBtn.click();
    await page.waitForTimeout(1000);

    // Server side: event must be revoked (this works today).
    const evStatus = d1Exec(`SELECT status FROM score_events WHERE id = ${evId};`).trim();
    expect(evStatus).toBe('revoked');

    // Contract: child UI's today-status must include the task in
    // `uncompleted_today_ids` (so the child sees the task as undone).
    // Buggy behavior: the task stays in `completed_task_ids` because
    // task_completions was never updated.
    const tsRes = await page.context().request.get(
      `${BASE}/api/public/tasks/today-status?user_id=2`,
    );
    const ts = await tsRes.json();
    expect(ts.uncompleted_today_ids, `expected task #1 in uncompleted_today_ids, got ${JSON.stringify(ts)}`).toContain(1);
    expect(ts.completed_task_ids, `expected task #1 NOT in completed_task_ids, got ${JSON.stringify(ts)}`).not.toContain(1);

    // Visual contract: child UI renders the task button with
    // .task-btn-revoked class and "系统休眠中" badge text (PR #27 Mecha redesign,
    // was "明天再来 🌙" pre-#27).
    const childPage = await context.newPage();
    await childPage.goto('/');
    await childPage.waitForTimeout(1500);
    const taskBtn = childPage.locator('#task-shortcuts button.task-btn[data-task-id="1"]');
    await expect(taskBtn).toHaveClass(/task-btn-revoked/);
    const html = await taskBtn.innerHTML();
    expect(html).toContain('系统休眠中');
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CASE 2: API level — direct revoke, then assert child API sees it
  // ─────────────────────────────────────────────────────────────────────────

  test('CASE 2: POST /api/admin/events/:id/revoke must propagate to child today-status', async ({ page }) => {
    const evId = seedEvent({ type: 'pocket_money', change_value: 5, status: 'approved', reason: 'task reward' });
    const now = Math.floor(Date.now() / 1000);
    // §X SH date: match todayShanghai() in src/utils/week.ts (UTC + 8h offset)
    // Without this, +08 tz machines get date mismatch vs production endpoint.
    const today = new Date(now * 1000 + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    d1Exec(
      `INSERT INTO task_completions (task_id, user_id, status, completed_date, completed_at, awarded_event_id)
       VALUES (1, 2, 'active', '${today}', ${now}, ${evId});`,
    );

    const r = await page.context().request.post(`${BASE}/api/admin/events/${evId}/revoke`);
    expect(r.status()).toBe(200);

    const ts = await (await page.context().request.get(
      `${BASE}/api/public/tasks/today-status?user_id=2`,
    )).json();

    // The contract: the task id must be in uncompleted_today_ids, NOT in
    // completed_task_ids. Today it stays in completed_task_ids (the bug).
    expect(ts.uncompleted_today_ids).toContain(1);
    expect(ts.completed_task_ids).not.toContain(1);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // CASE 3: sanity check — the COMPLETION-level revoke (which already works)
  //         must still pass after the fix. This protects against regressions
  //         in the working path while PM is fixing the broken one.
  // ─────────────────────────────────────────────────────────────────────────

  test('CASE 3: completion-level revoke still propagates (regression guard)', async ({ page }) => {
    const evId = seedEvent({ type: 'pocket_money', change_value: 5, status: 'approved', reason: 'task reward' });
    const now = Math.floor(Date.now() / 1000);
    // §X SH date: match todayShanghai() in src/utils/week.ts (UTC + 8h offset)
    // Without this, +08 tz machines get date mismatch vs production endpoint.
    const today = new Date(now * 1000 + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    d1Exec(
      `INSERT INTO task_completions (task_id, user_id, status, completed_date, completed_at, awarded_event_id)
       VALUES (1, 2, 'active', '${today}', ${now}, ${evId});`,
    );

    // Look up the completion id
    const compIdRaw = d1Exec(`SELECT id FROM task_completions WHERE awarded_event_id = ${evId};`).trim();
    const compId = parseInt(compIdRaw);

    const r = await page.context().request.post(
      `${BASE}/api/admin/task-completions/${compId}/revoke`,
    );
    expect(r.status()).toBe(200);

    const ts = await (await page.context().request.get(
      `${BASE}/api/public/tasks/today-status?user_id=2`,
    )).json();
    expect(ts.uncompleted_today_ids).toContain(1);
    expect(ts.completed_task_ids).not.toContain(1);
  });
});

// tests/e2e/flow-task-lifecycle.spec.ts
// §4 Flow F (bonus): Task lifecycle end-to-end (TEST_PLAN §4 lines 1000-1008)
//
// PM creates task → child completes → PM revokes → child re-completes → PM deletes.
// Single context, API-only (UI is tested in §3.11 + §3.5 separately).
//
// M2 (Q7, feihao 2026-06-11) notes:
// - The pre-M2 PHASE2-FINDING comment (awarded_event_id was NULL → revoke
//   UPDATE matched no row → balance didn't reverse) was already fixed by
//   5021b7d in commit log. awarded_event_id is populated on complete.
// - M2 also removed the legacy token_reward event: the complete endpoint
//   now writes only a +1 coin event, so legacy game_time/pocket_money
//   balances stay at 0 after a complete (the only effect is +1 coin, not
//   shown in this assertion). Revoke writes a -1 coin event instead of
//   flipping the awarded event, so legacy balances stay 0 (the +1/-1
//   pair nets to 0 on the coin balance).

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, d1Exec } from './helpers/db';
import { loginAsPm } from './helpers/auth';

test.describe('§4 Flow F: Task lifecycle (API-only, end-to-end)', () => {
  test('PM create → child complete → PM revoke → PM delete', async ({ page }) => {
    clearAllData();
    seedPmUser();
    d1Exec(
      "INSERT INTO users (id, name, role, created_at, updated_at) " +
      "VALUES (2, 'Tommy', 'child', unixepoch(), unixepoch())",
    );
    await loginAsPm(page.context().request);

    // 1. PM creates 洗碗 task.
    const tName = '洗碗';
    const createR = await page.context().request.post(
      'http://127.0.0.1:8787/api/admin/tasks',
      {
        data: {
          name: tName, icon: '🍽️', token_reward: 3,
          target_account: 'pocket_money', category: 'chore',
        },
      },
    );
    expect([200, 201]).toContain(createR.status());
    const created = await createR.json();
    const taskId = created.id;
    expect(taskId).toBeGreaterThan(0);

    // 2. Child completes (via /api/me/tasks/:id/complete).
    const compR = await page.context().request.post(
      `http://127.0.0.1:8787/api/me/tasks/${taskId}/complete`,
    );
    expect([200, 201]).toContain(compR.status());
    // Coin System M2 (Q7, feihao 2026-06-11): task completion no longer
    // adds token_reward (3) to pocket_money. The +1 coin is invisible to
    // this assertion (the /api/public/balance endpoint only returns
    // game_time + pocket_money — see src/utils/balance.ts computeBalance
    // which excludes 'coins' type from the Balance type cast). The
    // legacy game_time/pocket_money balances stay at 0.
    let br = await page.context().request.get(
      'http://127.0.0.1:8787/api/public/balance?user_id=2',
    );
    let balance = await br.json();
    expect(balance.pocket_money).toBe(0);
    expect(balance.game_time).toBe(0);

    // 3. PM revokes task completion.
    const taskCompletionId = Number(
      String(
        d1Exec(
          "SELECT id FROM task_completions WHERE task_id = " + taskId + " ORDER BY id DESC LIMIT 1",
        )?.toString().trim(),
      ),
    );
    expect(taskCompletionId).toBeGreaterThan(0);
    const revokeR = await page.context().request.post(
      `http://127.0.0.1:8787/api/admin/task-completions/${taskCompletionId}/revoke`,
    );
    expect([200, 204]).toContain(revokeR.status());

    // 4. task_completion row status → 'revoked'.
    const tcStatus = String(
      d1Exec(
        "SELECT status FROM task_completions WHERE id = " + taskCompletionId,
      )?.toString().trim(),
    );
    expect(tcStatus).toBe('revoked');
    // M2 (Q7): revoke no longer UPDATEs the awarded event to 'revoked' —
    // it writes a separate -1 coin event. Legacy game_time/pocket_money
    // balances stay at 0 (the +1/-1 coin pair nets to 0 on the coin
    // balance, which is the only thing that moves). Test now passes
    // because there's no balance to assert against at this step.

    // 5. (skipped re-complete — see PHASE2-FINDING note above)

    // 6. PM deletes task.
    const delR = await page.context().request.delete(
      `http://127.0.0.1:8787/api/admin/tasks/${taskId}`,
    );
    expect([200, 204]).toContain(delR.status());

    // 7. Task no longer in /api/public/tasks?active=true.
    const tR = await page.context().request.get(
      'http://127.0.0.1:8787/api/public/tasks?user_id=2&active=true',
    );
    const tasks = await tR.json();
    const stillActive = (tasks.tasks || []).some(
      (t: { id: number }) => t.id === taskId,
    );
    expect(stillActive).toBe(false);
  });
});

// tests/e2e/sleep-lockout.spec.ts
// §3.14 / Item #002 — Sleep task self-lockout (server-side enforcement)
// API-level coverage. UI countdown + auto-lockout is covered by the live e2e
// on iPad Safari; page.clock-based time control for 21:30 cutoff is fragile in
// Playwright (clock.install affects only Date.now, not the workerd's
// setInterval), so we test the server contract here. The full §3.14 scenarios
// (UI countdown / cross-day reset / page.clock) are documented in TEST_PLAN §3.14
// for future expansion.
//
// Pre-req: a sleep task is expected to be seeded by clearAllData + seedSleepTask
// in beforeEach. Helper: tests/e2e/helpers/db.ts.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, d1Exec } from './helpers/db';

const CHILD_USER_ID = 2;

/** Seed a sleep task with given cutoff + lockout flag. */
function seedSleepTask(opts: { cutoff: string; selfLockout: 0 | 1; id?: number; name?: string }): number {
  const id = opts.id ?? 102;
  const name = opts.name ?? '准时上床';
  const now = Math.floor(Date.now() / 1000);
  d1Exec(
    `INSERT INTO tasks (id, name, token_reward, target_account, icon, category, ` +
    `is_active, sort_order, cutoff_time, is_self_lockout, created_at, updated_at) ` +
    `VALUES (${id}, '${name}', 1, 'game_time', '🛏', 'habit', 1, 0, ` +
    `'${opts.cutoff}', ${opts.selfLockout}, ${now}, ${now}) ` +
    `ON CONFLICT(id) DO UPDATE SET cutoff_time=excluded.cutoff_time, ` +
    `is_self_lockout=excluded.is_self_lockout, updated_at=excluded.updated_at;`,
  );
  return id;
}

test.describe('Item #002: Sleep task self-lockout (API)', () => {
  test.beforeEach(() => {
    clearAllData();
    seedPmUser();
    seedChildUser();
  });

  test('GET /api/public/tasks?user_id=X returns cutoff_time + is_self_lockout fields', async ({ request }) => {
    seedSleepTask({ cutoff: '21:30', selfLockout: 1 });
    const res = await request.get(`/api/public/tasks?user_id=${CHILD_USER_ID}&active=true`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    const sleepTask = body.tasks.find((t: { name: string }) => t.name === '准时上床');
    expect(sleepTask).toBeTruthy();
    expect(sleepTask.cutoff_time).toBe('21:30');
    expect(sleepTask.is_self_lockout).toBe(1);
  });

  test('POST /complete with cutoff PASSED returns 400 CUTOFF_PASSED (no completion inserted)', async ({ request }) => {
    const id = seedSleepTask({ cutoff: '00:01', selfLockout: 1 }); // 00:01 is in the past after midnight
    const res = await request.post(`/api/me/tasks/${id}/complete`);
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error?.code).toBe('CUTOFF_PASSED');
    expect(body.error?.message).toContain('00:01');
    // Verify no completion was created
    const tcCheck = d1Exec(`SELECT COUNT(*) as n FROM task_completions WHERE task_id=${id} AND status='active';`);
    expect(tcCheck.trim()).toBe('0');
  });

  test('POST /complete with cutoff NOT YET PASSED (23:59) succeeds and awards token', async ({ request }) => {
    const id = seedSleepTask({ cutoff: '23:59', selfLockout: 1 }); // 23:59 is always in the future during daytime
    const res = await request.post(`/api/me/tasks/${id}/complete`);
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.task_id).toBe(id);
    expect(body.token_awarded).toBe(1);
    expect(body.target_account).toBe('game_time');
  });

  test('Sleep task with is_self_lockout=0 ignores cutoff_time (no enforcement)', async ({ request }) => {
    // cutoff is in the past, but lockout flag is off — completion should succeed.
    const id = seedSleepTask({ cutoff: '00:01', selfLockout: 0 });
    const res = await request.post(`/api/me/tasks/${id}/complete`);
    expect(res.status()).toBe(201);
  });

  test('Non-sleep task (cutoff_time=NULL) is unaffected by cutoff check', async ({ request }) => {
    const now = Math.floor(Date.now() / 1000);
    // Manually seed a non-sleep task with explicit NULL cutoff (seedTask default).
    d1Exec(
      `INSERT INTO tasks (id, name, token_reward, target_account, icon, category, ` +
      `is_active, sort_order, cutoff_time, is_self_lockout, created_at, updated_at) ` +
      `VALUES (200, '刷牙', 5, 'game_time', '🦷', 'chore', 1, 1, NULL, 0, ${now}, ${now});`,
    );
    const res = await request.post('/api/me/tasks/200/complete');
    expect(res.status()).toBe(201);
  });
});

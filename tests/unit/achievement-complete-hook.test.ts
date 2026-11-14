// tests/unit/achievement-complete-hook.test.ts
// The streak engine's hook into POST /api/me/tasks/:id/complete (spec §8).
//
// Verifies:
//   - the hook runs at the §4.5 bonus-check position (after the completion
//     is committed, so the engine can read it)
//   - a fully-completed day grants the medal through the /complete path
//   - the hook is BEST-EFFORT: a failing streak engine must NOT fail the
//     task completion (spec §8: 不回滚主流程)
//
// The child user id is hardcoded to 2 in src/routes/me/tasks.ts (M5 will
// replace it with real auth) — same convention as me-tasks-complete.test.ts.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import app from '../../src/worker.ts';
import {
  addAchievement,
  addSeason,
  addTask,
  addUser,
  completeTask,
  makeMockDb,
  petTokenBalance,
  petTokenEvents,
  type MockState,
} from './achievements-mock.ts';
import { todayShanghai } from '../../src/utils/week.ts';

const CHILD_ID = 2;
const PM_ID = 1;

let mock = makeMockDb();
let state: MockState;

beforeEach(() => {
  mock = makeMockDb();
  state = mock.state;
  addUser(state, PM_ID, 'pm');
  addUser(state, CHILD_ID, 'child');
});

function envObj() {
  return { DB: mock.db, JWT_SECRET: 'unit-test-secret-1234567890' };
}

async function call(path: string, init: RequestInit = {}) {
  return app.request(`http://test.local${path}`, init, envObj());
}

async function completeTaskRequest(taskId: number) {
  return call(`/api/me/tasks/${taskId}/complete`, { method: 'POST' });
}

interface CompleteResponse {
  task_id: number;
  coin_event_id: number;
  bonus_event_id: number | null;
  streak: { streak: number; granted: Array<{ tier: string; achievement_name: string }> } | null;
  error?: { code: string; message: string };
}

// =============================================================
// The hook fires
// =============================================================
describe('POST /api/me/tasks/:id/complete — achievement streak hook', () => {
  it('grants the iron medal when the day is fully complete (T1)', async () => {
    addSeason(state, { id: 1, starts_on: '2026-09-01', is_current: 1 });
    addAchievement(state, {
      id: 4,
      grp: 'life',
      name: '自律生活',
      grant_mode: 'auto_streak',
      ladder_json: '{"iron":2,"bronze":4,"silver":8,"gold":15,"king":30}',
    });
    const task = addTask(state, { id: 1 });

    // Yesterday complete → the streak is 1; completing today makes it 2
    // → iron threshold reached.
    completeTask(state, task.id, CHILD_ID, yesterday());

    const r = await completeTaskRequest(task.id);
    expect(r.status).toBe(201);
    const body = (await r.json()) as CompleteResponse;

    // The hook ran and reports the streak.
    expect(body.streak).not.toBeNull();
    expect(body.streak!.streak).toBe(2);
    expect(body.streak!.granted.map((g) => g.tier)).toEqual(['iron']);

    // The medal + its token landed.
    expect(state.awards).toHaveLength(1);
    expect(state.awards[0].tier).toBe('iron');
    expect(petTokenEvents(state, CHILD_ID)).toHaveLength(1);
    expect(petTokenEvents(state, CHILD_ID)[0].change_value).toBe(1);
    expect(petTokenBalance(state, CHILD_ID)).toBe(1);

    // Audit row for the auto-grant.
    const audit = state.audit.find((a) => a.action === 'achievement_grant');
    expect(audit).toBeDefined();
    expect(audit!.actor).toBe('system');
  });

  it('does not grant a medal when the day is only partially complete (T6)', async () => {
    addSeason(state, { id: 1, starts_on: '2026-09-01', is_current: 1 });
    addAchievement(state, {
      id: 4,
      grp: 'life',
      name: '自律生活',
      grant_mode: 'auto_streak',
      ladder_json: '{"iron":2,"bronze":4,"silver":8,"gold":15,"king":30}',
    });
    const taskA = addTask(state, { id: 1 });
    const taskB = addTask(state, { id: 2 });

    // Only task A gets completed → the day is not fully complete.
    const r = await completeTaskRequest(taskA.id);
    expect(r.status).toBe(201);
    const body = (await r.json()) as CompleteResponse;

    expect(body.streak!.streak).toBe(0);
    expect(body.streak!.granted).toHaveLength(0);
    expect(state.awards).toHaveLength(0);
    expect(petTokenEvents(state, CHILD_ID)).toHaveLength(0);
    expect(taskB.id).toBe(2);
  });

  it('is idempotent: a second completion of the same task does not re-grant', async () => {
    addSeason(state, { id: 1, starts_on: '2026-09-01', is_current: 1 });
    addAchievement(state, {
      id: 4,
      grp: 'life',
      name: '自律生活',
      grant_mode: 'auto_streak',
      ladder_json: '{"iron":2,"bronze":4,"silver":8,"gold":15,"king":30}',
    });
    const task = addTask(state, { id: 1 });
    completeTask(state, task.id, CHILD_ID, yesterday());

    const first = await completeTaskRequest(task.id);
    expect(first.status).toBe(201);

    // The same task again → rejected by the existing ALREADY_COMPLETED_TODAY
    // guard, so the hook never runs a second time.
    const second = await completeTaskRequest(task.id);
    expect(second.status).toBe(409);

    // Still exactly one award and one mint.
    expect(state.awards).toHaveLength(1);
    expect(petTokenEvents(state, CHILD_ID)).toHaveLength(1);
    expect(petTokenBalance(state, CHILD_ID)).toBe(1);
  });

  it('completes the task even when the streak engine throws (best-effort)', async () => {
    addSeason(state, { id: 1, starts_on: '2026-09-01', is_current: 1 });
    addAchievement(state, {
      id: 4,
      grp: 'life',
      name: '自律生活',
      grant_mode: 'auto_streak',
      ladder_json: '{"iron":2}',
    });
    const task = addTask(state, { id: 1 });

    // Make the streak engine's DB read blow up. The engine's task query is
    // distinguishable from the §4.5 bonus check's query by the extra
    // `created_at` column — targeting only the engine's query keeps the
    // bonus check (which is NOT best-effort) working.
    const originalPrepare = mock.db.prepare.bind(mock.db);
    vi.spyOn(mock.db, 'prepare').mockImplementation((query: string) => {
      if (/created_at FROM tasks WHERE is_active = 1/i.test(query)) {
        throw new Error('boom — engine failure');
      }
      return originalPrepare(query);
    });

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const r = await completeTaskRequest(task.id);

    // The task completion still succeeds (the hook must not roll back the
    // main flow — spec §8).
    expect(r.status).toBe(201);
    const body = (await r.json()) as CompleteResponse;
    expect(body.task_id).toBe(task.id);
    expect(body.streak).toBeNull();

    // The completion row was written.
    expect(
      state.completions.some(
        (c) => c.task_id === task.id && c.completed_date === todayShanghai(),
      ),
    ).toBe(true);

    consoleError.mockRestore();
  });
});

/** Yesterday's date in Asia/Shanghai (test-local helper). */
function yesterday(): string {
  const today = todayShanghai();
  const [y, m, d] = today.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1, d) - 86_400_000);
  const yy = target.getUTCFullYear();
  const mm = String(target.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(target.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

afterEach(() => {
  vi.restoreAllMocks();
});

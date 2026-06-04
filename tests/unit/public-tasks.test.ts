// tests/unit/public-tasks.test.ts
// Integration tests for GET /api/public/tasks (list) and
// GET /api/public/tasks/today-status.
// Read-only endpoints — no auth required. Mounted at /api/public/tasks
// by src/worker.ts.
import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/worker.ts';
import type { D1Database, D1PreparedStatement, D1Result } from '../../src/db/types.ts';
import type { Task, TaskCompletion } from '../../src/db/types.ts';
import { todayShanghai } from '../../src/utils/week.ts';

let tasks: Task[] = [];
let completions: TaskCompletion[] = [];
let nextTaskId = 1;
let nextCompletionId = 1;

function reset() {
  tasks = [];
  completions = [];
  nextTaskId = 1;
  nextCompletionId = 1;
}

function makeTask(overrides: Partial<Task> = {}): Task {
  const id = nextTaskId++;
  const now = 1_700_000_000;
  const t: Task = {
    id,
    name: `task ${id}`,
    token_reward: 10,
    target_account: 'game_time',
    icon: null,
    category: 'habit',
    is_active: 1,
    sort_order: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  tasks.push(t);
  return t;
}

function makeCompletion(overrides: Partial<TaskCompletion> = {}): TaskCompletion {
  const id = nextCompletionId++;
  const now = 1_700_000_000;
  const c: TaskCompletion = {
    id,
    task_id: 1,
    user_id: 1,
    status: 'active',
    completed_date: todayShanghai(),
    completed_at: now,
    awarded_event_id: null,
    revoked_at: null,
    revoked_by: null,
    ...overrides,
  };
  completions.push(c);
  return c;
}

function makeMockDb(): D1Database {
  const db: D1Database = {
    prepare(query: string): D1PreparedStatement {
      let params: unknown[] = [];
      const isTaskList = /FROM\s+tasks/.test(query);
      const isCompletionList = /FROM\s+task_completions/.test(query);

      const stmt: D1PreparedStatement = {
        bind(...values: unknown[]): D1PreparedStatement {
          params = values;
          return stmt;
        },
        first<T = unknown>(): Promise<T | null> {
          return Promise.resolve(null);
        },
        all<T = unknown>(): Promise<D1Result<T>> {
          if (isTaskList) {
            // Optional `WHERE is_active = ?` filter.
            let filtered = [...tasks];
            const activeMatch = /is_active\s*=\s*\?/.test(query);
            if (activeMatch) {
              const v = params.shift() as number;
              filtered = filtered.filter((t) => t.is_active === v);
            }
            // ORDER BY sort_order ASC, id ASC
            filtered.sort((a, b) => {
              if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
              return a.id - b.id;
            });
            return Promise.resolve({ results: filtered, success: true } as D1Result<T>);
          }
          if (isCompletionList) {
            // WHERE user_id = ? AND status = 'active' AND completed_date = ?
            // (status is a SQL literal in the spec; the other two are bound).
            const statusMatch = /status\s*=\s*'([^']+)'/.exec(query);
            const status = statusMatch ? statusMatch[1] : (params.shift() as string);
            const userId = params.shift() as number;
            const date = params.shift() as string;
            const filtered = completions.filter(
              (c) => c.user_id === userId && c.status === status && c.completed_date === date,
            );
            const results = filtered.map((c) => ({ task_id: c.task_id }));
            return Promise.resolve({ results, success: true } as D1Result<T>);
          }
          return Promise.resolve({ results: [], success: true });
        },
        run<T = unknown>(): Promise<D1Result<T>> {
          return Promise.resolve({ success: true });
        },
        raw<T = unknown>(): Promise<T[]> {
          return Promise.resolve([]);
        },
      };
      return stmt;
    },
    batch: () => Promise.resolve([]),
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
  };
  return db;
}

const SECRET = 'unit-test-secret-1234567890';

function envObj(): { DB: D1Database; JWT_SECRET: string } {
  return { DB: makeMockDb(), JWT_SECRET: SECRET };
}

async function call(path: string, init: RequestInit = {}, env = envObj()) {
  return app.request(`http://test.local${path}`, init, env);
}

interface ListBody {
  tasks?: Task[];
  error?: { code?: string; message?: string };
}

interface TodayBody {
  completed_task_ids?: number[];
  today?: string;
  error?: { code?: string; message?: string };
}

describe('GET /api/public/tasks (list)', () => {
  beforeEach(reset);

  it('returns 400 BAD_REQUEST without user_id', async () => {
    const r = await call('/api/public/tasks');
    expect(r.status).toBe(400);
    const body = (await r.json()) as ListBody;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('returns all tasks when ?active is not set', async () => {
    const t1 = makeTask({ name: 'a', is_active: 1, sort_order: 0 });
    const t2 = makeTask({ name: 'b', is_active: 0, sort_order: 1 });
    const t3 = makeTask({ name: 'c', is_active: 1, sort_order: 2 });

    const r = await call('/api/public/tasks?user_id=1');
    expect(r.status).toBe(200);
    const body = (await r.json()) as ListBody;
    expect(body.tasks).toHaveLength(3);
    const ids = (body.tasks ?? []).map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining([t1.id, t2.id, t3.id]));
  });

  it('with ?active=true filters to is_active=1 only', async () => {
    const active = makeTask({ name: 'active', is_active: 1 });
    const inactive = makeTask({ name: 'inactive', is_active: 0 });

    const r = await call('/api/public/tasks?user_id=1&active=true');
    expect(r.status).toBe(200);
    const body = (await r.json()) as ListBody;
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks?.[0]?.id).toBe(active.id);
    expect(body.tasks?.[0]?.id).not.toBe(inactive.id);
  });

  it('returns tasks sorted by sort_order ASC, then id ASC', async () => {
    // Insert deliberately out of order to verify sorting.
    const tC = makeTask({ name: 'c', sort_order: 2 });
    const tA = makeTask({ name: 'a', sort_order: 0 });
    const tB = makeTask({ name: 'b', sort_order: 1 });
    // Two tasks with the same sort_order: should fall back to id ASC.
    const tD = makeTask({ name: 'd', sort_order: 1 });

    const r = await call('/api/public/tasks?user_id=1');
    expect(r.status).toBe(200);
    const body = (await r.json()) as ListBody;
    // Expected: 'a' (sort=0), 'b' then 'd' (sort=1, broken by id), 'c' (sort=2).
    const names = (body.tasks ?? []).map((t) => t.name);
    expect(names).toEqual(['a', 'b', 'd', 'c']);
    // Within the same sort_order, id ASC must put the earlier-inserted task first.
    expect(tB.id).toBeLessThan(tD.id);
    // 'a' is at index 0 of the response.
    expect(body.tasks?.[0]?.name).toBe('a');
    expect(body.tasks?.[3]?.name).toBe('c');
    void tC;
  });
});

describe('GET /api/public/tasks/today-status', () => {
  beforeEach(reset);

  it('returns 400 BAD_REQUEST without user_id', async () => {
    const r = await call('/api/public/tasks/today-status');
    expect(r.status).toBe(400);
    const body = (await r.json()) as TodayBody;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('returns completed_task_ids from active completions only (excludes revoked)', async () => {
    const today = todayShanghai();
    const t1 = makeTask({ name: 't1' });
    const t2 = makeTask({ name: 't2' });
    const t3 = makeTask({ name: 't3' });
    const t4 = makeTask({ name: 't4' });

    // Active completions for user 1 today
    makeCompletion({ task_id: t1.id, user_id: 1, status: 'active', completed_date: today });
    makeCompletion({ task_id: t2.id, user_id: 1, status: 'active', completed_date: today });
    // Revoked completion for user 1 today (should NOT be returned)
    makeCompletion({ task_id: t3.id, user_id: 1, status: 'revoked', completed_date: today });
    // Active completion for a DIFFERENT user (should NOT be returned)
    makeCompletion({ task_id: t4.id, user_id: 2, status: 'active', completed_date: today });
    // Active completion for user 1 on a DIFFERENT date (should NOT be returned)
    makeCompletion({ task_id: 999, user_id: 1, status: 'active', completed_date: '2000-01-01' });

    const r = await call('/api/public/tasks/today-status?user_id=1');
    expect(r.status).toBe(200);
    const body = (await r.json()) as TodayBody;
    expect(body.completed_task_ids).toEqual(expect.arrayContaining([t1.id, t2.id]));
    expect(body.completed_task_ids).not.toContain(t3.id);
    expect(body.completed_task_ids).not.toContain(t4.id);
    expect(body.completed_task_ids).toHaveLength(2);
  });

  it('response includes today field set to todayShanghai()', async () => {
    const r = await call('/api/public/tasks/today-status?user_id=1');
    expect(r.status).toBe(200);
    const body = (await r.json()) as TodayBody;
    expect(body.today).toBe(todayShanghai());
    // And must be the YYYY-MM-DD shape.
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.completed_task_ids).toEqual([]);
  });
});

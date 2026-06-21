// tests/unit/calendar-tasks.test.ts
// Item #012 §1: GET /api/public/calendar/tasks endpoint tests.
// Verifies:
//   - Returns { tasks: [...] }
//   - Only is_active=1 tasks returned (is_active=0 filtered out)
//   - Sort order: sort_order ASC, then id ASC
//   - Each task has id, name, icon, category, sort_order (5 fields)
//   - Zero active tasks returns { tasks: [] } (no error)

import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/worker.ts';
import type { D1Database, D1PreparedStatement, D1Result } from '../../src/db/types.ts';

interface TaskRow {
  id: number;
  name: string;
  icon: string | null;
  category: string;
  sort_order: number;
  is_active: number;
}

let tasks: TaskRow[] = [];
let nextTaskId = 1;

function reset() {
  tasks = [];
  nextTaskId = 1;
}

function makeTask(overrides: Partial<TaskRow> = {}): TaskRow {
  const id = nextTaskId++;
  const t: TaskRow = {
    id,
    name: `task ${id}`,
    icon: null,
    category: 'habit',
    sort_order: 0,
    is_active: 1,
    ...overrides,
  };
  tasks.push(t);
  return t;
}

function makeMockDb(): D1Database {
  const db: D1Database = {
    prepare(query: string): D1PreparedStatement {
      let params: unknown[] = [];
      const isTaskList = /FROM\s+tasks/.test(query);

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
            // Filter is_active=1
            let filtered = tasks.filter((t) => t.is_active === 1);
            // ORDER BY sort_order ASC, id ASC
            filtered.sort((a, b) => {
              if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
              return a.id - b.id;
            });
            return Promise.resolve({ results: filtered, success: true } as D1Result<T>);
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

function envObj() {
  return { DB: makeMockDb(), JWT_SECRET: 'unit-test-secret-1234567890' };
}

async function call(path: string, env = envObj()) {
  return app.request(`http://test.local${path}`, {}, env);
}

interface TasksBody {
  tasks?: TaskRow[];
  error?: { code?: string; message?: string };
}

describe('GET /api/public/calendar/tasks', () => {
  beforeEach(reset);

  it('returns { tasks: [...] }', async () => {
    makeTask({ name: 'brush', icon: '🪥', category: 'habit', sort_order: 0 });
    makeTask({ name: 'read', icon: '📖', category: 'study', sort_order: 1 });

    const r = await call('/api/public/calendar/tasks');
    expect(r.status).toBe(200);
    const body = (await r.json()) as TasksBody;
    expect(body.tasks).toBeDefined();
    expect(Array.isArray(body.tasks)).toBe(true);
  });

  it('only returns is_active=1 tasks (filters out is_active=0)', async () => {
    makeTask({ name: 'active task', is_active: 1 });
    makeTask({ name: 'inactive task', is_active: 0, sort_order: 0 });
    makeTask({ name: 'another active', is_active: 1, sort_order: 1 });

    const r = await call('/api/public/calendar/tasks');
    expect(r.status).toBe(200);
    const body = (await r.json()) as TasksBody;
    expect(body.tasks).toHaveLength(2);
    const names = body.tasks!.map((t) => t.name);
    expect(names).not.toContain('inactive task');
    expect(names).toContain('active task');
    expect(names).toContain('another active');
  });

  it('sorts by sort_order ASC, then id ASC', async () => {
    // Insert out of order
    const tC = makeTask({ name: 'c', sort_order: 2, is_active: 1 });
    const tA = makeTask({ name: 'a', sort_order: 0, is_active: 1 });
    const tB = makeTask({ name: 'b', sort_order: 1, is_active: 1 });
    // Same sort_order: id ASC tiebreaker
    const tD = makeTask({ name: 'd', sort_order: 1, is_active: 1 });
    void tC;

    const r = await call('/api/public/calendar/tasks');
    expect(r.status).toBe(200);
    const body = (await r.json()) as TasksBody;
    const names = body.tasks!.map((t) => t.name);
    // Expected: 'a' (sort=0), 'b' then 'd' (sort=1, broken by id), 'c' (sort=2)
    expect(names).toEqual(['a', 'b', 'd', 'c']);
    expect(tB.id).toBeLessThan(tD.id); // verify id tiebreaker logic assumption
  });

  it('each task has id, name, icon, category, sort_order (5 required fields)', async () => {
    makeTask({ name: 'brush', icon: '🪥', category: 'habit', sort_order: 0 });

    const r = await call('/api/public/calendar/tasks');
    expect(r.status).toBe(200);
    const body = (await r.json()) as TasksBody;
    const task = body.tasks![0];
    expect(task).toHaveProperty('id');
    expect(task).toHaveProperty('name');
    expect(task).toHaveProperty('icon');
    expect(task).toHaveProperty('category');
    expect(task).toHaveProperty('sort_order');
    // 5 fields total — no extra keys
    expect(Object.keys(task).sort()).toEqual(['category', 'icon', 'id', 'name', 'sort_order']);
  });

  it('zero active tasks returns { tasks: [] } without error', async () => {
    // Add only inactive tasks
    makeTask({ name: 'old', is_active: 0 });
    makeTask({ name: 'archived', is_active: 0 });

    const r = await call('/api/public/calendar/tasks');
    expect(r.status).toBe(200);
    const body = (await r.json()) as TasksBody;
    expect(body.tasks).toEqual([]);
  });
});

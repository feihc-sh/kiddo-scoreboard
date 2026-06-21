// tests/unit/calendar-checkins-filter.test.ts
// Item #012 §1: GET /api/public/calendar/checkins task breakdown + filter tests.
// Verifies:
//   - New response structure: {checkins: {date: [{task_id, task_icon, task_name, count}]}}
//   - No task_ids param → returns all tasks (default = all)
//   - ?task_ids=1,3 → only returns completions for task_id 1,3
//   - ?task_ids=999 (invalid id) → silently filtered, returns {}
//   - Revoked completions are NOT returned (status='active' filter)
//   - Same day multiple tasks → array with multiple elements
//   - 0 completions → {checkins: {}} (empty object)

import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/worker.ts';
import type { D1Database, D1PreparedStatement, D1Result } from '../../src/db/types.ts';

interface TaskRow {
  id: number;
  name: string;
  icon: string | null;
  category: string;
  sort_order: number;
}

interface CompletionRow {
  id: number;
  task_id: number;
  user_id: number;
  status: 'active' | 'revoked';
  completed_at: number; // unix timestamp
  completed_date: string;
}

let completions: CompletionRow[] = [];
let tasks: TaskRow[] = [];
let nextTaskId = 1;
let nextCompletionId = 1;

function reset() {
  completions = [];
  tasks = [];
  nextTaskId = 1;
  nextCompletionId = 1;
}

function makeTask(overrides: Partial<TaskRow> = {}): TaskRow {
  const id = nextTaskId++;
  const t: TaskRow = {
    id,
    name: `task ${id}`,
    icon: null,
    category: 'habit',
    sort_order: 0,
    ...overrides,
  };
  tasks.push(t);
  return t;
}

function makeCompletion(overrides: Partial<CompletionRow> = {}): CompletionRow {
  const id = nextCompletionId++;
  const c: CompletionRow = {
    id,
    task_id: 1,
    user_id: 1,
    status: 'active',
    completed_at: 1_700_000_000,
    completed_date: '2026-06-15',
    ...overrides,
  };
  completions.push(c);
  return c;
}

function makeMockDb(): D1Database {
  const db: D1Database = {
    prepare(query: string): D1PreparedStatement {
      let params: unknown[] = [];

      const stmt: D1PreparedStatement = {
        bind(...values: unknown[]): D1PreparedStatement {
          params = values;
          return stmt;
        },
        first<T = unknown>(): Promise<T | null> {
          return Promise.resolve(null);
        },
        all<T = unknown>(): Promise<D1Result<T>> {
          // Check if this is the checkins query (JOINs task_completions + tasks)
          if (/FROM\s+task_completions\s+tc\s+JOIN\s+tasks/.test(query)) {
            // Params: [childId, startTs, endTs, ...taskIdFilter?]
            const childId = params[0] as number;
            const startTs = params[1] as number;
            const endTs = params[2] as number;

            // Detect if task_ids filter is present in SQL
            const hasTaskIdFilter = /tc\.task_id\s+IN\s*\(/.test(query);

            // Extract task_id filter values from params (after the first 3)
            let taskIdFilter: number[] | undefined;
            if (hasTaskIdFilter) {
              taskIdFilter = params.slice(3) as number[];
            }

            // status = 'active' is a SQL literal — not a bind param
            const filtered = completions.filter((c) => {
              if (c.user_id !== childId) return false;
              if (c.completed_at < startTs || c.completed_at >= endTs) return false;
              if (c.status !== 'active') return false; // filter revoked
              if (taskIdFilter && !taskIdFilter.includes(c.task_id)) return false;
              return true;
            });

            // Group by date_str + task_id
            const groupMap = new Map<string, { task_id: number; task_icon: string | null; task_name: string; cnt: number }>();
            for (const c of filtered) {
              const task = tasks.find((t) => t.id === c.task_id);
              const dateStr = c.completed_date; // already YYYY-MM-DD
              const key = `${dateStr}:${c.task_id}`;
              if (!groupMap.has(key)) {
                groupMap.set(key, {
                  task_id: c.task_id,
                  task_icon: task?.icon ?? null,
                  task_name: task?.name ?? 'unknown',
                  cnt: 0,
                });
              }
              groupMap.get(key)!.cnt += 1;
            }

            // Transform to SQL result shape (GROUP BY date_str, tc.task_id, t.icon, t.name)
            const results = Array.from(groupMap.entries()).map(([key, val]) => ({
              date_str: key.split(':')[0],
              task_id: val.task_id,
              task_icon: val.task_icon,
              task_name: val.task_name,
              cnt: val.cnt,
            }));

            return Promise.resolve({ results: results as unknown as T[], success: true });
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

interface CheckinEntry {
  task_id: number;
  task_icon: string | null;
  task_name: string;
  count: number;
}

interface CheckinsBody {
  checkins?: Record<string, CheckinEntry[]>;
  error?: { code?: string; message?: string };
}

describe('GET /api/public/calendar/checkins', () => {
  beforeEach(reset);

  it('returns new structure: {checkins: {date: [{task_id, task_icon, task_name, count}]}}', async () => {
    const t1 = makeTask({ name: 'brush', icon: '🪥' });
    makeCompletion({ task_id: t1.id, user_id: 1, completed_date: '2026-06-15', completed_at: unixTs(2026, 5, 15) });

    const r = await call('/api/public/calendar/checkins?child_id=1&year=2026&month=6');
    expect(r.status).toBe(200);
    const body = (await r.json()) as CheckinsBody;
    expect(body.checkins).toBeDefined();
    expect(typeof body.checkins).toBe('object');

    const entries = body.checkins!['2026-06-15'];
    expect(Array.isArray(entries)).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      task_id: t1.id,
      task_icon: '🪥',
      task_name: 'brush',
      count: 1,
    });
  });

  it('no task_ids param → returns all tasks (default = all)', async () => {
    const t1 = makeTask({ name: 'brush', icon: '🪥' });
    const t2 = makeTask({ name: 'read', icon: '📖' });
    makeCompletion({ task_id: t1.id, user_id: 1, completed_date: '2026-06-15', completed_at: unixTs(2026, 5, 15) });
    makeCompletion({ task_id: t2.id, user_id: 1, completed_date: '2026-06-15', completed_at: unixTs(2026, 5, 15) });

    const r = await call('/api/public/calendar/checkins?child_id=1&year=2026&month=6');
    expect(r.status).toBe(200);
    const body = (await r.json()) as CheckinsBody;
    const entries = body.checkins!['2026-06-15'];
    expect(entries).toHaveLength(2);
    const ids = entries.map((e) => e.task_id);
    expect(ids).toContain(t1.id);
    expect(ids).toContain(t2.id);
  });

  it('?task_ids=1,3 → only returns completions for task_id 1,3', async () => {
    const t1 = makeTask({ name: 'brush', icon: '🪥' });
    const t2 = makeTask({ name: 'read', icon: '📖' });
    const t3 = makeTask({ name: 'exercise', icon: '🏃' });
    makeCompletion({ task_id: t1.id, user_id: 1, completed_date: '2026-06-15', completed_at: unixTs(2026, 5, 15) });
    makeCompletion({ task_id: t2.id, user_id: 1, completed_date: '2026-06-15', completed_at: unixTs(2026, 5, 15) });
    makeCompletion({ task_id: t3.id, user_id: 1, completed_date: '2026-06-15', completed_at: unixTs(2026, 5, 15) });

    const r = await call(`/api/public/calendar/checkins?child_id=1&year=2026&month=6&task_ids=${t1.id},${t3.id}`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as CheckinsBody;
    const entries = body.checkins!['2026-06-15'];
    expect(entries).toHaveLength(2); // only brush + exercise, NOT read
    const ids = entries.map((e) => e.task_id);
    expect(ids).toContain(t1.id);
    expect(ids).toContain(t3.id);
    expect(ids).not.toContain(t2.id);
  });

  it('?task_ids=999 (invalid id) → silently filtered, returns {}', async () => {
    const t1 = makeTask({ name: 'brush', icon: '🪥' });
    makeCompletion({ task_id: t1.id, user_id: 1, completed_date: '2026-06-15', completed_at: unixTs(2026, 5, 15) });

    const r = await call('/api/public/calendar/checkins?child_id=1&year=2026&month=6&task_ids=999');
    expect(r.status).toBe(200);
    const body = (await r.json()) as CheckinsBody;
    expect(body.checkins).toEqual({});
  });

  it('revoked completions are NOT returned (status=active filter)', async () => {
    const t1 = makeTask({ name: 'brush', icon: '🪥' });
    makeCompletion({ task_id: t1.id, user_id: 1, status: 'active', completed_date: '2026-06-15', completed_at: unixTs(2026, 5, 15) });
    makeCompletion({ task_id: t1.id, user_id: 1, status: 'revoked', completed_date: '2026-06-15', completed_at: unixTs(2026, 5, 15) + 1 });

    const r = await call('/api/public/calendar/checkins?child_id=1&year=2026&month=6');
    expect(r.status).toBe(200);
    const body = (await r.json()) as CheckinsBody;
    const entries = body.checkins!['2026-06-15'];
    expect(entries).toHaveLength(1);
    expect(entries[0].count).toBe(1); // only the active one counted
  });

  it('same day multiple tasks → array with multiple elements', async () => {
    const t1 = makeTask({ name: 'brush', icon: '🪥' });
    const t2 = makeTask({ name: 'read', icon: '📖' });
    // Same day, two different tasks
    makeCompletion({ task_id: t1.id, user_id: 1, completed_date: '2026-06-15', completed_at: unixTs(2026, 5, 15) });
    makeCompletion({ task_id: t2.id, user_id: 1, completed_date: '2026-06-15', completed_at: unixTs(2026, 5, 15) + 60 });

    const r = await call('/api/public/calendar/checkins?child_id=1&year=2026&month=6');
    expect(r.status).toBe(200);
    const body = (await r.json()) as CheckinsBody;
    const entries = body.checkins!['2026-06-15'];
    expect(entries).toHaveLength(2);
    const ids = entries.map((e) => e.task_id).sort();
    expect(ids).toEqual([t1.id, t2.id].sort());
  });

  it('0 completions → {checkins: {}} (empty object)', async () => {
    const r = await call('/api/public/calendar/checkins?child_id=1&year=2026&month=6');
    expect(r.status).toBe(200);
    const body = (await r.json()) as CheckinsBody;
    expect(body.checkins).toEqual({});
  });
});

// Helper: build unix timestamp for a given year/month/day (UTC)
function unixTs(year: number, monthIndex: number, day: number): number {
  return Math.floor(Date.UTC(year, monthIndex, day) / 1000);
}

// tests/unit/admin-tasks-active-days.test.ts
// Validation tests for the task-active-days field on POST/PUT /api/admin/tasks.
//
// Spec §3.4 (PM, 2026-10-17):
//   - null / undefined / [] → store NULL (every day).
//   - array of integers 1..7 → JSON-encode sorted-unique.
//   - any out-of-range value, non-integer, or non-array → 400 BAD_REQUEST.
//
// We hit the real POST/PUT handlers (not just the parser) because the
// rejection is what admin PM will see in the UI. A focused mock DB is
// enough — no need to inherit the full admin-tasks-config mock.

import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/worker.ts';
import { signSession } from '../../src/auth/session.ts';
import type {
  AccountType,
  D1Database,
  D1PreparedStatement,
  D1Result,
  Task,
  TaskCategory,
  TaskCompletion,
} from '../../src/db/types.ts';

interface UserRow {
  id: number;
  name: string;
  role: 'child' | 'pm';
  pin_hash: string | null;
  created_at: number;
  updated_at: number;
}
interface AuditRow {
  id: number;
  actor: 'child' | 'pm' | 'system';
  action: string;
  target_event_id: number | null;
  target_user_id: number | null;
  details: string;
  created_at: number;
}

let users: UserRow[] = [];
let tasks: Task[] = [];
let completions: TaskCompletion[] = [];
let audit: AuditRow[] = [];
let nextTaskId = 1;
let nextAuditId = 1;
// MUST be set relative to Date.now() so verifySession's `exp <= now` check
// accepts the test token (admin-tasks-config.test.ts uses the same pattern).
let nowOverride = Math.floor(Date.now() / 1000);
let batchStatements: { query: string; params: unknown[] }[] = [];

function reset() {
  users = [];
  tasks = [];
  completions = [];
  audit = [];
  nextTaskId = 1;
  nextAuditId = 1;
  batchStatements = [];
}

function addPmUser(id = 1) {
  users.push({
    id,
    name: 'PM',
    role: 'pm',
    pin_hash: 'fake-hash',
    created_at: nowOverride,
    updated_at: nowOverride,
  });
}

function addTask(overrides: Partial<Task> = {}): Task {
  const id = overrides.id ?? nextTaskId++;
  if (id >= nextTaskId) nextTaskId = id + 1;
  const t: Task = {
    id,
    name: `task ${id}`,
    token_reward: 10,
    target_account: 'game_time' as AccountType,
    icon: null,
    category: 'habit' as TaskCategory,
    is_active: 1,
    sort_order: 0,
    cutoff_time: null,
    is_self_lockout: 0,
    active_days: null,
    created_at: nowOverride,
    updated_at: nowOverride,
    ...overrides,
  };
  tasks.push(t);
  return t;
}

interface TaggedStmt {
  __tag: { query: string; params: unknown[] };
}

function makeStmt(query: string): D1PreparedStatement & TaggedStmt {
  let params: unknown[] = [];
  const stmt: D1PreparedStatement & Partial<TaggedStmt> = {
    bind(...values: unknown[]): D1PreparedStatement {
      params = values;
      stmt.__tag = {
        query: query.trim().replace(/\s+/g, ' '),
        params: values,
      };
      return stmt;
    },
    first<T = unknown>(): Promise<T | null> {
      if (/FROM\s+tasks\s+WHERE\s+id\s*=\s*\?/i.test(query)) {
        const id = params[0] as number;
        const t = tasks.find((x) => x.id === id) ?? null;
        return Promise.resolve((t as unknown) as T);
      }
      if (
        /FROM\s+task_completions/i.test(query) &&
        /task_id\s*=\s*\?/i.test(query) &&
        /status\s*=\s*'active'/i.test(query)
      ) {
        const taskId = params[0] as number;
        const found = completions.find(
          (c) => c.task_id === taskId && c.status === 'active',
        );
        return Promise.resolve(
          (found ? ({ id: found.id } as unknown) : null) as T,
        );
      }
      return Promise.resolve(null);
    },
    all<T = unknown>(): Promise<D1Result<T>> {
      if (/FROM\s+tasks/i.test(query)) {
        const filtered = [...tasks];
        filtered.sort((a, b) => {
          if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
          return a.id - b.id;
        });
        return Promise.resolve({
          results: (filtered as unknown) as T[],
          success: true,
        });
      }
      return Promise.resolve({ results: [], success: true });
    },
    run<T = unknown>(): Promise<D1Result<T>> {
      if (/INSERT\s+INTO\s+tasks/i.test(query)) {
        const [
          name,
          token_reward,
          target_account,
          icon,
          category,
          sort_order,
          cutoff_time,
          is_self_lockout,
          active_days_raw,
          created_at,
          updated_at,
        ] = params as [
          string,
          number,
          string,
          string | null,
          string,
          number,
          string | null,
          number,
          string | null,
          number,
          number,
        ];
        const newTask: Task = {
          id: nextTaskId++,
          name,
          token_reward,
          target_account: target_account as AccountType,
          icon,
          category: category as TaskCategory,
          is_active: 1,
          sort_order,
          cutoff_time: cutoff_time ?? null,
          is_self_lockout: (is_self_lockout as 0 | 1) ?? 0,
          active_days: active_days_raw
            ? (JSON.parse(active_days_raw) as number[])
            : null,
          created_at,
          updated_at,
        };
        tasks.push(newTask);
        return Promise.resolve({
          success: true,
          meta: { changes: 1, last_row_id: newTask.id, duration: 0 },
        });
      }
      if (/UPDATE\s+tasks/i.test(query)) {
        const id = params[params.length - 1] as number;
        const t = tasks.find((x) => x.id === id);
        if (t) {
          const setsClause = query.match(/SET\s+(.+?)\s+WHERE/i)?.[1] ?? '';
          const segments = setsClause.split(',').map((s) => s.trim());
          let paramIdx = 0;
          for (const seg of segments) {
            const ph = seg.match(/^(\w+)\s*=\s*\?$/);
            if (ph) {
              const field = ph[1];
              const v = params[paramIdx++];
              if (field === 'updated_at') continue;
              if (field === 'active_days') {
                // task-active-days: server stores JSON text; decode here so
                // t.active_days reflects the typed value (matches real D1).
                t.active_days = v == null ? null : (JSON.parse(v as string) as number[]);
              } else if (field in t) {
                (t as unknown as Record<string, unknown>)[field] = v;
              }
            }
          }
        }
        return Promise.resolve({
          success: true,
          meta: { changes: t ? 1 : 0, last_row_id: 0, duration: 0 },
        });
      }
      if (/INSERT\s+INTO\s+audit_log/i.test(query)) {
        const m = query.match(/VALUES\s*\(\s*'pm'\s*,\s*'([^']+)'/i);
        const action = m ? m[1] : 'unknown';
        const isEventStyle = params.length === 4;
        const target_event_id = isEventStyle ? (params[0] as number | null) : null;
        const target_user_id = isEventStyle ? (params[1] as number | null) : null;
        const details = (isEventStyle ? params[2] : params[0]) as string;
        const created_at = (isEventStyle ? params[3] : params[1]) as number;
        const row: AuditRow = {
          id: nextAuditId++,
          actor: 'pm',
          action,
          target_event_id,
          target_user_id,
          details,
          created_at,
        };
        audit.push(row);
        return Promise.resolve({
          success: true,
          meta: { changes: 1, last_row_id: row.id, duration: 0 },
        });
      }
      return Promise.resolve({ success: true });
    },
    raw<T = unknown>(): Promise<T[]> {
      return Promise.resolve([]);
    },
  };
  stmt.__tag = { query: query.trim().replace(/\s+/g, ' '), params: [] };
  return stmt as D1PreparedStatement & TaggedStmt;
}

function makeMockDb(): D1Database {
  const db: D1Database = {
    prepare(query: string): D1PreparedStatement {
      return makeStmt(query);
    },
    batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      for (const s of statements) {
        const tagged = (s as D1PreparedStatement & Partial<TaggedStmt>).__tag;
        if (tagged) batchStatements.push(tagged);
      }
      return Promise.all(statements.map((s) => s.run())) as Promise<D1Result<T>[]>;
    },
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
  };
  return db;
}

const SECRET = 'unit-test-secret-1234567890';

function envObj() {
  return { DB: makeMockDb(), JWT_SECRET: SECRET };
}

async function call(path: string, init: RequestInit = {}, env = envObj()) {
  return app.request(`http://test.local${path}`, init, env);
}

async function pmCookie(userId = 1): Promise<string> {
  const token = await signSession(
    { user_id: userId, exp: nowOverride + 3600 },
    SECRET,
  );
  return `pm_session=${token}`;
}

const BASE_BODY = {
  name: 'test',
  token_reward: 5,
  target_account: 'game_time' as AccountType,
  category: 'habit' as TaskCategory,
};

interface ActiveDaysBody {
  id?: number;
  name?: string;
  active_days?: number[] | string | null;
  error?: { code: string; message: string };
}

// =============================================================
// POST /api/admin/tasks — active_days validation
// =============================================================
describe('POST /api/admin/tasks — task-active-days validation', () => {
  beforeEach(reset);

  async function createWithActiveDays(activeDays: unknown) {
    addPmUser();
    const cookie = await pmCookie();
    return call('/api/admin/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ ...BASE_BODY, active_days: activeDays }),
    });
  }

  it('accepts null → stored as null (every day)', async () => {
    const r = await createWithActiveDays(null);
    expect(r.status).toBe(201);
    const body = (await r.json()) as ActiveDaysBody;
    expect(body.active_days).toBeNull();
  });

  it('accepts [] → stored as null (every day, empty == no restriction)', async () => {
    const r = await createWithActiveDays([]);
    expect(r.status).toBe(201);
    const body = (await r.json()) as ActiveDaysBody;
    expect(body.active_days).toBeNull();
  });

  it('accepts a single valid day → stored as [day]', async () => {
    const r = await createWithActiveDays([6]);
    expect(r.status).toBe(201);
    const body = (await r.json()) as ActiveDaysBody;
    expect(body.active_days).toEqual([6]);
  });

  it('accepts [1,2,3,4,5] → stored unchanged (already sorted)', async () => {
    const r = await createWithActiveDays([1, 2, 3, 4, 5]);
    expect(r.status).toBe(201);
    const body = (await r.json()) as ActiveDaysBody;
    expect(body.active_days).toEqual([1, 2, 3, 4, 5]);
  });

  it('accepts [1..7] (every day as array) → stored as [1..7]', async () => {
    const r = await createWithActiveDays([1, 2, 3, 4, 5, 6, 7]);
    expect(r.status).toBe(201);
    const body = (await r.json()) as ActiveDaysBody;
    expect(body.active_days).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('normalizes duplicates: [1,1,2] → [1,2]', async () => {
    const r = await createWithActiveDays([1, 1, 2]);
    expect(r.status).toBe(201);
    const body = (await r.json()) as ActiveDaysBody;
    expect(body.active_days).toEqual([1, 2]);
  });

  it('normalizes unsorted: [3,1,5] → [1,3,5]', async () => {
    const r = await createWithActiveDays([3, 1, 5]);
    expect(r.status).toBe(201);
    const body = (await r.json()) as ActiveDaysBody;
    expect(body.active_days).toEqual([1, 3, 5]);
  });

  it('rejects [0] (out of range) → 400 BAD_REQUEST', async () => {
    const r = await createWithActiveDays([0]);
    expect(r.status).toBe(400);
    const body = (await r.json()) as ActiveDaysBody;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('rejects [8] (out of range) → 400 BAD_REQUEST', async () => {
    const r = await createWithActiveDays([8]);
    expect(r.status).toBe(400);
    const body = (await r.json()) as ActiveDaysBody;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('rejects [1.5] (non-integer) → 400 BAD_REQUEST', async () => {
    const r = await createWithActiveDays([1.5]);
    expect(r.status).toBe(400);
    const body = (await r.json()) as ActiveDaysBody;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('rejects "1,2" (string instead of array) → 400 BAD_REQUEST', async () => {
    const r = await createWithActiveDays('1,2');
    expect(r.status).toBe(400);
    const body = (await r.json()) as ActiveDaysBody;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('rejects [{day:1}] (object instead of number) → 400 BAD_REQUEST', async () => {
    const r = await createWithActiveDays([{ day: 1 }]);
    expect(r.status).toBe(400);
    const body = (await r.json()) as ActiveDaysBody;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });
});

// =============================================================
// PUT /api/admin/tasks/:id — active_days update path
// =============================================================
describe('PUT /api/admin/tasks/:id — task-active-days update', () => {
  beforeEach(reset);

  async function updateActiveDays(taskId: number, activeDays: unknown) {
    addPmUser();
    const cookie = await pmCookie();
    return call(`/api/admin/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ active_days: activeDays }),
    });
  }

  it('updates active_days from null → [6,7]', async () => {
    const t = addTask({ name: 'weekend task', active_days: null });
    const r = await updateActiveDays(t.id, [6, 7]);
    expect(r.status).toBe(200);
    const body = (await r.json()) as ActiveDaysBody;
    expect(body.active_days).toEqual([6, 7]);
    expect(t.active_days).toEqual([6, 7]);
  });

  it('updates active_days from [6,7] → null (clears the restriction)', async () => {
    const t = addTask({ name: 'weekend task', active_days: [6, 7] });
    const r = await updateActiveDays(t.id, null);
    expect(r.status).toBe(200);
    const body = (await r.json()) as ActiveDaysBody;
    expect(body.active_days).toBeNull();
    expect(t.active_days).toBeNull();
  });

  it('rejects out-of-range update → 400 and leaves existing value untouched', async () => {
    const t = addTask({ name: 'school only', active_days: [1, 2, 3, 4, 5] });
    const r = await updateActiveDays(t.id, [0]);
    expect(r.status).toBe(400);
    expect(t.active_days).toEqual([1, 2, 3, 4, 5]);
  });

  it('normalizes update duplicates: [6,6,7] → [6,7]', async () => {
    const t = addTask({ name: 'weekend', active_days: null });
    const r = await updateActiveDays(t.id, [6, 6, 7]);
    expect(r.status).toBe(200);
    const body = (await r.json()) as ActiveDaysBody;
    expect(body.active_days).toEqual([6, 7]);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/tasks — active_days must come back PARSED (regression for
// feihao 2026-10-21 bug found by CC doc audit E-9): the edit form prefill
// checks Array.isArray; a raw JSON TEXT value made it fall back to "all 7
// checked", so saving an edit would silently turn a weekend-only task into
// an every-day task.
// ---------------------------------------------------------------------------
describe('GET /api/admin/tasks — active_days parsed for edit prefill', () => {
  beforeEach(reset);

  it('returns active_days as a number[] when stored as JSON text', async () => {
    addPmUser();
    // Simulate a D1 row exactly as stored: JSON TEXT.
    addTask({ name: 'weekend-only', active_days: '[6,7]' as unknown as number[] | null });
    const cookie = await pmCookie();
    const r = await call('/api/admin/tasks', { headers: { cookie } });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { tasks: Array<{ name: string; active_days: number[] | null }> };
    const weekend = body.tasks.find((t) => t.name === 'weekend-only');
    expect(weekend).toBeDefined();
    expect(Array.isArray(weekend!.active_days)).toBe(true);
    expect(weekend!.active_days).toEqual([6, 7]);
  });

  it('returns null for NULL rows (every day) and tolerates junk', async () => {
    addPmUser();
    addTask({ name: 'everyday', active_days: null });
    addTask({ name: 'corrupt', active_days: 'not-json' as unknown as number[] | null });
    const cookie = await pmCookie();
    const r = await call('/api/admin/tasks', { headers: { cookie } });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { tasks: Array<{ name: string; active_days: number[] | null }> };
    expect(body.tasks.find((t) => t.name === 'everyday')!.active_days).toBeNull();
    expect(body.tasks.find((t) => t.name === 'corrupt')!.active_days).toBeNull();
  });
});

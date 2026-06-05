// tests/unit/admin-tasks-config.test.ts
// Integration tests for PM-only task config CRUD:
//   GET    /api/admin/tasks        — list (default active only)
//   POST   /api/admin/tasks        — create
//   PUT    /api/admin/tasks/:id    — partial update
//   DELETE /api/admin/tasks/:id    — soft-delete
//
// Verifies: requirePm guard, id validation, 404, 409 active-completions
// guard for delete, body validation for POST/PUT, audit_log writes, and
// happy paths for create/update/soft-delete.

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
  CompletionStatus,
} from '../../src/db/types.ts';

// -------------------------------------------------------------
// Fixtures
// -------------------------------------------------------------
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
let nowOverride = Math.floor(Date.now() / 1000);
let batchStatements: { query: string; params: unknown[] }[] = [];

function reset() {
  users = [];
  tasks = [];
  completions = [];
  audit = [];
  nextTaskId = 1;
  nextAuditId = 1;
  nowOverride = Math.floor(Date.now() / 1000);
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
    created_at: nowOverride,
    updated_at: nowOverride,
    ...overrides,
  };
  tasks.push(t);
  return t;
}

function addCompletion(overrides: Partial<TaskCompletion> = {}): TaskCompletion {
  const c: TaskCompletion = {
    id: completions.length + 1,
    task_id: 1,
    user_id: 1,
    status: 'active' as CompletionStatus,
    completed_date: '2026-06-05',
    completed_at: nowOverride,
    awarded_event_id: null,
    revoked_at: null,
    revoked_by: null,
    ...overrides,
  };
  completions.push(c);
  return c;
}

// -------------------------------------------------------------
// Tagged prepared statement: bind() stamps {query, params} for
// batch() to inspect later.
// -------------------------------------------------------------
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
      // SELECT ... FROM tasks WHERE id = ?
      if (/FROM\s+tasks\s+WHERE\s+id\s*=\s*\?/i.test(query)) {
        const id = params[0] as number;
        const t = tasks.find((x) => x.id === id) ?? null;
        return Promise.resolve((t as unknown) as T);
      }
      // SELECT id FROM task_completions WHERE task_id = ? AND status = 'active' LIMIT 1
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
      // SELECT ... FROM tasks [WHERE is_active = ?] ORDER BY sort_order ASC, id ASC
      if (/FROM\s+tasks/i.test(query)) {
        let filtered = [...tasks];
        const activeMatch = /is_active\s*=\s*\?/i.test(query);
        if (activeMatch) {
          const v = params.shift() as number;
          filtered = filtered.filter((t) => t.is_active === v);
        }
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
      // INSERT INTO tasks (...) VALUES (...)
      if (/INSERT\s+INTO\s+tasks/i.test(query)) {
        const [
          name,
          token_reward,
          target_account,
          icon,
          category,
          sort_order,
          created_at,
          updated_at,
        ] = params as [string, number, string, string | null, string, number, number, number];
        const newTask: Task = {
          id: nextTaskId++,
          name,
          token_reward,
          target_account: target_account as AccountType,
          icon,
          category: category as TaskCategory,
          is_active: 1,
          sort_order,
          created_at,
          updated_at,
        };
        tasks.push(newTask);
        return Promise.resolve({
          success: true,
          meta: { changes: 1, last_row_id: newTask.id, duration: 0 },
        });
      }
      // UPDATE tasks SET ... WHERE id = ?
      if (/UPDATE\s+tasks/i.test(query)) {
        const id = params[params.length - 1] as number;
        const t = tasks.find((x) => x.id === id);
        if (t) {
          const setsClause = query.match(/SET\s+(.+?)\s+WHERE/i)?.[1] ?? '';
          // Split SET clause by top-level commas (not inside parens — none here).
          const segments = setsClause.split(',').map((s) => s.trim());
          let paramIdx = 0;
          for (const seg of segments) {
            const ph = seg.match(/^(\w+)\s*=\s*\?$/);
            if (ph) {
              const field = ph[1];
              const v = params[paramIdx++];
              if (field === 'updated_at') {
                t.updated_at = Math.floor(Date.now() / 1000);
              } else if (field in t) {
                (t as unknown as Record<string, unknown>)[field] = v;
              }
              continue;
            }
            // Literal assignment: e.g. is_active = 0
            const lit = seg.match(/^(\w+)\s*=\s*(-?\d+)$/);
            if (lit) {
              const field = lit[1];
              const v = Number(lit[2]);
              if (field in t) {
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
      // INSERT INTO audit_log ...
      if (/INSERT\s+INTO\s+audit_log/i.test(query)) {
        const m = query.match(/VALUES\s*\(\s*'pm'\s*,\s*'([^']+)'/i);
        const action = m ? m[1] : 'unknown';
        // 'pm' and action are SQL literals; bind() receives 2 (task CRUD)
        // or 4 (events/task_revoke) params. Determine from arity.
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
  const token = await signSession({ user_id: userId, exp: nowOverride + 3600 }, SECRET);
  return `pm_session=${token}`;
}

interface TaskListBody {
  tasks?: Task[];
  error?: { code: string; message: string };
}
interface TaskBody {
  id?: number;
  name?: string;
  token_reward?: number;
  target_account?: AccountType;
  icon?: string | null;
  category?: TaskCategory;
  is_active?: 0 | 1;
  sort_order?: number;
  created_at?: number;
  updated_at?: number;
  error?: { code: string; message: string };
}

// =============================================================
// GET /api/admin/tasks
// =============================================================
describe('GET /api/admin/tasks', () => {
  beforeEach(reset);

  it('returns 401 without session cookie (requirePm guard)', async () => {
    const r = await call('/api/admin/tasks');
    expect(r.status).toBe(401);
    const body = (await r.json()) as TaskListBody;
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns only is_active=1 tasks by default', async () => {
    addPmUser();
    const active1 = addTask({ name: 'active1', is_active: 1, sort_order: 0 });
    const inactive = addTask({ name: 'inactive', is_active: 0, sort_order: 1 });
    const active2 = addTask({ name: 'active2', is_active: 1, sort_order: 2 });

    const cookie = await pmCookie();
    const r = await call('/api/admin/tasks', { headers: { cookie } });
    expect(r.status).toBe(200);
    const body = (await r.json()) as TaskListBody;
    expect(body.tasks).toHaveLength(2);
    const ids = (body.tasks ?? []).map((t) => t.id);
    expect(ids).toContain(active1.id);
    expect(ids).toContain(active2.id);
    expect(ids).not.toContain(inactive.id);
    // Sorted by sort_order ASC, then id ASC.
    expect(body.tasks?.[0]?.id).toBe(active1.id);
    expect(body.tasks?.[1]?.id).toBe(active2.id);
  });

  it('?include_inactive=true returns all tasks (active + inactive)', async () => {
    addPmUser();
    const a1 = addTask({ name: 'a1', is_active: 1, sort_order: 0 });
    const a2 = addTask({ name: 'a2', is_active: 0, sort_order: 1 });
    const a3 = addTask({ name: 'a3', is_active: 1, sort_order: 2 });

    const cookie = await pmCookie();
    const r = await call('/api/admin/tasks?include_inactive=true', {
      headers: { cookie },
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as TaskListBody;
    expect(body.tasks).toHaveLength(3);
    const ids = (body.tasks ?? []).map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining([a1.id, a2.id, a3.id]));
  });
});

// =============================================================
// POST /api/admin/tasks
// =============================================================
describe('POST /api/admin/tasks', () => {
  beforeEach(reset);

  it('returns 401 without session cookie (requirePm guard)', async () => {
    const r = await call('/api/admin/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x', token_reward: 1, target_account: 'game_time', category: 'habit' }),
    });
    expect(r.status).toBe(401);
  });

  it('returns 400 BAD_REQUEST for invalid body (negative token_reward, bad target_account, bad category)', async () => {
    addPmUser();
    const cookie = await pmCookie();
    const r = await call('/api/admin/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        name: '',
        token_reward: -5,
        target_account: 'snacks',
        category: 'random',
      }),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as TaskBody;
    expect(body.error?.code).toBe('BAD_REQUEST');
    // Nothing should have been written.
    expect(tasks).toHaveLength(0);
    expect(audit).toHaveLength(0);
  });

  it('201 happy path: returns full task JSON and writes audit (task_create)', async () => {
    addPmUser();
    const cookie = await pmCookie();
    const r = await call('/api/admin/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Brush teeth',
        token_reward: 5,
        target_account: 'pocket_money',
        icon: '🪥',
        category: 'habit',
        sort_order: 3,
      }),
    });
    expect(r.status).toBe(201);
    const body = (await r.json()) as TaskBody;

    // Response shape: full task JSON.
    expect(typeof body.id).toBe('number');
    expect(body.id).toBe(1);
    expect(body.name).toBe('Brush teeth');
    expect(body.token_reward).toBe(5);
    expect(body.target_account).toBe('pocket_money');
    expect(body.icon).toBe('🪥');
    expect(body.category).toBe('habit');
    expect(body.is_active).toBe(1);
    expect(body.sort_order).toBe(3);
    expect(typeof body.created_at).toBe('number');
    expect(typeof body.updated_at).toBe('number');

    // Task persisted in our mock.
    const t = tasks.find((x) => x.id === body.id);
    expect(t).toBeDefined();
    expect(t?.name).toBe('Brush teeth');
    expect(t?.is_active).toBe(1);

    // Audit entry written via batched INSERT.
    const entry = audit.find((a) => a.action === 'task_create');
    expect(entry).toBeDefined();
    expect(entry?.actor).toBe('pm');
    expect(entry?.target_event_id).toBeNull();
    expect(entry?.target_user_id).toBeNull();
    const details = JSON.parse(entry?.details ?? '{}') as Record<string, unknown>;
    expect(details.name).toBe('Brush teeth');
    expect(details.token_reward).toBe(5);
    expect(details.target_account).toBe('pocket_money');

    // Two batched statements: INSERT tasks + INSERT audit_log.
    expect(batchStatements).toHaveLength(2);
    expect(batchStatements[0].query.toUpperCase()).toMatch(/^INSERT\s+INTO\s+TASKS/);
    expect(batchStatements[1].query.toUpperCase()).toMatch(/^INSERT\s+INTO\s+AUDIT_LOG/);
  });
});

// =============================================================
// PUT /api/admin/tasks/:id
// =============================================================
describe('PUT /api/admin/tasks/:id', () => {
  beforeEach(reset);

  it('returns 401 without session cookie (requirePm guard)', async () => {
    const r = await call('/api/admin/tasks/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(r.status).toBe(401);
  });

  it('returns 400 BAD_REQUEST for non-integer id', async () => {
    addPmUser();
    const cookie = await pmCookie();
    const r = await call('/api/admin/tasks/abc', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as TaskBody;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('returns 404 NOT_FOUND when task does not exist', async () => {
    addPmUser();
    const cookie = await pmCookie();
    const r = await call('/api/admin/tasks/9999', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(r.status).toBe(404);
    const body = (await r.json()) as TaskBody;
    expect(body.error?.code).toBe('NOT_FOUND');
    expect(audit).toHaveLength(0);
    expect(batchStatements).toHaveLength(0);
  });

  it('returns 400 BAD_REQUEST when body is empty / no fields provided', async () => {
    addPmUser();
    addTask({ id: 1, name: 'a' });
    const cookie = await pmCookie();
    const r = await call('/api/admin/tasks/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as TaskBody;
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(batchStatements).toHaveLength(0);
  });

  it('200 partial update: changes name + sort_order only, audit reflects old/new values', async () => {
    addPmUser();
    addTask({
      id: 1,
      name: 'old name',
      token_reward: 10,
      sort_order: 0,
      is_active: 1,
    });

    const cookie = await pmCookie();
    const r = await call('/api/admin/tasks/1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ name: 'new name', sort_order: 5 }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as TaskBody;
    expect(body.id).toBe(1);
    expect(body.name).toBe('new name');
    expect(body.sort_order).toBe(5);
    // Unchanged fields preserved.
    expect(body.token_reward).toBe(10);
    expect(body.is_active).toBe(1);

    const t = tasks.find((x) => x.id === 1);
    expect(t?.name).toBe('new name');
    expect(t?.sort_order).toBe(5);

    const entry = audit.find((a) => a.action === 'task_update');
    expect(entry).toBeDefined();
    const details = JSON.parse(entry?.details ?? '{}') as Record<string, unknown>;
    expect(details.task_id).toBe(1);
    expect(details.old_values).toEqual({ name: 'old name', sort_order: 0 });
    expect(details.new_values).toEqual({ name: 'new name', sort_order: 5 });

    // Two batched statements: UPDATE tasks + INSERT audit_log.
    expect(batchStatements).toHaveLength(2);
    expect(batchStatements[0].query.toUpperCase()).toMatch(/^UPDATE\s+TASKS/);
    expect(batchStatements[1].query.toUpperCase()).toMatch(/^INSERT\s+INTO\s+AUDIT_LOG/);
  });
});

// =============================================================
// DELETE /api/admin/tasks/:id (soft-delete)
// =============================================================
describe('DELETE /api/admin/tasks/:id', () => {
  beforeEach(reset);

  it('returns 401 without session cookie (requirePm guard)', async () => {
    const r = await call('/api/admin/tasks/1', { method: 'DELETE' });
    expect(r.status).toBe(401);
  });

  it('returns 400 BAD_REQUEST for non-integer id', async () => {
    addPmUser();
    const cookie = await pmCookie();
    const r = await call('/api/admin/tasks/abc', {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as TaskBody;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('returns 404 NOT_FOUND when task does not exist', async () => {
    addPmUser();
    const cookie = await pmCookie();
    const r = await call('/api/admin/tasks/9999', {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(r.status).toBe(404);
    const body = (await r.json()) as TaskBody;
    expect(body.error?.code).toBe('NOT_FOUND');
    expect(audit).toHaveLength(0);
    expect(batchStatements).toHaveLength(0);
  });

  it('returns 409 HAS_ACTIVE_COMPLETIONS when task has active completions', async () => {
    addPmUser();
    const t = addTask({ id: 1, name: 'blocked' });
    addCompletion({ task_id: t.id, status: 'active' });
    const cookie = await pmCookie();
    const r = await call('/api/admin/tasks/1', {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(r.status).toBe(409);
    const body = (await r.json()) as TaskBody;
    expect(body.error?.code).toBe('HAS_ACTIVE_COMPLETIONS');
    // Task is NOT soft-deleted, and no audit was written.
    expect(tasks.find((x) => x.id === 1)?.is_active).toBe(1);
    expect(audit).toHaveLength(0);
    expect(batchStatements).toHaveLength(0);
  });

  it('200 happy path: soft-deletes (is_active=0), writes audit (task_delete)', async () => {
    addPmUser();
    addTask({ id: 1, name: 'tidy toys', token_reward: 20 });

    const cookie = await pmCookie();
    const r = await call('/api/admin/tasks/1', {
      method: 'DELETE',
      headers: { cookie },
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as TaskBody;
    expect(body.id).toBe(1);
    expect(body.is_active).toBe(0);

    // Soft-delete: task still exists in DB, just inactive.
    const t = tasks.find((x) => x.id === 1);
    expect(t).toBeDefined();
    expect(t?.is_active).toBe(0);

    const entry = audit.find((a) => a.action === 'task_delete');
    expect(entry).toBeDefined();
    const details = JSON.parse(entry?.details ?? '{}') as Record<string, unknown>;
    expect(details.task_id).toBe(1);
    expect(details.name).toBe('tidy toys');

    // Two batched statements: UPDATE tasks SET is_active=0 + INSERT audit_log.
    expect(batchStatements).toHaveLength(2);
    expect(batchStatements[0].query.toUpperCase()).toMatch(/^UPDATE\s+TASKS/);
    expect(batchStatements[0].query).toMatch(/is_active\s*=\s*0/i);
    expect(batchStatements[1].query.toUpperCase()).toMatch(/^INSERT\s+INTO\s+AUDIT_LOG/);
  });
});

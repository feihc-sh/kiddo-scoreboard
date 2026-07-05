// tests/unit/admin-task-toggle.test.ts
// Unit tests for POST /api/admin/tasks/:id/toggle.
// Verifies: requirePm guard, id validation, 404, toggle 1→0 (task_suspended),
// toggle 0→1 (task_resumed), audit_log details structure.

import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/worker.ts';
import { signSession } from '../../src/auth/session.ts';
import type { D1Database, D1PreparedStatement, D1Result, Task, AccountType } from '../../src/db/types.ts';

// -------------------------------------------------------------
// Test fixtures (in-memory mock)
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
let audit: AuditRow[] = [];
let nextAuditId = 1;
let nowOverride = Math.floor(Date.now() / 1000);
let batchStatements: { query: string; params: unknown[] }[] = [];

function reset() {
  users = [];
  tasks = [];
  audit = [];
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
  const id = tasks.length + 1;
  const t: Task = {
    id,
    name: `task ${id}`,
    token_reward: 30,
    target_account: 'game_time' as AccountType,
    icon: null,
    category: 'habit',
    is_active: 1,
    sort_order: 0,
    cutoff_time: null,
    is_self_lockout: 0,
    created_at: nowOverride,
    updated_at: nowOverride,
    ...overrides,
  };
  tasks.push(t);
  return t;
}

// -------------------------------------------------------------
// Mock D1 prepared statement
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
      if (/FROM\s+tasks\s+WHERE\s+id\s*=\s*\?/i.test(query)) {
        const id = params[0] as number;
        const t = tasks.find((x) => x.id === id);
        return Promise.resolve((t as unknown) as T);
      }
      return Promise.resolve(null);
    },
    all<T = unknown>(): Promise<D1Result<T>> {
      return Promise.resolve({ results: [], success: true });
    },
    run<T = unknown>(): Promise<D1Result<T>> {
      if (/UPDATE\s+tasks/i.test(query)) {
        // UPDATE tasks SET is_active = ?, updated_at = ? WHERE id = ?
        const [newIsActive, newUpdatedAt, taskId] = params as [number, number, number];
        const t = tasks.find((x) => x.id === taskId);
        if (t) {
          t.is_active = newIsActive as 0 | 1;
          t.updated_at = newUpdatedAt;
        }
        return Promise.resolve({
          success: true,
          meta: { changes: t ? 1 : 0, last_row_id: 0, duration: 0 },
        });
      }
      if (/INSERT\s+INTO\s+audit_log/i.test(query)) {
        // Action is inlined as SQL literal, only details and created_at are bound
        const [details, createdAt] = params as [string, number];
        // Extract action from query: VALUES ('pm', 'task_resumed', NULL, NULL, ?, ?)
        const actionMatch = query.match(/VALUES\s*\(\s*'pm'\s*,\s*'(\w+)'\s*,/);
        const action = actionMatch ? actionMatch[1] : 'unknown';
        const row: AuditRow = {
          id: nextAuditId++,
          actor: 'pm',
          action,
          target_event_id: null,
          target_user_id: null,
          details,
          created_at: createdAt,
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

interface ToggleResponse {
  id?: number;
  is_active?: 0 | 1;
  action?: string;
  toggled_at?: number;
  error?: { code: string; message: string };
}

// -------------------------------------------------------------
// Tests
// -------------------------------------------------------------
describe('POST /api/admin/tasks/:id/toggle', () => {
  beforeEach(reset);

  it('returns 401 without session cookie (requirePm guard)', async () => {
    const r = await call('/api/admin/tasks/1/toggle', { method: 'POST' });
    expect(r.status).toBe(401);
    const body = (await r.json()) as ToggleResponse;
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns 400 BAD_REQUEST for non-integer id', async () => {
    addPmUser();
    const cookie = await pmCookie();
    const r = await call('/api/admin/tasks/abc/toggle', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as ToggleResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(body.error?.message).toBe('id must be a positive integer');
  });

  it('returns 400 BAD_REQUEST for id <= 0', async () => {
    addPmUser();
    const cookie = await pmCookie();
    const r = await call('/api/admin/tasks/0/toggle', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as ToggleResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('returns 404 NOT_FOUND when task does not exist', async () => {
    addPmUser();
    const cookie = await pmCookie();
    const r = await call('/api/admin/tasks/9999/toggle', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(404);
    const body = (await r.json()) as ToggleResponse;
    expect(body.error?.code).toBe('NOT_FOUND');
    expect(body.error?.message).toBe('task not found');
    // No audit written
    expect(audit).toHaveLength(0);
    expect(batchStatements).toHaveLength(0);
  });

  it('toggle 1→0: is_active=0 + audit action=task_suspended', async () => {
    addPmUser();
    const task = addTask({ id: 5, is_active: 1 });
    const cookie = await pmCookie();

    const r = await call('/api/admin/tasks/5/toggle', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as ToggleResponse;

    // Response
    expect(body.id).toBe(5);
    expect(body.is_active).toBe(0);
    expect(body.action).toBe('task_suspended');
    expect(typeof body.toggled_at).toBe('number');

    // Task row updated
    const updated = tasks.find((t) => t.id === 5);
    expect(updated?.is_active).toBe(0);

    // Audit log entry
    const entry = audit.find((a) => a.action === 'task_suspended');
    expect(entry).toBeDefined();
    expect(entry?.actor).toBe('pm');
    expect(entry?.target_event_id).toBeNull();
    expect(entry?.target_user_id).toBeNull();
    const details = JSON.parse(entry?.details ?? '{}') as Record<string, unknown>;
    expect(details.task_id).toBe(5);
    expect(details.old_is_active).toBe(1);
    expect(details.new_is_active).toBe(0);
    expect(typeof details.toggled_at).toBe('number');

    // db.batch had 2 statements: UPDATE + INSERT audit
    expect(batchStatements).toHaveLength(2);
    expect(batchStatements[0].query.toUpperCase()).toMatch(/^UPDATE\s+TASKS/);
    expect(batchStatements[1].query.toUpperCase()).toMatch(/^INSERT\s+INTO\s+AUDIT_LOG/);
  });

  it('toggle 0→1: is_active=1 + audit action=task_resumed', async () => {
    addPmUser();
    const task = addTask({ id: 7, is_active: 0 });
    const cookie = await pmCookie();

    const r = await call('/api/admin/tasks/7/toggle', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as ToggleResponse;

    // Response
    expect(body.id).toBe(7);
    expect(body.is_active).toBe(1);
    expect(body.action).toBe('task_resumed');
    expect(typeof body.toggled_at).toBe('number');

    // Task row updated
    const updated = tasks.find((t) => t.id === 7);
    expect(updated?.is_active).toBe(1);

    // Audit log entry
    const entry = audit.find((a) => a.action === 'task_resumed');
    expect(entry).toBeDefined();
    expect(entry?.actor).toBe('pm');
    expect(entry?.target_event_id).toBeNull();
    expect(entry?.target_user_id).toBeNull();
    const details = JSON.parse(entry?.details ?? '{}') as Record<string, unknown>;
    expect(details.task_id).toBe(7);
    expect(details.old_is_active).toBe(0);
    expect(details.new_is_active).toBe(1);
    expect(typeof details.toggled_at).toBe('number');

    // db.batch had 2 statements
    expect(batchStatements).toHaveLength(2);
    expect(batchStatements[0].query.toUpperCase()).toMatch(/^UPDATE\s+TASKS/);
    expect(batchStatements[1].query.toUpperCase()).toMatch(/^INSERT\s+INTO\s+AUDIT_LOG/);
  });
});

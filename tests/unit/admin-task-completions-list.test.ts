// tests/unit/admin-task-completions-list.test.ts
// Integration tests for GET /api/admin/task-completions (PM-only).
//
// Verifies:
//   - 401 without PM session
//   - 400 when user_id is missing (or non-integer)
//   - 400 when date is malformed
//   - 400 when status is neither 'active' nor 'revoked'
//   - happy path: defaults date=todayShanghai, status='active', returns
//     matching completions ordered by completed_at DESC
//   - status='revoked' filter returns only revoked rows (active is excluded)

import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/worker.ts';
import { signSession } from '../../src/auth/session.ts';
import { todayShanghai } from '../../src/utils/week.ts';
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  TaskCompletion,
  CompletionStatus,
} from '../../src/db/types.ts';

// -------------------------------------------------------------
// Test fixtures (in-memory, replace D1 in these tests)
// -------------------------------------------------------------
interface UserRow {
  id: number;
  name: string;
  role: 'child' | 'pm';
  pin_hash: string | null;
  created_at: number;
  updated_at: number;
}

let users: UserRow[] = [];
let completions: TaskCompletion[] = [];

function reset() {
  users = [];
  completions = [];
}

function addPmUser(id = 1) {
  users.push({
    id,
    name: 'PM',
    role: 'pm',
    pin_hash: 'fake-hash',
    created_at: 0,
    updated_at: 0,
  });
}

function addCompletion(overrides: Partial<TaskCompletion> = {}): TaskCompletion {
  const id = completions.length + 1;
  const c: TaskCompletion = {
    id,
    task_id: 1,
    user_id: 2,
    status: 'active' as CompletionStatus,
    completed_date: '2026-06-05',
    completed_at: 1_700_000_000 + id, // strictly increasing by id
    awarded_event_id: 100,
    revoked_at: null,
    revoked_by: null,
    ...overrides,
  };
  completions.push(c);
  return c;
}

// -------------------------------------------------------------
// In-memory D1 mock — only needs to support the GET query.
// The query is: SELECT ... FROM task_completions
//               WHERE user_id = ? AND completed_date = ? AND status = ?
//               ORDER BY completed_at DESC
// -------------------------------------------------------------
function makeMockDb(): D1Database {
  const db: D1Database = {
    prepare(query: string): D1PreparedStatement {
      let params: unknown[] = [];
      const stmt: D1PreparedStatement = {
        bind(...values: unknown[]): D1PreparedStatement {
          params = values;
          return stmt;
        },
        first: () => Promise.resolve(null),
        all<T = unknown>(): Promise<D1Result<T>> {
          if (
            /FROM\s+task_completions/i.test(query) &&
            /user_id\s*=\s*\?/i.test(query) &&
            /completed_date\s*=\s*\?/i.test(query) &&
            /status\s*=\s*\?/i.test(query)
          ) {
            const [userId, completedDate, status] = params as [number, string, string];
            const filtered = completions
              .filter(
                (c) =>
                  c.user_id === userId &&
                  c.completed_date === completedDate &&
                  c.status === status,
              )
              // The SELECT projects only 6 of the 8 columns; the route's
              // narrow Omit type matches this.
              .map((c) => ({
                id: c.id,
                task_id: c.task_id,
                user_id: c.user_id,
                status: c.status,
                completed_date: c.completed_date,
                completed_at: c.completed_at,
                awarded_event_id: c.awarded_event_id,
              }))
              .sort((a, b) => b.completed_at - a.completed_at);
            return Promise.resolve({
              results: filtered as unknown as T[],
              success: true,
            });
          }
          return Promise.resolve({ results: [], success: true });
        },
        run: () => Promise.resolve({ success: true }),
        raw: () => Promise.resolve([]),
      };
      return stmt;
    },
    batch: () => Promise.resolve([]),
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
    { user_id: userId, exp: Math.floor(Date.now() / 1000) + 3600 },
    SECRET,
  );
  return `pm_session=${token}`;
}

interface ListResponse {
  completions?: Array<{
    id: number;
    task_id: number;
    user_id: number;
    status: CompletionStatus;
    completed_date: string;
    completed_at: number;
    awarded_event_id: number | null;
  }>;
  count?: number;
  error?: { code: string; message: string };
}

// -------------------------------------------------------------
// Tests
// -------------------------------------------------------------
describe('GET /api/admin/task-completions', () => {
  beforeEach(reset);

  it('returns 401 without PM session cookie', async () => {
    const r = await call('/api/admin/task-completions?user_id=2');
    expect(r.status).toBe(401);
    const body = (await r.json()) as ListResponse;
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns 400 when user_id is missing', async () => {
    addPmUser();
    const cookie = await pmCookie();
    const r = await call('/api/admin/task-completions', { headers: { cookie } });
    expect(r.status).toBe(400);
    const body = (await r.json()) as ListResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(body.error?.message).toMatch(/user_id/);
  });

  it('returns 400 when user_id is not a positive integer', async () => {
    addPmUser();
    const cookie = await pmCookie();
    const r = await call('/api/admin/task-completions?user_id=abc', {
      headers: { cookie },
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as ListResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when date is malformed', async () => {
    addPmUser();
    const cookie = await pmCookie();
    // "2026-6-5" has single-digit month/day — the format regex /^\d{4}-\d{2}-\d{2}$/ rejects it.
    // We deliberately do NOT test range semantics (e.g. 2026-13-99): the spec's validator
    // is a format check, not a calendar-validity check.
    const r = await call('/api/admin/task-completions?user_id=2&date=2026-6-5', {
      headers: { cookie },
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as ListResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(body.error?.message).toMatch(/date/i);
  });

  it('returns 400 when status is invalid', async () => {
    addPmUser();
    const cookie = await pmCookie();
    const r = await call('/api/admin/task-completions?user_id=2&status=pending', {
      headers: { cookie },
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as ListResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(body.error?.message).toMatch(/status/);
  });

  it('happy path: defaults date=todayShanghai and status=active, returns matching completions', async () => {
    addPmUser();
    const today = todayShanghai();
    const yesterday = (() => {
      // 1 day before today, expressed in YYYY-MM-DD
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 1);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    })();

    // Three completions we want to see (today, user 2, status active).
    addCompletion({ id: 1, user_id: 2, status: 'active', completed_date: today, completed_at: 1_700_000_010 });
    addCompletion({ id: 2, user_id: 2, status: 'active', completed_date: today, completed_at: 1_700_000_020 });
    addCompletion({ id: 3, user_id: 2, status: 'active', completed_date: today, completed_at: 1_700_000_030 });
    // These should be EXCLUDED by the filter:
    addCompletion({ id: 4, user_id: 2, status: 'active', completed_date: yesterday, completed_at: 1_700_000_040 });
    addCompletion({ id: 5, user_id: 3, status: 'active', completed_date: today, completed_at: 1_700_000_050 });
    addCompletion({ id: 6, user_id: 2, status: 'revoked', completed_date: today, completed_at: 1_700_000_060 });

    const cookie = await pmCookie();
    const r = await call('/api/admin/task-completions?user_id=2', {
      headers: { cookie },
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as ListResponse;

    expect(body.count).toBe(3);
    expect(body.completions).toHaveLength(3);
    // Ordered by completed_at DESC.
    const ids = body.completions!.map((c) => c.id);
    expect(ids).toEqual([3, 2, 1]);
    // All rows project exactly the 6 columns the SELECT promises — no
    // revoked_at / revoked_by leakage in the list payload.
    for (const c of body.completions!) {
      expect(c.status).toBe('active');
      expect(c.completed_date).toBe(today);
      expect(c.user_id).toBe(2);
      expect('revoked_at' in c).toBe(false);
      expect('revoked_by' in c).toBe(false);
    }
  });

  it("status='revoked' returns only revoked completions (excludes active)", async () => {
    addPmUser();
    const today = todayShanghai();

    addCompletion({ id: 1, user_id: 2, status: 'active', completed_date: today, completed_at: 1_700_000_010 });
    addCompletion({ id: 2, user_id: 2, status: 'active', completed_date: today, completed_at: 1_700_000_020 });
    addCompletion({
      id: 3,
      user_id: 2,
      status: 'revoked',
      completed_date: today,
      completed_at: 1_700_000_030,
      revoked_at: 1_700_000_040,
      revoked_by: 1,
    });

    const cookie = await pmCookie();
    const r = await call(
      `/api/admin/task-completions?user_id=2&date=${today}&status=revoked`,
      { headers: { cookie } },
    );
    expect(r.status).toBe(200);
    const body = (await r.json()) as ListResponse;

    expect(body.count).toBe(1);
    expect(body.completions).toHaveLength(1);
    const c = body.completions![0];
    expect(c.id).toBe(3);
    expect(c.status).toBe('revoked');
  });
});

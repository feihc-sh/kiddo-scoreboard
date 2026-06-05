// tests/unit/me-profile.test.ts
// Tests for PATCH /api/me/profile — first-time child name set.
// TDD: written before the implementation. In-memory D1 mock supports
// db.batch() with last_row_id and mutates in-memory tables on writes,
// so sequential calls (e.g. second attempt) see prior state.
//
// Auth: child user_id is HARDCODED to 2 in src/routes/me/profile.ts for now
// (matches seeds/local.sql and src/routes/me/tasks.ts). M5 will replace this
// with proper auth.

import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/worker.ts';
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
} from '../../src/db/types.ts';

const CHILD_USER_ID = 2;

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
  actor: string;
  action: string;
  target_event_id: number | null;
  target_user_id: number | null;
  details: string;
  created_at: number;
}

let users: UserRow[] = [];
let auditLog: AuditRow[] = [];

let nextUserId = 1;
let nextAuditId = 1;
let now = 1_700_000_000;

interface CapturedBatch {
  query: string;
  params: unknown[];
}
let lastBatch: CapturedBatch[] = [];

function reset() {
  users = [];
  auditLog = [];
  nextUserId = 1;
  nextAuditId = 1;
  now = 1_700_000_000;
  lastBatch = [];
}

function makeUser(overrides: Partial<UserRow> = {}): UserRow {
  const id = overrides.id ?? nextUserId++;
  const u: UserRow = {
    id,
    name: '',
    role: 'child',
    pin_hash: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  users.push(u);
  return u;
}

function makeMockDb(): D1Database {
  type Tagged = D1PreparedStatement & { __captured?: CapturedBatch };

  const captureAndReturn = (stmt: Tagged, query: string, params: unknown[]): Tagged => {
    stmt.__captured = { query: query.trim().replace(/\s+/g, ' '), params };
    return stmt;
  };

  const db: D1Database = {
    prepare(query: string): D1PreparedStatement {
      let params: unknown[] = [];
      const stmt: Tagged = {
        bind(...values: unknown[]): D1PreparedStatement {
          params = values;
          return captureAndReturn(stmt, query, params);
        },
        first<T = unknown>(): Promise<T | null> {
          // SELECT user by id (initial load + re-read after UPDATE).
          if (/FROM\s+users\s+WHERE\s+id\s*=\s*\?/.test(query)) {
            const id = params[0] as number;
            const found = users.find((u) => u.id === id) ?? null;
            return Promise.resolve(found as T);
          }
          return Promise.resolve(null);
        },
        all<T = unknown>(): Promise<D1Result<T>> {
          return Promise.resolve({ results: [], success: true });
        },
        run<T = unknown>(): Promise<D1Result<T>> {
          captureAndReturn(stmt, query, params);
          return Promise.resolve({ success: true });
        },
        raw<T = unknown>(): Promise<T[]> {
          return Promise.resolve([]);
        },
      };
      return stmt;
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const results: D1Result<T>[] = [];
      for (const s of statements) {
        const tagged = s as Tagged;
        const captured = tagged.__captured ?? { query: '', params: [] };
        lastBatch.push(captured);
        const q = captured.query;
        const p = captured.params;

        if (/^UPDATE\s+users\s+SET\s+name/i.test(q)) {
          // Bound params: [trimmed_name, child_id].
          const newName = p[0] as string;
          const id = p[1] as number;
          const u = users.find((x) => x.id === id);
          if (u) {
            u.name = newName;
            u.updated_at = now;
          }
          results.push({
            success: true,
            meta: { changes: u ? 1 : 0, last_row_id: 0, duration: 0 },
          } as D1Result<T>);
          continue;
        }

        if (/^INSERT INTO\s+audit_log/i.test(q)) {
          const id = nextAuditId++;
          // For set_name the SQL inlines actor='child', action='set_name',
          // target_event_id=NULL, created_at=unixepoch(); bound params are
          // [target_user_id, details].
          auditLog.push({
            id,
            actor: 'child',
            action: 'set_name',
            target_event_id: null,
            target_user_id: p[0] as number | null,
            details: typeof p[1] === 'string' ? p[1] : JSON.stringify(p[1] ?? {}),
            created_at: now,
          });
          results.push({
            success: true,
            meta: { changes: 1, last_row_id: id, duration: 0 },
          } as D1Result<T>);
          continue;
        }

        results.push({ success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } });
      }
      return results;
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

interface ProfileResponse {
  id?: number;
  name?: string;
  is_first_time?: boolean;
  updated_at?: number;
  error?: { code?: string; message?: string };
}

describe('PATCH /api/me/profile', () => {
  beforeEach(reset);

  it('returns 400 BAD_REQUEST when body is missing', async () => {
    // No body, no Content-Type → c.req.json() will throw / return unusable value.
    const r = await call('/api/me/profile', { method: 'PATCH' });
    expect(r.status).toBe(400);
    const body = (await r.json()) as ProfileResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('returns 400 BAD_REQUEST when name is not a string', async () => {
    makeUser({ id: CHILD_USER_ID, name: '' });
    const r = await call('/api/me/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 123 }),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as ProfileResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('returns 400 BAD_REQUEST when name is empty', async () => {
    makeUser({ id: CHILD_USER_ID, name: '' });
    const r = await call('/api/me/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as ProfileResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('returns 400 BAD_REQUEST when name is whitespace only', async () => {
    makeUser({ id: CHILD_USER_ID, name: '' });
    const r = await call('/api/me/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as ProfileResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('returns 400 BAD_REQUEST when name exceeds 20 chars', async () => {
    makeUser({ id: CHILD_USER_ID, name: '' });
    const r = await call('/api/me/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'a'.repeat(21) }),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as ProfileResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('returns 404 NOT_FOUND when user does not exist', async () => {
    // No user with id=2 in the mock DB.
    const r = await call('/api/me/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Tom' }),
    });
    expect(r.status).toBe(404);
    const body = (await r.json()) as ProfileResponse;
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('returns 409 ALREADY_SET when user.name is already non-empty', async () => {
    makeUser({ id: CHILD_USER_ID, name: 'Bob' });
    const r = await call('/api/me/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Tom' }),
    });
    expect(r.status).toBe(409);
    const body = (await r.json()) as ProfileResponse;
    expect(body.error?.code).toBe('ALREADY_SET');
    // No batch should have been submitted.
    expect(lastBatch).toHaveLength(0);
  });

  it('happy path: 200 with updated user, name trimmed, audit written', async () => {
    makeUser({ id: CHILD_USER_ID, name: '' });
    const r = await call('/api/me/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '  Tom  ' }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as ProfileResponse;
    expect(body.id).toBe(CHILD_USER_ID);
    expect(body.name).toBe('Tom');
    expect(body.is_first_time).toBe(false);
    expect(typeof body.updated_at).toBe('number');

    // Exactly 2 batch statements executed: UPDATE users + INSERT audit_log.
    expect(lastBatch).toHaveLength(2);
    expect(lastBatch[0].query).toMatch(/^UPDATE\s+users\s+SET\s+name/i);
    expect(lastBatch[1].query).toMatch(/^INSERT INTO\s+audit_log/i);

    // The trimmed name and child id were bound to the UPDATE.
    expect(lastBatch[0].params[0]).toBe('Tom');
    expect(lastBatch[0].params[1]).toBe(CHILD_USER_ID);

    // The user in the DB now has the new name.
    const u = users.find((x) => x.id === CHILD_USER_ID);
    expect(u?.name).toBe('Tom');

    // The audit row was created with actor=child, action=set_name, target_user_id=2, details={name:'Tom'}.
    expect(auditLog).toHaveLength(1);
    const audit = auditLog[0];
    expect(audit.actor).toBe('child');
    expect(audit.action).toBe('set_name');
    expect(audit.target_user_id).toBe(CHILD_USER_ID);
    expect(JSON.parse(audit.details)).toEqual({ name: 'Tom' });
  });

  it('second attempt on same user → 409 ALREADY_SET', async () => {
    makeUser({ id: CHILD_USER_ID, name: '' });

    // First call: sets the name.
    const r1 = await call('/api/me/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Tom' }),
    });
    expect(r1.status).toBe(200);

    // Reset batch capture so we can verify the second call does NOT issue a batch.
    lastBatch = [];

    // Second call: should now 409 because the name is already set.
    const r2 = await call('/api/me/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Jerry' }),
    });
    expect(r2.status).toBe(409);
    const body = (await r2.json()) as ProfileResponse;
    expect(body.error?.code).toBe('ALREADY_SET');

    // No batch was submitted for the second call.
    expect(lastBatch).toHaveLength(0);
    // Only the first call's audit row exists.
    expect(auditLog).toHaveLength(1);
    // Name in the DB is still 'Tom' (unchanged by the rejected call).
    const u = users.find((x) => x.id === CHILD_USER_ID);
    expect(u?.name).toBe('Tom');
  });
});

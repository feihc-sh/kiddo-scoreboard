// tests/unit/admin-events-actions.test.ts
// Integration tests for PM event management endpoints:
//   POST /api/admin/events/:id/approve
//   POST /api/admin/events/:id/reject
//   POST /api/admin/events/:id/revoke
//   PUT  /api/admin/events/:id       (edit)
//
// Verifies: requirePm guard, id validation, 404, 409 state guards,
// happy paths with batched UPDATE + audit_log INSERT, new_balance
// recomputation, and edit body validation.

import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/worker.ts';
import { signSession } from '../../src/auth/session.ts';
import type {
  AccountType,
  D1Database,
  D1PreparedStatement,
  D1Result,
  EventSource,
  EventStatus,
  ScoreEvent,
  SubmittedBy,
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
let events: ScoreEvent[] = [];
let audit: AuditRow[] = [];
let nextAuditId = 1;
let nextEventId = 1;
let nowOverride = Math.floor(Date.now() / 1000);
let batchStatements: { query: string; params: unknown[] }[] = [];

function reset() {
  users = [];
  events = [];
  audit = [];
  nextAuditId = 1;
  nextEventId = 1;
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

function addEvent(overrides: Partial<ScoreEvent> = {}): ScoreEvent {
  const id = overrides.id ?? nextEventId++;
  const e: ScoreEvent = {
    id,
    user_id: 1,
    type: 'game_time' as AccountType,
    change_value: 30,
    reason: 'task complete',
    status: 'pending' as EventStatus,
    submitted_by: 'pm' as SubmittedBy,
    source: 'manual' as EventSource,
    source_ref: null,
    reviewed_by: null,
    reviewed_at: null,
    week_of: null,
    created_at: nowOverride,
    ...overrides,
  };
  if (id >= nextEventId) nextEventId = id + 1;
  events.push(e);
  return e;
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
      if (/FROM\s+score_events\s+WHERE\s+id\s*=\s*\?/i.test(query)) {
        const id = params[0] as number;
        const e = events.find((x) => x.id === id) ?? null;
        return Promise.resolve((e as unknown) as T);
      }
      return Promise.resolve(null);
    },
    all<T = unknown>(): Promise<D1Result<T>> {
      if (
        /FROM\s+score_events/i.test(query) &&
        /user_id\s*=\s*\?/i.test(query) &&
        /status\s*=\s*'approved'/i.test(query) &&
        /GROUP\s+BY\s+type/i.test(query)
      ) {
        const uid = params[0] as number;
        const filtered = events.filter((e) => e.user_id === uid && e.status === 'approved');
        const grouped = new Map<string, number>();
        for (const e of filtered) {
          grouped.set(e.type, (grouped.get(e.type) ?? 0) + e.change_value);
        }
        const results = Array.from(grouped, ([type, total]) => ({ type, total }));
        return Promise.resolve({ results: (results as unknown) as T[], success: true });
      }
      return Promise.resolve({ results: [], success: true });
    },
    run<T = unknown>(): Promise<D1Result<T>> {
      if (/UPDATE\s+score_events/i.test(query)) {
        const id = params[params.length - 1] as number;
        const e = events.find((x) => x.id === id);
        if (e) {
          const mApprove = /status\s*=\s*'approved'/i.test(query);
          const mReject = /status\s*=\s*'rejected'/i.test(query);
          const mRevoke = /status\s*=\s*'revoked'/i.test(query);
          if (mApprove) {
            e.status = 'approved';
            e.reviewed_by = params[0] as number;
            e.reviewed_at = params[1] as number;
          } else if (mReject) {
            e.status = 'rejected';
            e.reviewed_by = params[0] as number;
            e.reviewed_at = params[1] as number;
          } else if (mRevoke) {
            e.status = 'revoked';
            e.reviewed_by = params[0] as number;
            e.reviewed_at = params[1] as number;
          } else {
            const sets = query.match(/SET\s+(.+?)\s+WHERE/i)?.[1] ?? '';
            const fieldMatches = [...sets.matchAll(/(\w+)\s*=\s*\?/g)].map((m) => m[1]);
            fieldMatches.forEach((field, idx) => {
              const v = params[idx];
              if (field in e) {
                (e as unknown as Record<string, unknown>)[field] = v;
              }
            });
          }
        }
        return Promise.resolve({
          success: true,
          meta: { changes: e ? 1 : 0, last_row_id: 0, duration: 0 },
        });
      }
      if (/INSERT\s+INTO\s+audit_log/i.test(query)) {
        const [target_event_id, target_user_id, details, createdAt] = params as [
          number | null,
          number | null,
          string,
          number,
        ];
        const m = query.match(/VALUES\s*\(\s*'pm'\s*,\s*'([^']+)'/i);
        const row: AuditRow = {
          id: nextAuditId++,
          actor: 'pm',
          action: m ? m[1] : 'unknown',
          target_event_id,
          target_user_id,
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

interface EventActionResponse {
  id?: number;
  status?: EventStatus;
  new_balance?: { game_time: number; pocket_money: number } | null;
  event?: ScoreEvent;
  error?: { code: string; message: string };
}

// =============================================================
// POST /:id/approve
// =============================================================
describe('POST /api/admin/events/:id/approve', () => {
  beforeEach(reset);

  it('returns 401 without session cookie (requirePm guard)', async () => {
    const r = await call('/api/admin/events/1/approve', { method: 'POST' });
    expect(r.status).toBe(401);
    const body = (await r.json()) as EventActionResponse;
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns 400 for non-integer id', async () => {
    addPmUser();
    const cookie = await pmCookie();
    const r = await call('/api/admin/events/abc/approve', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as EventActionResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('returns 404 when event does not exist', async () => {
    addPmUser();
    const cookie = await pmCookie();
    const r = await call('/api/admin/events/9999/approve', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(404);
    const body = (await r.json()) as EventActionResponse;
    expect(body.error?.code).toBe('NOT_FOUND');
    expect(audit).toHaveLength(0);
    expect(batchStatements).toHaveLength(0);
  });

  it('returns 409 when event is not pending', async () => {
    addPmUser();
    addEvent({ id: 11, status: 'approved' });
    const cookie = await pmCookie();
    const r = await call('/api/admin/events/11/approve', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(409);
    const body = (await r.json()) as EventActionResponse;
    expect(body.error?.code).toBe('INVALID_STATUS');
    expect(batchStatements).toHaveLength(0);
  });

  it('happy path: flips status, writes audit, returns new_balance', async () => {
    addPmUser();
    addEvent({
      id: 21,
      user_id: 1,
      type: 'pocket_money',
      change_value: 50,
      reason: 'helped dishes',
      status: 'pending',
    });
    addEvent({
      id: 22,
      user_id: 1,
      type: 'game_time',
      change_value: 20,
      status: 'approved',
    });

    const cookie = await pmCookie();
    const r = await call('/api/admin/events/21/approve', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as EventActionResponse;

    expect(body.id).toBe(21);
    expect(body.status).toBe('approved');
    expect(body.new_balance).toEqual({ game_time: 20, pocket_money: 50, coins: 0 });

    const ev = events.find((e) => e.id === 21);
    expect(ev?.status).toBe('approved');
    expect(ev?.reviewed_by).toBe(1);
    expect(typeof ev?.reviewed_at).toBe('number');

    const entry = audit.find((a) => a.action === 'approve_event');
    expect(entry).toBeDefined();
    expect(entry?.actor).toBe('pm');
    expect(entry?.target_event_id).toBe(21);
    expect(entry?.target_user_id).toBe(1);
    const details = JSON.parse(entry?.details ?? '{}') as Record<string, unknown>;
    expect(details.change_value).toBe(50);
    expect(details.reason).toBe('helped dishes');

    expect(batchStatements).toHaveLength(2);
    expect(batchStatements[0].query.toUpperCase()).toMatch(/^UPDATE\s+SCORE_EVENTS/);
    expect(batchStatements[1].query.toUpperCase()).toMatch(/^INSERT\s+INTO\s+AUDIT_LOG/);
  });
});

// =============================================================
// POST /:id/reject
// =============================================================
describe('POST /api/admin/events/:id/reject', () => {
  beforeEach(reset);

  it('happy path: flips status to rejected and writes audit', async () => {
    addPmUser();
    addEvent({ id: 31, user_id: 1, status: 'pending', reason: 'asked for candy' });

    const cookie = await pmCookie();
    const r = await call('/api/admin/events/31/reject', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as EventActionResponse;
    expect(body.id).toBe(31);
    expect(body.status).toBe('rejected');

    const ev = events.find((e) => e.id === 31);
    expect(ev?.status).toBe('rejected');
    expect(ev?.reviewed_by).toBe(1);

    const entry = audit.find((a) => a.action === 'reject_event');
    expect(entry).toBeDefined();
    const details = JSON.parse(entry?.details ?? '{}') as Record<string, unknown>;
    expect(details.reason).toBe('asked for candy');

    expect(batchStatements).toHaveLength(2);
  });

  it('returns 409 when event is already approved', async () => {
    addPmUser();
    addEvent({ id: 32, user_id: 1, status: 'approved' });
    const cookie = await pmCookie();
    const r = await call('/api/admin/events/32/reject', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(409);
    const body = (await r.json()) as EventActionResponse;
    expect(body.error?.code).toBe('INVALID_STATUS');
    expect(batchStatements).toHaveLength(0);
  });
});

// =============================================================
// POST /:id/revoke
// =============================================================
describe('POST /api/admin/events/:id/revoke', () => {
  beforeEach(reset);

  it('200 from approved: revokes and returns new_balance', async () => {
    addPmUser();
    addEvent({ id: 41, user_id: 1, type: 'game_time', change_value: 30, status: 'approved' });
    addEvent({ id: 42, user_id: 1, type: 'pocket_money', change_value: 10, status: 'approved' });

    const cookie = await pmCookie();
    const r = await call('/api/admin/events/41/revoke', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as EventActionResponse;
    expect(body.id).toBe(41);
    expect(body.status).toBe('revoked');
    expect(body.new_balance).toEqual({ game_time: 0, pocket_money: 10, coins: 0 });

    const ev = events.find((e) => e.id === 41);
    expect(ev?.status).toBe('revoked');

    const entry = audit.find((a) => a.action === 'revoke_event');
    expect(entry).toBeDefined();
    const details = JSON.parse(entry?.details ?? '{}') as Record<string, unknown>;
    expect(details.original_status).toBe('approved');
  });

  it('200 from rejected: revokes and new_balance is null', async () => {
    addPmUser();
    addEvent({ id: 43, user_id: 1, status: 'rejected' });

    const cookie = await pmCookie();
    const r = await call('/api/admin/events/43/revoke', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as EventActionResponse;
    expect(body.status).toBe('revoked');
    expect(body.new_balance).toBeNull();

    const entry = audit.find((a) => a.action === 'revoke_event');
    const details = JSON.parse(entry?.details ?? '{}') as Record<string, unknown>;
    expect(details.original_status).toBe('rejected');
  });

  it('returns 409 when event is pending', async () => {
    addPmUser();
    addEvent({ id: 44, user_id: 1, status: 'pending' });
    const cookie = await pmCookie();
    const r = await call('/api/admin/events/44/revoke', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(409);
    const body = (await r.json()) as EventActionResponse;
    expect(body.error?.code).toBe('INVALID_STATUS');
    expect(batchStatements).toHaveLength(0);
  });
});

// =============================================================
// PUT /:id  (edit)
// =============================================================
describe('PUT /api/admin/events/:id  (edit)', () => {
  beforeEach(reset);

  it('200 partial update: changes reason only, audit reflects it', async () => {
    addPmUser();
    addEvent({ id: 51, user_id: 1, reason: 'old reason', change_value: 10, type: 'game_time' });

    const cookie = await pmCookie();
    const r = await call('/api/admin/events/51', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ reason: 'new reason' }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as EventActionResponse;
    expect(body.event?.reason).toBe('new reason');
    expect(body.event?.change_value).toBe(10);
    expect(body.new_balance).toBeNull();

    const entry = audit.find((a) => a.action === 'edit_event');
    expect(entry).toBeDefined();
    const details = JSON.parse(entry?.details ?? '{}') as Record<string, unknown>;
    expect(details.old_values).toEqual({ reason: 'old reason' });
    expect(details.new_values).toEqual({ reason: 'new reason' });
  });

  it('400 when body is empty / no fields provided', async () => {
    addPmUser();
    addEvent({ id: 52, user_id: 1 });
    const cookie = await pmCookie();
    const r = await call('/api/admin/events/52', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as EventActionResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('404 when event does not exist', async () => {
    addPmUser();
    const cookie = await pmCookie();
    const r = await call('/api/admin/events/8888', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ reason: 'whatever' }),
    });
    expect(r.status).toBe(404);
    const body = (await r.json()) as EventActionResponse;
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('400 when type is invalid', async () => {
    addPmUser();
    addEvent({ id: 53, user_id: 1, type: 'game_time' });
    const cookie = await pmCookie();
    const r = await call('/api/admin/events/53', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ type: 'side_bet' }),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as EventActionResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(audit).toHaveLength(0);
    const ev = events.find((e) => e.id === 53);
    expect(ev?.type).toBe('game_time');
  });

  it('editing an approved event change_value recomputes new_balance', async () => {
    addPmUser();
    addEvent({
      id: 54,
      user_id: 1,
      type: 'game_time',
      change_value: 30,
      status: 'approved',
    });
    addEvent({
      id: 55,
      user_id: 1,
      type: 'game_time',
      change_value: 20,
      status: 'approved',
    });
    const cookie = await pmCookie();
    const r = await call('/api/admin/events/54', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ change_value: 100 }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as EventActionResponse;
    expect(body.event?.change_value).toBe(100);
    expect(body.new_balance).toEqual({ game_time: 120, pocket_money: 0, coins: 0 });
  });
});

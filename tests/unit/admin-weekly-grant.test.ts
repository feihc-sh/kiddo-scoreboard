// tests/unit/admin-weekly-grant.test.ts
// Unit tests for POST /api/admin/weekly-grant
//   — PM-only weekend allowance, one or both accounts, atomic batch.
//
// Verifies: requirePm guard, body validation (missing / all-zero / bad types),
// happy paths for one and both accounts, note handling in reason, and
// new_balance recomputation across both accounts.

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
// Fixtures + in-memory D1 mock
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

function addChildUser(id = 2) {
  users.push({
    id,
    name: 'Kid',
    role: 'child',
    pin_hash: 'fake-hash',
    created_at: nowOverride,
    updated_at: nowOverride,
  });
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
      return Promise.resolve(null);
    },
    all<T = unknown>(): Promise<D1Result<T>> {
      // Balance query: sum approved events per type for a user.
      if (
        /FROM\s+score_events/i.test(query) &&
        /user_id\s*=\s*\?/i.test(query) &&
        /status\s*=\s*'approved'/i.test(query) &&
        /GROUP\s+BY\s+type/i.test(query)
      ) {
        const uid = params[0] as number;
        const filtered = events.filter(
          (e) => e.user_id === uid && e.status === 'approved',
        );
        const grouped = new Map<string, number>();
        for (const e of filtered) {
          grouped.set(e.type, (grouped.get(e.type) ?? 0) + e.change_value);
        }
        const results = Array.from(grouped, ([type, total]) => ({
          type,
          total,
        }));
        return Promise.resolve({
          results: (results as unknown) as T[],
          success: true,
        });
      }
      return Promise.resolve({ results: [], success: true });
    },
    run<T = unknown>(): Promise<D1Result<T>> {
      if (/INSERT\s+INTO\s+score_events/i.test(query)) {
        // Param order: user_id, type, change_value, reason, week_of, created_at
        const [user_id, type, change_value, reason, week_of, created_at] =
          params as [number, AccountType, number, string, string, number];
        const id = nextEventId++;
        const e: ScoreEvent = {
          id,
          user_id,
          type,
          change_value,
          reason,
          status: 'approved' as EventStatus,
          submitted_by: 'pm' as SubmittedBy,
          source: 'weekly_grant' as EventSource,
          source_ref: null,
          reviewed_by: null,
          reviewed_at: null,
          week_of,
          created_at,
        };
        events.push(e);
        return Promise.resolve({
          success: true,
          meta: { changes: 1, last_row_id: id, duration: 0 },
        });
      }
      if (/INSERT\s+INTO\s+audit_log/i.test(query)) {
        // Param order depends on columns listed; we always pass
        // (target_event_id?, target_user_id, details, created_at).
        const mAction = query.match(/VALUES\s*\(\s*'pm'\s*,\s*'([^']+)'/i);
        const action = mAction ? mAction[1] : 'unknown';
        // Detect whether target_event_id was bound (column listed) by
        // counting the leading columns.
        const hasTargetEventCol = /target_event_id/i.test(query);
        let target_event_id: number | null;
        let target_user_id: number | null;
        let details: string;
        let created_at: number;
        if (hasTargetEventCol) {
          target_event_id = (params[0] as number | null) ?? null;
          target_user_id = params[1] as number;
          details = params[2] as string;
          created_at = params[3] as number;
        } else {
          target_event_id = null;
          target_user_id = params[0] as number;
          details = params[1] as string;
          created_at = params[2] as number;
        }
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

interface GrantResponse {
  event_ids?: number[];
  new_balance?: { game_time: number; pocket_money: number };
  error?: { code: string; message: string };
}

// =============================================================
// Auth + validation
// =============================================================
describe('POST /api/admin/weekly-grant', () => {
  beforeEach(reset);

  it('returns 401 without PM session cookie', async () => {
    const r = await call('/api/admin/weekly-grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game_time: 30 }),
    });
    expect(r.status).toBe(401);
    const body = (await r.json()) as GrantResponse;
    expect(body.error?.code).toBe('UNAUTHORIZED');
    expect(events).toHaveLength(0);
    expect(audit).toHaveLength(0);
  });

  it('returns 400 when body is missing', async () => {
    addPmUser();
    const cookie = await pmCookie();
    const r = await call('/api/admin/weekly-grant', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as GrantResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(events).toHaveLength(0);
    expect(audit).toHaveLength(0);
    expect(batchStatements).toHaveLength(0);
  });

  it('returns 400 when both amounts are missing or zero', async () => {
    addPmUser();
    const cookie = await pmCookie();
    const r = await call('/api/admin/weekly-grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as GrantResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(batchStatements).toHaveLength(0);

    // Also covers explicit zeros.
    const r2 = await call('/api/admin/weekly-grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ game_time: 0, pocket_money: 0 }),
    });
    expect(r2.status).toBe(400);
  });

  it('returns 400 when an amount is not a non-negative integer', async () => {
    addPmUser();
    const cookie = await pmCookie();
    const r = await call('/api/admin/weekly-grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ game_time: -5 }),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as GrantResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(batchStatements).toHaveLength(0);
  });
});

// =============================================================
// Happy paths
// =============================================================
describe('POST /api/admin/weekly-grant — happy paths', () => {
  beforeEach(reset);

  it('game_time only: creates 1 score_event + 1 audit, returns ids and new_balance', async () => {
    addPmUser();
    addChildUser(2);
    const cookie = await pmCookie();

    const r = await call('/api/admin/weekly-grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ game_time: 60 }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as GrantResponse;

    expect(body.event_ids).toEqual([1]);
    expect(body.new_balance).toEqual({ game_time: 60, pocket_money: 0, coins: 0 });

    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev.user_id).toBe(2);
    expect(ev.type).toBe('game_time');
    expect(ev.change_value).toBe(60);
    expect(ev.reason).toBe('Weekly grant: +60 game_time');
    expect(ev.status).toBe('approved');
    expect(ev.submitted_by).toBe('pm');
    expect(ev.source).toBe('weekly_grant');
    expect(typeof ev.week_of).toBe('string');
    expect(ev.week_of).toMatch(/^\d{4}-W\d{2}$/);
    expect(typeof ev.created_at).toBe('number');

    expect(audit).toHaveLength(1);
    const entry = audit[0];
    expect(entry.action).toBe('weekly_grant');
    expect(entry.actor).toBe('pm');
    expect(entry.target_user_id).toBe(2);
    expect(entry.target_event_id).toBeNull();
    const details = JSON.parse(entry.details) as Record<string, unknown>;
    expect(details.game_time).toBe(60);
    expect(details.pocket_money).toBe(0);
    expect(details.note).toBeNull();

    // Exactly 2 statements in the batch: 1 event + 1 audit.
    expect(batchStatements).toHaveLength(2);
    expect(batchStatements[0].query.toUpperCase()).toMatch(
      /^INSERT\s+INTO\s+SCORE_EVENTS/,
    );
    expect(batchStatements[1].query.toUpperCase()).toMatch(
      /^INSERT\s+INTO\s+AUDIT_LOG/,
    );
  });

  it('both accounts: creates 2 score_events + 1 audit, returns both ids and new_balance', async () => {
    addPmUser();
    addChildUser(2);
    const cookie = await pmCookie();

    const r = await call('/api/admin/weekly-grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ game_time: 30, pocket_money: 5 }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as GrantResponse;

    expect(body.event_ids).toEqual([1, 2]);
    expect(body.new_balance).toEqual({ game_time: 30, pocket_money: 5, coins: 0 });

    expect(events).toHaveLength(2);
    const gt = events.find((e) => e.type === 'game_time');
    const pm = events.find((e) => e.type === 'pocket_money');
    expect(gt?.change_value).toBe(30);
    expect(pm?.change_value).toBe(5);
    expect(gt?.reason).toBe('Weekly grant: +30 game_time');
    expect(pm?.reason).toBe('Weekly grant: +5 pocket_money');

    expect(audit).toHaveLength(1);
    const details = JSON.parse(audit[0].details) as Record<string, unknown>;
    expect(details.game_time).toBe(30);
    expect(details.pocket_money).toBe(5);

    // Exactly 3 statements: 2 events + 1 audit.
    expect(batchStatements).toHaveLength(3);
    expect(batchStatements[0].query.toUpperCase()).toMatch(
      /^INSERT\s+INTO\s+SCORE_EVENTS/,
    );
    expect(batchStatements[1].query.toUpperCase()).toMatch(
      /^INSERT\s+INTO\s+SCORE_EVENTS/,
    );
    expect(batchStatements[2].query.toUpperCase()).toMatch(
      /^INSERT\s+INTO\s+AUDIT_LOG/,
    );
  });

  it('with note: reason string embeds the note, audit details include it', async () => {
    addPmUser();
    addChildUser(2);
    const cookie = await pmCookie();

    const r = await call('/api/admin/weekly-grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ game_time: 45, pocket_money: 3, note: 'bonus week' }),
    });
    expect(r.status).toBe(200);

    expect(events).toHaveLength(2);
    for (const ev of events) {
      expect(ev.reason).toContain('(bonus week)');
    }
    const gt = events.find((e) => e.type === 'game_time')!;
    const pm = events.find((e) => e.type === 'pocket_money')!;
    expect(gt.reason).toBe('Weekly grant: +45 game_time (bonus week)');
    expect(pm.reason).toBe('Weekly grant: +3 pocket_money (bonus week)');

    expect(audit).toHaveLength(1);
    const details = JSON.parse(audit[0].details) as Record<string, unknown>;
    expect(details.note).toBe('bonus week');
  });

  it('new_balance reflects both accounts (and ignores zero amounts)', async () => {
    addPmUser();
    addChildUser(2);
    // Pre-existing approved event so the new_balance is non-trivial.
    events.push({
      id: nextEventId++,
      user_id: 2,
      type: 'game_time',
      change_value: 100,
      reason: 'prior',
      status: 'approved',
      submitted_by: 'pm',
      source: 'manual',
      source_ref: null,
      reviewed_by: null,
      reviewed_at: null,
      week_of: '2026-W20',
      created_at: nowOverride,
    });

    const cookie = await pmCookie();
    // Game_time +100, pocket_money +7 → balance = 200 / 7.
    const r = await call('/api/admin/weekly-grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ game_time: 100, pocket_money: 7 }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as GrantResponse;
    expect(body.new_balance).toEqual({ game_time: 200, pocket_money: 7, coins: 0 });

    // Zero filter: pocket_money: 0 is dropped, only game_time event created.
    const r2 = await call('/api/admin/weekly-grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ game_time: 50, pocket_money: 0 }),
    });
    expect(r2.status).toBe(200);
    const body2 = (await r2.json()) as GrantResponse;
    expect(body2.event_ids).toEqual([4]); // id 1 (pre), 2 + 3 (first grant), 4 (this one)
    expect(body2.new_balance).toEqual({ game_time: 250, pocket_money: 7, coins: 0 });
  });
});

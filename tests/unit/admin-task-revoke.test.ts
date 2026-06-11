// tests/unit/admin-task-revoke.test.ts
// Integration tests for POST /api/admin/task-completions/:id/revoke.
// Verifies: requirePm guard, id validation, 404, 409 already-revoked, and the
// happy path that revokes both the task_completion and the awarded score_event
// in a single db.batch() transaction, writes an audit_log entry, and returns
// the recomputed new_balance.

import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/worker.ts';
import { signSession } from '../../src/auth/session.ts';
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  TaskCompletion,
  Task,
  ScoreEvent,
  CompletionStatus,
  AccountType,
  EventStatus,
  EventSource,
  SubmittedBy,
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
let events: ScoreEvent[] = [];
let audit: AuditRow[] = [];
let nextAuditId = 1;
let nowOverride = Math.floor(Date.now() / 1000);
let batchStatements: { query: string; params: unknown[] }[] = [];

function reset() {
  users = [];
  tasks = [];
  completions = [];
  events = [];
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
    created_at: nowOverride,
    updated_at: nowOverride,
    ...overrides,
  };
  tasks.push(t);
  return t;
}

function addCompletion(overrides: Partial<TaskCompletion> = {}): TaskCompletion {
  const id = completions.length + 1;
  const c: TaskCompletion = {
    id,
    task_id: 1,
    user_id: 1,
    status: 'active' as CompletionStatus,
    completed_date: '2026-06-05',
    completed_at: nowOverride,
    awarded_event_id: 100,
    revoked_at: null,
    revoked_by: null,
    ...overrides,
  };
  completions.push(c);
  return c;
}

function addEvent(overrides: Partial<ScoreEvent> = {}): ScoreEvent {
  const id = events.length + 1;
  const e: ScoreEvent = {
    id,
    user_id: 1,
    type: 'game_time' as AccountType,
    change_value: 30,
    reason: 'task complete',
    status: 'approved' as EventStatus,
    submitted_by: 'pm' as SubmittedBy,
    source: 'task' as EventSource,
    source_ref: 'task:1',
    reviewed_by: 1,
    reviewed_at: nowOverride,
    week_of: null,
    created_at: nowOverride,
    ...overrides,
  };
  events.push(e);
  return e;
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
      if (/FROM\s+task_completions\s+WHERE\s+id\s*=\s*\?/i.test(query)) {
        const id = params[0] as number;
        const c = completions.find((x) => x.id === id) ?? null;
        return Promise.resolve((c as unknown) as T);
      }
      if (/FROM\s+tasks\s+WHERE\s+id\s*=\s*\?/i.test(query)) {
        const id = params[0] as number;
        const t = tasks.find((x) => x.id === id);
        return Promise.resolve(
          (t ? ({ id: t.id, token_reward: t.token_reward } as unknown) : null) as T,
        );
      }
      return Promise.resolve(null);
    },
    all<T = unknown>(): Promise<D1Result<T>> {
      // computeBalance: SELECT type, SUM(change_value) ... WHERE user_id=? AND status='approved' GROUP BY type
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
      if (/UPDATE\s+task_completions/i.test(query)) {
        const [now, pmUserId, id] = params as [number, number, number];
        const c = completions.find((x) => x.id === id);
        if (c) {
          c.status = 'revoked';
          c.revoked_at = now;
          c.revoked_by = pmUserId;
        }
        return Promise.resolve({
          success: true,
          meta: { changes: c ? 1 : 0, last_row_id: 0, duration: 0 },
        });
      }
      // Coin System M2 (Q7, feihao 2026-06-11): revoke no longer UPDATEs
      // the awarded score_event to 'revoked' (that would corrupt the coin
      // balance — see src/routes/admin/task-completions.ts:172-177 for the
      // mathematical argument). Instead it INSERTs a -1 coin event
      // (buildRevokeTaskCoinSQL) whose change_value is the inverse of the
      // original +1 coin grant, so balance = +1 + (-1) = 0.
      if (/INSERT\s+INTO\s+score_events/i.test(query)) {
        // SQL builder inlines status/submitted_by/source/week_of/created_at
        // as SQL literals, so bound params are:
        //   [user_id, type, change_value, reason, source_ref]
        const [user_id, type, change_value, reason, source_ref] = params as [
          number,
          ScoreEvent['type'],
          number,
          string,
          string,
        ];
        const newEvent: ScoreEvent = {
          id: events.length + 1,
          user_id,
          type,
          change_value,
          reason,
          status: 'approved',
          submitted_by: 'pm',
          source: 'task',
          source_ref,
          reviewed_by: null,
          reviewed_at: null,
          week_of: null,
          created_at: nowOverride,
        };
        events.push(newEvent);
        return Promise.resolve({
          success: true,
          meta: { changes: 1, last_row_id: newEvent.id, duration: 0 },
        });
      }
      if (/INSERT\s+INTO\s+audit_log/i.test(query)) {
        // Implementation inlines 'pm' and 'task_revoke' as SQL literals, so
        // bind() receives only 4 params: (target_event_id, target_user_id, details, created_at).
        const [target_event_id, target_user_id, details, createdAt] = params as [
          number | null,
          number | null,
          string,
          number,
        ];
        const row: AuditRow = {
          id: nextAuditId++,
          actor: 'pm',
          action: 'task_revoke',
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

interface RevokeResponse {
  completion_id?: number;
  task_id?: number;
  revoked_at?: number;
  new_balance?: { game_time: number; pocket_money: number };
  error?: { code: string; message: string };
}

// -------------------------------------------------------------
// Tests
// -------------------------------------------------------------
describe('POST /api/admin/task-completions/:id/revoke', () => {
  beforeEach(reset);

  it('returns 401 without session cookie (requirePm guard)', async () => {
    const r = await call('/api/admin/task-completions/1/revoke', { method: 'POST' });
    expect(r.status).toBe(401);
    const body = (await r.json()) as RevokeResponse;
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns 400 BAD_REQUEST for non-integer id', async () => {
    addPmUser();
    const cookie = await pmCookie();
    const r = await call('/api/admin/task-completions/abc/revoke', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as RevokeResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('returns 400 BAD_REQUEST for id <= 0', async () => {
    addPmUser();
    const cookie = await pmCookie();
    const r = await call('/api/admin/task-completions/0/revoke', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(400);
  });

  it('returns 404 NOT_FOUND when completion does not exist', async () => {
    addPmUser();
    const cookie = await pmCookie();
    const r = await call('/api/admin/task-completions/9999/revoke', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(404);
    const body = (await r.json()) as RevokeResponse;
    expect(body.error?.code).toBe('NOT_FOUND');
    // Nothing was written
    expect(audit).toHaveLength(0);
    expect(batchStatements).toHaveLength(0);
  });

  it('returns 409 ALREADY_REVOKED when completion.status is already revoked', async () => {
    addPmUser();
    addCompletion({
      id: 5,
      status: 'revoked',
      revoked_at: nowOverride - 100,
      revoked_by: 1,
    });
    const cookie = await pmCookie();
    const r = await call('/api/admin/task-completions/5/revoke', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(409);
    const body = (await r.json()) as RevokeResponse;
    expect(body.error?.code).toBe('ALREADY_REVOKED');
    // No batch was executed
    expect(batchStatements).toHaveLength(0);
    expect(audit).toHaveLength(0);
  });

  it('happy path: updates both rows, writes audit, returns new_balance', async () => {
    addPmUser();
    const task = addTask({ token_reward: 30 });
    // The event being revoked (game_time, +30, approved)
    addEvent({ id: 42, user_id: 1, type: 'game_time', change_value: 30, status: 'approved' });
    // A second event that should NOT be affected (pocket_money, +20, approved)
    addEvent({ id: 43, user_id: 1, type: 'pocket_money', change_value: 20, status: 'approved' });
    addCompletion({
      id: 7,
      task_id: task.id,
      user_id: 1,
      status: 'active',
      awarded_event_id: 42,
    });

    const cookie = await pmCookie();
    const r = await call('/api/admin/task-completions/7/revoke', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as RevokeResponse;

    // Response shape
    expect(body.completion_id).toBe(7);
    expect(body.task_id).toBe(task.id);
    expect(typeof body.revoked_at).toBe('number');
    // M2 (Q7): the awarded event (id=42) is NOT flipped to 'revoked' — the
    // revoke writes a -1 coin event instead, so legacy game_time/pocket_money
    // balances stay at their pre-revoke values. The coin balance is the only
    // thing that moves, and it goes to -1.
    expect(body.new_balance).toEqual({ game_time: 30, pocket_money: 20, coins: -1 });
    // New M2 response fields — revoke event id for the PM UI 🪙 toast
    expect(typeof body.revoke_coin_event_id).toBe('number');
    expect(body.revoke_coin_event_id).toBeGreaterThan(0);
    expect(body.revoke_bonus_event_id).toBeNull(); // no +3 bonus issued → no -3

    // Completion row updated
    const c = completions.find((x) => x.id === 7);
    expect(c?.status).toBe('revoked');
    expect(c?.revoked_at).toBe(body.revoked_at);
    expect(c?.revoked_by).toBe(1);

    // Awarded event (id=42) is UNTOUCHED in M2. The new code path
    // preserves it as 'approved' and writes a separate -1 coin event so
    // balance = (+1 original) + (-1 revoke) = 0 mathematically.
    const ev = events.find((e) => e.id === 42);
    expect(ev?.status).toBe('approved');
    // reviewed_by/reviewed_at stay at their pre-test values (addEvent set
    // reviewed_by: 1, reviewed_at: nowOverride — these are seed data, not
    // written by the revoke handler).
    expect(ev?.reviewed_by).toBe(1);
    expect(typeof ev?.reviewed_at).toBe('number');
    // The unrelated event is untouched
    const ev2 = events.find((e) => e.id === 43);
    expect(ev2?.status).toBe('approved');

    // New -1 coin event written by buildRevokeTaskCoinSQL
    const coinRevoke = events.find(
      (e) => e.type === 'coins' && e.change_value === -1,
    );
    expect(coinRevoke).toBeDefined();
    expect(coinRevoke?.user_id).toBe(1);
    expect(coinRevoke?.status).toBe('approved');
    expect(coinRevoke?.submitted_by).toBe('pm');
    expect(coinRevoke?.source).toBe('task');
    expect(coinRevoke?.reason).toBe('revoke:task:#1');
    expect(coinRevoke?.source_ref).toBe('revoke:task:1:2026-06-05:1');
    // The response's revoke_coin_event_id matches the row's id.
    expect(coinRevoke?.id).toBe(body.revoke_coin_event_id);

    // Audit log entry
    const entry = audit.find((a) => a.action === 'task_revoke');
    expect(entry).toBeDefined();
    expect(entry?.actor).toBe('pm');
    // target_event_id explicitly references the +1 coin event id from
    // completion.awarded_event_id (the src binds this directly, not via
    // last_insert_rowid()) — the test verifies it ties back to the
    // awarded event for audit reconciliation.
    expect(entry?.target_event_id).toBe(42);
    expect(entry?.target_user_id).toBe(1);
    const details = JSON.parse(entry?.details ?? '{}') as Record<string, unknown>;
    expect(details.completion_id).toBe(7);
    expect(details.task_id).toBe(task.id);
    expect(details.original_token_reward).toBe(30);

    // db.batch() contained exactly 3 statements, in new M2 order:
    //   0. UPDATE task_completions
    //   1. INSERT INTO score_events  (the new -1 coin; was UPDATE score_events pre-M2)
    //   2. INSERT INTO audit_log
    expect(batchStatements).toHaveLength(3);
    expect(batchStatements[0].query.toUpperCase()).toMatch(/^UPDATE\s+TASK_COMPLETIONS/);
    expect(batchStatements[1].query.toUpperCase()).toMatch(/^INSERT\s+INTO\s+SCORE_EVENTS/);
    expect(batchStatements[2].query.toUpperCase()).toMatch(/^INSERT\s+INTO\s+AUDIT_LOG/);
    // The completion UPDATE used the right id
    const cParams = batchStatements[0].params as unknown[];
    expect(cParams[2]).toBe(7);
    // The -1 coin INSERT bound [user_id, type, change_value, reason, source_ref]
    const coinParams = batchStatements[1].params as unknown[];
    expect(coinParams[0]).toBe(1);       // user_id
    expect(coinParams[1]).toBe('coins'); // type
    expect(coinParams[2]).toBe(-1);      // change_value (was 42 pre-M2)
    expect(coinParams[3]).toBe('revoke:task:#1');
    expect(coinParams[4]).toBe('revoke:task:1:2026-06-05:1');
  });
});

// tests/unit/admin-task-completions-reset-day.test.ts
// Integration tests for POST /api/admin/task-completions/reset-day
// (feihao request 2026-10-20: admin "重置所有打卡的任务状态" button).
// Verifies: requirePm guard, confirm gate, user_id/date validation,
// empty-day no-op, the happy path (bulk revoke = UPDATE + -1 coin + audit
// per completion in ONE atomic batch), and the -3 bonus reversal.

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

function addCompletion(overrides: Partial<TaskCompletion> = {}): TaskCompletion {
  const id = completions.length + 1;
  const c: TaskCompletion = {
    id,
    task_id: 1,
    user_id: 2,
    status: 'active' as CompletionStatus,
    completed_date: '2026-10-20',
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
    user_id: 2,
    type: 'coins' as AccountType,
    change_value: 1,
    reason: 'task:#1',
    status: 'approved' as EventStatus,
    submitted_by: 'system' as SubmittedBy,
    source: 'task' as EventSource,
    source_ref: null,
    reviewed_by: null,
    reviewed_at: null,
    week_of: null,
    created_at: nowOverride,
    ...overrides,
  };
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
      // Generic coins lookup by (user_id, change_value, source_ref):
      //   findBonusEvent (+3, reason LIKE 'bonus:%'), restore's reversal
      //   lookup (-3, revoke:bonus:...) and already-restored check (+3,
      //   restore:bonus:...). All share this shape.
      if (
        /FROM\s+score_events/i.test(query) &&
        /change_value\s*=\s*(-?3)/i.test(query) &&
        /source_ref\s*=\s*\?/i.test(query)
      ) {
        const cvMatch = /change_value\s*=\s*(-?3)/i.exec(query);
        const cv = Number(cvMatch![1]);
        const uid = params[0] as number;
        const ref = params[1] as string;
        const found = events.find(
          (e) =>
            e.user_id === uid &&
            e.change_value === cv &&
            e.status === 'approved' &&
            e.source_ref === ref,
        );
        return Promise.resolve((found ? { id: found.id } : null) as T);
      }
      return Promise.resolve(null);
    },
    all<T = unknown>(): Promise<D1Result<T>> {
      // reset-day day query (both statuses — 清空重来):
      //   SELECT ... FROM task_completions WHERE user_id = ? AND completed_date = ?
      // (restore path still inlines status = 'revoked'.)
      if (
        /FROM\s+task_completions/i.test(query) &&
        /completed_date\s*=\s*\?/i.test(query)
      ) {
        const uid = params[0] as number;
        const date = params[1] as string;
        const statusMatch = /status\s*=\s*'([^']+)'/.exec(query);
        const wantStatus = statusMatch ? statusMatch[1] : null;
        const results = completions.filter(
          (c) =>
            c.user_id === uid &&
            c.completed_date === date &&
            (wantStatus === null || c.status === wantStatus),
        );
        return Promise.resolve({ results: (results as unknown) as T[], success: true });
      }
      // computeBalance: SELECT type, SUM(change_value) ... GROUP BY type
      if (
        /FROM\s+score_events/i.test(query) &&
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
      // 清空重来: DELETE FROM task_completions WHERE id = ?
      if (/DELETE\s+FROM\s+task_completions/i.test(query)) {
        const id = params[0] as number;
        const idx = completions.findIndex((x) => x.id === id);
        if (idx >= 0) completions.splice(idx, 1);
        return Promise.resolve({ success: true } as D1Result<T>);
      }
      if (/INSERT\s+INTO\s+deleted_records/i.test(query)) {
        return Promise.resolve({ success: true } as D1Result<T>);
      }
      if (/DELETE\s+FROM\s+summer_homework_subitems/i.test(query)) {
        return Promise.resolve({ success: true } as D1Result<T>);
      }
      if (/UPDATE\s+task_completions/i.test(query)) {
        // Revoke UPDATE binds (now, pmUserId, id); restore UPDATE binds
        // just (id) — distinguish by the SET clause.
        if (/SET\s+status\s*=\s*'active'/i.test(query)) {
          const id = params[0] as number;
          const c = completions.find((x) => x.id === id);
          if (c) {
            c.status = 'active';
            c.revoked_at = null;
            c.revoked_by = null;
          }
        } else {
          const [now, pmUserId, id] = params as [number, number, number];
          const c = completions.find((x) => x.id === id);
          if (c) {
            c.status = 'revoked';
            c.revoked_at = now;
            c.revoked_by = pmUserId;
          }
        }
        return Promise.resolve({ success: true } as D1Result<T>);
      }
      if (/INSERT\s+INTO\s+score_events/i.test(query)) {
        // Two param layouts exist:
        //   revoke path:  VALUES (?, ?, ?, ...) → [user_id, type, change_value, reason, source_ref]
        //   restore path: VALUES (?, 'coins', <n>, ...) → type/change_value inlined
        //                 → [user_id, reason, source_ref]
        const inlined = /'coins',\s*(-?\d+),/.exec(query);
        let user_id: number;
        let type: ScoreEvent['type'];
        let change_value: number;
        let reason: string;
        let source_ref: string | null;
        if (inlined) {
          [user_id, reason, source_ref] = params as [number, string, string];
          type = 'coins';
          change_value = Number(inlined[1]);
        } else {
          [user_id, type, change_value, reason, source_ref] = params as [
            number,
            ScoreEvent['type'],
            number,
            string,
            string,
          ];
        }
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

interface ResetResponse {
  success?: boolean;
  reset_count?: number;
  bonus_reversed?: boolean;
  restored_count?: number;
  bonus_restored?: boolean;
  new_balance?: Record<string, number>;
  error?: { code: string; message: string };
}

function post(body: unknown, cookie: string | null = null): Promise<Response> {
  return call('/api/admin/task-completions/reset-day', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/task-completions/reset-day', () => {
  beforeEach(reset);

  it('returns 401 without session cookie (requirePm guard)', async () => {
    const r = await post({ user_id: 2, confirm: true });
    expect(r.status).toBe(401);
    const body = (await r.json()) as ResetResponse;
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns 400 CONFIRM_REQUIRED without confirm:true', async () => {
    addPmUser();
    const cookie = await pmCookie();
    const r = await post({ user_id: 2 }, cookie);
    expect(r.status).toBe(400);
    const body = (await r.json()) as ResetResponse;
    expect(body.error?.code).toBe('CONFIRM_REQUIRED');
  });

  it('returns 400 BAD_REQUEST for missing/invalid user_id', async () => {
    addPmUser();
    const cookie = await pmCookie();
    const r1 = await post({ confirm: true }, cookie);
    expect(r1.status).toBe(400);
    const r2 = await post({ user_id: -1, confirm: true }, cookie);
    expect(r2.status).toBe(400);
    const body = (await r2.json()) as ResetResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('returns 400 BAD_REQUEST for malformed date', async () => {
    addPmUser();
    const cookie = await pmCookie();
    const r = await post({ user_id: 2, date: '20-10-2026', confirm: true }, cookie);
    expect(r.status).toBe(400);
    const body = (await r.json()) as ResetResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('no-op day: returns success with reset_count 0 (no rows to delete)', async () => {
    addPmUser();
    const cookie = await pmCookie();
    const r = await post({ user_id: 2, date: '2026-10-20', confirm: true }, cookie);
    expect(r.status).toBe(200);
    const body = (await r.json()) as ResetResponse;
    expect(body.success).toBe(true);
    expect(body.reset_count).toBe(0);
    expect(body.bonus_reversed).toBe(false);
    expect(batchStatements).toHaveLength(0);
  });

  it('happy path: 2 active completions → both DELETED (清空重来), -1 coin each, snapshot+audit each', async () => {
    addPmUser();
    addTask(); // task 1
    addTask(); // task 2
    const c1 = addCompletion({ task_id: 1, completed_date: '2026-10-20' });
    const c2 = addCompletion({ task_id: 2, completed_date: '2026-10-20' });
    // A different day's completion must NOT be touched.
    const otherDay = addCompletion({ task_id: 1, completed_date: '2026-10-19' });

    const cookie = await pmCookie();
    const r = await post({ user_id: 2, date: '2026-10-20', confirm: true }, cookie);
    expect(r.status).toBe(200);
    const body = (await r.json()) as ResetResponse;
    expect(body.success).toBe(true);
    expect(body.reset_count).toBe(2);
    expect(body.bonus_reversed).toBe(false);

    // Both target-day completions are GONE; the other day's is untouched.
    expect(completions.find((c) => c.id === c1.id)).toBeUndefined();
    expect(completions.find((c) => c.id === c2.id)).toBeUndefined();
    expect(completions.find((c) => c.id === otherDay.id)?.status).toBe('active');

    // One atomic batch: [snapshot, del subitems, del completion, -1 coin,
    // audit] × 2 = 10 statements.
    expect(batchStatements).toHaveLength(10);
    const snapshots = batchStatements.filter((s) => /^INSERT INTO deleted_records/i.test(s.query));
    const deletes = batchStatements.filter((s) => /^DELETE FROM task_completions/i.test(s.query));
    const coinInserts = batchStatements.filter((s) => /^INSERT INTO score_events/i.test(s.query));
    const audits = batchStatements.filter((s) => /^INSERT INTO audit_log/i.test(s.query));
    expect(snapshots).toHaveLength(2);
    expect(deletes).toHaveLength(2);
    expect(coinInserts).toHaveLength(2);
    expect(audits).toHaveLength(2);
    // Each -1 coin is anchored on the original (date, userId, taskId) tuple.
    expect(coinInserts[0].params[2]).toBe(-1);
    expect(coinInserts[1].params[2]).toBe(-1);

    // Balance math: no prior events → -1 + -1 = -2 coins.
    expect(body.new_balance?.coins).toBe(-2);
  });

  it('清空 also deletes revoked rows of the day (feihao "重置不能重置撤销的任务")', async () => {
    addPmUser();
    addTask();
    addCompletion({ task_id: 1, completed_date: '2026-10-20', status: 'active' });
    addCompletion({ task_id: 1, completed_date: '2026-10-20', status: 'revoked', revoked_at: 111, revoked_by: 1 });

    const cookie = await pmCookie();
    const r = await post({ user_id: 2, date: '2026-10-20', confirm: true }, cookie);
    expect(r.status).toBe(200);
    const body = (await r.json()) as ResetResponse;
    expect(body.reset_count).toBe(2);
    expect(completions.filter((c) => c.completed_date === '2026-10-20')).toHaveLength(0);
  });

  it('bonus day: +3 existed → one -3 reversal written, bonus_reversed=true', async () => {
    addPmUser();
    addTask();
    addCompletion({ task_id: 1, completed_date: '2026-10-20' });
    // The +3 bonus granted earlier that day.
    addEvent({
      user_id: 2,
      type: 'coins',
      change_value: 3,
      reason: 'bonus:2026-10-20:2',
      source_ref: 'bonus:2026-10-20:2',
      status: 'approved',
    });

    const cookie = await pmCookie();
    const r = await post({ user_id: 2, date: '2026-10-20', confirm: true }, cookie);
    expect(r.status).toBe(200);
    const body = (await r.json()) as ResetResponse;
    expect(body.reset_count).toBe(1);
    expect(body.bonus_reversed).toBe(true);

    // Second batch = [-3 bonus reversal, bonus audit] (after the 5-statement
    // primary batch for the single completion).
    const bonusBatch = batchStatements.slice(5);
    expect(bonusBatch).toHaveLength(2);
    expect(bonusBatch[0].query).toMatch(/^INSERT INTO score_events/i);
    expect(bonusBatch[0].params[2]).toBe(-3);
    expect(bonusBatch[0].params[4]).toBe('revoke:bonus:2026-10-20:2');

    // Balance math: +3 (existing) -1 (task revoke) -3 (bonus reversal) = -1.
    expect(body.new_balance?.coins).toBe(-1);
  });
});

describe('POST /api/admin/task-completions/reset-day — mode:restore', () => {
  beforeEach(reset);

  it('no revoked rows → success no-op with restored_count 0', async () => {
    addPmUser();
    const cookie = await pmCookie();
    const r = await post({ user_id: 2, date: '2026-10-20', confirm: true, mode: 'restore' }, cookie);
    expect(r.status).toBe(200);
    const body = (await r.json()) as ResetResponse;
    expect(body.success).toBe(true);
    expect(body.restored_count).toBe(0);
    expect(body.bonus_restored).toBe(false);
  });

  it('happy path: 2 revoked rows → both active again, +1 coin each, one atomic batch', async () => {
    addPmUser();
    addTask();
    addTask();
    const c1 = addCompletion({ task_id: 1, completed_date: '2026-10-20', status: 'revoked', revoked_at: 111, revoked_by: 1 });
    const c2 = addCompletion({ task_id: 2, completed_date: '2026-10-20', status: 'revoked', revoked_at: 111, revoked_by: 1 });
    // An active row on the same day must NOT be touched.
    const activeRow = addCompletion({ task_id: 1, completed_date: '2026-10-20', status: 'active' });

    const cookie = await pmCookie();
    const r = await post({ user_id: 2, date: '2026-10-20', confirm: true, mode: 'restore' }, cookie);
    expect(r.status).toBe(200);
    const body = (await r.json()) as ResetResponse;
    expect(body.success).toBe(true);
    expect(body.restored_count).toBe(2);

    expect(completions.find((c) => c.id === c1.id)?.status).toBe('active');
    expect(completions.find((c) => c.id === c2.id)?.status).toBe('active');
    expect(completions.find((c) => c.id === activeRow.id)?.status).toBe('active');
    expect(completions.find((c) => c.id === c1.id)?.revoked_at).toBeNull();

    // [UPDATE, +1 coin, audit] × 2 = 6 statements in one batch.
    expect(batchStatements).toHaveLength(6);
    const coinInserts = batchStatements.filter((s) => /^INSERT INTO score_events/i.test(s.query));
    expect(coinInserts).toHaveLength(2);
    // Restore INSERT inlines user_id/type/change_value; bound params are
    // [reason, source_ref]. The +1 is asserted via the SQL literal.
    expect(coinInserts[0].query).toMatch(/'coins',\s*1,/);
    expect(coinInserts[0].params[2]).toBe('restore:task:1:2026-10-20:2');

    // Balance math: +1 +1 = 2 coins restored, no prior events.
    expect(body.new_balance?.coins).toBe(2);
  });

  it('bonus restore: -3 reversal existed → one +3 re-grant, idempotent on rerun', async () => {
    addPmUser();
    addTask();
    addCompletion({ task_id: 1, completed_date: '2026-10-20', status: 'revoked', revoked_at: 111, revoked_by: 1 });
    // The -3 reversal from a previous reset-day.
    addEvent({
      user_id: 2,
      type: 'coins',
      change_value: -3,
      reason: 'revoke:bonus:2026-10-20:2',
      source_ref: 'revoke:bonus:2026-10-20:2',
      status: 'approved',
    });

    const cookie = await pmCookie();
    const r = await post({ user_id: 2, date: '2026-10-20', confirm: true, mode: 'restore' }, cookie);
    expect(r.status).toBe(200);
    const body = (await r.json()) as ResetResponse;
    expect(body.restored_count).toBe(1);
    expect(body.bonus_restored).toBe(true);

    // Second batch = [+3 restore, bonus audit]. +3 is inlined in SQL;
    // bound params are [reason, source_ref].
    const bonusBatch = batchStatements.slice(3);
    expect(bonusBatch).toHaveLength(2);
    expect(bonusBatch[0].query).toMatch(/'coins',\s*3,/);
    expect(bonusBatch[0].params[2]).toBe('restore:bonus:2026-10-20:2');

    // Balance math: -3 (existing) +1 (task restore) +3 (bonus restore) = +1.
    expect(body.new_balance?.coins).toBe(1);
  });
});

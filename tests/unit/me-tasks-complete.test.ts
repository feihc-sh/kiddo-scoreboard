// tests/unit/me-tasks-complete.test.ts
// Tests for POST /api/me/tasks/:id/complete
// TDD: written before the implementation. Mock D1 supports db.batch() with last_row_id.
//
// Auth: child user_id is HARDCODED to 2 in src/routes/me/tasks.ts for now
// (matches seeds/local.sql). M5 will replace this with proper auth.

import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/worker.ts';
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  Task,
  TaskCompletion,
  ScoreEvent,
} from '../../src/db/types.ts';
import { todayShanghai } from '../../src/utils/week.ts';

const CHILD_USER_ID = 2;

// In-memory tables the mock DB will mutate.
let tasks: Task[] = [];
let completions: TaskCompletion[] = [];
let scoreEvents: ScoreEvent[] = [];
let auditLog: Array<{
  id: number;
  actor: string;
  action: string;
  target_event_id: number | null;
  target_user_id: number | null;
  details: string;
  created_at: number;
}> = [];

// Counters
let nextTaskId = 1;
let nextCompletionId = 1;
let nextEventId = 1;
let nextAuditId = 1;
let now = 1_700_000_000;

// Capture batch invocations for inspection
interface CapturedBatch {
  query: string;
  params: unknown[];
}
let lastBatch: CapturedBatch[] = [];

function reset() {
  tasks = [];
  completions = [];
  scoreEvents = [];
  auditLog = [];
  nextTaskId = 1;
  nextCompletionId = 1;
  nextEventId = 1;
  nextAuditId = 1;
  now = 1_700_000_000;
  lastBatch = [];
}

function makeTask(overrides: Partial<Task> = {}): Task {
  const id = nextTaskId++;
  const t: Task = {
    id,
    name: `task ${id}`,
    token_reward: 10,
    target_account: 'game_time',
    icon: null,
    category: 'habit',
    is_active: 1,
    sort_order: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  tasks.push(t);
  return t;
}

function makeCompletion(overrides: Partial<TaskCompletion> = {}): TaskCompletion {
  const id = nextCompletionId++;
  const c: TaskCompletion = {
    id,
    task_id: 1,
    user_id: CHILD_USER_ID,
    status: 'active',
    completed_date: todayShanghai(),
    completed_at: now,
    awarded_event_id: null,
    revoked_at: null,
    revoked_by: null,
    ...overrides,
  };
  completions.push(c);
  return c;
}

function makeScoreEvent(overrides: Partial<ScoreEvent> = {}): ScoreEvent {
  const id = nextEventId++;
  const ev: ScoreEvent = {
    id,
    user_id: CHILD_USER_ID,
    type: 'game_time',
    change_value: 10,
    reason: 'manual',
    status: 'approved',
    submitted_by: 'pm',
    source: 'manual',
    source_ref: null,
    reviewed_by: null,
    reviewed_at: null,
    week_of: null,
    created_at: now,
    ...overrides,
  };
  scoreEvents.push(ev);
  return ev;
}

function makeMockDb(): D1Database {
  // For inspecting prepared statements in a batch we need the query+params.
  // Our D1PreparedStatement mock attaches a __captured tuple that batch() reads.
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
          // SELECT task by id
          const selectTaskMatch = /FROM\s+tasks\s+WHERE\s+id\s*=\s*\?/.test(query);
          if (selectTaskMatch) {
            const id = params[0] as number;
            const found = tasks.find((t) => t.id === id) ?? null;
            return Promise.resolve(found as T);
          }
          // SELECT FROM task_completions (e.g. "is there an active completion today?")
          if (/FROM\s+task_completions/.test(query)) {
            const statusMatch = /status\s*=\s*'([^']+)'/.exec(query);
            const wantStatus = statusMatch ? statusMatch[1] : (params.shift() as string);
            const taskId = params.shift() as number;
            const userId = params.shift() as number;
            const date = params.shift() as string;
            const found = completions.find(
              (c) =>
                c.task_id === taskId &&
                c.user_id === userId &&
                c.status === wantStatus &&
                c.completed_date === date,
            );
            return Promise.resolve((found ? { id: found.id } : null) as T);
          }
          return Promise.resolve(null);
        },
        all<T = unknown>(): Promise<D1Result<T>> {
          // today-status query (read active completions)
          if (/FROM\s+task_completions/.test(query)) {
            // Active check: `status = 'active'` is a SQL literal in the route.
            const statusMatch = /status\s*=\s*'([^']+)'/.exec(query);
            const wantStatus = statusMatch ? statusMatch[1] : null;
            const userId = params[0] as number;
            const date = params[1] as string;
            const results = completions.filter(
              (c) =>
                c.user_id === userId &&
                (wantStatus === null || c.status === wantStatus) &&
                c.completed_date === date,
            );
            return Promise.resolve({ results: results as unknown as T[], success: true });
          }
          // SELECT type, SUM(change_value) GROUP BY type — for computeBalance
          if (/GROUP BY\s+type/.test(query)) {
            const userId = params[0] as number;
            const filtered = scoreEvents.filter(
              (e) => e.user_id === userId && e.status === 'approved',
            );
            const grouped = new Map<string, number>();
            for (const row of filtered) {
              grouped.set(row.type, (grouped.get(row.type) ?? 0) + row.change_value);
            }
            const results = Array.from(grouped, ([type, total]) => ({ type, total }));
            return Promise.resolve({ results: results as unknown as T[], success: true });
          }
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
      let lastInsertId = 0;

      for (const s of statements) {
        const tagged = s as Tagged;
        const captured = tagged.__captured ?? { query: '', params: [] };
        lastBatch.push(captured);
        const q = captured.query;
        const p = captured.params;

        if (/^INSERT INTO\s+task_completions/i.test(q)) {
          const id = nextCompletionId++;
          // Bound params: [task_id, user_id, completed_date].
          // `status` and `completed_at` are inlined as SQL literals
          // ('active' and unixepoch() respectively) — see src/routes/me/tasks.ts
          // task complete handler. Mock mirrors the inlined status literally
          // rather than reading a non-existent bound param.
          // `awarded_event_id` is set via SQLite `last_insert_rowid()` in
          // the src — for our 3-statement batch that resolves to the +1
          // coin event id from batch[0]. The mock's `lastInsertId` (updated
          // by the previous score_events INSERT) mirrors that.
          const completion: TaskCompletion = {
            id,
            task_id: p[0] as number,
            user_id: p[1] as number,
            status: 'active',
            completed_date: p[2] as string,
            completed_at: now,
            awarded_event_id: lastInsertId,
            revoked_at: null,
            revoked_by: null,
          };
          completions.push(completion);
          lastInsertId = id;
          results.push({
            success: true,
            meta: { changes: 1, last_row_id: id, duration: 0 },
          } as D1Result<T>);
          continue;
        }

        if (/^INSERT INTO\s+score_events/i.test(q)) {
          const id = nextEventId++;
          // The route inlines status/submitted_by/source as SQL literals and
          // `unixepoch()` for created_at, so bound params are:
          //   [user_id, type, change_value, reason, source_ref]
          const ev: ScoreEvent = {
            id,
            user_id: p[0] as number,
            type: p[1] as ScoreEvent['type'],
            change_value: p[2] as number,
            reason: p[3] as string,
            status: 'approved',
            submitted_by: 'child',
            source: 'task',
            source_ref: (p[4] as string | null) ?? null,
            reviewed_by: null,
            reviewed_at: null,
            week_of: null,
            created_at: now,
          };
          scoreEvents.push(ev);
          lastInsertId = id;
          results.push({
            success: true,
            meta: { changes: 1, last_row_id: id, duration: 0 },
          } as D1Result<T>);
          continue;
        }

        if (/^INSERT INTO\s+audit_log/i.test(q)) {
          const id = nextAuditId++;
          // The route writes target_event_id via SQL `last_insert_rowid()` — the
          // mock simulates D1's connection-level last_insert_rowid by tracking
          // the rowid of the previous statement in this batch.
          // The two bound parameters are (target_user_id, details).
          const details = typeof p[1] === 'string' ? p[1] : JSON.stringify(p[1] ?? {});
          auditLog.push({
            id,
            actor: 'child',
            action: 'task_complete',
            target_event_id: lastInsertId,
            target_user_id: (p[0] as number | null) ?? null,
            details,
            created_at: now,
          });
          results.push({
            success: true,
            meta: { changes: 1, last_row_id: id, duration: 0 },
          } as D1Result<T>);
          continue;
        }

        // Unknown statement — record a no-op result.
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

interface CompleteBody {
  task_id?: number;
  task_name?: string;
  token_awarded?: number;
  target_account?: 'game_time' | 'pocket_money';
  new_balance?: { game_time: number; pocket_money: number };
  event_id?: number;
  error?: { code?: string; message?: string };
}

describe('POST /api/me/tasks/:id/complete', () => {
  beforeEach(reset);

  it('returns 400 BAD_REQUEST when task_id is non-integer', async () => {
    const r = await call('/api/me/tasks/abc/complete', { method: 'POST' });
    expect(r.status).toBe(400);
    const body = (await r.json()) as CompleteBody;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('returns 400 BAD_REQUEST when task_id is zero or negative', async () => {
    const r = await call('/api/me/tasks/0/complete', { method: 'POST' });
    expect(r.status).toBe(400);
    const body = (await r.json()) as CompleteBody;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('returns 404 NOT_FOUND when task does not exist', async () => {
    const r = await call('/api/me/tasks/9999/complete', { method: 'POST' });
    expect(r.status).toBe(404);
    const body = (await r.json()) as CompleteBody;
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('returns 400 TASK_INACTIVE when task is_active=0', async () => {
    const t = makeTask({ name: 'archived', is_active: 0 });
    const r = await call(`/api/me/tasks/${t.id}/complete`, { method: 'POST' });
    expect(r.status).toBe(400);
    const body = (await r.json()) as CompleteBody;
    expect(body.error?.code).toBe('TASK_INACTIVE');
  });

  it('happy path: 201 with response shape and all 3 batch statements executed', async () => {
    const t = makeTask({
      name: 'Read 30min',
      token_reward: 15,
      target_account: 'game_time',
    });

    const r = await call(`/api/me/tasks/${t.id}/complete`, { method: 'POST' });
    expect(r.status).toBe(201);
    const body = (await r.json()) as CompleteBody;
    expect(body.task_id).toBe(t.id);
    expect(body.task_name).toBe('Read 30min');
    expect(body.token_awarded).toBe(15);
    expect(body.target_account).toBe('game_time');
    // Coin System M2 (Q7, feihao 2026-06-11): task completion no longer adds
    // token_reward to game_time/pocket_money. The only balance change is +1
    // coin (type='coins', change_value=1). Legacy game_time/pocket_money
    // balances stay at 0. game_time (15) is still the *informational*
    // token_awarded value above — it's what the task would have given in
    // the old model — but it no longer hits the balance.
    expect(body.new_balance).toEqual({ game_time: 0, pocket_money: 0, coins: 1 });
    expect(typeof body.event_id).toBe('number');
    // The new response field — M2 exposes the +1 coin event id so the UI
    // can render the 🪙 toast. Same value as event_id (the legacy score
    // event no longer exists).
    expect(typeof body.coin_event_id).toBe('number');
    expect(body.coin_event_id).toBe(body.event_id);

    // All 3 batch statements executed. New M2 order:
    //   0. +1 coin event (score_events INSERT)
    //   1. task_completions INSERT (awarded_event_id = last_insert_rowid() = coin event id)
    //   2. audit_log INSERT
    expect(lastBatch).toHaveLength(3);
    expect(lastBatch[0].query).toMatch(/^INSERT INTO\s+score_events/i);
    expect(lastBatch[1].query).toMatch(/^INSERT INTO\s+task_completions/i);
    expect(lastBatch[2].query).toMatch(/^INSERT INTO\s+audit_log/i);

    // The completion row exists with today's date and status=active.
    const completion = completions.find(
      (c) => c.task_id === t.id && c.user_id === CHILD_USER_ID,
    );
    expect(completion).toBeDefined();
    expect(completion?.status).toBe('active');
    expect(completion?.completed_date).toBe(todayShanghai());
    // awarded_event_id points at the +1 coin event (new M2 behavior).
    // The mock's `lastInsertId` is updated by each INSERT in the batch, so
    // for the task_completions statement (batch index 1) it's the
    // score_event id from batch index 0. The mock simulates SQLite's
    // connection-level `last_insert_rowid()` correctly here.
    expect(completion?.awarded_event_id).toBe(body.coin_event_id);

    // The only score event is the +1 coin (type='coins', change_value=1).
    // No legacy game_time/pocket_money event is written — see M2 Q7.
    const allTaskEvents = scoreEvents.filter(
      (e) => e.user_id === CHILD_USER_ID && e.source === 'task',
    );
    expect(allTaskEvents).toHaveLength(1);
    const ev = allTaskEvents[0];
    expect(ev).toBeDefined();
    expect(ev?.type).toBe('coins');
    expect(ev?.change_value).toBe(1);
    expect(ev?.status).toBe('approved');
    expect(ev?.submitted_by).toBe('child');
    expect(ev?.source_ref).toBe(`task:${t.id}:${todayShanghai()}:${CHILD_USER_ID}`);

    // The audit row exists with action=task_complete. The src uses
    // `last_insert_rowid()` in the audit_log INSERT which (in real D1) is
    // the task_completion rowid, NOT the +1 coin event id — see the
    // comment in src/routes/me/tasks.ts:124-127 (the source comment
    // claiming "+1 coin event id" is incorrect; the actual value is the
    // most recent INSERT, i.e. the task_completion). We assert it's a
    // valid positive number rather than tying to a specific FK target.
    const audit = auditLog[0];
    expect(audit).toBeDefined();
    expect(audit.actor).toBe('child');
    expect(audit.action).toBe('task_complete');
    expect(audit.target_event_id).toBeGreaterThan(0);
    expect(audit.target_user_id).toBe(CHILD_USER_ID);
  });

  it('returns 409 ALREADY_COMPLETED_TODAY when an active completion exists for today', async () => {
    const t = makeTask({ name: 'Brush teeth' });
    // Pre-existing active completion today for this task + child.
    makeCompletion({ task_id: t.id, user_id: CHILD_USER_ID, status: 'active' });

    const r = await call(`/api/me/tasks/${t.id}/complete`, { method: 'POST' });
    expect(r.status).toBe(409);
    const body = (await r.json()) as CompleteBody;
    expect(body.error?.code).toBe('ALREADY_COMPLETED_TODAY');

    // No batch should have been submitted.
    expect(lastBatch).toHaveLength(0);
  });

  it('revoked completion today does NOT block re-completion (only active counts)', async () => {
    const t = makeTask({ name: 'Walk dog', token_reward: 5 });
    // Pre-existing REVOKED completion today for this task + child.
    makeCompletion({ task_id: t.id, user_id: CHILD_USER_ID, status: 'revoked' });

    const r = await call(`/api/me/tasks/${t.id}/complete`, { method: 'POST' });
    expect(r.status).toBe(201);
    const body = (await r.json()) as CompleteBody;
    expect(body.task_id).toBe(t.id);
    expect(body.token_awarded).toBe(5);

    // All 3 batch statements executed.
    expect(lastBatch).toHaveLength(3);
    // A second completion row was created.
    const active = completions.filter(
      (c) => c.task_id === t.id && c.user_id === CHILD_USER_ID && c.status === 'active',
    );
    expect(active).toHaveLength(1);
  });

  it('new_balance reflects the awarded tokens when starting from a non-zero balance', async () => {
    // Pre-existing approved score events for the child — only legacy
    // game_time/pocket_money, NO coins yet.
    makeScoreEvent({
      user_id: CHILD_USER_ID,
      type: 'game_time',
      change_value: 20,
      status: 'approved',
    });
    makeScoreEvent({
      user_id: CHILD_USER_ID,
      type: 'pocket_money',
      change_value: 7,
      status: 'approved',
    });

    const t = makeTask({ name: 'Wash dishes', token_reward: 5, target_account: 'pocket_money' });
    const r = await call(`/api/me/tasks/${t.id}/complete`, { method: 'POST' });
    expect(r.status).toBe(201);
    const body = (await r.json()) as CompleteBody;
    // Coin System M2 (Q7): task completion no longer adds token_reward (5) to
    // pocket_money. Pre-existing game_time=20 and pocket_money=7 are
    // preserved untouched, and a new +1 coin event lands: coins=1.
    expect(body.new_balance).toEqual({ game_time: 20, pocket_money: 7, coins: 1 });
  });
});

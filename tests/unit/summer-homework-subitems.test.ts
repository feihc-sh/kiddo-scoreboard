// tests/unit/summer-homework-subitems.test.ts
// Item #016 §5: 暑假作业 subitem persistence — POST /api/me/tasks/:id/complete
// with body { subitems: { <id>: 0|1 } }.
//
// REGRESSION GUARD for the ReferenceError that broke this endpoint:
// `rawSubitems` was declared with `let` INSIDE the
// `if (task.name === SUMMER_HOMEWORK_TASK_NAME)` block but read again in the
// subitems batch AFTER that block. `let` is block-scoped, so at runtime every
// 暑假作业 打卡 threw `ReferenceError: rawSubitems is not defined` and the
// endpoint returned HTTP 500 — the kid could never complete 暑假作业, and the
// admin dot matrix never received subitem rows.
// The fix hoists the declaration to the outer scope (see src/routes/me/tasks.ts).
//
// The mock-D1 pattern is copied from tests/unit/me-tasks-complete.test.ts.

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
const SUMMER_TASK_NAME = '每日完成暑假作业';

// The 6 hardcoded sub-items (mirror of SUMMER_HOMEWORK_ITEMS in public/app.js
// and SUMMER_HOMEWORK_SUBITEM_IDS in src/routes/me/tasks.ts).
const ALL_SUBITEM_IDS = [
  'chinese',
  'math-school',
  'english-vocab',
  'english-reading',
  'math-extra',
  'english-class',
] as const;

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
/** Rows captured from `INSERT OR IGNORE INTO summer_homework_subitems`. */
let subitemRows: Array<{ completionId: number; subitemId: string; checked: number }> = [];

let nextTaskId = 1;
let nextCompletionId = 1;
let nextEventId = 1;
let nextAuditId = 1;
let now = 1_700_000_000;

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
  subitemRows = [];
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
    token_reward: 1,
    target_account: 'pocket_money',
    icon: null,
    category: 'study',
    is_active: 1,
    sort_order: 0,
    cutoff_time: null,
    is_self_lockout: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  tasks.push(t);
  return t;
}

function makeScoreEvent(overrides: Partial<ScoreEvent> = {}): ScoreEvent {
  const id = nextEventId++;
  const ev: ScoreEvent = {
    id,
    user_id: CHILD_USER_ID,
    type: 'coins',
    change_value: 1,
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
          if (/FROM\s+tasks\s+WHERE\s+id\s*=\s*\?/.test(query)) {
            const id = params[0] as number;
            const found = tasks.find((t) => t.id === id) ?? null;
            return Promise.resolve(found as T);
          }
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
          if (/FROM\s+task_completions/.test(query)) {
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

        // --- summer_homework_subitems (batch 2) -----------------------------
        // `INSERT OR IGNORE INTO summer_homework_subitems
        //    (task_completion_id, subitem_id, checked) VALUES (?, ?, ?)`
        if (/INSERT OR IGNORE INTO\s+summer_homework_subitems/i.test(q)) {
          const completionId = p[0] as number;
          const subitemId = p[1] as string;
          const checked = p[2] as number;
          subitemRows.push({ completionId, subitemId, checked });
          lastInsertId = completionId;
          results.push({
            success: true,
            meta: { changes: 1, last_row_id: subitemRows.length, duration: 0 },
          } as D1Result<T>);
          continue;
        }

        if (/^INSERT INTO\s+task_completions/i.test(q)) {
          const id = nextCompletionId++;
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

/** POST helper that sends a JSON body the way public/app.js does. */
async function completeWithSubitems(
  taskId: number,
  subitems: Record<string, unknown>,
  env = envObj(),
) {
  return call(
    `/api/me/tasks/${taskId}/complete`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subitems }),
    },
    env,
  );
}

describe('Item #016 §5: 暑假作业 subitems persistence (regression: rawSubitems ReferenceError)', () => {
  beforeEach(reset);

  it('returns 201 (not 500) when completing 暑假作业 with a subitems payload', async () => {
    const t = makeTask({ name: SUMMER_TASK_NAME, token_reward: 1 });

    const r = await completeWithSubitems(t.id, {
      chinese: 1,
      'math-school': 0,
      'english-vocab': 1,
      'english-reading': 0,
      'math-extra': 0,
      'english-class': 0,
    });

    // Before the fix this threw `ReferenceError: rawSubitems is not defined`
    // and the handler returned HTTP 500.
    expect(r.status).toBe(201);
    const body = (await r.json()) as { task_id?: number; error?: { code?: string } };
    expect(body.error).toBeUndefined();
    expect(body.task_id).toBe(t.id);
  });

  it('persists all 6 subitem rows with the correct checked 0/1 values', async () => {
    const t = makeTask({ name: SUMMER_TASK_NAME, token_reward: 1 });

    const r = await completeWithSubitems(t.id, {
      chinese: 1,
      'math-school': 0,
      'english-vocab': 1,
      'english-reading': 0,
      'math-extra': 0,
      'english-class': 0,
    });
    expect(r.status).toBe(201);

    // All 6 sub-items persisted (both checked=1 and checked=0 — the admin dot
    // matrix needs to distinguish "modal opened, item missed" from "no row").
    expect(subitemRows).toHaveLength(6);
    expect(subitemRows.map((row) => row.subitemId).sort()).toEqual([...ALL_SUBITEM_IDS].sort());

    const byId = new Map(subitemRows.map((row) => [row.subitemId, row.checked]));
    expect(byId.get('chinese')).toBe(1);
    expect(byId.get('math-school')).toBe(0);
    expect(byId.get('english-vocab')).toBe(1);
    expect(byId.get('english-reading')).toBe(0);
    expect(byId.get('math-extra')).toBe(0);
    expect(byId.get('english-class')).toBe(0);

    // Every subitem row points at the freshly created task_completion.
    const completion = completions.find((c) => c.task_id === t.id);
    expect(completion).toBeDefined();
    for (const row of subitemRows) {
      expect(row.completionId).toBe(completion!.id);
    }
  });

  it('persists 0 (not 1) for items the kid did NOT check — the admin matrix needs the gap', async () => {
    const t = makeTask({ name: SUMMER_TASK_NAME, token_reward: 1 });

    const r = await completeWithSubitems(t.id, {
      chinese: 0,
      'math-school': 0,
      'english-vocab': 0,
      'english-reading': 0,
      'math-extra': 0,
      'english-class': 0,
    });
    expect(r.status).toBe(201);
    expect(subitemRows).toHaveLength(6);
    expect(subitemRows.every((row) => row.checked === 0)).toBe(true);
  });

  it('returns 400 BAD_REQUEST for an unknown subitem_id', async () => {
    const t = makeTask({ name: SUMMER_TASK_NAME, token_reward: 1 });

    const r = await completeWithSubitems(t.id, {
      chinese: 1,
      'not-a-real-item': 1,
    });

    expect(r.status).toBe(400);
    const body = (await r.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(body.error?.message).toContain('not-a-real-item');

    // Nothing was written — validation happens before any batch.
    expect(lastBatch).toHaveLength(0);
    expect(subitemRows).toHaveLength(0);
  });

  it('returns 400 BAD_REQUEST when a subitem value is neither 0 nor 1', async () => {
    const t = makeTask({ name: SUMMER_TASK_NAME, token_reward: 1 });

    const r = await completeWithSubitems(t.id, { chinese: 2 });

    expect(r.status).toBe(400);
    const body = (await r.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(lastBatch).toHaveLength(0);
    expect(subitemRows).toHaveLength(0);
  });

  it('returns 400 BAD_REQUEST when a subitem value is a non-numeric string', async () => {
    const t = makeTask({ name: SUMMER_TASK_NAME, token_reward: 1 });

    const r = await completeWithSubitems(t.id, { chinese: 'yes' });

    expect(r.status).toBe(400);
    const body = (await r.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(lastBatch).toHaveLength(0);
    expect(subitemRows).toHaveLength(0);
  });

  it('does NOT persist subitems for a non-暑假作业 task (back-compat)', async () => {
    const t = makeTask({ name: '跑步', token_reward: 1 });

    const r = await completeWithSubitems(t.id, { chinese: 1 });

    expect(r.status).toBe(201);
    expect(subitemRows).toHaveLength(0);
  });

  it('completes 暑假作业 with NO subitems body at all (kid skipped the modal)', async () => {
    const t = makeTask({ name: SUMMER_TASK_NAME, token_reward: 1 });

    const r = await call(`/api/me/tasks/${t.id}/complete`, { method: 'POST' });

    expect(r.status).toBe(201);
    // No per-item record written — treated as "no per-item data", not a guess.
    expect(subitemRows).toHaveLength(0);
    expect(completions.find((c) => c.task_id === t.id)).toBeDefined();
    expect(completions.find((c) => c.task_id === t.id)?.completed_date).toBe(todayShanghai());
  });
});

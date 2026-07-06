// tests/unit/me-events-submit.test.ts
// Tests for POST /api/me/events
// TDD: written before the implementation. Mock D1 supports db.batch() with last_row_id.
//
// Auth: child user_id is HARDCODED to 2 in src/routes/me/events.ts for now
// (matches seeds/local.sql). M5 will replace this with proper auth.

import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/worker.ts';
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  ScoreEvent,
} from '../../src/db/types.ts';
import { currentWeek, nowUnix } from '../../src/utils/week.ts';

const CHILD_USER_ID = 2;

// In-memory tables the mock DB will mutate.
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
let nextEventId = 1;
let nextAuditId = 1;
const now = nowUnix();

// Capture batch invocations for inspection
interface CapturedBatch {
  query: string;
  params: unknown[];
}
let lastBatch: CapturedBatch[] = [];

function reset() {
  scoreEvents = [];
  auditLog = [];
  nextEventId = 1;
  nextAuditId = 1;
  lastBatch = [];
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
      let lastInsertId = 0;

      for (const s of statements) {
        const tagged = s as Tagged;
        const captured = tagged.__captured ?? { query: '', params: [] };
        lastBatch.push(captured);
        const q = captured.query;
        const p = captured.params;

        if (/^INSERT INTO\s+score_events/i.test(q)) {
          const id = nextEventId++;
          // Route inlines status='pending', submitted_by='child', source='manual',
          // source_ref=NULL, created_at=unixepoch() as SQL literals.
          // Bound params: [user_id, type, change_value, reason, week_of]
          const ev: ScoreEvent = {
            id,
            user_id: p[0] as number,
            type: p[1] as ScoreEvent['type'],
            change_value: p[2] as number,
            reason: p[3] as string,
            status: 'pending',
            submitted_by: 'child',
            source: 'manual',
            source_ref: null,
            reviewed_by: null,
            reviewed_at: null,
            week_of: p[4] as string,
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
          // Route inlines actor='child', action='submit_event', target_event_id=
          // last_insert_rowid(), created_at=unixepoch() as SQL literals.
          // Bound params: [target_user_id, details].
          // Mock simulates D1's connection-level last_insert_rowid by tracking
          // the rowid of the previous statement in this batch.
          const details = typeof p[1] === 'string' ? p[1] : JSON.stringify(p[1] ?? {});
          auditLog.push({
            id,
            actor: 'child',
            action: 'submit_event',
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

interface SubmitBody {
  id?: number;
  status?: string;
  created_at?: number;
  error?: { code?: string; message?: string };
}

interface ValidPayload {
  type: 'game_time' | 'pocket_money';
  change_value: number;
  reason: string;
}

function validBody(overrides: Partial<ValidPayload> = {}): ValidPayload {
  return {
    type: 'game_time',
    change_value: 10,
    reason: 'Helped with dishes',
    ...overrides,
  };
}

describe('POST /api/me/events', () => {
  beforeEach(reset);

  it('returns 400 BAD_REQUEST when body is missing', async () => {
    const r = await call('/api/me/events', { method: 'POST' });
    expect(r.status).toBe(400);
    const body = (await r.json()) as SubmitBody;
    expect(body.error?.code).toBe('BAD_REQUEST');

    // No batch should have been submitted.
    expect(lastBatch).toHaveLength(0);
  });

  it('returns 400 BAD_REQUEST when type is invalid', async () => {
    const r = await call('/api/me/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody({ type: 'invalid' as 'game_time' })),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as SubmitBody;
    expect(body.error?.code).toBe('BAD_REQUEST');

    expect(lastBatch).toHaveLength(0);
  });

  it('returns 400 BAD_REQUEST when change_value is 0 (no-op)', async () => {
    const r = await call('/api/me/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody({ change_value: 0 })),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as SubmitBody;
    expect(body.error?.code).toBe('BAD_REQUEST');

    expect(lastBatch).toHaveLength(0);
  });

  it('returns 400 BAD_REQUEST when change_value is a string "5"', async () => {
    const r = await call('/api/me/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'game_time', change_value: '5', reason: 'x' }),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as SubmitBody;
    expect(body.error?.code).toBe('BAD_REQUEST');

    expect(lastBatch).toHaveLength(0);
  });

  it('returns 400 BAD_REQUEST when reason is empty or whitespace-only', async () => {
    for (const reason of ['', '   ', '\t\n']) {
      reset();
      const r = await call('/api/me/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validBody({ reason })),
      });
      expect(r.status).toBe(400);
      const body = (await r.json()) as SubmitBody;
      expect(body.error?.code).toBe('BAD_REQUEST');
      expect(lastBatch).toHaveLength(0);
    }
  });

  it('happy path: 201 with id + status="pending", writes score_event + audit_log', async () => {
    const payload = validBody({
      type: 'pocket_money',
      change_value: -3,
      reason: 'Broke a rule',
    });

    const r = await call('/api/me/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(r.status).toBe(201);
    const body = (await r.json()) as SubmitBody;
    expect(typeof body.id).toBe('number');
    expect(body.id).toBeGreaterThan(0);
    expect(body.status).toBe('pending');
    expect(typeof body.created_at).toBe('number');

    // Both batch statements executed (score_event then audit_log).
    expect(lastBatch).toHaveLength(2);
    expect(lastBatch[0].query).toMatch(/^INSERT INTO\s+score_events/i);
    expect(lastBatch[1].query).toMatch(/^INSERT INTO\s+audit_log/i);

    // score_event row: status=pending, source=manual, submitted_by=child, week_of=currentWeek
    const ev = scoreEvents[0];
    expect(ev).toBeDefined();
    expect(ev.user_id).toBe(CHILD_USER_ID);
    expect(ev.type).toBe('pocket_money');
    expect(ev.change_value).toBe(-3);
    expect(ev.reason).toBe('Broke a rule');
    expect(ev.status).toBe('pending');
    expect(ev.submitted_by).toBe('child');
    expect(ev.source).toBe('manual');
    expect(ev.source_ref).toBeNull();
    expect(ev.reviewed_by).toBeNull();
    expect(ev.reviewed_at).toBeNull();
    expect(ev.week_of).toBe(currentWeek());

    // Score event insert bound the right values.
    const evParams = lastBatch[0].params;
    expect(evParams[0]).toBe(CHILD_USER_ID);
    expect(evParams[1]).toBe('pocket_money');
    expect(evParams[2]).toBe(-3);
    expect(evParams[3]).toBe('Broke a rule');
    expect(evParams[4]).toBe(currentWeek());

    // audit_log row: action=submit_event, actor=child, target_event_id=ev.id
    const audit = auditLog[0];
    expect(audit).toBeDefined();
    expect(audit.actor).toBe('child');
    expect(audit.action).toBe('submit_event');
    expect(audit.target_event_id).toBe(ev.id);
    expect(audit.target_user_id).toBe(CHILD_USER_ID);
    const details = JSON.parse(audit.details) as Record<string, unknown>;
    expect(details.type).toBe('pocket_money');
    expect(details.change_value).toBe(-3);
    expect(details.reason).toBe('Broke a rule');
  });
  // Item #015 M1: 🪙 金币 as 3rd type option in existing submit modal.
  // Verifies the endpoint accepts type='coins' (not rejected by VALID_TYPES check)
  // and writes the score_event with type='coins' so it flows through the same
  // approval pipeline as game_time / pocket_money (no separate coin_requests table).
  it('Item #015 M1: accepts type=coins and writes score_event with type=coins', async () => {
    const res = await call('/api/me/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'coins',
        change_value: 25,
        reason: '申请 25 金币看动画',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: number; status: string };
    expect(body.id).toBeGreaterThan(0);
    expect(body.status).toBe('pending');

    // score_events row written with type='coins'
    expect(scoreEvents).toHaveLength(1);
    expect(scoreEvents[0].type).toBe('coins');
    expect(scoreEvents[0].change_value).toBe(25);
    expect(scoreEvents[0].status).toBe('pending');
    expect(scoreEvents[0].submitted_by).toBe('child');

    // audit_log records type='coins' in details
    expect(auditLog).toHaveLength(1);
    const details = JSON.parse(auditLog[0].details) as Record<string, unknown>;
    expect(details.type).toBe('coins');
    expect(details.change_value).toBe(25);
  });

});

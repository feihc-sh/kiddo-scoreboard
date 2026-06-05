// tests/unit/public-events.test.ts
// Integration tests for GET /api/public/events (list) and GET /api/public/events/:id (detail).
// Read-only endpoints — no auth required. Mounted at /api/public/events by src/worker.ts.
import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/worker.ts';
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  ScoreEvent,
} from '../../src/db/types.ts';

let events: ScoreEvent[] = [];
let nextId = 1;
let now = 1700000000;

function reset() {
  events = [];
  nextId = 1;
  now = 1700000000;
}

function makeEvent(overrides: Partial<ScoreEvent> = {}): ScoreEvent {
  const id = nextId++;
  const createdAt = now++;
  const ev: ScoreEvent = {
    id,
    user_id: 2,
    type: 'game_time',
    change_value: 10,
    reason: `event ${id}`,
    status: 'approved',
    submitted_by: 'pm',
    source: 'manual',
    source_ref: null,
    reviewed_by: 1,
    reviewed_at: createdAt,
    week_of: '2026-W23',
    created_at: createdAt,
    ...overrides,
  };
  events.push(ev);
  return ev;
}

/**
 * Apply the WHERE-clause params against the in-memory event table.
 * Bind order (positional): [user_id, status?, type?, limit].
 * user_id is at position 0 (always). Strings are status/type filters.
 * Numbers after position 0 are limit (skip).
 */
function filterEvents(filterParams: unknown[]): ScoreEvent[] {
  return events.filter((e) => {
    // Position 0: user_id
    if (filterParams[0] !== undefined && e.user_id !== filterParams[0]) return false;
    // Remaining: status / type / limit. Strings are filters; numbers are limit.
    for (let i = 1; i < filterParams.length; i++) {
      const p = filterParams[i];
      if (typeof p === 'number') continue;
      if (e.status === p) continue;
      if (e.type === p) continue;
      return false;
    }
    return true;
  });
}

function makeMockDb(): D1Database {
  const db: D1Database = {
    prepare(query: string): D1PreparedStatement {
      let params: unknown[] = [];
      const isCount = /SELECT COUNT\(\*\)\s+AS\s+n\s+FROM\s+score_events/.test(query);
      const isById = /FROM\s+score_events\s+WHERE\s+id\s+=\s+\?/.test(query);
      const isList = !isCount && !isById && /FROM\s+score_events/.test(query);

      const stmt: D1PreparedStatement = {
        bind(...values: unknown[]): D1PreparedStatement {
          params = values;
          return stmt;
        },
        first<T = unknown>(): Promise<T | null> {
          if (isCount) {
            const filtered = filterEvents(params);
            return Promise.resolve({ n: filtered.length } as T);
          }
          if (isById) {
            const id = params[0] as number;
            const found = events.find((e) => e.id === id);
            return Promise.resolve((found ?? null) as T);
          }
          return Promise.resolve(null);
        },
        all<T = unknown>(): Promise<D1Result<T>> {
          if (isList) {
            // Last param is LIMIT; the rest are WHERE filters.
            const filterParams = params.slice(0, -1);
            const limit = params[params.length - 1] as number;
            const filtered = filterEvents(filterParams).slice(0, limit);
            // ORDER BY created_at DESC (in-memory sort for determinism).
            filtered.sort((a, b) => b.created_at - a.created_at);
            return Promise.resolve({
              results: filtered,
              success: true,
            } as D1Result<T>);
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

function envObj(): { DB: D1Database; JWT_SECRET: string } {
  return { DB: makeMockDb(), JWT_SECRET: SECRET };
}

async function call(path: string, init: RequestInit = {}, env = envObj()) {
  return app.request(`http://test.local${path}`, init, env);
}

interface ListBody {
  events?: ScoreEvent[];
  total?: number;
  error?: { code?: string; message?: string };
}

interface DetailBody extends Partial<ScoreEvent> {
  error?: { code?: string; message?: string };
}

describe('GET /api/public/events (list)', () => {
  beforeEach(reset);

  it('returns 400 BAD_REQUEST without user_id', async () => {
    const r = await call('/api/public/events');
    expect(r.status).toBe(400);
    const body = (await r.json()) as ListBody;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('returns 200 with all events for the user when no status filter (default = all)', async () => {
    const a1 = makeEvent({ user_id: 2, status: 'approved' });
    const a2 = makeEvent({ user_id: 2, status: 'approved' });
    const p1 = makeEvent({ user_id: 2, status: 'pending' });
    const r1 = makeEvent({ user_id: 2, status: 'rejected' });
    const otherUser = makeEvent({ user_id: 3, status: 'approved' });

    const r = await call('/api/public/events?user_id=2');
    expect(r.status).toBe(200);
    const body = (await r.json()) as ListBody;
    // Default returns ALL statuses (changed from "approved only" so child can see own pending)
    expect(body.events).toHaveLength(4);
    expect(body.total).toBe(4);
    const ids = (body.events ?? []).map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining([a1.id, a2.id, p1.id, r1.id]));
    expect(ids).not.toContain(otherUser.id);
  });

  it('filters by ?status=approved (explicit)', async () => {
    const a1 = makeEvent({ user_id: 2, status: 'approved' });
    const a2 = makeEvent({ user_id: 2, status: 'approved' });
    const p1 = makeEvent({ user_id: 2, status: 'pending' });

    const r = await call('/api/public/events?user_id=2&status=approved');
    expect(r.status).toBe(200);
    const body = (await r.json()) as ListBody;
    expect(body.events).toHaveLength(2);
    const ids = (body.events ?? []).map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining([a1.id, a2.id]));
    expect(ids).not.toContain(p1.id);
  });

  it('filters by ?status=rejected', async () => {
    const a = makeEvent({ user_id: 2, status: 'approved' });
    const r1 = makeEvent({ user_id: 2, status: 'rejected' });
    const r2 = makeEvent({ user_id: 2, status: 'rejected' });

    const r = await call('/api/public/events?user_id=2&status=rejected');
    expect(r.status).toBe(200);
    const body = (await r.json()) as ListBody;
    expect(body.events).toHaveLength(2);
    expect(body.total).toBe(2);
    const ids = (body.events ?? []).map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining([r1.id, r2.id]));
    expect(ids).not.toContain(a.id);
  });

  it('filters by ?type=game_time', async () => {
    const g1 = makeEvent({ user_id: 2, type: 'game_time', status: 'approved' });
    const g2 = makeEvent({ user_id: 2, type: 'game_time', status: 'approved' });
    const p1 = makeEvent({ user_id: 2, type: 'pocket_money', status: 'approved' });

    const r = await call('/api/public/events?user_id=2&type=game_time');
    expect(r.status).toBe(200);
    const body = (await r.json()) as ListBody;
    expect(body.events).toHaveLength(2);
    expect(body.total).toBe(2);
    const ids = (body.events ?? []).map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining([g1.id, g2.id]));
    expect(ids).not.toContain(p1.id);
  });

  it('clamps ?limit=500 down to 200', async () => {
    for (let i = 0; i < 250; i++) {
      makeEvent({ user_id: 2, status: 'approved', type: 'game_time' });
    }
    const r = await call('/api/public/events?user_id=2&limit=500');
    expect(r.status).toBe(200);
    const body = (await r.json()) as ListBody;
    expect(body.events).toHaveLength(200);
    expect(body.total).toBe(250);
  });
});

describe('GET /api/public/events/:id (detail)', () => {
  beforeEach(reset);

  it('returns 404 NOT_FOUND for missing event', async () => {
    const r = await call('/api/public/events/9999');
    expect(r.status).toBe(404);
    const body = (await r.json()) as DetailBody;
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('returns 400 BAD_REQUEST for non-numeric id', async () => {
    const r = await call('/api/public/events/abc');
    expect(r.status).toBe(400);
    const body = (await r.json()) as DetailBody;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('returns 200 with full event JSON for existing event', async () => {
    const ev = makeEvent({
      user_id: 2,
      type: 'pocket_money',
      change_value: -5,
      reason: 'broken vase',
      status: 'rejected',
      source: 'manual',
      source_ref: null,
    });
    const r = await call(`/api/public/events/${ev.id}`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as DetailBody;
    expect(body.id).toBe(ev.id);
    expect(body.user_id).toBe(2);
    expect(body.type).toBe('pocket_money');
    expect(body.change_value).toBe(-5);
    expect(body.reason).toBe('broken vase');
    expect(body.status).toBe('rejected');
    expect(body.source).toBe('manual');
    expect(body.submitted_by).toBe('pm');
    expect(body.created_at).toBeTypeOf('number');
  });
});

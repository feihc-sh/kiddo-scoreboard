// tests/unit/public-balance.test.ts
// Integration tests for GET /api/public/balance?user_id=N
// Read-only endpoint: returns aggregated approved balance for a user.
import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/worker.ts';
import type { D1Database, D1PreparedStatement, D1Result } from '../../src/db/types.ts';

interface ScoreEventRow {
  id: number;
  user_id: number;
  type: 'game_time' | 'pocket_money';
  change_value: number;
  status: 'pending' | 'approved' | 'rejected' | 'revoked';
}

let events: ScoreEventRow[] = [];

function reset() {
  events = [];
}

function makeMockDb(): D1Database {
  const db: D1Database = {
    prepare(query: string): D1PreparedStatement {
      let params: unknown[] = [];
      const stmt: D1PreparedStatement = {
        bind(...values: unknown[]): D1PreparedStatement {
          params = values;
          return stmt;
        },
        first<T = unknown>(): Promise<T | null> {
          return Promise.resolve(null);
        },
        all<T = unknown>(): Promise<D1Result<T>> {
          // GROUP BY type: emulate SELECT type, COALESCE(SUM(change_value), 0)
          if (query.includes('GROUP BY type')) {
            const filtered = applyWhere(events, query, params);
            const grouped = new Map<string, number>();
            for (const row of filtered) {
              grouped.set(row.type, (grouped.get(row.type) ?? 0) + row.change_value);
            }
            const results = Array.from(grouped, ([type, total]) => ({
              type,
              total,
            })) as unknown as T[];
            return Promise.resolve({ results, success: true });
          }
          return Promise.resolve({ results: [], success: true });
        },
        run<T = unknown>(): Promise<D1Result<T>> {
          return Promise.resolve({ success: true });
        },
        raw<T = unknown>(): Promise<T[]> {
          return Promise.resolve([]);
        },
      };
      return stmt;
    },
    batch: () => Promise.resolve([]),
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
  };
  return db;
}

function applyWhere(rows: ScoreEventRow[], query: string, params: unknown[]): ScoreEventRow[] {
  // Mirrors the pattern from tests/unit/balance.test.ts: filter by user_id (first ?)
  // then by literal status, in query order.
  let out = [...rows];
  const userMatch = /user_id\s*=\s*\?/.exec(query);
  if (userMatch) {
    const uid = params.shift() as number;
    out = out.filter((r) => r.user_id === uid);
  }
  const statusMatch = /status\s*=\s*'([^']+)'/.exec(query);
  if (statusMatch) {
    out = out.filter((r) => r.status === statusMatch[1]);
  }
  return out;
}

const SECRET = 'unit-test-secret-1234567890';

function envObj(): { DB: D1Database; JWT_SECRET: string } {
  return { DB: makeMockDb(), JWT_SECRET: SECRET };
}

async function call(path: string, init: RequestInit = {}, env = envObj()) {
  return app.request(`http://test.local${path}`, init, env);
}

interface BalanceBody {
  game_time?: number;
  pocket_money?: number;
  error?: { code?: string; message?: string };
}

describe('GET /api/public/balance', () => {
  beforeEach(reset);

  it('returns 400 when user_id query param is missing', async () => {
    const r = await call('/api/public/balance');
    expect(r.status).toBe(400);
    const body = (await r.json()) as BalanceBody;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when user_id is non-numeric', async () => {
    const r = await call('/api/public/balance?user_id=abc');
    expect(r.status).toBe(400);
    const body = (await r.json()) as BalanceBody;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('returns 200 with zero balance when user has no score_events', async () => {
    const r = await call('/api/public/balance?user_id=1');
    expect(r.status).toBe(200);
    const body = (await r.json()) as BalanceBody;
    expect(body).toEqual({ game_time: 0, pocket_money: 0, coins: 0 });
  });

  it('sums only approved events across both account types', async () => {
    events = [
      { id: 1, user_id: 1, type: 'game_time',    change_value:  30, status: 'approved' },
      { id: 2, user_id: 1, type: 'game_time',    change_value: -10, status: 'approved' },
      { id: 3, user_id: 1, type: 'pocket_money', change_value:  20, status: 'approved' },
      { id: 4, user_id: 1, type: 'pocket_money', change_value:  -5, status: 'approved' },
    ];
    const r = await call('/api/public/balance?user_id=1');
    expect(r.status).toBe(200);
    const body = (await r.json()) as BalanceBody;
    expect(body).toEqual({ game_time: 20, pocket_money: 15, coins: 0 });
  });

  it('excludes pending, rejected, and revoked events from the balance', async () => {
    events = [
      { id: 1, user_id: 1, type: 'game_time',    change_value:  30, status: 'approved' },
      { id: 2, user_id: 1, type: 'game_time',    change_value:  10, status: 'pending'  },
      { id: 3, user_id: 1, type: 'game_time',    change_value:  10, status: 'rejected' },
      { id: 4, user_id: 1, type: 'game_time',    change_value:  10, status: 'revoked'  },
      { id: 5, user_id: 1, type: 'pocket_money', change_value:  50, status: 'pending'  },
    ];
    const r = await call('/api/public/balance?user_id=1');
    expect(r.status).toBe(200);
    const body = (await r.json()) as BalanceBody;
    expect(body.game_time).toBe(30);
    expect(body.pocket_money).toBe(0);
  });
});

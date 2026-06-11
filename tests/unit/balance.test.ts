// tests/unit/balance.test.ts
// Tests for src/utils/balance.ts using a minimal D1 mock.
import { describe, it, expect, beforeEach } from 'vitest';
import { computeBalance, getAccountBalance, countPendingEvents } from '../../src/utils/balance.ts';
import type { D1Database, D1PreparedStatement, D1Result } from '../../src/db/types.ts';

// Minimal D1 mock that emulates `.prepare(...).bind(...).all()` and `.first()`.
// We build a small in-memory table of score_events rows and route queries against it.

interface ScoreEventRow {
  id: number;
  user_id: number;
  type: 'game_time' | 'pocket_money';
  change_value: number;
  status: 'pending' | 'approved' | 'rejected' | 'revoked';
}

let table: ScoreEventRow[] = [];

function resetTable() {
  table = [];
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
          // Compute SUM per type, or COUNT(*) — both end up as a single aggregate row
          if (query.includes('COUNT(*)')) {
            const filtered = applyWhere(table, query, params);
            return Promise.resolve({ n: filtered.length } as T);
          }
          // SUM(change_value) with GROUP BY type
          if (query.includes('GROUP BY type')) {
            const filtered = applyWhere(table, query, params);
            const grouped = new Map<string, number>();
            for (const row of filtered) {
              grouped.set(row.type, (grouped.get(row.type) ?? 0) + row.change_value);
            }
            return Promise.resolve(
              Array.from(grouped, ([type, total]) => ({ type, total }))[0] as T ?? null,
            );
          }
          // SUM per single type
          const filtered = applyWhere(table, query, params);
          const total = filtered.reduce((s, r) => s + r.change_value, 0);
          return Promise.resolve({ total } as T);
        },
        all<T = unknown>(): Promise<D1Result<T>> {
          // GROUP BY type path
          const filtered = applyWhere(table, query, params);
          const grouped = new Map<string, number>();
          for (const row of filtered) {
            grouped.set(row.type, (grouped.get(row.type) ?? 0) + row.change_value);
          }
          const results = Array.from(grouped, ([type, total]) => ({ type, total })) as unknown as T[];
          return Promise.resolve({ results, success: true });
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
  // Naive: filter by user_id (first ?), then by status, then by type, in query order
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
  const typeMatch = /AND\s+type\s*=\s*\?/.exec(query);
  if (typeMatch) {
    const t = params.shift() as string;
    out = out.filter((r) => r.type === t);
  }
  return out;
}

describe('balance', () => {
  beforeEach(() => {
    resetTable();
  });

  it('returns zero balance for new user', async () => {
    const db = makeMockDb();
    const bal = await computeBalance(db, 1);
    expect(bal).toEqual({ game_time: 0, pocket_money: 0, coins: 0 });
  });

  it('sums positive and negative approved events per account', async () => {
    table = [
      { id: 1, user_id: 1, type: 'game_time',   change_value:  30, status: 'approved' },
      { id: 2, user_id: 1, type: 'game_time',   change_value: -10, status: 'approved' },
      { id: 3, user_id: 1, type: 'pocket_money', change_value:  20, status: 'approved' },
      { id: 4, user_id: 1, type: 'pocket_money', change_value:  -5, status: 'approved' },
    ];
    const bal = await computeBalance(makeMockDb(), 1);
    expect(bal).toEqual({ game_time: 20, pocket_money: 15, coins: 0 });
  });

  it('excludes pending, rejected, and revoked events', async () => {
    table = [
      { id: 1, user_id: 1, type: 'game_time',   change_value:  30, status: 'approved' },
      { id: 2, user_id: 1, type: 'game_time',   change_value:  10, status: 'pending'  },
      { id: 3, user_id: 1, type: 'game_time',   change_value:  10, status: 'rejected' },
      { id: 4, user_id: 1, type: 'game_time',   change_value:  10, status: 'revoked'  },
    ];
    const bal = await computeBalance(makeMockDb(), 1);
    expect(bal.game_time).toBe(30);
    expect(bal.pocket_money).toBe(0);
  });

  it('isolates balance per user', async () => {
    table = [
      { id: 1, user_id: 1, type: 'game_time', change_value: 100, status: 'approved' },
      { id: 2, user_id: 2, type: 'game_time', change_value:  50, status: 'approved' },
    ];
    const db = makeMockDb();
    const bal1 = await computeBalance(db, 1);
    const bal2 = await computeBalance(db, 2);
    expect(bal1.game_time).toBe(100);
    expect(bal2.game_time).toBe(50);
  });

  it('handles negative totals (overdraft / net loss)', async () => {
    table = [
      { id: 1, user_id: 1, type: 'pocket_money', change_value: -30, status: 'approved' },
      { id: 2, user_id: 1, type: 'pocket_money', change_value:  10, status: 'approved' },
    ];
    const bal = await computeBalance(makeMockDb(), 1);
    expect(bal.pocket_money).toBe(-20);
  });

  it('getAccountBalance returns the per-type total', async () => {
    table = [
      { id: 1, user_id: 1, type: 'game_time', change_value: 5, status: 'approved' },
      { id: 2, user_id: 1, type: 'game_time', change_value: 3, status: 'approved' },
    ];
    const db = makeMockDb();
    expect(await getAccountBalance(db, 1, 'game_time')).toBe(8);
    expect(await getAccountBalance(db, 1, 'pocket_money')).toBe(0);
  });

  it('countPendingEvents only counts pending status', async () => {
    table = [
      { id: 1, user_id: 1, type: 'game_time', change_value: 1, status: 'pending'  },
      { id: 2, user_id: 1, type: 'game_time', change_value: 1, status: 'pending'  },
      { id: 3, user_id: 1, type: 'game_time', change_value: 1, status: 'approved' },
      { id: 4, user_id: 1, type: 'game_time', change_value: 1, status: 'revoked'  },
    ];
    const db = makeMockDb();
    expect(await countPendingEvents(db, 1)).toBe(2);
  });
});

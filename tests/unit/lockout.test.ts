// tests/unit/lockout.test.ts
// Tests for src/auth/lockout.ts — 5 wrong attempts → locked 5 minutes.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  isLockedOut,
  recordAttempt,
  MAX_ATTEMPTS,
  LOCKOUT_DURATION_SEC,
} from '../../src/auth/lockout.ts';
import type { D1Database, D1PreparedStatement, D1Result } from '../../src/db/types.ts';

interface AttemptRow {
  id: number;
  ip: string;
  success: 0 | 1;
  attempted_at: number;
}

let table: AttemptRow[] = [];
let nextId = 1;
let nowOverride = Math.floor(Date.now() / 1000);

function resetTable() {
  table = [];
  nextId = 1;
  nowOverride = Math.floor(Date.now() / 1000);
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
          if (/SELECT COUNT\(\*\) AS n/.test(query)) {
            const cutoff = params[0] as number;
            const ip = params[1] as string;
            const n = table.filter(
              (r) => r.ip === ip && r.success === 0 && r.attempted_at >= cutoff,
            ).length;
            return Promise.resolve({ n } as T);
          }
          return Promise.resolve(null);
        },
        all: () => Promise.resolve({ results: [], success: true }),
        run<T = unknown>(): Promise<D1Result<T>> {
          if (/INSERT INTO auth_attempts/.test(query)) {
            const [ip, success] = params as [string, 0 | 1];
            const row: AttemptRow = {
              id: nextId++,
              ip,
              success,
              attempted_at: nowOverride,
            };
            table.push(row);
            return Promise.resolve({
              success: true,
              meta: { changes: 1, last_row_id: row.id, duration: 0 },
            });
          }
          return Promise.resolve({ success: true });
        },
        raw: () => Promise.resolve([]),
      };
      return stmt;
    },
    batch: () => Promise.resolve([]),
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
  };
  return db;
}

describe('isLockedOut', () => {
  beforeEach(resetTable);

  it('returns false when no attempts', async () => {
    expect(await isLockedOut(makeMockDb(), '1.2.3.4')).toBe(false);
  });

  it('returns false with < 5 failed attempts', async () => {
    const db = makeMockDb();
    for (let i = 0; i < 4; i++) {
      await recordAttempt(db, '1.2.3.4', false);
    }
    expect(await isLockedOut(db, '1.2.3.4')).toBe(false);
  });

  it('returns true with exactly 5 failed attempts in window', async () => {
    const db = makeMockDb();
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await recordAttempt(db, '1.2.3.4', false);
    }
    expect(await isLockedOut(db, '1.2.3.4')).toBe(true);
  });

  it('returns true with more than 5 failed attempts', async () => {
    const db = makeMockDb();
    for (let i = 0; i < 7; i++) {
      await recordAttempt(db, '1.2.3.4', false);
    }
    expect(await isLockedOut(db, '1.2.3.4')).toBe(true);
  });

  it('returns false once 5-minute window expires', async () => {
    const db = makeMockDb();
    for (let i = 0; i < 5; i++) {
      await recordAttempt(db, '1.2.3.4', false);
    }
    nowOverride += LOCKOUT_DURATION_SEC + 1;
    expect(await isLockedOut(db, '1.2.3.4', nowOverride)).toBe(false);
  });

  it('successful attempts do not count toward lockout', async () => {
    const db = makeMockDb();
    for (let i = 0; i < 3; i++) {
      await recordAttempt(db, '1.2.3.4', false);
    }
    for (let i = 0; i < 10; i++) {
      await recordAttempt(db, '1.2.3.4', true);
    }
    expect(await isLockedOut(db, '1.2.3.4')).toBe(false);
  });

  it('isolates per IP', async () => {
    const db = makeMockDb();
    for (let i = 0; i < 5; i++) {
      await recordAttempt(db, '1.2.3.4', false);
    }
    expect(await isLockedOut(db, '1.2.3.4')).toBe(true);
    expect(await isLockedOut(db, '5.6.7.8')).toBe(false);
  });
});

describe('MAX_ATTEMPTS / LOCKOUT_DURATION_SEC', () => {
  it('MAX_ATTEMPTS is 5', () => {
    expect(MAX_ATTEMPTS).toBe(5);
  });
  it('LOCKOUT_DURATION_SEC is 300 (5 minutes)', () => {
    expect(LOCKOUT_DURATION_SEC).toBe(5 * 60);
  });
});

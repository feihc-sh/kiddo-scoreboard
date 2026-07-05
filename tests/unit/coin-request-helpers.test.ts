// tests/unit/coin-request-helpers.test.ts
// Item #015 Stage 1: tests for src/utils/coin-request.ts helpers.
// Uses a minimal D1 mock (mirrors audit.test.ts pattern).

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createCoinRequest,
  listCoinRequestsForKid,
  listPendingCoinRequests,
  reviewCoinRequest,
} from '../../src/utils/coin-request.ts';
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
} from '../../src/db/types.ts';

// =============================================================
// In-memory mock storage
// =============================================================

interface CoinRequestRow {
  id: number;
  user_id: number;
  amount: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  requested_at: number;
  reviewed_at: number | null;
  reviewed_by: number | null;
  review_note: string | null;
}

interface ScoreEventRow {
  id: number;
  user_id: number;
  type: string;
  change_value: number;
  reason: string;
  status: string;
  submitted_by: string;
  source: string;
  source_ref: string | null;
  reviewed_by: number | null;
  reviewed_at: number | null;
  week_of: string | null;
  created_at: number;
}

let coinRequestTable: CoinRequestRow[] = [];
let scoreEventTable: ScoreEventRow[] = [];
let nextCoinRequestId = 1;
let nextScoreEventId = 1;
let nowOffset = 0;

function resetTables() {
  coinRequestTable = [];
  scoreEventTable = [];
  nextCoinRequestId = 1;
  nextScoreEventId = 1;
  nowOffset = 0;
}

// =============================================================
// Mock D1 — identifies SQL by verb prefix (avoids fragile regex on full query text)
// =============================================================

type SqlVerb = 'INSERT_COIN_REQUEST' | 'UPDATE_COIN_REQUEST'
  | 'INSERT_SCORE_EVENT' | 'SELECT_COIN_REQUEST_BY_ID'
  | 'SELECT_COIN_REQUESTS_BY_USER' | 'SELECT_PENDING_COIN_REQUESTS'
  | 'UNKNOWN';

function classifyQuery(q: string): SqlVerb {
  const u = q.trim().toUpperCase();
  if (u.startsWith('INSERT INTO COIN_REQUESTS')) return 'INSERT_COIN_REQUEST';
  if (u.startsWith('UPDATE COIN_REQUESTS')) return 'UPDATE_COIN_REQUEST';
  if (u.startsWith('INSERT INTO SCORE_EVENTS')) return 'INSERT_SCORE_EVENT';
  if (/SELECT.*FROM.*COIN_REQUESTS.*WHERE.*\bID\b\s*=/s.test(u)) return 'SELECT_COIN_REQUEST_BY_ID';
  if (/SELECT.*FROM.*COIN_REQUESTS.*WHERE.*\bSTATUS\b\s*=/s.test(u)) return 'SELECT_PENDING_COIN_REQUESTS';
  if (/SELECT.*FROM.*COIN_REQUESTS/s.test(u)) return 'SELECT_COIN_REQUESTS_BY_USER';
  return 'UNKNOWN';
}

function makeMockDb(): D1Database {
  return {
    prepare(query: string): D1PreparedStatement {
      const verb: SqlVerb = classifyQuery(query);
      let params: unknown[] = [];

      const stmt: D1PreparedStatement = {
        bind(...values: unknown[]): D1PreparedStatement {
          params = values;
          return stmt;
        },
        first<T = unknown>(): Promise<T | null> {
          if (verb === 'SELECT_COIN_REQUEST_BY_ID') {
            const id = params[0] as number;
            return Promise.resolve(
              (coinRequestTable.find((r) => r.id === id) ?? null) as T | null,
            );
          }
          return Promise.resolve(null);
        },
        run<T = unknown>(): Promise<D1Result<T>> {
          if (verb === 'INSERT_COIN_REQUEST') {
            const [userId, amount, reason] = params as [number, number, string];
            const row: CoinRequestRow = {
              id: nextCoinRequestId++,
              user_id: userId,
              amount,
              reason,
              status: 'pending',
              requested_at: Math.floor(Date.now() / 1000) + nowOffset,
              reviewed_at: null,
              reviewed_by: null,
              review_note: null,
            };
            coinRequestTable.push(row);
            nowOffset += 1;
            return Promise.resolve({
              success: true,
              meta: { changes: 1, last_row_id: row.id, duration: 0 },
            });
          }
          if (verb === 'UPDATE_COIN_REQUEST') {
            // Params: [reviewed_at, reviewed_by, review_note, id]
            // (status is a SQL literal 'approved'/'rejected' embedded in the query)
            // Parse status from SQL so the mock matches the helper's actual binding shape.
            const statusMatch = query.match(/SET\s+status\s*=\s*'(\w+)'/i);
            const parsedStatus = statusMatch ? statusMatch[1] : null;
            const [reviewedAt, reviewedBy, reviewNote, id] = params as [
              number, number, string | null, number,
            ];
            const idx = coinRequestTable.findIndex((r) => r.id === id);
            if (idx >= 0) {
              coinRequestTable[idx] = {
                ...coinRequestTable[idx],
                status: (parsedStatus as 'pending' | 'approved' | 'rejected') ?? coinRequestTable[idx].status,
                reviewed_at: reviewedAt,
                reviewed_by: reviewedBy,
                review_note: reviewNote,
              };
            }
            return Promise.resolve({
              success: true,
              meta: { changes: idx >= 0 ? 1 : 0, last_row_id: id, duration: 0 },
            });
          }
          if (verb === 'INSERT_SCORE_EVENT') {
            // Helper binds 7 params matching the 7 `?` placeholders in:
            //   VALUES (?, 'coins', ?, ?, 'approved', 'pm', 'manual', ?, ?, ?, ?, unixepoch())
            // (other columns are SQL literals: 'coins', 'approved', 'pm', 'manual', unixepoch())
            // Order: userId, changeValue, reason, sourceRef, pmUserId, now, weekOf
            const [
              userId, changeValue, reason, sourceRef, pmUserId, now, weekOf,
            ] = params as [number, number, string, string, number, number, string];
            const row: ScoreEventRow = {
              id: nextScoreEventId++,
              user_id: userId,
              type: 'coins',
              change_value: changeValue,
              reason,
              status: 'approved',
              submitted_by: 'pm',
              source: 'manual',
              source_ref: sourceRef,
              reviewed_by: pmUserId,
              reviewed_at: now,
              week_of: weekOf,
              created_at: Math.floor(Date.now() / 1000) + nowOffset,
            };
            scoreEventTable.push(row);
            nowOffset += 1;
            return Promise.resolve({
              success: true,
              meta: { changes: 1, last_row_id: row.id, duration: 0 },
            });
          }
          return Promise.resolve({ success: true });
        },
        all<T = unknown>(): Promise<D1Result<T>> {
          if (verb === 'SELECT_COIN_REQUESTS_BY_USER') {
            const userId = params[0] as number;
            const limit = (params[params.length - 1] as number) ?? 50;
            const rows = coinRequestTable
              .filter((r) => r.user_id === userId)
              .sort((a, b) => b.requested_at - a.requested_at)
              .slice(0, limit);
            return Promise.resolve({ results: rows as T[], success: true });
          }
          if (verb === 'SELECT_PENDING_COIN_REQUESTS') {
            const limit = (params[params.length - 1] as number) ?? 100;
            const rows = coinRequestTable
              .filter((r) => r.status === 'pending')
              .sort((a, b) => a.requested_at - b.requested_at)
              .slice(0, limit);
            return Promise.resolve({ results: rows as T[], success: true });
          }
          return Promise.resolve({ results: [], success: true });
        },
        raw<T = unknown>(): Promise<T[]> {
          return Promise.resolve([]);
        },
      };
      return stmt;
    },
    batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const runAll = async (
        idx: number,
        acc: D1Result<T>[],
      ): Promise<D1Result<T>[]> => {
        if (idx >= statements.length) return acc;
        const result = await statements[idx].run();
        return runAll(idx + 1, [...acc, result as D1Result<T>]);
      };
      return runAll(0, []);
    },
    exec(): Promise<{ count: number; duration: number }> {
      return Promise.resolve({ count: 0, duration: 0 });
    },
  };
}

// =============================================================
// Tests
// =============================================================

describe('createCoinRequest', () => {
  beforeEach(() => {
    resetTables();
  });

  it('inserts a row with status=pending and returns the new id', async () => {
    const db = makeMockDb();
    const result = await createCoinRequest(db, 2, 50, 'Good behavior reward');
    expect(result.id).toBe(1);
    expect(coinRequestTable).toHaveLength(1);
    expect(coinRequestTable[0].status).toBe('pending');
    expect(coinRequestTable[0].amount).toBe(50);
    expect(coinRequestTable[0].reason).toBe('Good behavior reward');
    expect(coinRequestTable[0].user_id).toBe(2);
    expect(coinRequestTable[0].requested_at).toBeGreaterThan(0);
  });

  it('trims the reason string before inserting', async () => {
    const db = makeMockDb();
    await createCoinRequest(db, 2, 10, '  Padded reason  ');
    expect(coinRequestTable[0].reason).toBe('Padded reason');
  });

  it('throws when amount is 0', async () => {
    const db = makeMockDb();
    await expect(createCoinRequest(db, 2, 0, 'reason')).rejects.toThrow(
      'amount must be a positive integer',
    );
  });

  it('throws when amount is negative', async () => {
    const db = makeMockDb();
    await expect(createCoinRequest(db, 2, -5, 'reason')).rejects.toThrow(
      'amount must be a positive integer',
    );
  });

  it('throws when reason is empty after trim', async () => {
    const db = makeMockDb();
    await expect(createCoinRequest(db, 2, 10, '   ')).rejects.toThrow(
      'reason cannot be empty',
    );
  });

  it('throws when reason is an empty string', async () => {
    const db = makeMockDb();
    await expect(createCoinRequest(db, 2, 10, '')).rejects.toThrow(
      'reason cannot be empty',
    );
  });
});

describe('listCoinRequestsForKid', () => {
  beforeEach(() => {
    resetTables();
  });

  it('returns all requests for a user ordered by requested_at DESC', async () => {
    const db = makeMockDb();
    await createCoinRequest(db, 2, 10, 'pending req 1');
    await createCoinRequest(db, 2, 20, 'approved req');
    await createCoinRequest(db, 3, 30, 'other user');       // distractor
    await createCoinRequest(db, 2, 30, 'rejected req');
    await createCoinRequest(db, 2, 40, 'pending req 2');

    // Simulate ordering: patch requested_at values
    const now = Math.floor(Date.now() / 1000);
    coinRequestTable[0].requested_at = now - 100;  // pending req 1 (oldest)
    coinRequestTable[1].requested_at = now - 50;   // approved req
    coinRequestTable[3].requested_at = now - 30;   // rejected req
    coinRequestTable[4].requested_at = now;         // pending req 2 (newest)

    const rows = await listCoinRequestsForKid(db, 2, 50);
    expect(rows).toHaveLength(4);
    expect(rows[0].reason).toBe('pending req 2');   // newest first
    expect(rows[3].reason).toBe('pending req 1');   // oldest last
  });

  it('respects the limit parameter', async () => {
    const db = makeMockDb();
    await createCoinRequest(db, 2, 10, 'req 1');
    await createCoinRequest(db, 2, 20, 'req 2');
    await createCoinRequest(db, 2, 30, 'req 3');

    const rows = await listCoinRequestsForKid(db, 2, 2);
    expect(rows).toHaveLength(2);
    expect(rows[0].reason).toBe('req 3');   // newest
    expect(rows[1].reason).toBe('req 2');
  });

  it('returns empty array when user has no requests', async () => {
    const db = makeMockDb();
    const rows = await listCoinRequestsForKid(db, 999, 50);
    expect(rows).toHaveLength(0);
  });
});

describe('listPendingCoinRequests', () => {
  beforeEach(() => {
    resetTables();
  });

  it('returns only pending requests ordered by requested_at ASC', async () => {
    const db = makeMockDb();
    await createCoinRequest(db, 2, 10, 'approved req');
    await createCoinRequest(db, 2, 20, 'pending req 1');
    await createCoinRequest(db, 3, 30, 'pending req 2');
    await createCoinRequest(db, 2, 40, 'rejected req');

    // Set non-pending statuses directly
    coinRequestTable[0].status = 'approved';
    coinRequestTable[3].status = 'rejected';

    // Time ordering: pending req 1 is older than pending req 2
    const now = Math.floor(Date.now() / 1000);
    coinRequestTable[1].requested_at = now - 50;
    coinRequestTable[2].requested_at = now;

    const rows = await listPendingCoinRequests(db, 100);
    expect(rows).toHaveLength(2);
    expect(rows[0].reason).toBe('pending req 1');   // oldest first (ASC)
    expect(rows[1].reason).toBe('pending req 2');
  });

  it('returns empty array when no pending requests', async () => {
    const db = makeMockDb();
    await createCoinRequest(db, 2, 10, 'approved req');
    await createCoinRequest(db, 2, 20, 'rejected req');
    coinRequestTable[0].status = 'approved';
    coinRequestTable[1].status = 'rejected';

    const rows = await listPendingCoinRequests(db, 100);
    expect(rows).toHaveLength(0);
  });
});

describe('reviewCoinRequest', () => {
  beforeEach(() => {
    resetTables();
  });

  it('approves a pending request and inserts a score_events row', async () => {
    const db = makeMockDb();
    await createCoinRequest(db, 2, 55, 'Good behavior bonus');
    const reqId = coinRequestTable[0].id;


    const result = await reviewCoinRequest(db, reqId, 1, 'approved', 'Great job!');

    expect(result.status).toBe('approved');
    expect(result.amount).toBe(55);
    expect(result.scoreEventId!).toBeGreaterThan(0);

    // coin_requests updated
    expect(coinRequestTable[0].status).toBe('approved');
    expect(coinRequestTable[0].reviewed_by).toBe(1);
    expect(coinRequestTable[0].review_note).toBe('Great job!');
    expect(coinRequestTable[0].reviewed_at!).toBeGreaterThan(0);

    // score_events inserted
    expect(scoreEventTable).toHaveLength(1);
    const ev = scoreEventTable[0];
    expect(ev.user_id).toBe(2);
    expect(ev.type).toBe('coins');
    expect(ev.change_value).toBe(55);
    expect(ev.reason).toBe('Good behavior bonus');
    expect(ev.source).toBe('manual');
    expect(ev.source_ref).toBe(`coin_request:${reqId}`);
    expect(ev.status).toBe('approved');
    expect(ev.submitted_by).toBe('pm');
  });

  it('rejects a pending request without inserting a score_events row', async () => {
    const db = makeMockDb();
    await createCoinRequest(db, 2, 30, 'Suspicious request');
    const reqId = coinRequestTable[0].id;

    const result = await reviewCoinRequest(db, reqId, 1, 'rejected', 'Too vague');

    expect(result.status).toBe('rejected');
    expect(result.amount).toBe(30);
    expect(result.scoreEventId).toBeUndefined();

    expect(coinRequestTable[0].status).toBe('rejected');
    expect(coinRequestTable[0].reviewed_by).toBe(1);
    expect(coinRequestTable[0].review_note).toBe('Too vague');

    expect(scoreEventTable).toHaveLength(0);
  });

  it('throws when request does not exist', async () => {
    const db = makeMockDb();
    await expect(
      reviewCoinRequest(db, 9999, 1, 'approved', null),
    ).rejects.toThrow('coin request 9999 not found');
  });

  it('throws when request is already approved (idempotent guard)', async () => {
    const db = makeMockDb();
    await createCoinRequest(db, 2, 10, 'already approved');
    coinRequestTable[0].status = 'approved';
    coinRequestTable[0].reviewed_at = Math.floor(Date.now() / 1000);
    coinRequestTable[0].reviewed_by = 1;

    await expect(
      reviewCoinRequest(db, 1, 1, 'approved', null),
    ).rejects.toThrow('coin request 1 is already approved');
  });

  it('throws when request is already rejected', async () => {
    const db = makeMockDb();
    await createCoinRequest(db, 2, 10, 'already rejected');
    coinRequestTable[0].status = 'rejected';
    coinRequestTable[0].reviewed_at = Math.floor(Date.now() / 1000);
    coinRequestTable[0].reviewed_by = 1;

    await expect(
      reviewCoinRequest(db, 1, 1, 'rejected', null),
    ).rejects.toThrow('coin request 1 is already rejected');
  });

  it('throws when decision is invalid', async () => {
    const db = makeMockDb();
    await expect(
      reviewCoinRequest(db, 1, 1, 'maybe' as 'approved' | 'rejected', null),
    ).rejects.toThrow('decision must be "approved" or "rejected"');
  });
});

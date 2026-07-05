// tests/unit/coin-request-api.test.ts
// Item #015 §2: Integration tests for kid + admin coin-request API endpoints.
//
// Kid endpoints (src/routes/me/coins.ts):
//   POST /api/coins/request  — kid submits a coin request
//   GET  /api/coins/requests — kid lists own request history
//
// Admin endpoints (src/routes/admin/coin-requests.ts):
//   GET  /api/admin/coin-requests            — PM lists requests (default: pending)
//   POST /api/admin/coin-requests/:id/approve — approve + score_events + audit_log
//   POST /api/admin/coin-requests/:id/reject   — reject + audit_log

import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/worker.ts';
import { signSession } from '../../src/auth/session.ts';
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
} from '../../src/db/types.ts';

// =============================================================
// Fixtures
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

interface AuditRow {
  id: number;
  actor: string;
  action: string;
  target_event_id: number | null;
  target_user_id: number | null;
  details: string;
  created_at: number;
}

interface UserRow {
  id: number;
  name: string;
  role: 'child' | 'pm';
  pin_hash: string | null;
  created_at: number;
  updated_at: number;
}

let users: UserRow[] = [];
let coinRequests: CoinRequestRow[] = [];
let scoreEvents: ScoreEventRow[] = [];
let audit: AuditRow[] = [];
let nextUserId = 1;
let nextRequestId = 1;
let nextScoreEventId = 1;
let nextAuditId = 1;
let nowOffset = 0;

function reset() {
  users = [];
  coinRequests = [];
  scoreEvents = [];
  audit = [];
  nextUserId = 1;
  nextRequestId = 1;
  nextScoreEventId = 1;
  nextAuditId = 1;
  nowOffset = 0;
}

function addUser(id: number, role: 'child' | 'pm') {
  const row: UserRow = {
    id,
    name: role === 'pm' ? 'PM' : `kid${id}`,
    role,
    pin_hash: role === 'pm' ? 'fake-hash' : null,
    created_at: 0,
    updated_at: 0,
  };
  users.push(row);
  if (id >= nextUserId) nextUserId = id + 1;
  return row;
}

function addCoinRequest(overrides: Partial<CoinRequestRow> = {}): CoinRequestRow {
  const id = overrides.id ?? nextRequestId++;
  if (id >= nextRequestId) nextRequestId = id + 1;
  const now = Math.floor(Date.now() / 1000) + nowOffset++;
  const row: CoinRequestRow = {
    id,
    user_id: 2,
    amount: 10,
    reason: 'test reason',
    status: 'pending',
    requested_at: now,
    reviewed_at: null,
    reviewed_by: null,
    review_note: null,
    ...overrides,
  };
  coinRequests.push(row);
  return row;
}

function addScoreEvent(overrides: Partial<ScoreEventRow> = {}): ScoreEventRow {
  const id = overrides.id ?? nextScoreEventId++;
  if (id >= nextScoreEventId) nextScoreEventId = id + 1;
  const row: ScoreEventRow = {
    id,
    user_id: 2,
    type: 'coins',
    change_value: 10,
    reason: 'test',
    status: 'approved',
    submitted_by: 'pm',
    source: 'manual',
    source_ref: null,
    reviewed_by: null,
    reviewed_at: null,
    week_of: null,
    created_at: 0,
    ...overrides,
  };
  scoreEvents.push(row);
  return row;
}

// =============================================================
// Mock D1
// =============================================================

type SqlVerb =
  | 'INSERT_COIN_REQUEST'
  | 'UPDATE_COIN_REQUEST'
  | 'INSERT_SCORE_EVENT'
  | 'INSERT_AUDIT_LOG'
  | 'SELECT_COIN_REQUEST_BY_ID'
  | 'SELECT_COIN_REQUEST_BY_USER'
  | 'SELECT_PENDING_COIN_REQUESTS'
  | 'SELECT_COIN_REQUESTS_BY_STATUS'
  | 'UNKNOWN';

function classifyQuery(q: string): SqlVerb {
  const u = q.trim().toUpperCase();
  if (u.startsWith('INSERT INTO COIN_REQUESTS')) return 'INSERT_COIN_REQUEST';
  if (u.startsWith('UPDATE COIN_REQUESTS')) return 'UPDATE_COIN_REQUEST';
  if (u.startsWith('INSERT INTO SCORE_EVENTS')) return 'INSERT_SCORE_EVENT';
  if (u.startsWith('INSERT INTO AUDIT_LOG')) return 'INSERT_AUDIT_LOG';
  if (/SELECT.*FROM.*COIN_REQUESTS.*WHERE.*\bID\b\s*=\s*\?/s.test(u)) return 'SELECT_COIN_REQUEST_BY_ID';
  if (/SELECT.*FROM.*COIN_REQUESTS.*WHERE.*\bUSER_ID\b\s*=\s*\?/s.test(u)) return 'SELECT_COIN_REQUEST_BY_USER';
  // Pending: bare "status = 'pending'" (no alias, no JOIN) — used by listPendingCoinRequests helper
  if (/SELECT.*FROM.*COIN_REQUESTS.*WHERE.*\bSTATUS\b\s*=\s*'PENDING'/s.test(u)) return 'SELECT_PENDING_COIN_REQUESTS';
  // Admin custom query: JOIN users (distinguishes from kid's listCoinRequestsForKid)
  if (/SELECT.*FROM.*COIN_REQUESTS.*JOIN USERS/s.test(u)) return 'SELECT_COIN_REQUESTS_BY_STATUS';
  if (/SELECT.*FROM.*COIN_REQUESTS/s.test(u)) return 'SELECT_COIN_REQUESTS_BY_STATUS';
  return 'UNKNOWN';
}

function makeMockDb(): D1Database {
  return {
    prepare(query: string): D1PreparedStatement {
      let params: unknown[] = [];

      const stmt: D1PreparedStatement = {
        bind(...values: unknown[]): D1PreparedStatement {
          params = values;
          return stmt;
        },
        first<T = unknown>(): Promise<T | null> {
          // SELECT ... FROM coin_requests WHERE id = ?
          if (/FROM\s+coin_requests\s+WHERE\s+id\s*=\s*\?/i.test(query)) {
            const id = params[0] as number;
            return Promise.resolve((coinRequests.find((r) => r.id === id) ?? null) as T | null);
          }
          return Promise.resolve(null);
        },
        all<T = unknown>(): Promise<D1Result<T>> {
          const upper = query.toUpperCase();

          // Kid: SELECT ... FROM coin_requests WHERE user_id = ? ORDER BY requested_at DESC
          if (
            /FROM\s+coin_requests\s+WHERE\s+user_id\s*=\s*\?/i.test(query) &&
            /ORDER\s+BY\s+requested_at\s+DESC/i.test(query)
          ) {
            const userId = params[0] as number;
            const limit = (params[params.length - 1] as number) ?? 50;
            const rows = coinRequests
              .filter((r) => r.user_id === userId)
              .sort((a, b) => b.requested_at - a.requested_at)
              .slice(0, limit);
            return Promise.resolve({ results: rows as T[], success: true });
          }

          // Admin pending helper: SELECT ... FROM coin_requests WHERE status = 'pending' ORDER BY requested_at ASC
          if (
            /FROM\s+coin_requests\s+WHERE\s+status\s*=\s*'PENDING'/i.test(query) &&
            /ORDER\s+BY\s+requested_at\s+ASC/i.test(query)
          ) {
            const limit = (params[params.length - 1] as number) ?? 100;
            const rows = coinRequests
              .filter((r) => r.status === 'pending')
              .sort((a, b) => a.requested_at - b.requested_at)
              .slice(0, limit);
            return Promise.resolve({ results: rows as T[], success: true });
          }

          // Admin custom: SELECT ... FROM coin_requests cr ... JOIN users
          if (/FROM\s+coin_requests\s+cr\s+.*JOIN\s+users/i.test(query)) {
            const limit = 100;
            let rows = [...coinRequests];
            // Match 'WHERE cr.status = ?' or 'WHERE status = ?'
            const statusMatch = query.match(/WHERE\s+(?:cr\.)?status\s*=\s*(\?|'([^']+)')/i);
            if (statusMatch) {
              if (statusMatch[2]) {
                // Literal: 'approved', 'rejected', 'all'
                rows = rows.filter((r) => r.status === statusMatch[2]);
              } else if (params[0]) {
                // Param-bound: ? resolved from params[0]
                rows = rows.filter((r) => r.status === params[0]);
              }
            }
            rows.sort((a, b) => b.requested_at - a.requested_at);
            rows = rows.slice(0, limit);
            return Promise.resolve({ results: rows as T[], success: true });
          }

          return Promise.resolve({ results: [], success: true });
        },
        run<T = unknown>(): Promise<D1Result<T>> {
          const now = Math.floor(Date.now() / 1000) + nowOffset++;
          const upper = query.toUpperCase();

          // INSERT INTO coin_requests (...)
          if (/INSERT\s+INTO\s+COIN_REQUESTS/i.test(upper)) {
            const [userId, amount, reason] = params as [number, number, string];
            const id = nextRequestId++;
            const row: CoinRequestRow = {
              id,
              user_id: userId,
              amount,
              reason,
              status: 'pending',
              requested_at: now,
              reviewed_at: null,
              reviewed_by: null,
              review_note: null,
            };
            coinRequests.push(row);
            return Promise.resolve({ success: true, meta: { changes: 1, last_row_id: id, duration: 0 } });
          }

          // UPDATE coin_requests SET status = 'approved'|'rejected' ...
          if (/UPDATE\s+COIN_REQUESTS/i.test(upper)) {
            const statusMatch = query.match(/SET\s+status\s*=\s*'(\w+)'/i);
            const parsedStatus = statusMatch ? statusMatch[1] : null;
            const [reviewedAt, reviewedBy, reviewNote, id] = params as [
              number, number, string | null, number,
            ];
            const idx = coinRequests.findIndex((r) => r.id === id);
            if (idx >= 0) {
              coinRequests[idx] = {
                ...coinRequests[idx],
                status: (parsedStatus as CoinRequestRow['status']) ?? coinRequests[idx].status,
                reviewed_at: reviewedAt,
                reviewed_by: reviewedBy,
                review_note: reviewNote,
              };
            }
            return Promise.resolve({ success: true, meta: { changes: idx >= 0 ? 1 : 0, last_row_id: id, duration: 0 } });
          }

          // INSERT INTO score_events (...) — reviewCoinRequest helper
          if (/INSERT\s+INTO\s+SCORE_EVENTS/i.test(upper)) {
            const [
              userId, changeValue, reason, sourceRef, pmUserId, reviewedAt, weekOf,
            ] = params as [number, number, string, string, number, number, string];
            const id = nextScoreEventId++;
            const row: ScoreEventRow = {
              id,
              user_id: userId,
              type: 'coins',
              change_value: changeValue,
              reason,
              status: 'approved',
              submitted_by: 'pm',
              source: 'manual',
              source_ref: sourceRef,
              reviewed_by: pmUserId,
              reviewed_at: reviewedAt,
              week_of: weekOf,
              created_at: now,
            };
            scoreEvents.push(row);
            return Promise.resolve({ success: true, meta: { changes: 1, last_row_id: id, duration: 0 } });
          }

          // INSERT INTO audit_log (...)
          if (/INSERT\s+INTO\s+AUDIT_LOG/i.test(upper)) {
            const m = query.match(/VALUES\s*\(\s*'([^']+)'\s*,\s*'([^']+)'/i);
            const actor = m ? m[1] : 'pm';
            const action = m ? m[2] : 'unknown';
            const target_user_id = params[0] as number | null;
            const details = params[1] as string;
            const created_at = params[2] as number;
            const row: AuditRow = {
              id: nextAuditId++,
              actor,
              action,
              target_event_id: null,
              target_user_id,
              details,
              created_at,
            };
            audit.push(row);
            return Promise.resolve({ success: true, meta: { changes: 1, last_row_id: row.id, duration: 0 } });
          }

          return Promise.resolve({ success: true });
        },
        raw<T = unknown>(): Promise<T[]> {
          return Promise.resolve([]);
        },
      };
      return stmt;
    },
    batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      return Promise.all(statements.map((s) => s.run())) as Promise<D1Result<T>[]>;
    },
    exec(): Promise<{ count: number; duration: number }> {
      return Promise.resolve({ count: 0, duration: 0 });
    },
  };
}

const SECRET = 'unit-test-secret-1234567890';

function envObj() {
  return { DB: makeMockDb(), JWT_SECRET: SECRET };
}

async function call(path: string, init: RequestInit = {}, env = envObj()) {
  return app.request(`http://test.local${path}`, init, env);
}

async function pmCookie(userId = 1): Promise<string> {
  const token = await signSession({ user_id: userId, exp: 9999999999 }, SECRET);
  return `pm_session=${token}`;
}

// =============================================================
// Type helpers
// =============================================================

interface CoinRequestResponse {
  id?: number;
  status?: string;
  amount?: number;
  requested_at?: number;
  error?: { code: string; message: string };
}

interface CoinRequestListResponse {
  requests?: CoinRequestRow[];
  error?: { code: string; message: string };
}

interface AdminCoinRequestListResponse {
  count?: number;
  requests?: CoinRequestRow[];
  error?: { code: string; message: string };
}

// =============================================================
// GET /api/coins/requests (kid list own history — no auth)
// =============================================================

describe('GET /api/coins/requests (kid — no auth required)', () => {
  beforeEach(reset);

  it('returns empty array when kid has no requests', async () => {
    const r = await call('/api/coins/requests');
    expect(r.status).toBe(200);
    const body = (await r.json()) as CoinRequestListResponse;
    expect(body.requests).toHaveLength(0);
  });

  it('returns kid\'s own requests only, newest first', async () => {
    addUser(2, 'child');
    addCoinRequest({ user_id: 2, amount: 10, reason: 'req A' });
    addCoinRequest({ user_id: 3, amount: 20, reason: 'other kid' }); // distractor
    addCoinRequest({ user_id: 2, amount: 30, reason: 'req B' });

    // Patch timestamps so ordering is deterministic
    const now = Math.floor(Date.now() / 1000);
    coinRequests[0].requested_at = now - 100; // req A (older)
    coinRequests[2].requested_at = now;        // req B (newer)

    const r = await call('/api/coins/requests');
    expect(r.status).toBe(200);
    const body = (await r.json()) as CoinRequestListResponse;
    expect(body.requests).toHaveLength(2);
    expect(body.requests![0].reason).toBe('req B');  // newest first
    expect(body.requests![1].reason).toBe('req A');
  });

  it('limits to 50 rows', async () => {
    addUser(2, 'child');
    // Add 52 requests — mock limits via the limit param in SELECT
    for (let i = 0; i < 52; i++) {
      addCoinRequest({ user_id: 2, amount: i + 1, reason: `req ${i}` });
    }

    const r = await call('/api/coins/requests');
    expect(r.status).toBe(200);
    const body = (await r.json()) as CoinRequestListResponse;
    expect(body.requests).toHaveLength(50);
  });
});

// =============================================================
// POST /api/coins/request (kid submits coin request)
// =============================================================

describe('POST /api/coins/request (kid — no auth required)', () => {
  beforeEach(reset);

  it('201 happy path: returns id, status=pending, amount, requested_at', async () => {
    const r = await call('/api/coins/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 50, reason: 'Good behavior bonus' }),
    });
    expect(r.status).toBe(201);
    const body = (await r.json()) as CoinRequestResponse;
    expect(typeof body.id).toBe('number');
    expect(body.status).toBe('pending');
    expect(body.amount).toBe(50);
    expect(typeof body.requested_at).toBe('number');
    // Row was written to DB
    expect(coinRequests).toHaveLength(1);
    expect(coinRequests[0].reason).toBe('Good behavior bonus');
    expect(coinRequests[0].user_id).toBe(2); // CHILD_USER_ID
  });

  it('trims reason before saving', async () => {
    const r = await call('/api/coins/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 10, reason: '  padded reason  ' }),
    });
    expect(r.status).toBe(201);
    expect(coinRequests[0].reason).toBe('padded reason');
  });

  it('400 BAD_REQUEST when amount is missing', async () => {
    const r = await call('/api/coins/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'no amount' }),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as CoinRequestResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(coinRequests).toHaveLength(0);
  });

  it('400 BAD_REQUEST when amount is not a number', async () => {
    const r = await call('/api/coins/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 'fifty', reason: 'test' }),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as CoinRequestResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('400 BAD_REQUEST when amount is 0', async () => {
    const r = await call('/api/coins/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 0, reason: 'zero' }),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as CoinRequestResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('400 BAD_REQUEST when amount is negative', async () => {
    const r = await call('/api/coins/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: -5, reason: 'negative' }),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as CoinRequestResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('400 BAD_REQUEST when amount > 999', async () => {
    const r = await call('/api/coins/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 1000, reason: 'too big' }),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as CoinRequestResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('400 BAD_REQUEST when reason is missing', async () => {
    const r = await call('/api/coins/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 10 }),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as CoinRequestResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(coinRequests).toHaveLength(0);
  });

  it('400 BAD_REQUEST when reason is empty string', async () => {
    const r = await call('/api/coins/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 10, reason: '' }),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as CoinRequestResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('400 BAD_REQUEST when reason is whitespace only', async () => {
    const r = await call('/api/coins/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 10, reason: '   ' }),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as CoinRequestResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('400 BAD_REQUEST when reason exceeds 200 characters', async () => {
    const r = await call('/api/coins/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 10, reason: 'x'.repeat(201) }),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as CoinRequestResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('400 BAD_REQUEST for non-JSON body', async () => {
    const r = await call('/api/coins/request', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not json',
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as CoinRequestResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });
});

// =============================================================
// GET /api/admin/coin-requests (admin list — PM guard)
// =============================================================

describe('GET /api/admin/coin-requests', () => {
  beforeEach(reset);

  it('returns 401 without session cookie (requirePm guard)', async () => {
    const r = await call('/api/admin/coin-requests');
    expect(r.status).toBe(401);
    const body = (await r.json()) as AdminCoinRequestListResponse;
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });

  it('returns only pending requests by default', async () => {
    addUser(1, 'pm');
    addCoinRequest({ status: 'pending', amount: 10 });
    addCoinRequest({ status: 'approved', amount: 20 });
    addCoinRequest({ status: 'rejected', amount: 30 });

    const cookie = await pmCookie();
    const r = await call('/api/admin/coin-requests', { headers: { cookie } });
    expect(r.status).toBe(200);
    const body = (await r.json()) as AdminCoinRequestListResponse;
    expect(body.count).toBe(1);
    expect(body.requests![0].status).toBe('pending');
  });

  it('?status=approved returns only approved requests', async () => {
    addUser(1, 'pm');
    addCoinRequest({ status: 'pending', amount: 10 });
    addCoinRequest({ status: 'approved', amount: 20 });
    addCoinRequest({ status: 'rejected', amount: 30 });

    const cookie = await pmCookie();
    const r = await call('/api/admin/coin-requests?status=approved', { headers: { cookie } });
    expect(r.status).toBe(200);
    const body = (await r.json()) as AdminCoinRequestListResponse;
    expect(body.count).toBe(1);
    expect(body.requests![0].status).toBe('approved');
  });

  it('?status=all returns all requests', async () => {
    addUser(1, 'pm');
    addCoinRequest({ status: 'pending', amount: 10 });
    addCoinRequest({ status: 'approved', amount: 20 });
    addCoinRequest({ status: 'rejected', amount: 30 });

    const cookie = await pmCookie();
    const r = await call('/api/admin/coin-requests?status=all', { headers: { cookie } });
    expect(r.status).toBe(200);
    const body = (await r.json()) as AdminCoinRequestListResponse;
    expect(body.count).toBe(3);
  });

  it('400 BAD_REQUEST for unknown status value', async () => {
    addUser(1, 'pm');
    const cookie = await pmCookie();
    const r = await call('/api/admin/coin-requests?status=unknown', { headers: { cookie } });
    expect(r.status).toBe(400);
    const body = (await r.json()) as AdminCoinRequestListResponse;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('pending requests ordered ASC by requested_at (FIFO)', async () => {
    addUser(1, 'pm');
    addCoinRequest({ status: 'pending', amount: 10, reason: 'second' });
    addCoinRequest({ status: 'pending', amount: 5,  reason: 'first' });

    const now = Math.floor(Date.now() / 1000);
    coinRequests[0].requested_at = now - 100; // second (older)
    coinRequests[1].requested_at = now - 50;  // first (newer)

    const cookie = await pmCookie();
    const r = await call('/api/admin/coin-requests', { headers: { cookie } });
    expect(r.status).toBe(200);
    const body = (await r.json()) as AdminCoinRequestListResponse;
    expect(body.requests![0].reason).toBe('second');  // older → first (FIFO)
    expect(body.requests![1].reason).toBe('first');
  });
});

// =============================================================
// POST /api/admin/coin-requests/:id/approve
// =============================================================

describe('POST /api/admin/coin-requests/:id/approve', () => {
  beforeEach(reset);

  it('returns 401 without session cookie', async () => {
    const r = await call('/api/admin/coin-requests/1/approve', { method: 'POST' });
    expect(r.status).toBe(401);
  });

  it('400 BAD_REQUEST for non-positive id', async () => {
    addUser(1, 'pm');
    const cookie = await pmCookie();
    const r = await call('/api/admin/coin-requests/0/approve', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('404 when coin request does not exist', async () => {
    addUser(1, 'pm');
    const cookie = await pmCookie();
    const r = await call('/api/admin/coin-requests/999/approve', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(404);
    const body = (await r.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('409 INVALID_STATUS when request is already approved', async () => {
    addUser(1, 'pm');
    addCoinRequest({ status: 'approved', reviewed_at: 100, reviewed_by: 1 });

    const cookie = await pmCookie();
    const r = await call('/api/admin/coin-requests/1/approve', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(409);
    const body = (await r.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_STATUS');
  });

  it('409 INVALID_STATUS when request is already rejected', async () => {
    addUser(1, 'pm');
    addCoinRequest({ status: 'rejected', reviewed_at: 100, reviewed_by: 1 });

    const cookie = await pmCookie();
    const r = await call('/api/admin/coin-requests/1/approve', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(409);
    const body = (await r.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_STATUS');
  });

  it('200 happy path: returns id, status=approved, amount, score_event_id', async () => {
    addUser(1, 'pm');
    addCoinRequest({ user_id: 2, amount: 55, reason: 'Great work!' });

    const cookie = await pmCookie();
    const r = await call('/api/admin/coin-requests/1/approve', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { id: number; status: string; amount: number; score_event_id?: number };
    expect(body.id).toBe(1);
    expect(body.status).toBe('approved');
    expect(body.amount).toBe(55);
    expect(typeof body.score_event_id).toBe('number');

    // score_events row written
    expect(scoreEvents).toHaveLength(1);
    expect(scoreEvents[0].user_id).toBe(2);
    expect(scoreEvents[0].type).toBe('coins');
    expect(scoreEvents[0].change_value).toBe(55);
    expect(scoreEvents[0].source).toBe('manual');
    expect(scoreEvents[0].source_ref).toBe('coin_request:1');

    // coin_requests updated
    expect(coinRequests[0].status).toBe('approved');
    expect(coinRequests[0].reviewed_by).toBe(1);
  });

  it('writes audit_log with action=coin_request_approved', async () => {
    addUser(1, 'pm');
    addCoinRequest({ user_id: 2, amount: 77, reason: 'Bonus' });

    const cookie = await pmCookie();
    await call('/api/admin/coin-requests/1/approve', {
      method: 'POST',
      headers: { cookie },
    });

    expect(audit).toHaveLength(1);
    expect(audit[0].actor).toBe('pm');
    expect(audit[0].action).toBe('coin_request_approved');
    expect(audit[0].target_user_id).toBe(2);
    const details = JSON.parse(audit[0].details);
    expect(details.request_id).toBe(1);
    expect(details.amount).toBe(77);
    expect(details.reason).toBe('Bonus');
  });

  it('accepts optional note via body.note', async () => {
    addUser(1, 'pm');
    addCoinRequest({ user_id: 2, amount: 10, reason: 'Test' });

    const cookie = await pmCookie();
    const r = await call('/api/admin/coin-requests/1/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ note: 'Well done!' }),
    });
    expect(r.status).toBe(200);
    expect(coinRequests[0].review_note).toBe('Well done!');
  });

  it('accepts optional note via ?note= query param', async () => {
    addUser(1, 'pm');
    addCoinRequest({ user_id: 2, amount: 10, reason: 'Test' });

    const cookie = await pmCookie();
    const r = await call('/api/admin/coin-requests/1/approve?note=From+query', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(200);
    expect(coinRequests[0].review_note).toBe('From query');
  });
});

// =============================================================
// POST /api/admin/coin-requests/:id/reject
// =============================================================

describe('POST /api/admin/coin-requests/:id/reject', () => {
  beforeEach(reset);

  it('returns 401 without session cookie', async () => {
    const r = await call('/api/admin/coin-requests/1/reject', { method: 'POST' });
    expect(r.status).toBe(401);
  });

  it('400 BAD_REQUEST for non-positive id', async () => {
    addUser(1, 'pm');
    const cookie = await pmCookie();
    const r = await call('/api/admin/coin-requests/-1/reject', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('404 when coin request does not exist', async () => {
    addUser(1, 'pm');
    const cookie = await pmCookie();
    const r = await call('/api/admin/coin-requests/999/reject', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({ note: 'test' }),
    });
    expect(r.status).toBe(404);
    const body = (await r.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('400 BAD_REQUEST when note is missing (required for rejection)', async () => {
    addUser(1, 'pm');
    addCoinRequest({ status: 'pending' });

    const cookie = await pmCookie();
    const r = await call('/api/admin/coin-requests/1/reject', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('400 BAD_REQUEST when note is empty string', async () => {
    addUser(1, 'pm');
    addCoinRequest({ status: 'pending' });

    const cookie = await pmCookie();
    const r = await call('/api/admin/coin-requests/1/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ note: '' }),
    });
    expect(r.status).toBe(400);
  });

  it('409 INVALID_STATUS when request is already approved', async () => {
    addUser(1, 'pm');
    addCoinRequest({ status: 'approved', reviewed_at: 100, reviewed_by: 1 });

    const cookie = await pmCookie();
    const r = await call('/api/admin/coin-requests/1/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ note: 'Too late' }),
    });
    expect(r.status).toBe(409);
    const body = (await r.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_STATUS');
  });

  it('200 happy path: returns id, status=rejected', async () => {
    addUser(1, 'pm');
    addCoinRequest({ user_id: 2, amount: 30, reason: 'Suspicious' });

    const cookie = await pmCookie();
    const r = await call('/api/admin/coin-requests/1/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ note: 'Not enough detail' }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { id: number; status: string };
    expect(body.id).toBe(1);
    expect(body.status).toBe('rejected');

    // coin_requests updated
    expect(coinRequests[0].status).toBe('rejected');
    expect(coinRequests[0].reviewed_by).toBe(1);
    expect(coinRequests[0].review_note).toBe('Not enough detail');

    // No score_events written for rejected
    expect(scoreEvents).toHaveLength(0);
  });

  it('writes audit_log with action=coin_request_rejected including reject_note', async () => {
    addUser(1, 'pm');
    addCoinRequest({ user_id: 2, amount: 88, reason: 'Request' });

    const cookie = await pmCookie();
    await call('/api/admin/coin-requests/1/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ note: 'Too vague' }),
    });

    expect(audit).toHaveLength(1);
    expect(audit[0].actor).toBe('pm');
    expect(audit[0].action).toBe('coin_request_rejected');
    expect(audit[0].target_user_id).toBe(2);
    const details = JSON.parse(audit[0].details);
    expect(details.request_id).toBe(1);
    expect(details.amount).toBe(88);
    expect(details.reason).toBe('Request');
    expect(details.reject_note).toBe('Too vague');
  });

  it('accepts note via ?note= query param as fallback', async () => {
    addUser(1, 'pm');
    addCoinRequest({ user_id: 2, amount: 10, reason: 'Test' });

    const cookie = await pmCookie();
    const r = await call('/api/admin/coin-requests/1/reject?note=Via+query', {
      method: 'POST',
      headers: { cookie },
    });
    expect(r.status).toBe(200);
    expect(coinRequests[0].review_note).toBe('Via query');
  });
});

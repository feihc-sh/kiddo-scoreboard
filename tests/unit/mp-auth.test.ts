// tests/unit/mp-auth.test.ts
// TDD: tests for POST /api/mp/auth (wx.login bridge).
// Verifies openid → userId binding, new user creation, and error handling.
// Uses vi.stubGlobal('fetch') + mock D1.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import app from '../../src/worker.ts';
import type { D1Database, D1PreparedStatement, D1Result } from '../../src/db/types.ts';

// =============================================================
// Mock D1
// =============================================================

interface UserRow {
  id: number;
  name: string;
  role: 'child' | 'pm';
  openid: string | null;
  family_id: number | null;
  created_at: number;
  updated_at: number;
}

let users: UserRow[] = [];
let nextUserId = 1;

function resetUsers() {
  users = [];
  nextUserId = 1;
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
          // SELECT ... FROM users WHERE openid = ?
          if (/WHERE openid\s*=\s*\?/i.test(query)) {
            const openid = params[0] as string;
            const u = users.find((x) => x.openid === openid) as T | undefined;
            return Promise.resolve(u ?? null);
          }
          return Promise.resolve(null);
        },
        all: () => Promise.resolve({ results: [], success: true }),
        run<T = unknown>(): Promise<D1Result<T>> {
          // INSERT INTO users ...
          if (/INSERT INTO users/i.test(query)) {
            const [openid, now] = params as [string, number];
            const newUser: UserRow = {
              id: nextUserId++,
              name: '',
              role: 'child',
              openid,
              family_id: null,
              created_at: now,
              updated_at: now,
            };
            users.push(newUser);
            return Promise.resolve({
              success: true,
              meta: { changes: 1, last_row_id: newUser.id, duration: 0 },
            } as D1Result<T>);
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

function makeEnv(db: D1Database) {
  return {
    DB: db,
    JWT_SECRET: 'test-secret',
    ASSETS: {} as Fetcher,
    WECHAT_APPID: 'test-appid',
    WECHAT_SECRET: 'test-secret',
  };
}

// =============================================================
// Helpers
// =============================================================

async function call(path: string, init: RequestInit = {}, env?: ReturnType<typeof makeEnv>) {
  return app.request(`http://test.local${path}`, init, (env ?? makeEnv(makeMockDb())) as Parameters<typeof app.request>[2]);
}

// =============================================================
// Tests
// =============================================================

describe('POST /api/mp/auth', () => {
  beforeEach(() => {
    resetUsers();
    // Reset fetch mock between tests
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 400 when body is missing', async () => {
    const db = makeMockDb();
    const r = await call('/api/mp/auth', { method: 'POST' }, makeEnv(db));
    expect(r.status).toBe(400);
  });

  it('returns 400 when code is not a string', async () => {
    const db = makeMockDb();
    const r = await call('/api/mp/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 123 }),
    }, makeEnv(db));
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(body.error?.message).toMatch(/code must be a non-empty string/);
  });

  it('returns 400 when code is an empty string', async () => {
    const db = makeMockDb();
    const r = await call('/api/mp/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '  ' }),
    }, makeEnv(db));
    expect(r.status).toBe(400);
  });

  it('returns 500 when WECHAT_APPID is missing', async () => {
    const db = makeMockDb();
    const env = {
      DB: db,
      JWT_SECRET: 'test-secret',
      ASSETS: {} as Fetcher,
      WECHAT_APPID: '',
      WECHAT_SECRET: 'test-secret',
    };
    const r = await call('/api/mp/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'wx-code-001' }),
    }, env as ReturnType<typeof makeEnv>);
    expect(r.status).toBe(500);
    const body = (await r.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('SERVER_MISCONFIG');
  });

  it('returns 500 when WECHAT_SECRET is missing', async () => {
    const db = makeMockDb();
    const env = {
      DB: db,
      JWT_SECRET: 'test-secret',
      ASSETS: {} as Fetcher,
      WECHAT_APPID: 'test-appid',
      WECHAT_SECRET: '',
    };
    const r = await call('/api/mp/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'wx-code-001' }),
    }, env as ReturnType<typeof makeEnv>);
    expect(r.status).toBe(500);
  });

  it('returns 400 when wx code2Session returns errcode != 0', async () => {
    const db = makeMockDb();
    // Mock fetch: wx API returns HTTP 200 with errcode != 0 in body.
    // Using a factory so each call gets a fresh Response (Response is single-use).
    globalThis.fetch = vi.fn().mockImplementation(
      () => Promise.resolve(
        new Response(JSON.stringify({ errcode: 40029, errmsg: 'invalid code' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const r = await call('/api/mp/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'wx-code-001' }),
    }, makeEnv(db));
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('WECHAT_API_ERROR');
  });

  it('returns 200 + existing user when openid is already registered', async () => {
    const db = makeMockDb();
    // Pre-seed an existing user
    const now = Math.floor(Date.now() / 1000);
    users.push({
      id: 42,
      name: '小明',
      role: 'child',
      openid: 'existing-openid-abc123',
      family_id: null,
      created_at: now,
      updated_at: now,
    });
    // Mock fetch: wx API returns openid (factory for fresh Response each call)
    globalThis.fetch = vi.fn().mockImplementation(
      () => Promise.resolve(
        new Response(JSON.stringify({ openid: 'existing-openid-abc123', session_key: 'skey' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const r = await call('/api/mp/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'wx-code-existing' }),
    }, makeEnv(db));
    expect(r.status).toBe(200);
    const body = (await r.json()) as { openid: string; userId: number; role: string; familyId: number | null };
    expect(body.openid).toBe('existing-openid-abc123');
    expect(body.userId).toBe(42);
    expect(body.role).toBe('child');
    expect(body.familyId).toBeNull();
  });

  it('creates a new child user when openid is not registered', async () => {
    const db = makeMockDb();
    // Mock fetch: wx API returns new openid
    globalThis.fetch = vi.fn().mockImplementation(
      () => Promise.resolve(
        new Response(JSON.stringify({ openid: 'new-openid-xyz789', session_key: 'skey-new' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const r = await call('/api/mp/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'wx-code-new' }),
    }, makeEnv(db));
    expect(r.status).toBe(200);
    const body = (await r.json()) as { openid: string; userId: number; role: string; familyId: number | null };
    expect(body.openid).toBe('new-openid-xyz789');
    expect(body.userId).toBe(1);
    expect(body.role).toBe('child');
    expect(body.familyId).toBeNull();
    // Verify user was actually inserted into mock D1
    expect(users).toHaveLength(1);
    expect(users[0].openid).toBe('new-openid-xyz789');
    expect(users[0].role).toBe('child');
  });

  it('returns the same userId for consecutive logins (openid→userId stable)', async () => {
    const db = makeMockDb();
    // Mock fetch: wx API returns same openid (factory = fresh Response per call)
    globalThis.fetch = vi.fn().mockImplementation(
      () => Promise.resolve(
        new Response(JSON.stringify({ openid: 'stable-openid-001', session_key: 'skey' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    // First login — creates user
    const r1 = await call('/api/mp/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'code-001' }),
    }, makeEnv(db));
    expect(r1.status).toBe(200);
    const body1 = (await r1.json()) as { openid: string; userId: number; role: string };
    expect(body1.userId).toBe(1);

    // Second login — same openid → same userId (no duplicate created)
    const r2 = await call('/api/mp/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'code-002' }),
    }, makeEnv(db));
    expect(r2.status).toBe(200);
    const body2 = (await r2.json()) as { openid: string; userId: number; role: string };
    expect(body2.userId).toBe(1);
    expect(body2.openid).toBe('stable-openid-001');
    // Only one user created despite two logins
    expect(users).toHaveLength(1);
  });
});

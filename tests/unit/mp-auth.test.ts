// tests/unit/mp-auth.test.ts
// TDD: tests for POST /api/mp/auth (wx.login bridge).
// Verifies openid → userId binding, new user creation, and error handling.
// Uses mock fetch (for wx code2Session) + mock D1.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import app from '../../src/worker.ts';
import type { D1Database, D1PreparedStatement, D1Result } from '../../src/db/types.ts';

// =============================================================
// Mock fetch (global)
// =============================================================

type MockFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

let mockWxResponse: Partial<{
  openid: string;
  session_key: string;
  errcode: number;
  errmsg: string;
}> = {};
let mockFetch: MockFetch | null = null;

function mockWxCode2Session(resp: typeof mockWxResponse) {
  mockWxResponse = resp;
}

function makeFakeFetch(): MockFetch {
  return async (url: string) => {
    if (url.includes('api.weixin.qq.com')) {
      const body = JSON.stringify(mockWxResponse);
      const status = mockWxResponse.errcode === 0 ? 200 : 400;
      return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('Not Found', { status: 404 });
  };
}

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

async function call(path: string, init: RequestInit = {}, env: ReturnType<typeof makeEnv>) {
  // Inject mock fetch if provided
  const globalFetch = mockFetch ?? makeFakeFetch();
  return app.request(`http://test.local${path}`, init, env as Parameters<typeof app.request>[2]);
}

// =============================================================
// Tests
// =============================================================

describe('POST /api/mp/auth', () => {
  beforeEach(() => {
    resetUsers();
    mockWxResponse = {};
    // Reset global fetch mock
    if (typeof globalThis.fetch === 'function') {
      // save
    }
  });

  it('returns 400 when body is missing', async () => {
    const db = makeMockDb();
    const fakeFetch = makeFakeFetch();
    const r = await app.request('http://test.local/api/mp/auth', { method: 'POST' }, makeEnv(db) as Parameters<typeof app.request>[2]);
    // No fetch will be called because body parse fails first
    expect(r.status).toBe(400);
  });

  it('returns 400 when code is not a string', async () => {
    const db = makeMockDb();
    const r = await app.request('http://test.local/api/mp/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 123 }),
    }, makeEnv(db) as Parameters<typeof app.request>[2]);
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('BAD_REQUEST');
    expect(body.error?.message).toMatch(/code must be a non-empty string/);
  });

  it('returns 400 when code is an empty string', async () => {
    const db = makeMockDb();
    const r = await app.request('http://test.local/api/mp/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '  ' }),
    }, makeEnv(db) as Parameters<typeof app.request>[2]);
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
    const r = await app.request('http://test.local/api/mp/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'wx-code-001' }),
    }, env as Parameters<typeof app.request>[2]);
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
    const r = await app.request('http://test.local/api/mp/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'wx-code-001' }),
    }, env as Parameters<typeof app.request>[2]);
    expect(r.status).toBe(500);
  });

  it('returns 400 when wx code2Session returns errcode != 0', async () => {
    const db = makeMockDb();
    const fakeFetch = makeFakeFetch();
    mockWxCode2Session({ errcode: 40029, errmsg: 'invalid code' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch as unknown as typeof fetch;
    try {
      const r = await app.request('http://test.local/api/mp/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'wx-code-001' }),
      }, makeEnv(db) as Parameters<typeof app.request>[2]);
      expect(r.status).toBe(400);
      const body = (await r.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBe('WECHAT_API_ERROR');
    } finally {
      globalThis.fetch = originalFetch as typeof fetch;
    }
  });

  it('returns existing user when openid is already registered', async () => {
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

    const fakeFetch = makeFakeFetch();
    mockWxCode2Session({ openid: 'existing-openid-abc123', session_key: 'skey' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch as unknown as typeof fetch;
    try {
      const r = await app.request('http://test.local/api/mp/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'wx-code-existing' }),
      }, makeEnv(db) as Parameters<typeof app.request>[2]);
      expect(r.status).toBe(200);
      const body = (await r.json()) as { openid: string; userId: number; role: string; familyId: number | null };
      expect(body.openid).toBe('existing-openid-abc123');
      expect(body.userId).toBe(42);
      expect(body.role).toBe('child');
      expect(body.familyId).toBeNull();
    } finally {
      globalThis.fetch = originalFetch as typeof fetch;
    }
  });

  it('creates a new child user when openid is not registered', async () => {
    const db = makeMockDb();
    const fakeFetch = makeFakeFetch();
    mockWxCode2Session({ openid: 'new-openid-xyz789', session_key: 'skey-new' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch as unknown as typeof fetch;
    try {
      const r = await app.request('http://test.local/api/mp/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'wx-code-new' }),
      }, makeEnv(db) as Parameters<typeof app.request>[2]);
      expect(r.status).toBe(200);
      const body = (await r.json()) as { openid: string; userId: number; role: string; familyId: number | null };
      expect(body.openid).toBe('new-openid-xyz789');
      expect(body.userId).toBe(1); // first user, id=1
      expect(body.role).toBe('child');
      expect(body.familyId).toBeNull();
      // Verify user was actually inserted
      expect(users).toHaveLength(1);
      expect(users[0].openid).toBe('new-openid-xyz789');
      expect(users[0].role).toBe('child');
    } finally {
      globalThis.fetch = originalFetch as typeof fetch;
    }
  });

  it('returns the correct userId for consecutive logins (openid→userId stable)', async () => {
    const db = makeMockDb();
    const fakeFetch = makeFakeFetch();
    mockWxCode2Session({ openid: 'stable-openid-001', session_key: 'skey' });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fakeFetch as unknown as typeof fetch;
    try {
      // First login — creates user
      const r1 = await app.request('http://test.local/api/mp/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'code-001' }),
      }, makeEnv(db) as Parameters<typeof app.request>[2]);
      expect(r1.status).toBe(200);
      const body1 = (await r1.json()) as { openid: string; userId: number; role: string };
      expect(body1.userId).toBe(1);

      // Second login — same user
      const r2 = await app.request('http://test.local/api/mp/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'code-002' }),
      }, makeEnv(db) as Parameters<typeof app.request>[2]);
      expect(r2.status).toBe(200);
      const body2 = (await r2.json()) as { openid: string; userId: number; role: string };
      expect(body2.userId).toBe(1);
      expect(body2.openid).toBe('stable-openid-001');
      // No duplicate user created
      expect(users).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch as typeof fetch;
    }
  });
});

// tests/unit/public-user.test.ts
// Integration tests for GET /api/public/user/:id
// Read-only endpoint: returns user info WITHOUT pin_hash.
import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/worker.ts';
import type { D1Database, D1PreparedStatement, D1Result } from '../../src/db/types.ts';

interface UserRow {
  id: number;
  name: string;
  role: 'child' | 'pm';
  pin_hash: string | null;
  created_at: number;
  updated_at: number;
}

let users: UserRow[] = [];

function reset() {
  users = [];
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
          if (/FROM users WHERE id = \?/.test(query)) {
            const id = params[0] as number;
            const u = users.find((x) => x.id === id);
            return Promise.resolve((u ?? null) as T);
          }
          return Promise.resolve(null);
        },
        all: () => Promise.resolve({ results: [], success: true }),
        run<T = unknown>(): Promise<D1Result<T>> {
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

const SECRET = 'unit-test-secret-1234567890';

function envObj(): { DB: D1Database; JWT_SECRET: string } {
  return { DB: makeMockDb(), JWT_SECRET: SECRET };
}

async function call(path: string, init: RequestInit = {}, env = envObj()) {
  return app.request(`http://test.local${path}`, init, env);
}

function addChildUser(id: number, name: string) {
  const now = Math.floor(Date.now() / 1000);
  users.push({
    id,
    name,
    role: 'child',
    pin_hash: null,
    created_at: now,
    updated_at: now,
  });
}

function addPmUser(id: number, name = 'PM') {
  const now = Math.floor(Date.now() / 1000);
  users.push({
    id,
    name,
    role: 'pm',
    pin_hash: 'fake-pm-pin-hash',
    created_at: now,
    updated_at: now,
  });
}

interface PublicUserBody {
  id?: number;
  name?: string;
  role?: string;
  is_first_time?: boolean;
  pin_hash?: string;
  error?: { code?: string; message?: string };
}

describe('GET /api/public/user/:id', () => {
  beforeEach(reset);

  it('returns 400 when id is non-numeric', async () => {
    const r = await call('/api/public/user/abc');
    expect(r.status).toBe(400);
    const body = (await r.json()) as PublicUserBody;
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('returns 404 when user does not exist', async () => {
    const r = await call('/api/public/user/999');
    expect(r.status).toBe(404);
    const body = (await r.json()) as PublicUserBody;
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('returns is_first_time=true for child with empty name', async () => {
    addChildUser(2, '');
    const r = await call('/api/public/user/2');
    expect(r.status).toBe(200);
    const body = (await r.json()) as PublicUserBody;
    expect(body).toEqual({ id: 2, name: '', role: 'child', is_first_time: true });
  });

  it('returns is_first_time=false for child with a name', async () => {
    addChildUser(3, 'Tom');
    const r = await call('/api/public/user/3');
    expect(r.status).toBe(200);
    const body = (await r.json()) as PublicUserBody;
    expect(body).toEqual({ id: 3, name: 'Tom', role: 'child', is_first_time: false });
  });

  it('returns PM user without pin_hash', async () => {
    addPmUser(1, 'Alice');
    const r = await call('/api/public/user/1');
    expect(r.status).toBe(200);
    const body = (await r.json()) as PublicUserBody;
    // The explicit shape: id, name, role, is_first_time (name is not empty).
    expect(body.id).toBe(1);
    expect(body.name).toBe('Alice');
    expect(body.role).toBe('pm');
    expect(body.is_first_time).toBe(false);
    // Security: pin_hash MUST NOT leak.
    expect(body.pin_hash).toBeUndefined();
  });
});

// tests/unit/admin-auth.test.ts
// Integration tests for /api/admin/auth/* routes + requirePm middleware.
import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/worker.ts';
import { hashPin } from '../../src/auth/pin.ts';
import { signSession } from '../../src/auth/session.ts';
import type { D1Database, D1PreparedStatement, D1Result } from '../../src/db/types.ts';

interface UserRow {
  id: number;
  name: string;
  role: 'child' | 'pm';
  pin_hash: string | null;
  created_at: number;
  updated_at: number;
}

interface AttemptRow {
  id: number;
  ip: string;
  success: 0 | 1;
  attempted_at: number;
}

interface AuditRow {
  id: number;
  actor: 'child' | 'pm' | 'system';
  action: string;
  target_event_id: number | null;
  target_user_id: number | null;
  details: string;
  created_at: number;
}

let users: UserRow[] = [];
let attempts: AttemptRow[] = [];
let audit: AuditRow[] = [];
let nextAttemptId = 1;
let nextAuditId = 1;
let nowOverride = Math.floor(Date.now() / 1000);

function reset() {
  users = [];
  attempts = [];
  audit = [];
  nextAttemptId = 1;
  nextAuditId = 1;
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
          if (/FROM users WHERE role = 'pm'/.test(query)) {
            const u = users.find((x) => x.role === 'pm');
            return Promise.resolve((u ?? null) as T);
          }
          if (/FROM users WHERE id = \?/.test(query)) {
            const id = params[0] as number;
            const u = users.find((x) => x.id === id);
            if (!u) return Promise.resolve(null);
            return Promise.resolve({ id: u.id, name: u.name, role: u.role } as T);
          }
          if (/FROM auth_attempts/.test(query)) {
            const cutoff = params[0] as number;
            const ip = params[1] as string;
            const n = attempts.filter(
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
              id: nextAttemptId++,
              ip,
              success,
              attempted_at: nowOverride,
            };
            attempts.push(row);
            return Promise.resolve({
              success: true,
              meta: { changes: 1, last_row_id: row.id, duration: 0 },
            });
          }
          if (/INSERT INTO audit_log/.test(query)) {
            const [actor, action, target_event_id, target_user_id, details] = params as [
              string, string, number | null, number | null, string,
            ];
            const row: AuditRow = {
              id: nextAuditId++,
              actor: actor as 'child' | 'pm' | 'system',
              action,
              target_event_id,
              target_user_id,
              details,
              created_at: nowOverride,
            };
            audit.push(row);
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

const SECRET = 'unit-test-secret-1234567890';

function envObj(): { DB: D1Database; JWT_SECRET: string } {
  return { DB: makeMockDb(), JWT_SECRET: SECRET };
}

async function call(path: string, init: RequestInit = {}, env = envObj()) {
  // Hono app.request signature: (input, requestInit?, env?, ctx?)
  // We pass env as the 3rd arg to avoid TypeScript RequestInit generic mismatch.
  return app.request(`http://test.local${path}`, init, env);
}

async function callHttps(path: string, init: RequestInit = {}, env = envObj()) {
  return app.request(`https://test.local${path}`, init, env);
}

async function addPmUser(pin = '1234') {
  const hash = await hashPin(pin, SECRET);
  users.push({
    id: 1,
    name: 'PM',
    role: 'pm',
    pin_hash: hash,
    created_at: nowOverride,
    updated_at: nowOverride,
  });
}

describe('POST /api/admin/auth/login', () => {
  beforeEach(reset);

  it('returns 400 when pin is missing', async () => {
    const r = await call('/api/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error?: { code?: string; message?: string }; user?: { id: number; name: string; role: string }; ok?: boolean };
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  it('returns 400 when pin is not 4-8 digits', async () => {
    const r = await call('/api/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '12' }),
    });
    expect(r.status).toBe(400);
  });

  it('returns 500 when no PM user exists', async () => {
    const r = await call('/api/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '1234' }),
    });
    expect(r.status).toBe(500);
  });

  it('returns 401 when PIN is wrong', async () => {
    await addPmUser('1234');
    const r = await call('/api/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '9999' }),
    });
    expect(r.status).toBe(401);
    const body = (await r.json()) as { error?: { code?: string; message?: string }; user?: { id: number; name: string; role: string }; ok?: boolean };
    expect(body.error?.code).toBe('INVALID_PIN');
    expect(attempts.filter((a) => a.success === 0)).toHaveLength(1);
    expect(audit.some((a) => a.action === 'login_failed')).toBe(true);
  });

  it('returns 200 + Set-Cookie on correct PIN', async () => {
    await addPmUser('5678');
    const r = await call('/api/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '5678' }),
    });
    expect(r.status).toBe(200);
    const setCookie = r.headers.get('set-cookie');
    expect(setCookie).toMatch(/pm_session=[^;]+;/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    // http (test/wrangler dev): no Secure flag
    expect(setCookie).not.toMatch(/;\s*Secure/);
    const body = (await r.json()) as { error?: { code?: string; message?: string }; user?: { id: number; name: string; role: string }; ok?: boolean };
    expect(body.user).toEqual({ id: 1, name: 'PM', role: 'pm' });
    expect(attempts.filter((a) => a.success === 1)).toHaveLength(1);
    expect(audit.some((a) => a.action === 'login')).toBe(true);
  });

  it('sets Secure flag on cookie when request is HTTPS (production)', async () => {
    await addPmUser('9999');
    const r = await callHttps('/api/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '9999' }),
    });
    expect(r.status).toBe(200);
    const setCookie = r.headers.get('set-cookie');
    expect(setCookie).toMatch(/;\s*Secure/);
  });

  it('clears Secure flag on logout cookie when request is HTTPS (production)', async () => {
    // First login to get a session
    await addPmUser('8888');
    const loginR = await callHttps('/api/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '8888' }),
    });
    const cookie = loginR.headers.get('set-cookie')!.split(';')[0];
    // Then logout
    const r = await callHttps('/api/admin/auth/logout', {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(r.status).toBe(200);
    const setCookie = r.headers.get('set-cookie');
    expect(setCookie).toMatch(/Max-Age=0/);
    expect(setCookie).toMatch(/;\s*Secure/);
  });

  it('returns 429 when IP is locked out', async () => {
    await addPmUser('1234');
    for (let i = 0; i < 5; i++) {
      attempts.push({
        id: nextAttemptId++,
        ip: '127.0.0.1',
        success: 0,
        attempted_at: nowOverride,
      });
    }
    const r = await call(
      '/api/admin/auth/login',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': '127.0.0.1',
        },
        body: JSON.stringify({ pin: '1234' }),
      },
    );
    expect(r.status).toBe(429);
    const body = (await r.json()) as { error?: { code?: string; message?: string }; user?: { id: number; name: string; role: string }; ok?: boolean };
    expect(body.error?.code).toBe('TOO_MANY_ATTEMPTS');
  });
});

describe('POST /api/admin/auth/logout', () => {
  beforeEach(reset);

  it('clears cookie even when not logged in', async () => {
    const r = await call('/api/admin/auth/logout', { method: 'POST' });
    expect(r.status).toBe(200);
    const setCookie = r.headers.get('set-cookie');
    expect(setCookie).toMatch(/pm_session=;/);
    expect(setCookie).toMatch(/Max-Age=0/);
  });

  it('writes audit log when logged in', async () => {
    await addPmUser('1234');
    const token = await signSession(
      { user_id: 1, exp: nowOverride + 3600 },
      SECRET,
    );
    const r = await call('/api/admin/auth/logout', {
      method: 'POST',
      headers: { cookie: `pm_session=${token}` },
    });
    expect(r.status).toBe(200);
    expect(audit.some((a) => a.action === 'logout')).toBe(true);
  });
});

describe('GET /api/admin/auth/me', () => {
  beforeEach(reset);

  it('returns 401 without cookie', async () => {
    const r = await call('/api/admin/auth/me');
    expect(r.status).toBe(401);
  });

  it('returns 401 with bad cookie', async () => {
    const r = await call('/api/admin/auth/me', {
      headers: { cookie: 'pm_session=tampered' },
    });
    expect(r.status).toBe(401);
  });

  it('returns user with valid cookie', async () => {
    await addPmUser('1234');
    const token = await signSession(
      { user_id: 1, exp: nowOverride + 3600 },
      SECRET,
    );
    const r = await call('/api/admin/auth/me', {
      headers: { cookie: `pm_session=${token}` },
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { error?: { code?: string; message?: string }; user?: { id: number; name: string; role: string }; ok?: boolean };
    expect(body).toEqual({ id: 1, name: 'PM', role: 'pm' });
  });
});

describe('requirePm middleware', () => {
  beforeEach(reset);

  it('blocks access to admin route without valid session', async () => {
    const r = await call('/api/admin/auth/me');
    expect(r.status).toBe(401);
    const body = (await r.json()) as { error?: { code?: string; message?: string }; user?: { id: number; name: string; role: string }; ok?: boolean };
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });
});

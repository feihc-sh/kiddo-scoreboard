// tests/unit/health-events.test.ts
// Integration tests for the Health Checkin (健康打卡) v1 API:
//   GET    /api/public/health/events                 (月历查询 + active 检查)
//   POST   /api/me/health/events                     (child 打卡)
//   POST   /api/admin/health/events                  (PM 代记录)
//   PATCH  /api/admin/health/events/:id/resolve      (PM 标记已愈)
//
// Verifies: auth guards (requirePm for admin routes, hardcoded CHILD_USER_ID=2 for /me),
// input validation (event_type whitelist, date format, end_date >= start_date),
// happy paths with atomic db.batch(INSERT health_events, INSERT audit_log),
// immutability of score_events (zero decoupling — IMPL-1 §1.4 in test plan),
// and 13 EDGE cases from PM brief §2.3.
//
// Requires M1 implementation:
//   - src/db/types.ts: HealthEvent, HealthEventType, AuditAction extension
//   - src/routes/public/health.ts: GET endpoint
//   - src/routes/me/health.ts: POST endpoint (child, hardcoded user_id=2)
//   - src/routes/admin/health.ts: POST + PATCH endpoints (PM session)
//   - migrations/0008_health_events.sql: table + 3 indices
// Until M1 commits land in this branch (PM rebases), the import of
// HealthEvent/HealthEventType will throw — that is expected.

import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/worker.ts';
import { signSession } from '../../src/auth/session.ts';
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  HealthEvent,
  HealthEventType,
  ScoreEvent,
} from '../../src/db/types.ts';

// CHILD_USER_ID is hardcoded in src/routes/me/* (matches seeds/local.sql).
const CHILD_USER_ID = 2;
const PM_USER_ID = 1;

// 8 hardcoded event_types per RFC §2.2 — used for boundary sweep + validation.
const VALID_TYPES: readonly HealthEventType[] = [
  'ulcer', 'fever', 'cough', 'injury',
  'allergy', 'dizzy', 'vomit', 'other',
];

// ============================================================
// In-memory fixture tables
// ============================================================
interface UserRow {
  id: number;
  name: string;
  role: 'child' | 'pm';
  pin_hash: string | null;
  created_at: number;
  updated_at: number;
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
let healthEvents: HealthEvent[] = [];
let auditLog: AuditRow[] = [];
let scoreEvents: ScoreEvent[] = [];  // verify health event does NOT write score_events (IMPL-1)
let nextHealthId = 1;
let nextAuditId = 1;
let nextEventId = 1;
let nowOverride = 1_700_000_000;

// Capture every prepared statement that flows through .bind() AND every
// batch(). Used by AUDIT-3 to assert (INSERT health_events, INSERT audit_log)
// are in the SAME db.batch call (atomicity).
interface CapturedStmt { query: string; params: unknown[] }
let lastBind: CapturedStmt | null = null;
let batchCalls: CapturedStmt[][] = [];

function reset() {
  users = [];
  healthEvents = [];
  auditLog = [];
  scoreEvents = [];
  nextHealthId = 1;
  nextAuditId = 1;
  nextEventId = 1;
  nowOverride = 1_700_000_000;
  lastBind = null;
  batchCalls = [];
}

function seedUsers() {
  users.push(
    { id: PM_USER_ID, name: 'PM', role: 'pm', pin_hash: 'fake-hash', created_at: nowOverride, updated_at: nowOverride },
    { id: CHILD_USER_ID, name: '', role: 'child', pin_hash: null, created_at: nowOverride, updated_at: nowOverride },
  );
}

/**
 * Pre-seed an active or resolved health event. Used to set up EDGE cases
 * (e.g. EDGE-1 needs an existing active event before the test creates a 2nd).
 */
function seedHealthEvent(overrides: Partial<HealthEvent> = {}): HealthEvent {
  const id = overrides.id ?? nextHealthId++;
  const ev: HealthEvent = {
    id,
    user_id: CHILD_USER_ID,
    event_type: 'ulcer',
    start_date: '2026-06-14',
    end_date: null,
    is_resolved: 0,
    note: null,
    submitted_by: 'child',
    created_at: nowOverride,
    resolved_at: null,
    resolved_by: null,
    updated_at: nowOverride,
    ...overrides,
  };
  if (id >= nextHealthId) nextHealthId = id + 1;
  healthEvents.push(ev);
  return ev;
}

// ============================================================
// Mock D1 — patterned after tests/unit/admin-events-actions.test.ts
// ============================================================

function makeStmt(query: string): D1PreparedStatement & { _snapshot: () => CapturedStmt } {
  let params: unknown[] = [];
  const stmt = {
    bind(...values: unknown[]) {
      params = values;
      lastBind = {
        query: query.trim().replace(/\s+/g, ' '),
        params: values,
      };
      return stmt;
    },
    _snapshot(): CapturedStmt {
      return {
        query: query.trim().replace(/\s+/g, ' '),
        params: [...params],
      };
    },
    async first<T = unknown>(): Promise<T | null> {
      // SELECT FROM health_events WHERE id = ?
      if (/FROM\s+health_events\s+WHERE\s+id\s*=\s*\?/i.test(query)) {
        const id = params[0] as number;
        const found = healthEvents.find((h) => h.id === id) ?? null;
        return (found as unknown) as T;
      }
      // SELECT FROM users WHERE id = ?  (sanity check — admin may look up pm user)
      if (/FROM\s+users\s+WHERE\s+id\s*=\s*\?/i.test(query)) {
        const id = params[0] as number;
        const found = users.find((u) => u.id === id) ?? null;
        return (found as unknown) as T;
      }
      return null;
    },
    async all<T = unknown>(): Promise<D1Result<T>> {
      // List query: SELECT FROM health_events WHERE user_id=? [AND event_type=?] [AND ...] [ORDER BY start_date DESC]
      if (/FROM\s+health_events/i.test(query)) {
        // Walk bind params in order to derive the WHERE clauses.
        // CC writes inline `end_date IS NULL` and `start_date LIKE 'YYYY-MM-%'` as SQL
        // literals (param values are the placeholders). The pattern of the query
        // tells us which param slot is what:
        //   listActive:   params = [userId, eventType?]
        //   listByMonth:  params = [userId, eventType?, 'YYYY-MM-%']
        const userId = params[0] as number;
        const eventType = typeof params[1] === 'string' && !/^\d{4}-\d{2}-%/.test(params[1] as string)
          ? (params[1] as string)
          : null;
        const monthLike = typeof params[1] === 'string' && /^\d{4}-\d{2}-%$/.test(params[1] as string)
          ? (params[1] as string).replace(/-%$/, '')
          : (typeof params[2] === 'string' && /^\d{4}-\d{2}-%$/.test(params[2] as string)
            ? (params[2] as string).replace(/-%$/, '')
            : null);
        const onlyActive = /end_date\s+IS\s+NULL/i.test(query);

        const filtered = healthEvents.filter((h) => {
          if (h.user_id !== userId) return false;
          if (eventType !== null && h.event_type !== eventType) return false;
          if (onlyActive && h.end_date !== null) return false;
          if (monthLike !== null) {
            // SQL `start_date LIKE 'YYYY-MM-%'` is the primary match.
            // For cross-month events (start < month AND end >= month start), also include.
            // RFC §4.2.1: an event that "covers" any day in the month should appear.
            const monthStart = monthLike;
            const monthEnd = monthLike.replace(/-(\d{2})$/, (_m, mm) => {
              // Last day of month: for v1, use day 28 to keep it simple (real impl uses Date math).
              return `-${mm === '02' ? '28' : '30'}`;
            });
            const matchesStart = h.start_date.startsWith(monthStart);
            const matchesCross = h.end_date !== null && h.start_date <= monthEnd && h.end_date >= monthStart;
            if (!matchesStart && !matchesCross) return false;
          }
          return true;
        });

        // ORDER BY start_date DESC (default in route).
        filtered.sort((a, b) => (a.start_date < b.start_date ? 1 : -1));

        return { results: (filtered as unknown) as T[], success: true };
      }
      return { results: [], success: true };
    },
    async run<T = unknown>(): Promise<D1Result<T>> {
      // UPDATE health_events SET end_date=?, is_resolved=1, resolved_at=?, resolved_by=?, updated_at=? WHERE id=?
      if (/UPDATE\s+health_events/i.test(query)) {
        const id = params[params.length - 1] as number;
        const e = healthEvents.find((x) => x.id === id);
        if (e) {
          // Field assignment by column order — route inlines end_date/is_resolved/resolved_at/resolved_by/updated_at as bound params.
          // Conservative: just set the known fields by position.
          // Most routes bind: [end_date, resolved_at, resolved_by, updated_at, id]
          // or use SET col=? clauses we can parse.
          const setsClause = query.match(/SET\s+(.+?)\s+WHERE/i)?.[1] ?? '';
          const fieldMatches = [...setsClause.matchAll(/(\w+)\s*=\s*\?/g)].map((m) => m[1]);
          fieldMatches.forEach((field, idx) => {
            const v = params[idx];
            if (field in e) {
              (e as unknown as Record<string, unknown>)[field] = v;
            }
          });
        }
        return {
          success: true,
          meta: { changes: e ? 1 : 0, last_row_id: 0, duration: 0 },
        };
      }
      return { success: true };
    },
    raw<T = unknown>(): Promise<T[]> { return Promise.resolve([]); },
  };
  return stmt as unknown as D1PreparedStatement;
}

function makeMockDb(): D1Database {
  const db: D1Database = {
    prepare(query: string): D1PreparedStatement {
      return makeStmt(query);
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const captured: CapturedStmt[] = [];
      const results: D1Result<T>[] = [];
      let lastInsertId = 0;

      for (const s of statements) {
        // Per-statement snapshot — fixes bug where multiple stmts in a batch
        // all used the global lastBind (last one wins) instead of their own params.
        const snap = s._snapshot();
        const q = snap.query;
        const p = snap.params;
        const stmtLastBind = snap;

        if (/^INSERT INTO\s+health_events/i.test(q)) {
          const id = nextHealthId++;
          // Bound params (in order, per RFC §3.1):
          //   user_id, event_type, start_date, end_date, note, submitted_by
          // end_date / note may be NULL.
          // is_resolved/created_at/updated_at are inlined (defaults).
          const ev: HealthEvent = {
            id,
            user_id: p[0] as number,
            event_type: p[1] as HealthEventType,
            start_date: p[2] as string,
            end_date: (p[3] as string | null) ?? null,
            is_resolved: 0,
            note: (p[4] as string | null) ?? null,
            submitted_by: p[5] as 'child' | 'pm',
            created_at: nowOverride,
            resolved_at: null,
            resolved_by: null,
            updated_at: nowOverride,
          };
          healthEvents.push(ev);
          lastInsertId = id;
          results.push({ success: true, meta: { changes: 1, last_row_id: id, duration: 0 } } as D1Result<T>);
        } else if (/^INSERT INTO\s+audit_log/i.test(q)) {
          const id = nextAuditId++;
          // Bound params differ by action:
          //   create:  params = [actor, target_user_id, details]   (CC writes 'child' or 'pm' as bound ?)
          //   resolve: params = [actor, target_user_id, details]  (§4.2.4 + §4.2.5 — both bind actor)
          // Actor can be 'child' (self-resolve) or 'pm' (admin resolve).
          const actionMatch = q.match(/'(health_event_create|health_event_resolve|health_event_delete)'/i);
          const action = actionMatch ? actionMatch[1] : 'unknown';
          // Read actor from p[0] (works for both create and resolve).
          const actor: 'child' | 'pm' | 'system' = (typeof p[0] === 'string' ? p[0] : 'pm') as
            | 'child'
            | 'pm'
            | 'system';
          const targetUserId = (p[1] as number | null) ?? null;
          const details = typeof p[2] === 'string' ? p[2] : JSON.stringify(p[2] ?? {});
          auditLog.push({
            id,
            actor,
            action,
            target_event_id: lastInsertId,        // CC sets NULL in SQL but for v1 mock tracks via lastInsertId
            target_user_id: targetUserId,
            details,
            created_at: nowOverride,
          });
          results.push({ success: true, meta: { changes: 1, last_row_id: id, duration: 0 } } as D1Result<T>);
        } else if (/^UPDATE\s+health_events/i.test(q)) {
          // Mock for resolveEvent's UPDATE. Params (in order after refactor §4.2.5):
          //   [endDate, now, resolvedBy, now, id]
          // SET clause: end_date = ?, is_resolved = 1, resolved_at = ?, resolved_by = ?, updated_at = ?
          // (is_resolved is a SQL literal '1', not a bound ?).
          const id = (p[p.length - 1] as number);
          const e = healthEvents.find((x) => x.id === id);
          if (e) {
            const sets = q.match(/SET\s+(.+?)\s+WHERE/i)?.[1] ?? '';
            const fields = [...sets.matchAll(/(\w+)\s*=\s*\?/g)].map((m) => m[1]);
            fields.forEach((f, i) => { (e as Record<string, unknown>)[f] = p[i]; });
            // Also handle inlined is_resolved = 1
            const isResolvedLiteral = sets.match(/is_resolved\s*=\s*(\d+)/i);
            if (isResolvedLiteral) e.is_resolved = Number(isResolvedLiteral[1]);
          }
          results.push({
            success: true,
            meta: { changes: e ? 1 : 0, last_row_id: 0, duration: 0 },
          } as D1Result<T>);
        } else {
          // Unknown statement — no-op.
          results.push({ success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } } as D1Result<T>);
        }
        captured.push(stmtLastBind);
      }
      batchCalls.push(captured);
      return results;
    },
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
  };
  return db;
}

// ============================================================
// Test request helpers
// ============================================================
const SECRET = 'unit-test-secret-health-checkin';

function envObj() {
  return { DB: makeMockDb(), JWT_SECRET: SECRET };
}

async function call(path: string, init: RequestInit = {}, env = envObj()) {
  return app.request(`http://test.local${path}`, init, env);
}

async function pmCookie(userId = PM_USER_ID): Promise<string> {
  // Use REAL time for exp — verifySession() in src/auth/session.ts validates
  // against Date.now()/1000, not the test fixture's nowOverride. Using
  // nowOverride (1_700_000_000, 2023-11) would always be expired in 2026+.
  const token = await signSession({ user_id: userId, exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);
  return `pm_session=${token}`;
}

// ============================================================
// Test suites
// ============================================================
beforeEach(() => {
  reset();
  seedUsers();
});

describe('HAPPY — Health Checkin core flows', () => {
  it('HAPPY-1: child POST /api/me/health/events creates ulcer event + audit_log', async () => {
    const res = await call('/api/me/health/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        event_type: 'ulcer',
        start_date: '2026-06-14',
        note: '今天开始喉咙疼',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as HealthEvent;
    expect(body).toMatchObject({
      user_id: CHILD_USER_ID,
      event_type: 'ulcer',
      start_date: '2026-06-14',
      end_date: null,
      is_resolved: false,    // RFC §4.2.1 response example uses boolean
      note: '今天开始喉咙疼',
      submitted_by: 'child',
    });

    expect(healthEvents).toHaveLength(1);
    expect(auditLog).toHaveLength(1);
    expect(auditLog[0].action).toBe('health_event_create');
    expect(auditLog[0].target_event_id).toBe(body.id);
    expect(auditLog[0].actor).toBe('child');
  });

  it('HAPPY-2: pm POST /api/admin/health/events creates vomit event for user_id=1', async () => {
    const cookie = await pmCookie();
    const res = await call('/api/admin/health/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        user_id: PM_USER_ID,
        event_type: 'vomit',
        start_date: '2026-06-13',
        note: '晚饭后吐 1 次',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as HealthEvent;
    expect(body).toMatchObject({
      user_id: PM_USER_ID,
      event_type: 'vomit',
      submitted_by: 'pm',
      is_resolved: false,    // RFC §4.2.1 response example uses boolean
    });

    expect(auditLog).toHaveLength(1);
    expect(auditLog[0].action).toBe('health_event_create');
    expect(auditLog[0].actor).toBe('pm');
    expect(auditLog[0].target_user_id).toBe(PM_USER_ID);
  });

  it('HAPPY-3: pm PATCH /api/admin/health/events/:id/resolve marks resolved + writes audit', async () => {
    const existing = seedHealthEvent({ event_type: 'cough', start_date: '2026-06-10' });
    console.log('DEBUG seed existing:', JSON.stringify(existing));
    console.log('DEBUG healthEvents after seed:', JSON.stringify(healthEvents));
    const cookie = await pmCookie();
    const res = await call(`/api/admin/health/events/${existing.id}/resolve`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ end_date: '2026-06-20' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as HealthEvent;
    expect(body.end_date).toBe('2026-06-20');
    expect(body.is_resolved).toBe(true);    // RFC §4.2.1 response example uses boolean
    // resolved_by is intentionally NOT in response shape (CC Q2) — internal field for resolve audit.
    // expect(body.resolved_by).toBe(PM_USER_ID);

    expect(auditLog).toHaveLength(1);
    expect(auditLog[0].action).toBe('health_event_resolve');
    expect(auditLog[0].actor).toBe('pm');
    const details = JSON.parse(auditLog[0].details) as { end_date: string };
    expect(details.end_date).toBe('2026-06-20');
  });
});

describe('EDGE — boundary cases', () => {
  it('EDGE-1: 2 active ulcer events of same type coexist (业务允许)', async () => {
    const first = seedHealthEvent({ event_type: 'ulcer', start_date: '2026-06-10' });
    const res = await call('/api/me/health/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event_type: 'ulcer', start_date: '2026-06-14' }),
    });
    expect(res.status).toBe(201);

    const activeUlc = healthEvents.filter((h) => h.event_type === 'ulcer' && h.end_date === null);
    expect(activeUlc).toHaveLength(2);
    expect(activeUlc.map((h) => h.id).sort()).toEqual([first.id, (await res.json() as HealthEvent).id].sort());
  });

  it('EDGE-2: resolve with end_date < start_date → 400 INVALID_DATE', async () => {
    const existing = seedHealthEvent({ event_type: 'cough', start_date: '2026-06-14' });
    const cookie = await pmCookie();
    const res = await call(`/api/admin/health/events/${existing.id}/resolve`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ end_date: '2026-06-10' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_DATE');

    // Verify event unchanged.
    const after = healthEvents.find((h) => h.id === existing.id);
    expect(after?.end_date).toBeNull();
    expect(after?.is_resolved).toBe(0);
  });

  it('EDGE-3: pm resolve non-existent event_id → 404 NOT_FOUND', async () => {
    const cookie = await pmCookie();
    const res = await call('/api/admin/health/events/999/resolve', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ end_date: '2026-06-20' }),
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(auditLog).toHaveLength(0);
  });

  it('EDGE-4: PATCH /api/admin/health/events/:id/resolve without pm session → 401', async () => {
    const existing = seedHealthEvent({ event_type: 'cough', start_date: '2026-06-14' });
    const res = await call(`/api/admin/health/events/${existing.id}/resolve`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ end_date: '2026-06-20' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');

    // Verify event unchanged.
    const after = healthEvents.find((h) => h.id === existing.id);
    expect(after?.is_resolved).toBe(0);
  });

  it('EDGE-14: child PATCH /api/me/health/events/:id/resolve → 200 + actor=child (RFC §4.2.5)', async () => {
    // Seed an active event for child (user_id=2, the CHILD_USER_ID hardcode).
    const existing = seedHealthEvent({
      user_id: CHILD_USER_ID,
      event_type: 'cough',
      start_date: '2026-06-14',
    });
    const res = await call(`/api/me/health/events/${existing.id}/resolve`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ end_date: '2026-06-20' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: number; end_date: string; is_resolved: boolean; resolved_by: number | null };
    expect(body.end_date).toBe('2026-06-20');
    expect(body.is_resolved).toBe(true);
    expect(body.resolved_by).toBe(CHILD_USER_ID);

    // Verify audit_log got actor='child' (not 'pm').
    const resolves = auditLog.filter((a) => a.action === 'health_event_resolve' && a.target_user_id === CHILD_USER_ID);
    expect(resolves).toHaveLength(1);
    expect(resolves[0].actor).toBe('child');
  });

  it('EDGE-15: child PATCH /api/me/.../resolve for other user\'s event → 403 FORBIDDEN', async () => {
    // PM creates an event for user_id=99 (not the child). Child should NOT be able to resolve it.
    const existing = seedHealthEvent({ user_id: 99, event_type: 'ulcer', start_date: '2026-06-14' });
    const res = await call(`/api/me/health/events/${existing.id}/resolve`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ end_date: '2026-06-20' }),
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');

    // Event unchanged.
    const after = healthEvents.find((h) => h.id === existing.id);
    expect(after?.is_resolved).toBe(0);
  });

  it('EDGE-16: child PATCH /api/me/.../resolve with end_date < start_date → 400 INVALID_DATE', async () => {
    const existing = seedHealthEvent({
      user_id: CHILD_USER_ID,
      event_type: 'cough',
      start_date: '2026-06-14',
    });
    const res = await call(`/api/me/health/events/${existing.id}/resolve`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ end_date: '2026-06-10' }),  // before start_date
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_DATE');
  });

  it('EDGE-17: child PATCH /api/me/.../resolve for already-resolved event → 409 ALREADY_RESOLVED', async () => {
    // Resolve once first.
    const existing = seedHealthEvent({
      user_id: CHILD_USER_ID,
      event_type: 'cough',
      start_date: '2026-06-14',
    });
    await call(`/api/me/health/events/${existing.id}/resolve`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ end_date: '2026-06-20' }),
    });
    // Second attempt.
    const res = await call(`/api/me/health/events/${existing.id}/resolve`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ end_date: '2026-06-25' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('ALREADY_RESOLVED');
  });

  it('EDGE-5: POST invalid event_type "flu" → 400 INVALID_EVENT_TYPE', async () => {
    const res = await call('/api/me/health/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event_type: 'flu', start_date: '2026-06-14' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_EVENT_TYPE');
    expect(healthEvents).toHaveLength(0);
    expect(auditLog).toHaveLength(0);
  });

  it('EDGE-8: resolve already-resolved event → 409 ALREADY_RESOLVED', async () => {
    const existing = seedHealthEvent({
      event_type: 'fever',
      start_date: '2026-06-10',
      end_date: '2026-06-15',
      is_resolved: 1,
    });
    const cookie = await pmCookie();
    const res = await call(`/api/admin/health/events/${existing.id}/resolve`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ end_date: '2026-06-20' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('ALREADY_RESOLVED');
    // Verify end_date unchanged.
    const after = healthEvents.find((h) => h.id === existing.id);
    expect(after?.end_date).toBe('2026-06-15');
  });

  it('EDGE-9: pm POST without user_id → 400 MISSING_USER_ID', async () => {
    const cookie = await pmCookie();
    const res = await call('/api/admin/health/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ event_type: 'vomit', start_date: '2026-06-13' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('MISSING_USER_ID');
    expect(healthEvents).toHaveLength(0);
  });

  it('EDGE-10: GET /api/public/health/events without user_id → 400', async () => {
    const res = await call('/api/public/health/events');
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('MISSING_USER_ID');
  });

  it('EDGE-11: GET active_only=true returns only end_date IS NULL', async () => {
    seedHealthEvent({ event_type: 'ulcer', start_date: '2026-06-10' });  // active
    seedHealthEvent({
      event_type: 'ulcer',
      start_date: '2026-06-01',
      end_date: '2026-06-05',
      is_resolved: 1,
    });  // resolved
    const res = await call('/api/public/health/events?user_id=2&event_type=ulcer&active_only=true');
    expect(res.status).toBe(200);
    const body = await res.json() as { events: HealthEvent[] };
    expect(body.events).toHaveLength(1);
    expect(body.events[0].end_date).toBeNull();
  });

  it('EDGE-12: single-day event: start_date = end_date → 200 OK', async () => {
    const existing = seedHealthEvent({ event_type: 'fever', start_date: '2026-06-14' });
    const cookie = await pmCookie();
    const res = await call(`/api/admin/health/events/${existing.id}/resolve`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ end_date: '2026-06-14' }),  // same as start
    });
    expect(res.status).toBe(200);
    const body = await res.json() as HealthEvent;
    expect(body.end_date).toBe('2026-06-14');
    expect(body.start_date).toBe('2026-06-14');
    expect(body.is_resolved).toBe(true);    // RFC §4.2.1 response example uses boolean
  });
});

describe('AUDIT — audit log integrity', () => {
  it('AUDIT-1: every create writes exactly 1 audit_log row with correct actor', async () => {
    // Child create
    await call('/api/me/health/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event_type: 'ulcer', start_date: '2026-06-14' }),
    });
    // PM create
    const cookie = await pmCookie();
    await call('/api/admin/health/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ user_id: 1, event_type: 'vomit', start_date: '2026-06-13' }),
    });

    const creates = auditLog.filter((a) => a.action === 'health_event_create');
    expect(creates).toHaveLength(2);
    // Order: child first (POSTed first), pm second.
    expect(creates[0].actor).toBe('child');
    expect(creates[1].actor).toBe('pm');
  });

  it('AUDIT-2: resolve writes 1 audit_log row with end_date in details JSON', async () => {
    const existing = seedHealthEvent({ event_type: 'cough', start_date: '2026-06-10' });
    const cookie = await pmCookie();
    await call(`/api/admin/health/events/${existing.id}/resolve`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ end_date: '2026-06-20' }),
    });
    const resolves = auditLog.filter((a) => a.action === 'health_event_resolve');
    expect(resolves).toHaveLength(1);
    expect(resolves[0].actor).toBe('pm');
    // target_event_id tracks lastInsertId from the most recent INSERT health_events
    // (mockDb simplification — in real D1, CC sets it to NULL per RFC).
    // Just assert it's a number, not the specific existing.id.
    expect(typeof resolves[0].target_event_id).toBe('number');
    const details = JSON.parse(resolves[0].details) as { end_date: string };
    expect(details.end_date).toBe('2026-06-20');
  });

  it('AUDIT-3: create event + audit_log write use SAME db.batch (atomic)', async () => {
    await call('/api/me/health/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event_type: 'ulcer', start_date: '2026-06-14' }),
    });

    // The last batch call should contain BOTH the health_events INSERT and the audit_log INSERT.
    expect(batchCalls.length).toBeGreaterThanOrEqual(1);
    const lastBatch = batchCalls[batchCalls.length - 1];
    const hasHealthInsert = lastBatch.some((s) => /^INSERT INTO\s+health_events/i.test(s.query));
    const hasAuditInsert = lastBatch.some((s) => /^INSERT INTO\s+audit_log/i.test(s.query));
    expect(hasHealthInsert).toBe(true);
    expect(hasAuditInsert).toBe(true);
  });
});

describe('IMPL — implicit invariants (test plan §1.4)', () => {
  it('IMPL-1: health event creation does NOT write score_events (零关联)', async () => {
    await call('/api/me/health/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event_type: 'ulcer', start_date: '2026-06-14' }),
    });
    const cookie = await pmCookie();
    await call('/api/admin/health/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ user_id: 1, event_type: 'vomit', start_date: '2026-06-13' }),
    });
    expect(scoreEvents).toHaveLength(0);
  });

  it('IMPL-2: GET with month=YYYY-MM returns only events in that month range', async () => {
    seedHealthEvent({ event_type: 'cough', start_date: '2026-05-20' });  // out
    seedHealthEvent({ event_type: 'cough', start_date: '2026-06-05' });  // in
    seedHealthEvent({ event_type: 'cough', start_date: '2026-06-25' });  // in
    seedHealthEvent({ event_type: 'cough', start_date: '2026-07-01' });  // out

    const res = await call('/api/public/health/events?user_id=2&event_type=cough&month=2026-06');
    expect(res.status).toBe(200);
    const body = await res.json() as { events: HealthEvent[] };
    expect(body.events).toHaveLength(2);
    expect(body.events.every((h) => h.start_date.startsWith('2026-06'))).toBe(true);
  });

  it('IMPL-3: GET with event_type=cough filters to cough only', async () => {
    seedHealthEvent({ event_type: 'cough', start_date: '2026-06-10' });
    seedHealthEvent({ event_type: 'fever', start_date: '2026-06-11' });
    const res = await call('/api/public/health/events?user_id=2&event_type=cough');
    expect(res.status).toBe(200);
    const body = await res.json() as { events: HealthEvent[] };
    expect(body.events).toHaveLength(1);
    expect(body.events[0].event_type).toBe('cough');
  });

  it('IMPL-4: POST with invalid date format "2026/06/14" → 400 INVALID_DATE_FORMAT', async () => {
    const res = await call('/api/me/health/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event_type: 'ulcer', start_date: '2026/06/14' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_DATE_FORMAT');
    expect(healthEvents).toHaveLength(0);
  });

  it('IMPL-5: all 8 hardcoded event_types can be created', async () => {
    for (const type of VALID_TYPES) {
      const res = await call('/api/me/health/events', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event_type: type, start_date: '2026-06-14' }),
      });
      expect(res.status).toBe(201);
    }
    expect(healthEvents).toHaveLength(8);
    const types = new Set(healthEvents.map((h) => h.event_type));
    expect(types.size).toBe(8);
  });

  it('IMPL-6: end_date = future date (提前标记已愈) → 200 允许', async () => {
    const existing = seedHealthEvent({ event_type: 'cough', start_date: '2026-06-10' });
    const cookie = await pmCookie();
    const res = await call(`/api/admin/health/events/${existing.id}/resolve`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ end_date: '2099-01-01' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as HealthEvent;
    expect(body.end_date).toBe('2099-01-01');
  });
});

describe('AUTH — auth guards', () => {
  it('AUTH-1 (dual): POST /api/me/health/events without auth', async () => {
    // M1 child auth policy is undecided: current /api/me/* uses hardcoded CHILD_USER_ID=2
    // (no cookie). RFC says child session but M1 may follow existing pattern.
    // Accept either 201 (hardcoded) or 401 (new child session).
    const res = await call('/api/me/health/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event_type: 'ulcer', start_date: '2026-06-14' }),
    });
    expect([201, 401]).toContain(res.status);
    if (res.status === 201) {
      expect(healthEvents).toHaveLength(1);
      expect(healthEvents[0].user_id).toBe(CHILD_USER_ID);
    } else {
      const body = await res.json() as { error: { code: string } };
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(healthEvents).toHaveLength(0);
    }
  });

  it('AUTH-2: POST /api/admin/health/events without pm_session → 401', async () => {
    const res = await call('/api/admin/health/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: 1, event_type: 'ulcer', start_date: '2026-06-14' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(healthEvents).toHaveLength(0);
  });
});

describe('GET /api/public/health/events — list endpoint', () => {
  it('returns empty array when user has no events (not null)', async () => {
    const res = await call('/api/public/health/events?user_id=999');
    expect(res.status).toBe(200);
    const body = await res.json() as { events: HealthEvent[] };
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events).toHaveLength(0);
  });

  it('cross-month event: start=5月 end=6月 → GET 6月 returns it', async () => {
    seedHealthEvent({
      event_type: 'cough',
      start_date: '2026-05-30',
      end_date: '2026-06-03',
      is_resolved: 1,
    });
    const res = await call('/api/public/health/events?user_id=2&event_type=cough&month=2026-06');
    expect(res.status).toBe(200);
    const body = await res.json() as { events: HealthEvent[] };
    expect(body.events.length).toBeGreaterThanOrEqual(1);
    expect(body.events.some((h) => h.start_date === '2026-05-30')).toBe(true);
  });
});
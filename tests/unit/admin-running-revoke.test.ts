// tests/unit/admin-running-revoke.test.ts
// Item #011 §4 — Integration tests for:
//   GET  /api/admin/running/records
//   POST /api/admin/running/records/:id/revoke
//
// Verifies:
//   - requirePm guard (401 without cookie)
//   - GET returns all records (active + revoked) with joined names
//   - revoke: confirm: true required (400)
//   - revoke: 409 if already revoked
//   - revoke: 404 if not found
//   - revoke happy path: UPDATE revoked_at/revoked_by + INSERT -game_time
//     score_event + UPSERT running_progress + INSERT audit_log
//   - revoke: no score_event INSERT if awarded_coins=0

import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/worker.ts';
import { signSession } from '../../src/auth/session.ts';

// ---------------------------------------------------------------
// In-memory mock stores
// ---------------------------------------------------------------
interface UserRow {
  id: number;
  name: string;
  role: 'child' | 'pm';
}
interface RunningRecordRow {
  id: number;
  child_id: number;
  map_id: number;
  km: number;
  awarded_point_id: number | null;
  awarded_coins: number | null;
  created_at: number;
  revoked_at: number | null;
  revoked_by: number | null;
}
interface RunningProgressRow {
  child_id: number;
  map_id: number;
  cum_km: number;
  last_updated: number;
}
interface ScoreEventRow {
  id: number;
  user_id: number;
  type: string;
  change_value: number;
  reason: string;
  status: string;
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

let users: UserRow[] = [];
let runningRecords: RunningRecordRow[] = [];
let runningProgress: RunningProgressRow[] = [];
let scoreEvents: ScoreEventRow[] = [];
let audit: AuditRow[] = [];
let nextAuditId = 1;
let nowOverride = Math.floor(Date.now() / 1000);

function reset() {
  users = [];
  runningRecords = [];
  runningProgress = [];
  scoreEvents = [];
  audit = [];
  nextAuditId = 1;
  nowOverride = Math.floor(Date.now() / 1000);
}

function addUser(id: number, name: string, role: 'child' | 'pm') {
  users.push({ id, name, role });
}
function addRecord(overrides: Partial<RunningRecordRow> = {}): RunningRecordRow {
  const id = runningRecords.length + 1;
  const rec: RunningRecordRow = {
    id,
    child_id: 2,
    map_id: 1,
    km: 3.5,
    awarded_point_id: 1,
    awarded_coins: 5,
    created_at: nowOverride,
    revoked_at: null,
    revoked_by: null,
    ...overrides,
  };
  runningRecords.push(rec);
  return rec;
}
function addProgress(childId: number, mapId: number, cumKm: number) {
  runningProgress.push({ child_id: childId, map_id: mapId, cum_km: cumKm, last_updated: nowOverride });
}

// ---------------------------------------------------------------
// Mock D1 database
// ---------------------------------------------------------------
function makeMockDb(): D1Database {
  function stmt(query: string) {
    let params: unknown[] = [];
    const q = query.trim().replace(/\s+/g, ' ');

    const stmtObj = {
      bind(...values: unknown[]) {
        params = values;
        return stmtObj;
      },
      first<T = unknown>(): Promise<T | null> {
        if (/FROM running_records WHERE id = \?/i.test(q)) {
          const rec = runningRecords.find((r) => r.id === params[0]) ?? null;
          return Promise.resolve(rec as unknown as T);
        }
        if (/FROM running_records WHERE child_id = \? AND map_id = \? AND revoked_at IS NULL/i.test(q)) {
          const childId = params[0] as number;
          const mapId = params[1] as number;
          const excludeId = params.length > 2 ? (params[2] as number) : null;
          const sum = runningRecords
            .filter((r) => r.child_id === childId && r.map_id === mapId && r.revoked_at === null && r.id !== (excludeId ?? -1))
            .reduce((s, r) => s + r.km, 0);
          return Promise.resolve({ cum_km: sum } as unknown as T);
        }
        return Promise.resolve(null);
      },
      all<T = unknown>(): Promise<D1Result<T>> {
        if (/SELECT.*FROM running_records AS rr/i.test(q)) {
          const records = runningRecords.map((r) => {
            const child = users.find((u) => u.id === r.child_id);
            const rec: RunningRecordRow & { child_name: string; map_name: string; revoked_by_name: string | null } = {
              ...r,
              child_name: child?.name ?? ('user#' + r.child_id),
              map_name: 'map#' + r.map_id,
              revoked_by_name: r.revoked_by != null ? (users.find((u) => u.id === r.revoked_by)?.name ?? 'PM') : null,
            };
            return rec;
          });
          return Promise.resolve({ results: records as unknown as T[], success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } } as unknown as D1Result<T>);
        }
        return Promise.resolve({ results: [], success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } } as unknown as D1Result<T>);
      },
      run<T = unknown>(): Promise<D1Result<T>> {
        if (/UPDATE running_records SET revoked_at/i.test(q)) {
          const [ts, byId, recId] = params as [number, number, number];
          const rec = runningRecords.find((r) => r.id === recId);
          if (rec) { rec.revoked_at = ts; rec.revoked_by = byId; }
          return Promise.resolve({ success: true, meta: { changes: 1, last_row_id: 0, duration: 0 } });
        }
        if (/INSERT INTO score_events/i.test(q)) {
          const [userId, changeValue, sourceRef, ts] = params as [number, number, string, number];
          const ev: ScoreEventRow = {
            id: scoreEvents.length + 1,
            user_id: userId,
            type: 'coins',
            change_value: changeValue,
            reason: '跑步打卡撤销', // literal in SQL, not a bind param
            status: 'approved',
          };
          scoreEvents.push(ev);
          return Promise.resolve({ success: true, meta: { changes: 1, last_row_id: ev.id, duration: 0 } });
        }
        if (/INSERT INTO running_progress/i.test(q)) {
          const [childId, mapId, cumKm, ts, ,] = params as [number, number, number, number, number, number];
          const existing = runningProgress.findIndex((p) => p.child_id === childId && p.map_id === mapId);
          if (existing >= 0) {
            runningProgress[existing] = { child_id: childId, map_id: mapId, cum_km: cumKm, last_updated: ts };
          } else {
            runningProgress.push({ child_id: childId, map_id: mapId, cum_km: cumKm, last_updated: ts });
          }
          return Promise.resolve({ success: true, meta: { changes: 1, last_row_id: 0, duration: 0 } });
        }
        if (/INSERT INTO audit_log/i.test(q)) {
          const [targetEventId, targetUserId, details, ts] = params as [number, number, string, number];
          const row: AuditRow = {
            id: nextAuditId++,
            actor: 'pm', // literal in SQL, not a bind param
            action: 'running_record_revoke', // literal in SQL, not a bind param
            target_event_id: targetEventId,
            target_user_id: targetUserId,
            details,
            created_at: ts,
          };
          audit.push(row);
          return Promise.resolve({ success: true, meta: { changes: 1, last_row_id: row.id, duration: 0 } });
        }
        return Promise.resolve({ success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } });
      },
      raw: () => Promise.resolve([]),
    };
    return stmtObj;
  }

  const db: D1Database = {
    prepare: stmt as (query: string) => D1PreparedStatement,
    batch: (stmts) => Promise.all(stmts.map((s) => s.run())) as unknown as Promise<D1Result[]>,
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
  };
  return db;
}

const SECRET = 'test-secret-123';
function env() { return { DB: makeMockDb(), JWT_SECRET: SECRET }; }
async function call(path: string, init: RequestInit = {}, envOverride = env()) {
  return app.request(`http://test.local${path}`, init, envOverride);
}
async function pmCookie(userId = 1) {
  const token = await signSession({ user_id: userId, exp: nowOverride + 3600 }, SECRET);
  return `pm_session=${token}`;
}

// ---------------------------------------------------------------
// Tests
// ---------------------------------------------------------------
describe('GET /api/admin/running/records', () => {
  beforeEach(reset);

  it('returns 401 without session cookie', async () => {
    const r = await call('/api/admin/running/records');
    expect(r.status).toBe(401);
  });

  it('returns all records including revoked', async () => {
    addUser(2, 'Kiddo', 'child');
    addUser(1, 'PM', 'pm');
    addRecord({ id: 10, child_id: 2, map_id: 1, km: 3.5, awarded_coins: 5 });
    addRecord({ id: 11, child_id: 2, map_id: 1, km: 4.0, awarded_coins: 0, revoked_at: nowOverride - 10, revoked_by: 1 });
    const cookie = await pmCookie();
    const r = await call('/api/admin/running/records', { headers: { cookie } });
    expect(r.status).toBe(200);
    const body = await r.json() as { records: unknown[]; count: number };
    expect(body.count).toBe(2);
    const ids = body.records.map((rec: any) => rec.id);
    expect(ids).toContain(10);
    expect(ids).toContain(11);
    // Revoked record has revoked_at set
    const revoked = body.records.find((rec: any) => rec.id === 11);
    expect(revoked.revoked_at).toBe(nowOverride - 10);
  });
});

describe('POST /api/admin/running/records/:id/revoke', () => {
  beforeEach(reset);

  it('returns 401 without session cookie', async () => {
    const r = await call('/api/admin/running/records/1/revoke', { method: 'POST' });
    expect(r.status).toBe(401);
  });

  it('returns 400 if confirm !== true', async () => {
    addUser(1, 'PM', 'pm');
    addRecord({ id: 5 });
    const cookie = await pmCookie();
    const r = await call('/api/admin/running/records/5/revoke', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(400);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('CONFIRM_REQUIRED');
  });

  it('returns 400 for invalid id', async () => {
    addUser(1, 'PM', 'pm');
    const cookie = await pmCookie();
    const r = await call('/api/admin/running/records/abc/revoke', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    expect(r.status).toBe(400);
  });

  it('returns 404 when record not found', async () => {
    addUser(1, 'PM', 'pm');
    const cookie = await pmCookie();
    const r = await call('/api/admin/running/records/9999/revoke', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    expect(r.status).toBe(404);
  });

  it('returns 409 when record already revoked', async () => {
    addUser(1, 'PM', 'pm');
    addRecord({ id: 7, revoked_at: nowOverride - 100, revoked_by: 1 });
    const cookie = await pmCookie();
    const r = await call('/api/admin/running/records/7/revoke', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    expect(r.status).toBe(409);
    const body = await r.json() as { error: { code: string } };
    expect(body.error.code).toBe('ALREADY_REVOKED');
  });

  it('happy path: updates revoked_at + revoked_by + inserts -game_time score_event + upserts running_progress + audit_log', async () => {
    addUser(1, 'PM', 'pm');
    addUser(2, 'Kiddo', 'child');
    // Synthesize "previous progress" of 7 km as a running_record so that
    // SUM(km WHERE active AND id != 20) = 7.0 after revoking id=20 (km=3.5).
    // (Endpoint reads SUM FROM running_records per migration 0011 design,
    // not from running_progress cache.)
    addRecord({ id: 18, child_id: 2, map_id: 1, km: 7.0, awarded_coins: 0, created_at: nowOverride - 100 });
    const rec = addRecord({ id: 20, child_id: 2, map_id: 1, km: 3.5, awarded_coins: 5 });
    const cookie = await pmCookie();
    const r = await call('/api/admin/running/records/20/revoke', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    expect(r.status).toBe(200);
    const body = await r.json() as { record_id: number; revoked_at: number; cum_km: number; revoke_score_event_id: number | null };
    expect(body.record_id).toBe(20);
    expect(typeof body.revoked_at).toBe('number');
    // cum_km should be 10.5 (initial - this record's 3.5)
    expect(body.cum_km).toBe(7.0);
    // score_event was inserted (awarded_coins=5 > 0)
    expect(body.revoke_score_event_id).toBeGreaterThan(0);
    const ev = scoreEvents.find((e) => e.user_id === 2 && e.change_value === -5);
    expect(ev).toBeDefined();
    expect(ev?.reason).toBe('跑步打卡撤销');

    // running_progress updated
    const prog = runningProgress.find((p) => p.child_id === 2 && p.map_id === 1);
    expect(prog?.cum_km).toBe(7.0);

    // audit_log entry
    const entry = audit.find((a) => a.action === 'running_record_revoke');
    expect(entry).toBeDefined();
    expect(entry?.actor).toBe('pm');
    expect(entry?.target_event_id).toBe(20);
    const details = JSON.parse(entry?.details ?? '{}') as Record<string, unknown>;
    expect(details.record_id).toBe(20);
    expect(details.km).toBe(3.5);
  });

  it('no score_event INSERT when awarded_coins is 0 or null', async () => {
    addUser(1, 'PM', 'pm');
    addRecord({ id: 21, child_id: 2, map_id: 1, km: 2.0, awarded_coins: 0 });
    const cookie = await pmCookie();
    const r = await call('/api/admin/running/records/21/revoke', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    expect(r.status).toBe(200);
    const body = await r.json() as { revoke_score_event_id: number | null };
    expect(body.revoke_score_event_id).toBeNull();
    const ev = scoreEvents.find((e) => e.user_id === 2 && e.change_value < 0);
    expect(ev).toBeUndefined();
  });

  it('double revoke returns 409', async () => {
    addUser(1, 'PM', 'pm');
    const rec1 = addRecord({ id: 30, child_id: 2, map_id: 1, km: 3.0, awarded_coins: 3 });
    const cookie = await pmCookie();
    // First revoke succeeds
    const r1 = await call('/api/admin/running/records/30/revoke', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    expect(r1.status).toBe(200);
    // Second revoke → 409
    const r2 = await call('/api/admin/running/records/30/revoke', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    expect(r2.status).toBe(409);
  });
});

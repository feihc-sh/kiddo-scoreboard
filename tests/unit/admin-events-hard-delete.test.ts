// tests/unit/admin-events-hard-delete.test.ts
// Hard-delete endpoint test (NIGHTLY-TODO #009 stage 2):
//   POST /api/admin/events/:id/hard-delete
//
// Verifies the full flow against a real miniflare D1 binding:
//   - 401 without PM session (requirePm guard)
//   - Happy path: PM deletes a score_event, the row is removed from
//     score_events, a snapshot row is inserted into deleted_records,
//     an audit_log row is written with action='event_hard_deleted',
//     and the recomputed balance is returned in the response.
//
// Schema baseline is established by applying all migrations 0001-0006
// to a real D1 instance (matches stage 1 deleted-records.test.ts
// pattern). Mocking the whole D1 interface would defeat the purpose
// of the test — this endpoint depends on transaction (db.batch) and
// multiple-table writes.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types/experimental';
import app from '../../src/worker.ts';
import { signSession } from '../../src/auth/session.ts';

const MIGRATIONS_DIR = resolve(process.cwd(), 'migrations');

let mf: Miniflare;
let db: D1Database;
let migrationFiles: string[] = [];

const SECRET = 'unit-test-secret-1234567890';
let pmToken: string;

beforeAll(async () => {
  mf = new Miniflare({
    d1Databases: { DB: 'kiddo-scoreboard-db-test-hard-delete' },
    modules: true,
    script: '',
  });
  db = await mf.getD1Database('DB');
  migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
});

// splitStatements: same shape as deleted-records.test.ts stage 1
function splitStatements(sql: string): string[] {
  const stripped = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return stripped
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function applyAllMigrations() {
  for (const f of migrationFiles) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, f), 'utf8');
    for (const stmt of splitStatements(sql)) {
      await db.prepare(stmt).run();
    }
  }
}

async function resetDb() {
  // Drop every table that any migration might create. Order doesn't
  // matter — IF NOT EXISTS makes the recreation idempotent.
  for (const t of [
    'audit_log',
    'deleted_records',
    'auth_attempts',
    'task_completions',
    'tasks',
    'app_config',
    'score_events',
    'users',
  ]) {
    await db.prepare(`DROP TABLE IF EXISTS ${t}`).run();
  }
  await applyAllMigrations();
}

async function seedBasic() {
  // PM user (id=1) and child user (id=2) — same shape as local.sql seed
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO users (id, name, role, pin_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(1, 'PM', 'pm', 'fake-hash', now, now)
    .run();
  await db
    .prepare(
      `INSERT INTO users (id, name, role, pin_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(2, '', 'child', null, now, now)
    .run();
}

beforeEach(async () => {
  await resetDb();
  await seedBasic();
  pmToken = await signSession(
    { user_id: 1, exp: Math.floor(Date.now() / 1000) + 3600 },
    SECRET,
  );
});

afterAll(async () => {
  await mf.dispose();
});

interface HardDeleteResponse {
  success?: boolean;
  deleted_id?: number;
  balance?: { game_time: number; pocket_money: number } | null;
  error?: { code: string; message: string };
}

async function call(path: string, init: RequestInit = {}) {
  return app.request(
    `http://test.local${path}`,
    init,
    { DB: db, JWT_SECRET: SECRET, ASSETS: undefined as unknown as Fetcher },
  );
}

describe('POST /api/admin/events/:id/hard-delete', () => {
  it('returns 401 without PM session cookie', async () => {
    const r = await call('/api/admin/events/1/hard-delete', { method: 'POST' });
    expect(r.status).toBe(401);
    const body = (await r.json()) as HardDeleteResponse;
    expect(body.error?.code).toBe('UNAUTHORIZED');

    // No side effects from an unauthorized request.
    const evs = await db
      .prepare('SELECT COUNT(*) AS n FROM score_events')
      .first<{ n: number }>();
    expect(Number(evs?.n ?? 0)).toBe(0);
    const dr = await db
      .prepare('SELECT COUNT(*) AS n FROM deleted_records')
      .first<{ n: number }>();
    expect(Number(dr?.n ?? 0)).toBe(0);
    const al = await db
      .prepare('SELECT COUNT(*) AS n FROM audit_log')
      .first<{ n: number }>();
    expect(Number(al?.n ?? 0)).toBe(0);
  });

  it('happy path: PM deletes a score_event; snapshot + audit + balance', async () => {
    // Seed: 2 approved events for the child (id=2). Delete one of them,
    // the other must remain and the recomputed balance should reflect
    // the remaining event only.
    const now = Math.floor(Date.now() / 1000);
    await db
      .prepare(
        `INSERT INTO score_events
           (id, user_id, type, change_value, reason, status,
            submitted_by, source, source_ref, reviewed_by, reviewed_at,
            week_of, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        101, 2, 'game_time', 30, 'task reward', 'approved',
        'pm', 'manual', null, 1, now, null, now,
      )
      .run();
    await db
      .prepare(
        `INSERT INTO score_events
           (id, user_id, type, change_value, reason, status,
            submitted_by, source, source_ref, reviewed_by, reviewed_at,
            week_of, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        102, 2, 'pocket_money', 50, 'helped dishes', 'approved',
        'pm', 'manual', null, 1, now, null, now,
      )
      .run();

    const r = await call('/api/admin/events/101/hard-delete', {
      method: 'POST',
      headers: { cookie: `pm_session=${pmToken}` },
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as HardDeleteResponse;
    expect(body.success).toBe(true);
    expect(body.deleted_id).toBe(101);
    expect(body.balance).toEqual({ game_time: 0, pocket_money: 50 });

    // 1) score_events: id=101 is gone, id=102 is intact
    const remaining = await db
      .prepare('SELECT id, type, change_value FROM score_events ORDER BY id')
      .all<{ id: number; type: string; change_value: number }>();
    expect(remaining.results).toEqual([
      { id: 102, type: 'pocket_money', change_value: 50 },
    ]);

    // 2) deleted_records: exactly one row with full snapshot
    const del = await db
      .prepare(
        `SELECT record_type, original_id, original_data, deleted_by, original_table
           FROM deleted_records`,
      )
      .all<{
        record_type: string;
        original_id: number;
        original_data: string;
        deleted_by: number;
        original_table: string;
      }>();
    expect(del.results).toHaveLength(1);
    const row = del.results[0];
    expect(row.record_type).toBe('score_event');
    expect(row.original_id).toBe(101);
    expect(row.original_table).toBe('score_events');
    expect(row.deleted_by).toBe(1);
    const snapshot = JSON.parse(row.original_data) as Record<string, unknown>;
    expect(snapshot.id).toBe(101);
    expect(snapshot.user_id).toBe(2);
    expect(snapshot.type).toBe('game_time');
    expect(snapshot.change_value).toBe(30);
    expect(snapshot.reason).toBe('task reward');
    expect(snapshot.status).toBe('approved');

    // 3) audit_log: exactly one row with action='event_hard_deleted'
    const al = await db
      .prepare(
        `SELECT actor, action, target_event_id, target_user_id, details
           FROM audit_log`,
      )
      .all<{
        actor: string;
        action: string;
        target_event_id: number | null;
        target_user_id: number | null;
        details: string;
      }>();
    expect(al.results).toHaveLength(1);
    const a = al.results[0];
    expect(a.actor).toBe('pm');
    expect(a.action).toBe('event_hard_deleted');
    expect(a.target_event_id).toBe(101);
    expect(a.target_user_id).toBe(1);
    const details = JSON.parse(a.details) as Record<string, unknown>;
    expect(details.record_type).toBe('score_event');
    expect(details.original_table).toBe('score_events');
    const snapFromDetails = details.original_data as Record<string, unknown>;
    expect(snapFromDetails.id).toBe(101);
    expect(snapFromDetails.change_value).toBe(30);
  });
});

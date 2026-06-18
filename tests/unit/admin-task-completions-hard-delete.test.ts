// tests/unit/admin-task-completions-hard-delete.test.ts
// Hard-delete endpoint test (NIGHTLY-TODO #009 stage 3):
//   POST /api/admin/task-completions/:id/hard-delete
//
// Verifies the full flow against a real miniflare D1 binding:
//   - 401 without PM session (requirePm guard)
//   - Happy path: PM deletes a task_completion, the row is removed from
//     task_completions, a snapshot row is inserted into deleted_records,
//     an audit_log row is written with action='completion_hard_deleted'
//     (NB: distinct from stage 2's 'event_hard_deleted'), and the
//     recomputed balance is returned in the response.
//
// Note on balance: the balance is computed from approved score_events.
// A task_completion's `awarded_event_id` points to a score_event that
// is NOT touched by this endpoint — only the completion row is removed.
// So the recomputed balance after hard-delete is unchanged from before
// (the underlying event still exists and is still approved).
//
// Schema baseline is established by applying all migrations 0001-0006
// to a real D1 instance (matches stage 2 admin-events-hard-delete.test.ts
// pattern). Mirroring that pattern: a real Miniflare D1 binding gives
// us db.batch() transactions and per-table writes without mocks.

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
    d1Databases: { DB: 'kiddo-scoreboard-db-test-completion-hard-delete' },
    modules: true,
    script: '',
  });
  db = await mf.getD1Database('DB');
  migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
});

// splitStatements: same shape as admin-events-hard-delete.test.ts stage 2.
// Strips BOTH leading "--" comment lines AND inline "-- …" tails so
// semicolons inside a comment (e.g. "INTEGER, -- comment; tail") do
// not break the statement split. PRAGMA statements are passed
// through unchanged; D1 accepts them on their own line.
function splitStatements(sql: string): string[] {
  const noLineComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const noInlineComments = noLineComments
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
  return noInlineComments
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
  // PM user (id=1), child user (id=2), a task (id=1), and a task
  // completion (id=1) linked to an approved score_event (id=201).
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
  await db
    .prepare(
      `INSERT INTO tasks
         (id, name, token_reward, target_account, icon, category,
          is_active, sort_order, cutoff_time, is_self_lockout,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      1, 'brush teeth', 30, 'game_time', null, 'habit',
      1, 0, null, 0, now, now,
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
      201, 2, 'game_time', 30, 'task reward', 'approved',
      'pm', 'task', 'task:1', 1, now, null, now,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO task_completions
         (id, task_id, user_id, status, completed_date, completed_at,
          awarded_event_id, revoked_at, revoked_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(1, 1, 2, 'active', '2026-06-08', now, 201, null, null)
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

describe('POST /api/admin/task-completions/:id/hard-delete', () => {
  it('returns 401 without PM session cookie', async () => {
    const r = await call('/api/admin/task-completions/1/hard-delete', { method: 'POST' });
    expect(r.status).toBe(401);
    const body = (await r.json()) as HardDeleteResponse;
    expect(body.error?.code).toBe('UNAUTHORIZED');

    // No side effects from an unauthorized request.
    const tc = await db
      .prepare('SELECT COUNT(*) AS n FROM task_completions')
      .first<{ n: number }>();
    expect(Number(tc?.n ?? 0)).toBe(1);  // seed row still there
    const dr = await db
      .prepare('SELECT COUNT(*) AS n FROM deleted_records')
      .first<{ n: number }>();
    expect(Number(dr?.n ?? 0)).toBe(0);
    const al = await db
      .prepare('SELECT COUNT(*) AS n FROM audit_log')
      .first<{ n: number }>();
    expect(Number(al?.n ?? 0)).toBe(0);
  });

  it('happy path: PM deletes a task_completion; snapshot + audit + balance', async () => {
    const r = await call('/api/admin/task-completions/1/hard-delete', {
      method: 'POST',
      headers: { cookie: `pm_session=${pmToken}` },
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as HardDeleteResponse;
    expect(body.success).toBe(true);
    expect(body.deleted_id).toBe(1);
    // The underlying score_event (id=201) is NOT touched by this
    // endpoint, so the balance still reflects it.
    expect(body.balance).toEqual({ game_time: 30, pocket_money: 0, coins: 0 });

    // 1) task_completions: id=1 is gone
    const remaining = await db
      .prepare('SELECT id FROM task_completions')
      .all<{ id: number }>();
    expect(remaining.results).toEqual([]);

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
    expect(row.record_type).toBe('task_completion');
    expect(row.original_id).toBe(1);
    expect(row.original_table).toBe('task_completions');
    expect(row.deleted_by).toBe(1);
    const snapshot = JSON.parse(row.original_data) as Record<string, unknown>;
    expect(snapshot.id).toBe(1);
    expect(snapshot.task_id).toBe(1);
    expect(snapshot.user_id).toBe(2);
    expect(snapshot.status).toBe('active');
    expect(snapshot.completed_date).toBe('2026-06-08');
    expect(snapshot.awarded_event_id).toBe(201);

    // 3) audit_log: exactly one row with action='completion_hard_deleted'
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
    expect(a.action).toBe('completion_hard_deleted');
    expect(a.target_event_id).toBe(1);  // the deleted completion's id
    expect(a.target_user_id).toBe(1);   // the PM who deleted
    const details = JSON.parse(a.details) as Record<string, unknown>;
    expect(details.record_type).toBe('task_completion');
    expect(details.original_table).toBe('task_completions');
    const snapFromDetails = details.original_data as Record<string, unknown>;
    expect(snapFromDetails.id).toBe(1);
    expect(snapFromDetails.user_id).toBe(2);
  });
});

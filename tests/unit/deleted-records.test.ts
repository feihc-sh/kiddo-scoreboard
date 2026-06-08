// tests/unit/deleted-records.test.ts
// Schema baseline for the hard-delete snapshot table introduced by
// NIGHTLY-TODO.md Item #009 (stage 1). Uses a real miniflare D1 binding
// (already a transitive devDep via wrangler) so PRAGMA / CREATE TABLE
// IF NOT EXISTS idempotency are exercised against actual SQLite — not
// a hand-rolled mock.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import type { D1Database } from '@cloudflare/workers-types/experimental';

const MIGRATION_PATH = resolve(
  process.cwd(),
  'migrations/0006_deleted_records.sql',
);

let mf: Miniflare;
let db: D1Database;
let migrationSql: string;

beforeAll(async () => {
  mf = new Miniflare({
    d1Databases: { DB: 'kiddo-scoreboard-db-test' },
    modules: true,
    script: '',
  });
  db = await mf.getD1Database('DB');
  migrationSql = readFileSync(MIGRATION_PATH, 'utf8');
});

afterAll(async () => {
  await mf.dispose();
});

// Split a multi-statement migration into individual SQL statements so we
// can drive them through D1's per-statement APIs (D1's `db.exec()` only
// accepts a single statement; wrangler applies migrations by splitting
// on `;` server-side).
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

async function applyMigration() {
  for (const stmt of splitStatements(migrationSql)) {
    await db.prepare(stmt).run();
  }
}

beforeEach(async () => {
  // Wipe between tests so CREATE TABLE IF NOT EXISTS is the only thing
  // establishing schema (matches how the migration will be applied in
  // production: on a clean DB).
  await db.prepare('DROP TABLE IF EXISTS deleted_records').run();
});

describe('migrations/0006_deleted_records.sql', () => {
  it('declares the table and 2 indexes expected by the application', () => {
    expect(migrationSql).toMatch(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+deleted_records/i,
    );
    expect(migrationSql).toMatch(/record_type\s+TEXT\s+NOT\s+NULL/i);
    expect(migrationSql).toMatch(/original_id\s+INTEGER\s+NOT\s+NULL/i);
    expect(migrationSql).toMatch(/original_data\s+TEXT\s+NOT\s+NULL/i);
    expect(migrationSql).toMatch(/deleted_at\s+INTEGER\s+NOT\s+NULL/i);
    expect(migrationSql).toMatch(/deleted_by\s+INTEGER\s+NOT\s+NULL/i);
    expect(migrationSql).toMatch(/original_table\s+TEXT\s+NOT\s+NULL/i);
    expect(migrationSql).toMatch(/idx_deleted_records_lookup/i);
    expect(migrationSql).toMatch(/idx_deleted_records_deleted_at/i);
  });
});

describe('deleted_records table (real D1)', () => {
  it('CREATE TABLE IF NOT EXISTS is idempotent (running twice does not throw)', async () => {
    await expect(applyMigration()).resolves.toBeUndefined();
    // Second run must also succeed — IF NOT EXISTS should make this a no-op.
    await expect(applyMigration()).resolves.toBeUndefined();
  });

  it('INSERT then SELECT roundtrip preserves all fields', async () => {
    await applyMigration();

    const originalData = JSON.stringify({
      id: 99,
      user_id: 1,
      type: 'game_time',
      change_value: 30,
      reason: 'task reward',
      status: 'approved',
    });
    const deletedAt = Math.floor(Date.now() / 1000);

    const insert = await db
      .prepare(
        `INSERT INTO deleted_records
           (record_type, original_id, original_data, deleted_at, deleted_by, original_table)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind('score_event', 99, originalData, deletedAt, 1, 'score_events')
      .run();
    expect(insert.success).toBe(true);

    const rows = await db
      .prepare(
        `SELECT record_type, original_id, original_data, deleted_at,
                deleted_by, original_table
           FROM deleted_records
          WHERE record_type = ? AND original_id = ?`,
      )
      .bind('score_event', 99)
      .all<{
        record_type: string;
        original_id: number;
        original_data: string;
        deleted_at: number;
        deleted_by: number;
        original_table: string;
      }>();

    expect(rows.results).toHaveLength(1);
    const row = rows.results[0];
    expect(row.record_type).toBe('score_event');
    expect(row.original_id).toBe(99);
    expect(row.original_data).toBe(originalData);
    expect(row.deleted_at).toBe(deletedAt);
    expect(row.deleted_by).toBe(1);
    expect(row.original_table).toBe('score_events');
  });

  it('declares exactly 2 indexes on deleted_records (PRAGMA index_list)', async () => {
    await applyMigration();
    const { results } = await db
      .prepare(`PRAGMA index_list('deleted_records')`)
      .all<{ name: string; unique: number }>();

    // Filter out the auto-created sqlite sequence index; we only care
    // about the two indexes we declared explicitly.
    const declared = results
      .map((r) => r.name)
      .filter(
        (n) =>
          n !== 'sqlite_sequence' && !n.startsWith('sqlite_autoindex_'),
      );
    expect(declared).toEqual(
      expect.arrayContaining([
        'idx_deleted_records_lookup',
        'idx_deleted_records_deleted_at',
      ]),
    );
    expect(declared).toHaveLength(2);
  });
});

// tests/unit/achievement-real-d1.test.ts
// Integration test against REAL D1 (Miniflare + the actual migrations).
//
// The unit tests assert the money against an in-memory mock. This file
// asserts the same money against a real SQLite engine, so the SQL itself is
// validated — not just the mock's model of it:
//
//   - migration 0021 applies cleanly and is RE-APPLIABLE (the repo's own
//     hard-delete tests replay every migration in each beforeEach)
//   - the mint's source_ref really resolves to the award id through
//     connection-level last_insert_rowid() (not a placeholder)
//   - the burn's `INSERT ... SELECT ... WHERE NOT EXISTS` really is
//     conditional — a second burn writes 0 rows
//   - the FK columns really hold (no 0 placeholders on FK-enforced columns)
//   - the seeded season + 8 achievements land with the spec's ladder_json
//
// Same Miniflare setup shape as admin-events-hard-delete.test.ts.

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import app from '../../src/worker.ts';
import { signSession } from '../../src/auth/session.ts';
import type { D1Database } from '@cloudflare/workers-types/experimental';

const MIGRATIONS_DIR = resolve(process.cwd(), 'migrations');
const SECRET = 'unit-test-secret-1234567890';
const CHILD_ID = 2;
const PM_ID = 1;

let mf: Miniflare;
let db: D1Database;
let pmCookie: string;

/** Split a migration file into executable statements. */
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

async function applyAllMigrations(exclude?: string) {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  for (const f of files) {
    if (exclude && f.startsWith(exclude)) continue;
    const sql = readFileSync(resolve(MIGRATIONS_DIR, f), 'utf8');
    for (const stmt of splitStatements(sql)) {
      await db.prepare(stmt).run();
    }
  }
}

/** Apply a single migration file by its prefix (e.g. '0021'). */
async function applyMigration(prefix: string) {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
    .filter((f) => f.startsWith(prefix));
  for (const f of files) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, f), 'utf8');
    for (const stmt of splitStatements(sql)) {
      await db.prepare(stmt).run();
    }
  }
}

async function resetDb(options: { exclude?: string } = {}) {
  // Drop every table any migration creates, so the migrations can be
  // replayed from scratch on each test.
  //
  // FK-safe order: children before parents. `achievement_awards` references
  // achievements/seasons/users, so it must go first; `seasons` and
  // `achievements` are referenced by achievement_awards only.
  for (const t of [
    'audit_log',
    'deleted_records',
    'auth_attempts',
    'task_completions',
    'tasks',
    'app_config',
    'achievement_awards',
    'achievements',
    'seasons',
    'questions',
    'question_attempts',
    'families',
    'running_progress',
    'running_records',
    'running_points',
    'running_maps',
    'shop_redemptions',
    'shop_items',
    'health_events',
    'score_events',
    'users',
  ]) {
    await db.prepare(`DROP TABLE IF EXISTS ${t}`).run();
  }
  await applyAllMigrations(options.exclude);
}

async function seedUsers() {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO users (id, name, role, pin_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(PM_ID, 'PM', 'pm', 'fake-hash', now, now)
    .run();
  await db
    .prepare(
      `INSERT INTO users (id, name, role, pin_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(CHILD_ID, '', 'child', null, now, now)
    .run();
}

async function call(path: string, init: RequestInit = {}) {
  return app.request(`http://test.local${path}`, init, {
    DB: db,
    JWT_SECRET: SECRET,
  } as never);
}

async function post(path: string, body: unknown, cookie?: string) {
  return call(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** All pet-token ledger rows for the child. */
async function petTokenRows() {
  const res = await db
    .prepare(
      `SELECT id, user_id, type, change_value, reason, status, submitted_by, source, source_ref
       FROM score_events WHERE user_id = ? AND type = 'pet_tokens'
       ORDER BY id ASC`,
    )
    .bind(CHILD_ID)
    .all<{
      id: number;
      change_value: number;
      status: string;
      submitted_by: string;
      source: string;
      source_ref: string | null;
    }>();
  return res.results ?? [];
}

beforeAll(async () => {
  mf = new Miniflare({
    d1Databases: { DB: 'kiddo-scoreboard-db-test-achievements' },
    modules: true,
    script: '',
  });
  db = await mf.getD1Database('DB');
});

afterAll(async () => {
  await mf.dispose();
});

beforeEach(async () => {
  await resetDb();
  await seedUsers();
  const token = await signSession(
    { user_id: PM_ID, exp: 2_000_000_000 },
    SECRET,
  );
  pmCookie = `pm_session=${token}`;
});

// =============================================================
// Migration 0021
// =============================================================
describe('migration 0021 — schema + seed', () => {
  it('creates the three achievement tables', async () => {
    const tables = await db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table'
         AND name IN ('seasons','achievements','achievement_awards')`,
      )
      .all<{ name: string }>();
    expect((tables.results ?? []).map((t) => t.name).sort()).toEqual([
      'achievement_awards',
      'achievements',
      'seasons',
    ]);
  });

  it('seeds S1 with the spec §2 season values', async () => {
    const season = await db
      .prepare(`SELECT id, name, starts_on, ends_on, is_current FROM seasons`)
      .first<{ id: number; name: string; starts_on: string; ends_on: string | null; is_current: number }>();
    expect(season).toMatchObject({
      id: 1,
      name: 'S1 · 四年级上学期',
      starts_on: '2026-09-01',
      ends_on: null,
      is_current: 1,
    });
  });

  it('seeds exactly 8 achievements with the spec §2 ladders', async () => {
    const res = await db
      .prepare(
        `SELECT id, grp, name, grant_mode, ladder_json, sort_order
         FROM achievements ORDER BY sort_order ASC`,
      )
      .all<{
        id: number;
        grp: string;
        name: string;
        grant_mode: string;
        ladder_json: string | null;
        sort_order: number;
      }>();
    const rows = res.results ?? [];
    expect(rows).toHaveLength(8);
    expect(rows.map((r) => r.sort_order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    // 次数档奖项 (study ×3 + skill ×3)
    const countLadder = '{"iron":1,"bronze":3,"silver":5,"gold":8,"king":10}';
    for (const r of rows.filter((x) => x.grant_mode === 'admin_tier')) {
      expect(r.ladder_json).toBe(countLadder);
    }
    // 天数档 (自律生活)
    const streak = rows.find((r) => r.name === '自律生活')!;
    expect(streak.grant_mode).toBe('auto_streak');
    expect(streak.ladder_json).toBe('{"iron":2,"bronze":4,"silver":8,"gold":15,"king":30}');
    // 平发奖 (创新家务)
    const flat = rows.find((r) => r.name === '创新家务奖')!;
    expect(flat.grant_mode).toBe('admin_flat');
    expect(flat.ladder_json).toBeNull();
  });

  it('accepts the pet_tokens account type and the achievement source', async () => {
    await db
      .prepare(
        `INSERT INTO score_events
           (user_id, type, change_value, reason, status, submitted_by, source, source_ref)
         VALUES (?, 'pet_tokens', 3, 'test', 'approved', 'system', 'achievement', 'x')`,
      )
      .bind(CHILD_ID)
      .run();
    const row = await db
      .prepare(`SELECT COUNT(*) AS n FROM score_events WHERE type = 'pet_tokens'`)
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it('preserves existing score_events rows and their ids across the rebuild', async () => {
    // Rebuild the DB in the PRE-0021 state, write rows + FK references,
    // then apply 0021 — the real production upgrade path.
    await resetDb({ exclude: '0021' });
    // resetDb dropped the users/tasks, so re-create the rows the FKs need.
    await seedUsers();
    await db
      .prepare(
        `INSERT INTO tasks (id, name, token_reward, target_account, category, is_active, sort_order)
         VALUES (1, 't', 1, 'game_time', 'habit', 1, 0)`,
      )
      .run();

    // A coin event that a task completion points at.
    await db
      .prepare(
        `INSERT INTO score_events
           (id, user_id, type, change_value, reason, status, submitted_by, source, source_ref)
         VALUES (4242, ?, 'coins', 1, 'pre-rebuild', 'approved', 'child', 'task', 'task:1')`,
      )
      .bind(CHILD_ID)
      .run();
    await db
      .prepare(
        `INSERT INTO task_completions
           (id, task_id, user_id, status, completed_date, completed_at, awarded_event_id)
         VALUES (77, 1, ?, 'active', '2026-11-09', 1700000000, 4242)`,
      )
      .bind(CHILD_ID)
      .run();

    // Now apply the achievement migration.
    await applyMigration('0021');

    // The row survived with its id intact.
    const row = await db
      .prepare(
        `SELECT id, type, change_value, source_ref FROM score_events WHERE id = 4242`,
      )
      .first<{ id: number; type: string; change_value: number; source_ref: string }>();
    expect(row).toMatchObject({
      id: 4242,
      type: 'coins',
      change_value: 1,
      source_ref: 'task:1',
    });

    // And — unlike 0007, which NULL'd every awarded_event_id — the FK
    // reference into score_events is still intact.
    const completion = await db
      .prepare(`SELECT awarded_event_id FROM task_completions WHERE id = 77`)
      .first<{ awarded_event_id: number | null }>();
    expect(completion?.awarded_event_id).toBe(4242);

    // No FK violations anywhere.
    const violations = await db.prepare(`PRAGMA foreign_key_check`).all();
    expect(violations.results ?? []).toHaveLength(0);
  });

  it('preserves shop_redemptions FK references and restores the NOT NULL constraint', async () => {
    // The pre-0021 schema, with a redemption pointing at a coin event.
    await resetDb({ exclude: '0021' });
    await seedUsers();
    await db
      .prepare(
        `INSERT INTO score_events
           (id, user_id, type, change_value, reason, status, submitted_by, source)
         VALUES (900, ?, 'coins', -5, 'exchange', 'approved', 'child', 'exchange')`,
      )
      .bind(CHILD_ID)
      .run();
    await db
      .prepare(
        `INSERT INTO shop_redemptions
           (id, user_id, item_id, week_of, cost_coins, reward_value, reward_type,
            status, coin_event_id, reward_event_id)
         VALUES (11, ?, 1, '2026-W20', 5, 10, 'game_time', 'consumed', 900, 900)`,
      )
      .bind(CHILD_ID)
      .run();

    await applyMigration('0021');

    // The redemption's FK values survived.
    const redemption = await db
      .prepare(
        `SELECT coin_event_id, reward_event_id FROM shop_redemptions WHERE id = 11`,
      )
      .first<{ coin_event_id: number; reward_event_id: number }>();
    expect(redemption?.coin_event_id).toBe(900);
    expect(redemption?.reward_event_id).toBe(900);

    // And coin_event_id is NOT NULL again.
    const schema = await db
      .prepare(`SELECT sql FROM sqlite_master WHERE name = 'shop_redemptions'`)
      .first<{ sql: string }>();
    expect(schema?.sql).toMatch(/coin_event_id\s+INTEGER NOT NULL/i);

    // The FK now points at a real score_events row.
    const target = await db
      .prepare(`SELECT id FROM score_events WHERE id = 900`)
      .first();
    expect(target).not.toBeNull();

    const violations = await db.prepare(`PRAGMA foreign_key_check`).all();
    expect(violations.results ?? []).toHaveLength(0);
  });
});

// =============================================================
// The money, on real SQL
// =============================================================
describe('achievement grant/revoke — real D1', () => {
  it('mints the right number of tokens with a source_ref pointing at the real award', async () => {
    const r = await post(
      '/api/admin/achievement-awards',
      { achievement_id: 1, tier: 'bronze', user_id: CHILD_ID },
      pmCookie,
    );
    expect(r.status).toBe(201);
    const body = (await r.json()) as { award: { id: number }; tokens_minted: number };
    expect(body.tokens_minted).toBe(2);

    // The mint row's source_ref must resolve to the award row that exists
    // in the DB — this is the R4 check (a 0-placeholder / unresolved id
    // would not match any award row).
    const awardId = body.award.id;
    const award = await db
      .prepare(`SELECT id FROM achievement_awards WHERE id = ?`)
      .bind(awardId)
      .first<{ id: number }>();
    expect(award).not.toBeNull();

    const rows = await petTokenRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].change_value).toBe(2);
    expect(rows[0].source_ref).toBe(`achievement:award:${awardId}`);

    // The source_ref must actually resolve to a live award row.
    const resolved = await db
      .prepare(`SELECT id FROM achievement_awards WHERE id = ?`)
      .bind(awardId)
      .first();
    expect(resolved).not.toBeNull();
  });

  it('burns the tokens back on revoke, and never burns twice', async () => {
    const grant = await post(
      '/api/admin/achievement-awards',
      { achievement_id: 1, tier: 'gold', user_id: CHILD_ID },
      pmCookie,
    );
    const grantBody = (await grant.json()) as { award: { id: number } };

    const revoke = await post(
      '/api/admin/achievement-awards/revoke',
      { award_id: grantBody.award.id, confirm: true },
      pmCookie,
    );
    expect(revoke.status).toBe(200);
    const revokeBody = (await revoke.json()) as {
      tokens_burned: number;
      burn_skipped: boolean;
      pet_tokens: number;
    };
    expect(revokeBody.tokens_burned).toBe(5);
    expect(revokeBody.burn_skipped).toBe(false);
    expect(revokeBody.pet_tokens).toBe(0);

    // Two rows: +5 mint and -5 burn.
    const rows = await petTokenRows();
    expect(rows).toHaveLength(2);
    expect(rows[0].change_value).toBe(5);
    expect(rows[1].change_value).toBe(-5);

    // A second revoke is rejected AND writes no extra burn row.
    const second = await post(
      '/api/admin/achievement-awards/revoke',
      { award_id: grantBody.award.id, confirm: true },
      pmCookie,
    );
    expect(second.status).toBe(409);
    const rowsAfter = await petTokenRows();
    expect(rowsAfter).toHaveLength(2);
    expect(rowsAfter.filter((r) => r.change_value < 0)).toHaveLength(1);
  });

  it('the burn INSERT writes 0 rows when a burn already exists (SQL-level gate)', async () => {
    // Insert the mint + burn rows by hand, then call the burn path and
    // confirm the conditional INSERT did not add a third row.
    const grant = await post(
      '/api/admin/achievement-awards',
      { achievement_id: 1, tier: 'iron', user_id: CHILD_ID },
      pmCookie,
    );
    const grantBody = (await grant.json()) as { award: { id: number } };
    const awardId = grantBody.award.id;

    // Hand-write a burn row (as if a previous revoke had happened).
    await db
      .prepare(
        `INSERT INTO score_events
           (user_id, type, change_value, reason, status, submitted_by, source, source_ref)
         VALUES (?, 'pet_tokens', -1, 'manual burn', 'approved', 'pm', 'achievement', ?)`,
      )
      .bind(CHILD_ID, `achievement:award:${awardId}:burn`)
      .run();

    const before = await petTokenRows();
    expect(before.filter((r) => r.change_value < 0)).toHaveLength(1);

    // Run the same burn SQL the service uses — the WHERE NOT EXISTS guard
    // must make it a no-op.
    const res = await db
      .prepare(
        `INSERT INTO score_events
           (user_id, type, change_value, reason, status, submitted_by, source, source_ref, week_of, created_at)
         SELECT ?, 'pet_tokens', ?, ?, 'approved', 'pm', 'achievement', ?, NULL, unixepoch()
         WHERE NOT EXISTS (
           SELECT 1 FROM score_events WHERE source_ref = ? AND type = 'pet_tokens' AND change_value < 0
         )`,
      )
      .bind(CHILD_ID, -1, 'test burn', `achievement:award:${awardId}:burn`, `achievement:award:${awardId}:burn`)
      .run();

    expect(res.meta?.changes ?? 0).toBe(0);
    const after = await petTokenRows();
    expect(after.filter((r) => r.change_value < 0)).toHaveLength(1);
  });

  it('re-grant after revoke mints again under a NEW source_ref', async () => {
    const grant = await post(
      '/api/admin/achievement-awards',
      { achievement_id: 1, tier: 'silver', user_id: CHILD_ID },
      pmCookie,
    );
    const g1 = (await grant.json()) as { award: { id: number } };
    await post(
      '/api/admin/achievement-awards/revoke',
      { award_id: g1.award.id, confirm: true },
      pmCookie,
    );

    const regrant = await post(
      '/api/admin/achievement-awards',
      { achievement_id: 1, tier: 'silver', user_id: CHILD_ID },
      pmCookie,
    );
    const g2 = (await regrant.json()) as { award: { id: number }; tokens_minted: number };
    expect(g2.award.id).not.toBe(g1.award.id);
    expect(g2.tokens_minted).toBe(3);

    const rows = await petTokenRows();
    const refs = rows.map((r) => r.source_ref);
    expect(refs).toContain(`achievement:award:${g1.award.id}`);
    expect(refs).toContain(`achievement:award:${g1.award.id}:burn`);
    expect(refs).toContain(`achievement:award:${g2.award.id}`);
  });

  it('holds the FK columns: granted_by is a real user id, never 0', async () => {
    const r = await post(
      '/api/admin/achievement-awards',
      { achievement_id: 1, tier: 'iron', user_id: CHILD_ID },
      pmCookie,
    );
    expect(r.status).toBe(201);
    const award = await db
      .prepare(`SELECT granted_by, revoked_by FROM achievement_awards LIMIT 1`)
      .first<{ granted_by: number | null; revoked_by: number | null }>();
    expect(award?.granted_by).toBe(PM_ID);
    // No orphan FK values anywhere.
    const violations = await db
      .prepare(`PRAGMA foreign_key_check`)
      .all();
    expect(violations.results ?? []).toHaveLength(0);
  });

  it('the public wall reports the pet token balance and the parsed ladder', async () => {
    await post(
      '/api/admin/achievement-awards',
      { achievement_id: 1, tier: 'bronze', user_id: CHILD_ID },
      pmCookie,
    );
    const r = await call('/api/public/achievements?user_id=2');
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      season: { id: number; name: string };
      achievements: Array<{ ladder: Record<string, number>; award: { tier: string } | null }>;
      pet_tokens: number;
    };
    expect(body.season.name).toBe('S1 · 四年级上学期');
    expect(body.achievements).toHaveLength(8);
    expect(body.achievements[0].ladder).toEqual({
      iron: 1,
      bronze: 3,
      silver: 5,
      gold: 8,
      king: 10,
    });
    expect(body.achievements[0].award?.tier).toBe('bronze');
    expect(body.pet_tokens).toBe(2);
  });

  it('the audit trail records grant and revoke', async () => {
    const grant = await post(
      '/api/admin/achievement-awards',
      { achievement_id: 1, tier: 'iron', user_id: CHILD_ID },
      pmCookie,
    );
    const g = (await grant.json()) as { award: { id: number } };
    await post(
      '/api/admin/achievement-awards/revoke',
      { award_id: g.award.id, confirm: true },
      pmCookie,
    );

    const actions = await db
      .prepare(`SELECT action, actor FROM audit_log ORDER BY id ASC`)
      .all<{ action: string; actor: string }>();
    const list = (actions.results ?? []).map((a) => a.action);
    expect(list).toContain('achievement_grant');
    expect(list).toContain('achievement_revoke');
  });
});

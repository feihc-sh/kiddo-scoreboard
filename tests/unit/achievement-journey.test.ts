// tests/unit/achievement-journey.test.ts
// End-to-end journey on REAL D1 (Miniflare + the actual migrations).
//
// Walks the whole child/PM journey the way the app will use it:
//
//   1. empty wall (nothing earned yet)
//   2. PM grants a gold medal → +5 星币
//   3. the wall shows the gold medal
//   4. PM grants a bronze medal too → the wall still shows the HIGHER gold
//   5. PM revokes the gold → 5 星币 burned back
//   6. the wall drops back to bronze
//   7. PM starts S2 → the wall starts from zero
//   8. the S1 archive tab still shows S1's award
//   9. ledger integrity: every pet_tokens row resolves to a REAL award row
//
// This complements the unit tests (mock DB) and achievement-real-d1.test.ts
// (per-feature SQL assertions): here the whole flow runs against real SQL.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import app from '../../src/worker.ts';
import { signSession } from '../../src/auth/session.ts';
import type { D1Database } from '@cloudflare/workers-types/experimental';

const MIGRATIONS_DIR = resolve(process.cwd(), 'migrations');
const SECRET = 'unit-test-secret-1234567890';
const CHILD_ID = 2;

let mf: Miniflare;
let db: D1Database;
let cookie: string;

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

interface WallResponse {
  season: { id: number; name: string; starts_on: string; ends_on: string | null };
  achievements: Array<{
    id: number;
    name: string;
    award: { tier: string; granted_at: string; count: number } | null;
  }>;
  pet_tokens: number;
}

beforeAll(async () => {
  mf = new Miniflare({
    d1Databases: { DB: 'kiddo-scoreboard-db-test-journey' },
    modules: true,
    script: '',
  });
  db = await mf.getD1Database('DB');

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  for (const f of files) {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, f), 'utf8');
    for (const stmt of splitStatements(sql)) {
      await db.prepare(stmt).run();
    }
  }

  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO users (id, name, role, pin_hash, created_at, updated_at)
       VALUES (1, 'PM', 'pm', 'h', ?, ?)`,
    )
    .bind(now, now)
    .run();
  await db
    .prepare(
      `INSERT INTO users (id, name, role, pin_hash, created_at, updated_at)
       VALUES (2, '', 'child', NULL, ?, ?)`,
    )
    .bind(now, now)
    .run();

  const token = await signSession(
    { user_id: 1, exp: 2_000_000_000 },
    SECRET,
  );
  cookie = `pm_session=${token}`;
});

afterAll(async () => {
  await mf.dispose();
});

function call(path: string, init: RequestInit = {}) {
  return app.request(`http://x.local${path}`, init, {
    DB: db,
    JWT_SECRET: SECRET,
  } as never);
}

function post(path: string, body: unknown) {
  return call(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
}

async function wall(seasonId?: number): Promise<WallResponse> {
  const query =
    seasonId === undefined
      ? '/api/public/achievements?user_id=2'
      : `/api/public/achievements?user_id=2&season_id=${seasonId}`;
  const r = await call(query);
  expect(r.status).toBe(200);
  return (await r.json()) as WallResponse;
}

describe('achievement journey — real D1', () => {
  it('walks the whole grant → wall → revoke → season-switch flow', async () => {
    // 1. Empty wall: 8 achievements, nothing earned, no tokens.
    let w = await wall();
    expect(w.season.name).toBe('S1 · 四年级上学期');
    expect(w.achievements).toHaveLength(8);
    expect(w.achievements.every((a) => a.award === null)).toBe(true);
    expect(w.pet_tokens).toBe(0);

    // 2. PM grants a gold medal → +5 星币 (金牌 = 5, spec §5).
    const grant = await post('/api/admin/achievement-awards', {
      achievement_id: 1,
      tier: 'gold',
      user_id: CHILD_ID,
    });
    expect(grant.status).toBe(201);
    const grantBody = (await grant.json()) as {
      award: { id: number };
      tokens_minted: number;
      pet_tokens: number;
    };
    expect(grantBody.tokens_minted).toBe(5);
    expect(grantBody.pet_tokens).toBe(5);

    // 3. The wall shows the gold medal.
    w = await wall();
    expect(w.achievements[0].award?.tier).toBe('gold');
    expect(w.achievements[0].award?.count).toBe(1);
    expect(w.pet_tokens).toBe(5);

    // 4. A bronze medal on top → the wall still shows the HIGHER gold, and
    //    the gold's count stays 1 (count = grants of THAT tier).
    await post('/api/admin/achievement-awards', {
      achievement_id: 1,
      tier: 'bronze',
      user_id: CHILD_ID,
    });
    w = await wall();
    expect(w.achievements[0].award?.tier).toBe('gold');
    expect(w.achievements[0].award?.count).toBe(1);
    expect(w.pet_tokens).toBe(7);

    // 5. Revoke the gold → 5 星币 burned back.
    const log = (await (
      await call('/api/admin/achievement-awards?status=all', { headers: { cookie } })
    ).json()) as { awards: Array<{ id: number; tier: string }> };
    const goldAward = log.awards.find((a) => a.tier === 'gold')!;
    const revoke = await post('/api/admin/achievement-awards/revoke', {
      award_id: goldAward.id,
      confirm: true,
    });
    expect(revoke.status).toBe(200);
    const revokeBody = (await revoke.json()) as {
      tokens_burned: number;
      burn_skipped: boolean;
      pet_tokens: number;
    };
    expect(revokeBody.tokens_burned).toBe(5);
    expect(revokeBody.burn_skipped).toBe(false);
    expect(revokeBody.pet_tokens).toBe(2);

    // 6. The wall drops back to the bronze medal.
    w = await wall();
    expect(w.achievements[0].award?.tier).toBe('bronze');
    expect(w.pet_tokens).toBe(2);

    // 7. PM starts S2 → the current wall starts from zero.
    const season = await post('/api/admin/seasons', {
      name: 'S2 · 五年级下学期',
      starts_on: '2027-02-20',
    });
    expect(season.status).toBe(201);
    w = await wall();
    expect(w.season.name).toBe('S2 · 五年级下学期');
    expect(w.achievements[0].award).toBeNull();

    // 8. The archive tab still shows S1's award.
    w = await wall(1);
    expect(w.season.name).toBe('S1 · 四年级上学期');
    expect(w.achievements[0].award?.tier).toBe('bronze');

    // 9. Ledger integrity: every pet_tokens row resolves to a REAL award
    //    row (no dangling source_ref, no 0-placeholder).
    const rows = await db
      .prepare(
        `SELECT id, change_value, source_ref FROM score_events
         WHERE type = 'pet_tokens' ORDER BY id ASC`,
      )
      .all<{ id: number; change_value: number; source_ref: string }>();
    const list = rows.results ?? [];
    expect(list.length).toBeGreaterThan(0);
    for (const row of list) {
      const m = /^achievement:award:(\d+)(:burn)?$/.exec(row.source_ref);
      expect(m).not.toBeNull();
      const award = await db
        .prepare(`SELECT id, status FROM achievement_awards WHERE id = ?`)
        .bind(Number(m![1]))
        .first<{ id: number; status: string }>();
      expect(award).not.toBeNull();
    }
    // The minted +5 and the burned -5 are both there, and the balance nets
    // out to the bronze medal's +2.
    expect(list.filter((r) => r.change_value > 0).length).toBe(2);
    expect(list.filter((r) => r.change_value < 0).length).toBe(1);
  });
});

// tests/unit/achievement-public-api.test.ts
// GET /api/public/achievements — the achievement wall data (spec §7a / §7b).
//
// Verifies the response shape matches the spec's JSON exactly:
//   - `season` object with id / name / starts_on / ends_on
//   - `achievements[]` with id / grp / name / description / grant_mode /
//     ladder / award
//   - `pet_tokens` balance
//
// Plus the §7b field semantics:
//   - ladder is parsed server-side into an OBJECT (R11: never the raw JSON TEXT)
//   - award = the highest tier earned; null when nothing is earned
//   - award.count = how many times that tier was granted
//   - revoked awards do NOT count toward the displayed medal
//   - ?season_id= reads an archived season

import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/worker.ts';
import {
  addAchievement,
  addSeason,
  addUser,
  makeMockDb,
  type MockState,
} from './achievements-mock.ts';

const CHILD_ID = 2;

let mock = makeMockDb();
let state: MockState;

beforeEach(() => {
  mock = makeMockDb();
  state = mock.state;
  addUser(state, 1, 'pm');
  addUser(state, CHILD_ID, 'child');
});

function envObj() {
  return { DB: mock.db, JWT_SECRET: 'unit-test-secret-1234567890' };
}

async function call(path: string) {
  return app.request(`http://test.local${path}`, {}, envObj());
}

/** Insert an award row directly (simulating a grant). */
function addAward(overrides: Record<string, unknown> = {}) {
  const id = state.nextIds.award++;
  state.awards.push({
    id,
    achievement_id: 1,
    user_id: CHILD_ID,
    tier: 'bronze',
    season_id: 1,
    status: 'active',
    granted_by: 1,
    granted_at: 1_700_000_000,
    revoked_at: null,
    revoked_by: null,
    // 完成详情 (spec §7c) —— 默认没记 (= NULL)。
    completed_on: null,
    note: null,
    ...overrides,
  });
  return state.awards[state.awards.length - 1];
}

interface WallResponse {
  season: { id: number; name: string; starts_on: string; ends_on: string | null } | null;
  achievements: Array<{
    id: number;
    grp: string;
    name: string;
    description: string | null;
    grant_mode: string;
    ladder: Record<string, number> | null;
    award: { tier: string; granted_at: string; count: number } | null;
  }>;
  pet_tokens: number;
}

// =============================================================
// Response shape
// =============================================================
describe('GET /api/public/achievements — response shape', () => {
  it('returns 400 without user_id', async () => {
    const r = await call('/api/public/achievements');
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 for a non-positive user_id', async () => {
    const r = await call('/api/public/achievements?user_id=0');
    expect(r.status).toBe(400);
  });

  it('returns the season, the full achievement list and the token balance', async () => {
    addSeason(state, {
      id: 1,
      name: 'S1 · 四年级上学期',
      starts_on: '2026-09-01',
      ends_on: null,
      is_current: 1,
    });
    addAchievement(state, {
      id: 1,
      grp: 'study',
      name: '语文默写全对',
      description: '获得一次语文默写全对',
      grant_mode: 'admin_tier',
      ladder_json: '{"iron":1,"bronze":3,"silver":5,"gold":8,"king":10}',
      sort_order: 1,
    });

    const r = await call('/api/public/achievements?user_id=2');
    expect(r.status).toBe(200);
    const body = (await r.json()) as WallResponse;

    // season
    expect(body.season).toEqual({
      id: 1,
      name: 'S1 · 四年级上学期',
      starts_on: '2026-09-01',
      ends_on: null,
    });

    // achievements
    expect(body.achievements).toHaveLength(1);
    const a = body.achievements[0];
    expect(a.id).toBe(1);
    expect(a.grp).toBe('study');
    expect(a.name).toBe('语文默写全对');
    expect(a.description).toBe('获得一次语文默写全对');
    expect(a.grant_mode).toBe('admin_tier');
    // ladder is an OBJECT, not the raw JSON string (spec §7b, R11)
    expect(a.ladder).toEqual({ iron: 1, bronze: 3, silver: 5, gold: 8, king: 10 });
    expect(typeof a.ladder).toBe('object');
    // Nothing earned yet → award is null
    expect(a.award).toBeNull();

    // pet_tokens
    expect(body.pet_tokens).toBe(0);
  });

  it('returns an empty ladder object for a flat award (ladder_json NULL)', async () => {
    addSeason(state, { id: 1, is_current: 1 });
    addAchievement(state, {
      id: 5,
      grp: 'life',
      name: '创新家务奖',
      grant_mode: 'admin_flat',
      ladder_json: null,
      sort_order: 5,
    });

    const r = await call('/api/public/achievements?user_id=2');
    const body = (await r.json()) as WallResponse;
    expect(body.achievements[0].ladder).toEqual({});
  });
});

// =============================================================
// award semantics (spec §7b)
// =============================================================
describe('GET /api/public/achievements — award field', () => {
  beforeEach(() => {
    addSeason(state, {
      id: 1,
      name: 'S1 · 四年级上学期',
      starts_on: '2026-09-01',
      is_current: 1,
    });
    addAchievement(state, {
      id: 1,
      grp: 'study',
      name: '语文默写全对',
      grant_mode: 'admin_tier',
      ladder_json: '{"iron":1,"bronze":3,"silver":5,"gold":8,"king":10}',
      sort_order: 1,
    });
  });

  it('reports the HIGHEST tier earned, with count = grants of that tier', async () => {
    addAward({ tier: 'bronze', granted_at: 1_700_000_000 });
    addAward({ tier: 'gold', granted_at: 1_700_000_100 });
    // A second bronze — but gold is higher, so it must not be the winner.
    addAward({ tier: 'bronze', granted_at: 1_700_000_200 });

    const r = await call('/api/public/achievements?user_id=2');
    const body = (await r.json()) as WallResponse;
    const award = body.achievements[0].award;

    expect(award).not.toBeNull();
    expect(award!.tier).toBe('gold');
    // count = how many times THAT tier was granted (1 gold, not 3 awards)
    expect(award!.count).toBe(1);
    expect(typeof award!.granted_at).toBe('string');
    expect(new Date(award!.granted_at).toISOString()).toBe(award!.granted_at);
  });

  it('count reflects repeated grants of the same tier', async () => {
    addAward({ tier: 'silver', granted_at: 1_700_000_000 });
    addAward({ tier: 'silver', granted_at: 1_700_000_100 });
    addAward({ tier: 'silver', granted_at: 1_700_000_200 });

    const r = await call('/api/public/achievements?user_id=2');
    const body = (await r.json()) as WallResponse;
    expect(body.achievements[0].award!.tier).toBe('silver');
    expect(body.achievements[0].award!.count).toBe(3);
  });

  it('granted_at is the most recent grant of the winning tier', async () => {
    addAward({ tier: 'bronze', granted_at: 1_700_000_000 });
    addAward({ tier: 'bronze', granted_at: 1_700_000_500 });

    const r = await call('/api/public/achievements?user_id=2');
    const body = (await r.json()) as WallResponse;
    expect(body.achievements[0].award!.granted_at).toBe(
      new Date(1_700_000_500 * 1000).toISOString(),
    );
  });

  it('does NOT count revoked awards toward the displayed medal', async () => {
    addAward({ tier: 'gold', status: 'revoked', revoked_at: 1_700_000_300, revoked_by: 1 });
    addAward({ tier: 'bronze', status: 'active' });

    const r = await call('/api/public/achievements?user_id=2');
    const body = (await r.json()) as WallResponse;
    // The gold was revoked → the bronze is the highest LIVE medal.
    expect(body.achievements[0].award!.tier).toBe('bronze');
    expect(body.achievements[0].award!.count).toBe(1);
  });

  it('award is null when every award was revoked', async () => {
    addAward({ tier: 'gold', status: 'revoked', revoked_at: 1_700_000_300, revoked_by: 1 });

    const r = await call('/api/public/achievements?user_id=2');
    const body = (await r.json()) as WallResponse;
    expect(body.achievements[0].award).toBeNull();
  });

  it('only counts awards from the requested season', async () => {
    addSeason(state, { id: 2, name: 'S2', starts_on: '2026-12-01', is_current: 0 });
    addAward({ tier: 'gold', season_id: 2 });

    // The current season (1) has no awards for this user.
    const r = await call('/api/public/achievements?user_id=2');
    const body = (await r.json()) as WallResponse;
    expect(body.achievements[0].award).toBeNull();

    // The archived season (2) does.
    const r2 = await call('/api/public/achievements?user_id=2&season_id=2');
    const body2 = (await r2.json()) as WallResponse;
    expect(body2.season!.id).toBe(2);
    expect(body2.achievements[0].award!.tier).toBe('gold');
  });

  it('returns 404 for an unknown season_id', async () => {
    const r = await call('/api/public/achievements?user_id=2&season_id=999');
    expect(r.status).toBe(404);
  });

  it('returns 400 for a malformed season_id', async () => {
    const r = await call('/api/public/achievements?user_id=2&season_id=abc');
    expect(r.status).toBe(400);
  });

  it('reports the pet token balance', async () => {
    // A minted +3 token event.
    state.events.push({
      id: state.nextIds.event++,
      user_id: CHILD_ID,
      type: 'pet_tokens',
      change_value: 3,
      reason: '成就奖励',
      status: 'approved',
      submitted_by: 'system',
      source: 'achievement',
      source_ref: 'achievement:award:1',
      reviewed_by: null,
      reviewed_at: null,
      week_of: null,
      created_at: state.now,
    });
    // A pending one must NOT count.
    state.events.push({
      id: state.nextIds.event++,
      user_id: CHILD_ID,
      type: 'pet_tokens',
      change_value: 100,
      reason: 'pending',
      status: 'pending',
      submitted_by: 'system',
      source: 'achievement',
      source_ref: 'achievement:award:2',
      reviewed_by: null,
      reviewed_at: null,
      week_of: null,
      created_at: state.now,
    });

    const r = await call('/api/public/achievements?user_id=2');
    const body = (await r.json()) as WallResponse;
    expect(body.pet_tokens).toBe(3);
  });
});

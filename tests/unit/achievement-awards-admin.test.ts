// tests/unit/achievement-awards-admin.test.ts
// "Assert the money" (spec §10) — the admin achievement API.
//
// Verifies:
//   - grant mints EXACTLY the right number of pet tokens, with the right
//     source_ref, in the right batch position
//   - revoke burns them back symmetrically
//   - the burn double gate (R10): a revoked award is never burned twice
//   - revoke → re-grant creates a NEW award with NEW tokens (no collision)
//   - admin auth (401) + confirm gate (400) + status=all (default)
//   - same-tier re-grant is allowed
//
// The mock DB mirrors real SQL semantics (last_insert_rowid, conditional
// INSERT ... WHERE NOT EXISTS) — see tests/unit/achievements-mock.ts.

import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/worker.ts';
import { signSession } from '../../src/auth/session.ts';
import {
  addAchievement,
  addSeason,
  addUser,
  makeMockDb,
  petTokenBalance,
  petTokenEvents,
  type MockState,
} from './achievements-mock.ts';

const SECRET = 'unit-test-secret-1234567890';
const CHILD_ID = 2;
const PM_ID = 1;

let mock = makeMockDb();
let state: MockState;

beforeEach(() => {
  mock = makeMockDb();
  state = mock.state;
  addUser(state, PM_ID, 'pm');
  addUser(state, CHILD_ID, 'child');
  addSeason(state, { id: 1, name: 'S1 · 四年级上学期', starts_on: '2026-09-01', is_current: 1 });
});

function envObj() {
  return { DB: mock.db, JWT_SECRET: SECRET };
}

async function pmCookie(userId = PM_ID): Promise<string> {
  const token = await signSession(
    { user_id: userId, exp: Math.floor(Date.now() / 1000) + 3600 },
    SECRET,
  );
  return `pm_session=${token}`;
}

async function call(path: string, init: RequestInit = {}) {
  return app.request(`http://test.local${path}`, init, envObj());
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

async function get(path: string, cookie?: string) {
  return call(path, {
    method: 'GET',
    headers: cookie ? { cookie } : {},
  });
}

// =============================================================
// Grant — the money
// =============================================================
describe('POST /api/admin/achievement-awards — grant', () => {
  it('mints exactly TIER_TOKENS[tier] pet tokens with the right source_ref', async () => {
    const ach = addAchievement(state, { id: 1, grant_mode: 'admin_tier' });
    const cookie = await pmCookie();

    const r = await post(
      '/api/admin/achievement-awards',
      { achievement_id: ach.id, tier: 'bronze', user_id: CHILD_ID },
      cookie,
    );
    expect(r.status).toBe(201);
    const body = (await r.json()) as {
      award: { id: number; tier: string; status: string };
      tokens_minted: number;
      pet_tokens: number;
    };

    expect(body.award.tier).toBe('bronze');
    expect(body.award.status).toBe('active');
    // 铜牌 = +2 (spec §5)
    expect(body.tokens_minted).toBe(2);
    expect(body.pet_tokens).toBe(2);

    // Exactly ONE ledger row, +2, with the award-anchored source_ref.
    const events = petTokenEvents(state, CHILD_ID);
    expect(events).toHaveLength(1);
    expect(events[0].change_value).toBe(2);
    expect(events[0].type).toBe('pet_tokens');
    expect(events[0].status).toBe('approved');
    expect(events[0].source).toBe('achievement');
    expect(events[0].source_ref).toBe(`achievement:award:${body.award.id}`);
  });

  it('mints the right amount for every tier (spec §5: 铁1/铜2/银3/金5/王者8)', async () => {
    const ach = addAchievement(state, { id: 1, grant_mode: 'admin_tier' });
    const cookie = await pmCookie();
    const expected: Record<string, number> = {
      iron: 1,
      bronze: 2,
      silver: 3,
      gold: 5,
      king: 8,
    };

    for (const [tier, amount] of Object.entries(expected)) {
      const r = await post(
        '/api/admin/achievement-awards',
        { achievement_id: ach.id, tier, user_id: CHILD_ID },
        cookie,
      );
      expect(r.status).toBe(201);
      const body = (await r.json()) as { tokens_minted: number };
      expect(body.tokens_minted).toBe(amount);
    }
    // 5 grants → 5 ledger rows, 19 tokens total.
    expect(petTokenEvents(state, CHILD_ID)).toHaveLength(5);
    expect(petTokenBalance(state, CHILD_ID)).toBe(19);
  });

  it('flat award (创新家务) mints exactly 1 token', async () => {
    const ach = addAchievement(state, {
      id: 5,
      grp: 'life',
      name: '创新家务奖',
      grant_mode: 'admin_flat',
      ladder_json: null,
    });
    const cookie = await pmCookie();

    const r = await post(
      '/api/admin/achievement-awards',
      { achievement_id: ach.id, tier: 'flat', user_id: CHILD_ID },
      cookie,
    );
    expect(r.status).toBe(201);
    const body = (await r.json()) as { tokens_minted: number };
    expect(body.tokens_minted).toBe(1);
  });

  it('writes an audit_log row with action=achievement_grant and tier/award details', async () => {
    const ach = addAchievement(state, { id: 1 });
    const cookie = await pmCookie();

    const r = await post(
      '/api/admin/achievement-awards',
      { achievement_id: ach.id, tier: 'silver', user_id: CHILD_ID },
      cookie,
    );
    expect(r.status).toBe(201);
    const body = (await r.json()) as { award: { id: number } };

    expect(state.audit).toHaveLength(1);
    const entry = state.audit[0];
    expect(entry.action).toBe('achievement_grant');
    expect(entry.actor).toBe('pm');
    expect(entry.target_user_id).toBe(CHILD_ID);
    const details = JSON.parse(entry.details) as Record<string, unknown>;
    expect(details.tier).toBe('silver');
    expect(details.achievement_id).toBe(ach.id);
    expect(details.tokens).toBe(3);
  });

  it('mints the token INSIDE the same batch as the award (R4: no backfill)', async () => {
    const ach = addAchievement(state, { id: 1 });
    const cookie = await pmCookie();

    await post(
      '/api/admin/achievement-awards',
      { achievement_id: ach.id, tier: 'gold', user_id: CHILD_ID },
      cookie,
    );

    // The batch must be [award INSERT, token INSERT, audit INSERT] — the
    // token's source_ref is derived from last_insert_rowid() of the award
    // INSERT, so it can only be correct if it runs after it in one batch.
    expect(state.batches).toHaveLength(1);
    const batch = state.batches[0];
    expect(batch).toHaveLength(3);
    expect(batch[0].query).toMatch(/^INSERT INTO achievement_awards/i);
    expect(batch[1].query).toMatch(/^INSERT INTO score_events/i);
    expect(batch[1].query).toMatch(/last_insert_rowid\(\)/i);
    expect(batch[2].query).toMatch(/^INSERT INTO audit_log/i);
  });

  it('allows same-tier re-grant: 2 awards, 2 mints, distinct source_refs', async () => {
    const ach = addAchievement(state, { id: 1 });
    const cookie = await pmCookie();

    const r1 = await post(
      '/api/admin/achievement-awards',
      { achievement_id: ach.id, tier: 'bronze', user_id: CHILD_ID },
      cookie,
    );
    const r2 = await post(
      '/api/admin/achievement-awards',
      { achievement_id: ach.id, tier: 'bronze', user_id: CHILD_ID },
      cookie,
    );
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);

    const b1 = (await r1.json()) as { award: { id: number } };
    const b2 = (await r2.json()) as { award: { id: number } };
    expect(b2.award.id).not.toBe(b1.award.id);

    // Two awards, two mints — each with its own award-anchored source_ref.
    expect(state.awards).toHaveLength(2);
    const events = petTokenEvents(state, CHILD_ID);
    expect(events).toHaveLength(2);
    const refs = events.map((e) => e.source_ref).sort();
    expect(refs).toEqual(
      [
        `achievement:award:${b1.award.id}`,
        `achievement:award:${b2.award.id}`,
      ].sort(),
    );
    expect(petTokenBalance(state, CHILD_ID)).toBe(4);
  });

  it('returns 401 without a PM session', async () => {
    const ach = addAchievement(state, { id: 1 });
    const r = await post('/api/admin/achievement-awards', {
      achievement_id: ach.id,
      tier: 'bronze',
      user_id: CHILD_ID,
    });
    expect(r.status).toBe(401);
    const body = (await r.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
    // Nothing written.
    expect(state.awards).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it('rejects a tier that is not in the achievement ladder', async () => {
    const ach = addAchievement(state, { id: 1, grant_mode: 'admin_tier' });
    const cookie = await pmCookie();
    const r = await post(
      '/api/admin/achievement-awards',
      { achievement_id: ach.id, tier: 'flat', user_id: CHILD_ID },
      cookie,
    );
    expect(r.status).toBe(400);
    expect(state.awards).toHaveLength(0);
  });

  it('rejects a medal tier for a flat award', async () => {
    const ach = addAchievement(state, {
      id: 5,
      grant_mode: 'admin_flat',
      ladder_json: null,
    });
    const cookie = await pmCookie();
    const r = await post(
      '/api/admin/achievement-awards',
      { achievement_id: ach.id, tier: 'gold', user_id: CHILD_ID },
      cookie,
    );
    expect(r.status).toBe(400);
    expect(state.awards).toHaveLength(0);
  });

  it('returns 404 for an unknown achievement', async () => {
    const cookie = await pmCookie();
    const r = await post(
      '/api/admin/achievement-awards',
      { achievement_id: 999, tier: 'bronze', user_id: CHILD_ID },
      cookie,
    );
    expect(r.status).toBe(404);
    expect(state.awards).toHaveLength(0);
  });
});

// =============================================================
// Revoke — the symmetric burn
// =============================================================
describe('POST /api/admin/achievement-awards/revoke — revoke', () => {
  async function grantBronze() {
    const ach = addAchievement(state, { id: 1 });
    const cookie = await pmCookie();
    const r = await post(
      '/api/admin/achievement-awards',
      { achievement_id: ach.id, tier: 'bronze', user_id: CHILD_ID },
      cookie,
    );
    const body = (await r.json()) as { award: { id: number } };
    return { cookie, awardId: body.award.id };
  }

  it('burns the tokens back symmetrically', async () => {
    const { cookie, awardId } = await grantBronze();
    expect(petTokenBalance(state, CHILD_ID)).toBe(2);

    const r = await post(
      '/api/admin/achievement-awards/revoke',
      { award_id: awardId, confirm: true },
      cookie,
    );
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      tokens_burned: number;
      burn_skipped: boolean;
      pet_tokens: number;
      award: { status: string };
    };

    expect(body.tokens_burned).toBe(2);
    expect(body.burn_skipped).toBe(false);
    expect(body.award.status).toBe('revoked');
    expect(body.pet_tokens).toBe(0);

    // Two ledger rows: +2 mint, -2 burn.
    const events = petTokenEvents(state, CHILD_ID);
    expect(events).toHaveLength(2);
    expect(events[0].change_value).toBe(2);
    expect(events[1].change_value).toBe(-2);
    // The burn row is anchored on the award, with the ':burn' suffix.
    expect(events[1].source_ref).toBe(`achievement:award:${awardId}:burn`);
    expect(petTokenBalance(state, CHILD_ID)).toBe(0);
  });

  it('double gate: a revoked award is NOT burned a second time (R10)', async () => {
    const { cookie, awardId } = await grantBronze();

    const r1 = await post(
      '/api/admin/achievement-awards/revoke',
      { award_id: awardId, confirm: true },
      cookie,
    );
    expect(r1.status).toBe(200);

    // Second revoke attempt → rejected, and NO extra burn row.
    const r2 = await post(
      '/api/admin/achievement-awards/revoke',
      { award_id: awardId, confirm: true },
      cookie,
    );
    expect(r2.status).toBe(409);
    const body2 = (await r2.json()) as { error: { code: string } };
    expect(body2.error.code).toBe('ALREADY_REVOKED');

    // Still exactly 2 ledger rows: +2 and -2. The revoked row was not
    // burned again.
    const events = petTokenEvents(state, CHILD_ID);
    expect(events).toHaveLength(2);
    expect(events.filter((e) => e.change_value < 0)).toHaveLength(1);
    expect(petTokenBalance(state, CHILD_ID)).toBe(0);
  });

  it('requires confirm: true (destructive gate, R9)', async () => {
    const { cookie, awardId } = await grantBronze();

    const r = await post(
      '/api/admin/achievement-awards/revoke',
      { award_id: awardId },
      cookie,
    );
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CONFIRM_REQUIRED');

    // Nothing burned, award still active.
    expect(petTokenEvents(state, CHILD_ID)).toHaveLength(1);
    expect(state.awards[0].status).toBe('active');
  });

  it('returns 401 without a PM session', async () => {
    const { awardId } = await grantBronze();
    const r = await post('/api/admin/achievement-awards/revoke', {
      award_id: awardId,
      confirm: true,
    });
    expect(r.status).toBe(401);
    expect(petTokenEvents(state, CHILD_ID)).toHaveLength(1);
  });

  it('returns 404 for an unknown award', async () => {
    const cookie = await pmCookie();
    const r = await post(
      '/api/admin/achievement-awards/revoke',
      { award_id: 999, confirm: true },
      cookie,
    );
    expect(r.status).toBe(404);
  });

  it('writes an audit_log row with action=achievement_revoke', async () => {
    const { cookie, awardId } = await grantBronze();
    await post(
      '/api/admin/achievement-awards/revoke',
      { award_id: awardId, confirm: true },
      cookie,
    );

    const revokeEntry = state.audit.find((a) => a.action === 'achievement_revoke');
    expect(revokeEntry).toBeDefined();
    const details = JSON.parse(revokeEntry!.details) as Record<string, unknown>;
    expect(details.award_id).toBe(awardId);
    expect(details.tier).toBe('bronze');
    expect(details.tokens_burned).toBe(2);
  });

  it('revoke → re-grant creates a NEW award and NEW tokens (no source_ref collision)', async () => {
    const { cookie, awardId } = await grantBronze();
    await post(
      '/api/admin/achievement-awards/revoke',
      { award_id: awardId, confirm: true },
      cookie,
    );
    expect(petTokenBalance(state, CHILD_ID)).toBe(0);

    // Re-grant the same tier.
    const ach = state.achievements[0];
    const r = await post(
      '/api/admin/achievement-awards',
      { achievement_id: ach.id, tier: 'bronze', user_id: CHILD_ID },
      cookie,
    );
    expect(r.status).toBe(201);
    const body = (await r.json()) as { award: { id: number }; tokens_minted: number };

    expect(body.award.id).not.toBe(awardId);
    expect(body.tokens_minted).toBe(2);

    // 3 ledger rows: +2 (old), -2 (burn), +2 (new). The new mint's
    // source_ref is anchored on the NEW award id, so it does not collide
    // with the old (burned) one.
    const events = petTokenEvents(state, CHILD_ID);
    expect(events).toHaveLength(3);
    expect(petTokenBalance(state, CHILD_ID)).toBe(2);

    const refs = events.map((e) => e.source_ref);
    expect(refs).toContain(`achievement:award:${awardId}`);
    expect(refs).toContain(`achievement:award:${awardId}:burn`);
    expect(refs).toContain(`achievement:award:${body.award.id}`);
  });
});

// =============================================================
// Grant log
// =============================================================
describe('GET /api/admin/achievement-awards — grant log', () => {
  it('returns ALL awards by default (status=all, R8 lesson)', async () => {
    const ach = addAchievement(state, { id: 1 });
    const cookie = await pmCookie();

    await post(
      '/api/admin/achievement-awards',
      { achievement_id: ach.id, tier: 'bronze', user_id: CHILD_ID },
      cookie,
    );
    const grantBody = (
      await (
        await post(
          '/api/admin/achievement-awards',
          { achievement_id: ach.id, tier: 'silver', user_id: CHILD_ID },
          cookie,
        )
      ).json()
    ) as { award: { id: number } };
    await post(
      '/api/admin/achievement-awards/revoke',
      { award_id: grantBody.award.id, confirm: true },
      cookie,
    );

    const r = await get('/api/admin/achievement-awards', cookie);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { awards: unknown[]; status: string };
    // Both the active and the revoked award are in the default log.
    expect(body.awards).toHaveLength(2);
    expect(body.status).toBe('all');
  });

  it('status=active filters out revoked rows', async () => {
    const ach = addAchievement(state, { id: 1 });
    const cookie = await pmCookie();
    await post(
      '/api/admin/achievement-awards',
      { achievement_id: ach.id, tier: 'bronze', user_id: CHILD_ID },
      cookie,
    );
    const grantBody = (
      await (
        await post(
          '/api/admin/achievement-awards',
          { achievement_id: ach.id, tier: 'silver', user_id: CHILD_ID },
          cookie,
        )
      ).json()
    ) as { award: { id: number } };
    await post(
      '/api/admin/achievement-awards/revoke',
      { award_id: grantBody.award.id, confirm: true },
      cookie,
    );

    const r = await get('/api/admin/achievement-awards?status=active', cookie);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { awards: Array<{ status: string }> };
    expect(body.awards).toHaveLength(1);
    expect(body.awards[0].status).toBe('active');
  });

  it('status=revoked returns only revoked rows', async () => {
    const ach = addAchievement(state, { id: 1 });
    const cookie = await pmCookie();
    const grantBody = (
      await (
        await post(
          '/api/admin/achievement-awards',
          { achievement_id: ach.id, tier: 'bronze', user_id: CHILD_ID },
          cookie,
        )
      ).json()
    ) as { award: { id: number } };
    await post(
      '/api/admin/achievement-awards/revoke',
      { award_id: grantBody.award.id, confirm: true },
      cookie,
    );

    const r = await get('/api/admin/achievement-awards?status=revoked', cookie);
    const body = (await r.json()) as { awards: Array<{ status: string }> };
    expect(body.awards).toHaveLength(1);
    expect(body.awards[0].status).toBe('revoked');
  });

  it('returns 401 without a PM session', async () => {
    const r = await get('/api/admin/achievement-awards');
    expect(r.status).toBe(401);
  });
});

// src/routes/admin/achievement-awards.ts
// PM-only achievement administration (spec docs/achievements-spec.md §7).
//
//   POST /api/admin/achievement-awards          — grant a medal
//   POST /api/admin/achievement-awards/revoke   — revoke a medal (confirm gate)
//   GET  /api/admin/achievement-awards          — grant log (status=all default)
//   POST /api/admin/seasons                     — create a new season
//   POST /api/admin/achievements/eval-streak    — manually re-run the streak engine
//
// Money rules live in src/utils/achievement-service.ts so the admin path and
// the automatic streak engine can never drift apart.
//
// Destructive endpoint (revoke) carries a `confirm: true` gate (spec §3, R9):
// the PM UI must echo the confirmation explicitly, so a stray retry can't
// silently burn tokens.

import { Hono } from 'hono';
import type { Context } from 'hono';
import { getPmUserId } from '../../middleware/requirePm.ts';
import type {
  AchievementTier,
  AwardStatus,
} from '../../db/types.ts';
import {
  ALL_TIERS,
  AWARD_COLUMNS,
  SEASON_COLUMNS,
  TIER_ORDER,
  getAchievement,
  getCurrentSeason,
  getSeasonById,
  isAchievementTier,
  listAchievements,
  listSeasons,
  parseLadder,
} from '../../utils/achievements.ts';
import {
  grantAchievementAward,
  revokeAchievementAward,
} from '../../utils/achievement-service.ts';
import { getPetTokenBalance } from '../../utils/achievements.ts';
import { evaluateStreakForUser } from '../../utils/streak.ts';
import type { Env } from '../../worker.ts';

const achievementsAdmin = new Hono<{ Bindings: Env }>();

const DEFAULT_CHILD_USER_ID = 2;

function unauthorized(c: Context<{ Bindings: Env }>) {
  return c.json(
    { error: { code: 'UNAUTHORIZED', message: 'PM session required' } },
    401,
  );
}

function badRequest(c: Context<{ Bindings: Env }>, message: string, code = 'BAD_REQUEST') {
  return c.json({ error: { code, message } }, 400);
}

// =============================================================
// POST /api/admin/achievement-awards — grant
// =============================================================

interface GrantBody {
  achievement_id: number;
  tier: AchievementTier;
  user_id: number;
  season_id?: number;
}

function parseGrantBody(raw: unknown): { ok: true; value: GrantBody } | { ok: false; message: string } {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: 'body must be a JSON object' };
  }
  const b = raw as Record<string, unknown>;

  if (!Number.isInteger(b.achievement_id) || (b.achievement_id as number) <= 0) {
    return { ok: false, message: 'achievement_id must be a positive integer' };
  }
  if (!isAchievementTier(b.tier)) {
    return { ok: false, message: `tier must be one of ${ALL_TIERS.join(', ')}` };
  }
  if (!Number.isInteger(b.user_id) || (b.user_id as number) <= 0) {
    return { ok: false, message: 'user_id must be a positive integer' };
  }
  if (b.season_id !== undefined) {
    if (!Number.isInteger(b.season_id) || (b.season_id as number) <= 0) {
      return { ok: false, message: 'season_id must be a positive integer' };
    }
  }

  return {
    ok: true,
    value: {
      achievement_id: b.achievement_id as number,
      tier: b.tier,
      user_id: b.user_id as number,
      season_id: b.season_id as number | undefined,
    },
  };
}

achievementsAdmin.post('/', async (c) => {
  const pmUserId = await getPmUserId(c);
  if (pmUserId == null) return unauthorized(c);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return badRequest(c, 'invalid JSON body');
  }
  const parsed = parseGrantBody(raw);
  if (!parsed.ok) return badRequest(c, parsed.message);
  const body = parsed.value;

  const db = c.env.DB;

  const achievement = await getAchievement(db, body.achievement_id);
  if (!achievement) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'achievement not found' } },
      404,
    );
  }
  if (achievement.is_active === 0) {
    return c.json(
      { error: { code: 'ACHIEVEMENT_INACTIVE', message: 'achievement is not active' } },
      400,
    );
  }

  // Tier must be legal for this achievement's grant_mode:
  //   'admin_flat'  → only 'flat' (no medal hierarchy)
  //   'admin_tier'  → one of the five medal tiers
  //   'auto_streak' → admin may still grant manually, but only a real tier
  if (achievement.grant_mode === 'admin_flat') {
    if (body.tier !== 'flat') {
      return badRequest(
        c,
        `achievement "${achievement.name}" is a flat award; tier must be 'flat'`,
        'INVALID_TIER',
      );
    }
  } else if (body.tier === 'flat') {
    return badRequest(
      c,
      `achievement "${achievement.name}" uses medal tiers; tier must be one of ${TIER_ORDER.join(', ')}`,
      'INVALID_TIER',
    );
  } else {
    // admin_tier achievements have a ladder — the granted tier should be one
    // the ladder knows about. We warn-by-error only when the ladder is
    // non-empty and the tier is absent from it.
    const ladder = parseLadder(achievement.ladder_json);
    if (Object.keys(ladder).length > 0 && ladder[body.tier] === undefined) {
      return badRequest(
        c,
        `tier '${body.tier}' is not in the ladder for "${achievement.name}"`,
        'INVALID_TIER',
      );
    }
  }

  // Season: explicit season_id wins, else the current season.
  let seasonId = body.season_id;
  if (seasonId === undefined) {
    const season = await getCurrentSeason(db);
    if (!season) {
      return c.json(
        {
          error: {
            code: 'NO_CURRENT_SEASON',
            message: 'no current season; pass season_id explicitly',
          },
        },
        400,
      );
    }
    seasonId = season.id;
  } else {
    const season = await getSeasonById(db, seasonId);
    if (!season) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'season not found' } },
        404,
      );
    }
  }

  // Same-tier re-grant is allowed (spec §7b) — each grant is a new award row
  // with its own token mint.
  const result = await grantAchievementAward({
    db,
    achievement,
    userId: body.user_id,
    tier: body.tier,
    seasonId,
    grantedBy: pmUserId,
    actor: 'pm',
  });

  const petTokens = await getPetTokenBalance(db, body.user_id);

  return c.json(
    {
      award: result.award,
      tokens_minted: result.tokensMinted,
      token_event_id: result.tokenEventId,
      pet_tokens: petTokens,
    },
    201,
  );
});

// =============================================================
// POST /api/admin/achievement-awards/revoke — revoke (confirm gate)
// =============================================================

achievementsAdmin.post('/revoke', async (c) => {
  const pmUserId = await getPmUserId(c);
  if (pmUserId == null) return unauthorized(c);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return badRequest(c, 'invalid JSON body');
  }
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return badRequest(c, 'body must be a JSON object');
  }
  const b = raw as Record<string, unknown>;

  // Destructive gate (spec §3, R9): the caller must explicitly confirm.
  if (b.confirm !== true) {
    return badRequest(
      c,
      'confirm: true is required for a destructive revoke',
      'CONFIRM_REQUIRED',
    );
  }
  if (!Number.isInteger(b.award_id) || (b.award_id as number) <= 0) {
    return badRequest(c, 'award_id must be a positive integer');
  }

  const db = c.env.DB;
  const outcome = await revokeAchievementAward({
    db,
    awardId: b.award_id as number,
    revokedBy: pmUserId,
    actor: 'pm',
  });

  if (!outcome.ok) {
    if (outcome.code === 'NOT_FOUND') {
      return c.json(
        { error: { code: 'NOT_FOUND', message: outcome.message } },
        404,
      );
    }
    return c.json(
      { error: { code: 'ALREADY_REVOKED', message: outcome.message } },
      409,
    );
  }

  const petTokens = await getPetTokenBalance(db, outcome.result.award.user_id);

  return c.json({
    award: outcome.result.award,
    tokens_burned: outcome.result.tokensBurned,
    token_event_id: outcome.result.tokenEventId,
    burn_skipped: outcome.result.burnSkipped,
    pet_tokens: petTokens,
  });
});

// =============================================================
// GET /api/admin/achievement-awards — grant log
// =============================================================
//
// ?status=all (default) → every row, active and revoked.
// ?status=active      → only live awards.
// ?status=revoked     → only revoked awards.
//
// The default is 'all' (spec §7): the admin log is an audit surface, and
// hiding revoked rows would make the log look like it lost data (the R8
// lesson — default filters silently hide history).

achievementsAdmin.get('/', async (c) => {
  const pmUserId = await getPmUserId(c);
  if (pmUserId == null) return unauthorized(c);

  const statusParam = c.req.query('status') ?? 'all';
  if (!['all', 'active', 'revoked'].includes(statusParam)) {
    return badRequest(c, "status must be one of 'all', 'active', 'revoked'");
  }
  const status = statusParam as AwardStatus | 'all';

  const where = status === 'all' ? '' : 'WHERE status = ?';
  const stmt = c.env.DB.prepare(
    `SELECT ${AWARD_COLUMNS} FROM achievement_awards ${where}
     ORDER BY granted_at DESC, id DESC`,
  );
  const bound = status === 'all' ? stmt.bind() : stmt.bind(status);
  const result = await bound.all();

  return c.json({ awards: result.results ?? [], status });
});

// =============================================================
// POST /api/admin/seasons — create a new season
// =============================================================
//
// Creates a season and flips is_current: the new season becomes current and
// the previously-current one is archived (is_current = 0). Existing awards
// stay attached to their old season, so the archive tab still shows them
// (spec §1: 赛季结束 → 成就墙归档到「上赛季」视图, 计数清零).

interface SeasonBody {
  name: string;
  starts_on: string;
  ends_on: string | null;
  is_current?: boolean;
}

function parseSeasonBody(raw: unknown): { ok: true; value: SeasonBody } | { ok: false; message: string } {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: 'body must be a JSON object' };
  }
  const b = raw as Record<string, unknown>;

  if (typeof b.name !== 'string' || b.name.trim() === '') {
    return { ok: false, message: 'name is required' };
  }
  if (typeof b.starts_on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.starts_on)) {
    return { ok: false, message: 'starts_on must be YYYY-MM-DD' };
  }
  if (b.ends_on !== undefined && b.ends_on !== null) {
    if (typeof b.ends_on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.ends_on)) {
      return { ok: false, message: 'ends_on must be YYYY-MM-DD or null' };
    }
  }
  if (b.is_current !== undefined && typeof b.is_current !== 'boolean') {
    return { ok: false, message: 'is_current must be a boolean' };
  }

  return {
    ok: true,
    value: {
      name: b.name.trim(),
      starts_on: b.starts_on,
      ends_on: (b.ends_on as string | null | undefined) ?? null,
      is_current: b.is_current as boolean | undefined,
    },
  };
}

achievementsAdmin.post('/seasons', async (c) => {
  const pmUserId = await getPmUserId(c);
  if (pmUserId == null) return unauthorized(c);

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return badRequest(c, 'invalid JSON body');
  }
  const parsed = parseSeasonBody(raw);
  if (!parsed.ok) return badRequest(c, parsed.message);
  const body = parsed.value;

  const db = c.env.DB;
  const now = Math.floor(Date.now() / 1000);
  // A new season becomes the current one by default (the common case is
  // "start a new term"). Pass is_current: false to create it in advance
  // without flipping the current season.
  const makeCurrent = body.is_current ?? true;

  // NOTE: c.env.DB is the ambient workers-types D1Database, so the batch
  // array must use the ambient D1PreparedStatement type (the local mirror
  // in src/db/types.ts is structurally identical but a distinct type).
  const statements: D1PreparedStatement[] = [];

  if (makeCurrent) {
    // Flip the current season off first — the partial unique index on
    // is_current = 1 allows only one current season at a time.
    statements.push(
      db.prepare(`UPDATE seasons SET is_current = 0 WHERE is_current = 1`),
    );
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO seasons (name, starts_on, ends_on, is_current)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(body.name, body.starts_on, body.ends_on, makeCurrent ? 1 : 0),
  );

  statements.push(
    db
      .prepare(
        `INSERT INTO audit_log
           (actor, action, target_event_id, target_user_id, details, created_at)
         VALUES ('pm', 'achievement_grant', NULL, ?, ?, ?)`,
      )
      .bind(
        pmUserId,
        JSON.stringify({
          action: 'season_create',
          name: body.name,
          starts_on: body.starts_on,
          ends_on: body.ends_on,
          is_current: makeCurrent ? 1 : 0,
        }),
        now,
      ),
  );

  const results = await db.batch(statements);
  const seasonId = Number(results[results.length - 2]?.meta?.last_row_id ?? 0);

  const seasons = await listSeasons(db);
  return c.json({ season_id: seasonId, seasons }, 201);
});

// =============================================================
// GET /api/admin/seasons — list seasons (used by the wall's archive tab)
// =============================================================

achievementsAdmin.get('/seasons', async (c) => {
  const pmUserId = await getPmUserId(c);
  if (pmUserId == null) return unauthorized(c);

  const db = c.env.DB;
  const seasons = await listSeasons(db);
  const achievements = await listAchievements(db, { includeInactive: true });
  return c.json({
    seasons,
    achievements: achievements.map((a) => ({
      id: a.id,
      grp: a.grp,
      name: a.name,
      description: a.description,
      grant_mode: a.grant_mode,
      ladder: parseLadder(a.ladder_json),
      sort_order: a.sort_order,
      is_active: a.is_active,
    })),
  });
});

// =============================================================
// POST /api/admin/achievements/eval-streak — manual streak re-evaluation
// =============================================================
//
// Debug endpoint (spec §8a). Runs the same engine the /complete hook runs,
// so a PM can force a re-check after fixing data.

achievementsAdmin.post('/achievements/eval-streak', async (c) => {
  const pmUserId = await getPmUserId(c);
  if (pmUserId == null) return unauthorized(c);

  let raw: unknown = {};
  try {
    raw = await c.req.json();
  } catch {
    raw = {};
  }
  const b = (raw ?? {}) as Record<string, unknown>;
  const userId = Number.isInteger(b.user_id) && (b.user_id as number) > 0
    ? (b.user_id as number)
    : DEFAULT_CHILD_USER_ID;

  const db = c.env.DB;
  const result = await evaluateStreakForUser(db, userId);
  return c.json(result);
});

// Re-export for the mount point in src/routes/admin/index.ts.
export { SEASON_COLUMNS };
export default achievementsAdmin;

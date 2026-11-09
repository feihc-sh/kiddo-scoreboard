// src/routes/public/achievements.ts
// GET /api/public/achievements?user_id=N[&season_id=M]
// Read-only achievement wall data (spec docs/achievements-spec.md §7a).
//
// Response shape (spec §7a) — the frontend (C2) renders this directly:
//
//   {
//     "season": { "id": 1, "name": "S1 · 四年级上学期",
//                 "starts_on": "2026-09-01", "ends_on": null },
//     "achievements": [
//       {
//         "id": 1, "grp": "study", "name": "语文默写全对",
//         "description": "获得一次语文默写全对",
//         "grant_mode": "admin_tier",
//         "ladder": { "iron": 1, "bronze": 3, "silver": 5, "gold": 8, "king": 10 },
//         "award": null
//       }
//     ],
//     "pet_tokens": 0
//   }
//
// award = the HIGHEST medal earned for that achievement in the season, or
// null when nothing was earned. The ladder is parsed server-side from
// ladder_json (spec §7b, R11 — never return the raw JSON TEXT).

import { Hono } from 'hono';
import type { Env } from '../../worker.ts';
import type {
  AchievementAward,
  AchievementTier,
  Season,
} from '../../db/types.ts';
import {
  getCurrentSeason,
  getPetTokenBalance,
  getSeasonById,
  highestTier,
  listAchievements,
  listAwardsForUserSeason,
  parseLadder,
  tierRank,
} from '../../utils/achievements.ts';

const achievements = new Hono<{ Bindings: Env }>();

/** The medal shown on the wall for one achievement. */
interface WallAward {
  tier: AchievementTier;
  granted_at: string;
  count: number;
}

achievements.get('/', async (c) => {
  const userIdStr = c.req.query('user_id');
  if (userIdStr === undefined || userIdStr === '') {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'user_id query param is required' } },
      400,
    );
  }
  const userId = Number(userIdStr);
  if (!Number.isInteger(userId) || userId <= 0) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'user_id must be a positive integer' } },
      400,
    );
  }

  const db = c.env.DB;

  // Season: explicit season_id (archive tab) wins, else the current season.
  const seasonIdStr = c.req.query('season_id');
  let season: Season | null;
  if (seasonIdStr !== undefined && seasonIdStr !== '') {
    const seasonId = Number(seasonIdStr);
    if (!Number.isInteger(seasonId) || seasonId <= 0) {
      return c.json(
        { error: { code: 'BAD_REQUEST', message: 'season_id must be a positive integer' } },
        400,
      );
    }
    season = await getSeasonById(db, seasonId);
    if (!season) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'season not found' } },
        404,
      );
    }
  } else {
    season = await getCurrentSeason(db);
  }

  // No season at all — return an empty wall rather than an error, so the
  // frontend can render "神殿尚未发现符合条件的记录" (spec §0.3).
  if (!season) {
    return c.json({
      season: null,
      achievements: [],
      pet_tokens: await getPetTokenBalance(db, userId),
    });
  }

  const [allAchievements, awards] = await Promise.all([
    listAchievements(db),
    listAwardsForUserSeason(db, userId, season.id),
  ]);

  // Group the user's awards by achievement id.
  const awardsByAchievement = new Map<number, AchievementAward[]>();
  for (const award of awards) {
    const list = awardsByAchievement.get(award.achievement_id);
    if (list) list.push(award);
    else awardsByAchievement.set(award.achievement_id, [award]);
  }

  const achievementsOut = allAchievements.map((a) => {
    // Only ACTIVE awards count toward the displayed medal — a revoked medal
    // is history, not an unlocked achievement.
    const active = (awardsByAchievement.get(a.id) ?? []).filter(
      (award) => award.status === 'active',
    );

    const award = buildWallAward(active);

    return {
      id: a.id,
      grp: a.grp,
      name: a.name,
      description: a.description,
      grant_mode: a.grant_mode,
      // Server-side parse of ladder_json (spec §7b, R11).
      ladder: parseLadder(a.ladder_json),
      award,
    };
  });

  return c.json({
    season: {
      id: season.id,
      name: season.name,
      starts_on: season.starts_on,
      ends_on: season.ends_on,
    },
    achievements: achievementsOut,
    pet_tokens: await getPetTokenBalance(db, userId),
  });
});

/**
 * Build the wall's `award` field from a set of active awards.
 *
 * - tier: the HIGHEST medal earned (by medal hierarchy, not by when it was
 *   granted) — spec §7b "该赛季该奖项已获最高档".
 * - count: how many times THAT tier was granted (同档累计发放次数).
 *   Re-granting the same tier is allowed, so this can be > 1.
 * - granted_at: the ISO timestamp of the most recent grant of that tier.
 */
function buildWallAward(activeAwards: AchievementAward[]): WallAward | null {
  if (activeAwards.length === 0) return null;

  let best: AchievementAward | null = null;
  for (const award of activeAwards) {
    if (best === null || tierRank(award.tier) > tierRank(best.tier)) {
      best = award;
    }
  }
  if (!best) return null;

  const count = activeAwards.filter((a) => a.tier === best.tier).length;
  const latest = activeAwards
    .filter((a) => a.tier === best.tier)
    .reduce((max, a) => (a.granted_at > max ? a.granted_at : max), 0);

  return {
    tier: best.tier,
    granted_at: new Date(latest * 1000).toISOString(),
    count,
  };
}

export { highestTier };
export default achievements;

// src/utils/achievements.ts
// Achievement system (spec docs/achievements-spec.md) — domain layer.
//
// Contains:
//   - tier / ladder constants + helpers (parse ladder_json, token values)
//   - season reads (current season, lookup)
//   - award writes (grant + revoke) with the pet-token ledger side effects
//
// Ledger model (spec §5):
//   Every award mints pet tokens into the SAME score_events ledger the coins
//   use, under type='pet_tokens'. Balance is derived by summing approved
//   events — there is no separate balance table to keep in sync.
//
//   Mint:  source_ref = 'achievement:award:<award_id>', change_value = +N
//   Burn:  source_ref = 'achievement:award:<award_id>:burn', change_value = -N
//
//   Why the burn carries a ':burn' suffix instead of reusing the mint's
//   source_ref: the mint row stays as the durable "this award minted N"
//   record, and the burn is a separate compensating row (the same algebraic
//   pattern the coin system uses for revoke: -1 compensation instead of
//   flipping the original event to 'revoked' — see RFC §5.3). Keeping the
//   original row untouched means the award's token amount stays auditable
//   after revocation.
//
//   Burn double gate (spec §5, R10):
//     1. Only write the burn for an award row whose status is still 'active'.
//     2. Only write it if no burn row for this award already exists.
//   Both gates must hold — a revoked award is never burned twice.

import type {
  Achievement,
  AchievementAward,
  AchievementLadder,
  AchievementTier,
  D1Database,
  Season,
} from '../db/types.ts';

// =============================================================
// Constants
// =============================================================

/** All tiers in ascending order (铁 → 铜 → 银 → 金 → 王者). */
export const TIER_ORDER: readonly AchievementTier[] = [
  'iron',
  'bronze',
  'silver',
  'gold',
  'king',
] as const;

/** Tiers that can be stored on an award row (TIER_ORDER + the flat tier). */
export const ALL_TIERS: readonly AchievementTier[] = [...TIER_ORDER, 'flat'] as const;

/**
 * Pet-token mint amount per tier (spec §5).
 * 铁 +1 / 铜 +2 / 银 +3 / 金 +5 / 王者 +8 / 平发奖 +1
 */
export const TIER_TOKENS: Readonly<Record<AchievementTier, number>> = {
  iron: 1,
  bronze: 2,
  silver: 3,
  gold: 5,
  king: 8,
  flat: 1,
};

/** Token amount minted for a given tier. */
export function tokensForTier(tier: AchievementTier): number {
  return TIER_TOKENS[tier] ?? 0;
}

/** Is this a valid tier string? */
export function isAchievementTier(v: unknown): v is AchievementTier {
  return typeof v === 'string' && (ALL_TIERS as readonly string[]).includes(v);
}

/**
 * Parse ladder_json into a typed ladder object (spec §7b, R11).
 *
 * The DB stores the ladder as JSON TEXT — it MUST be parsed server-side
 * before being returned to a client (returning the raw string was a past
 * bug). A corrupt / non-object value degrades to an empty ladder rather
 * than throwing, so one bad row can't take down the whole wall.
 */
export function parseLadder(raw: string | null | undefined): AchievementLadder {
  if (raw == null || raw === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isAchievementTier(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      out[key] = Math.floor(value);
    }
  }
  return out;
}

/**
 * Ladder tiers sorted ascending by threshold — the order the streak engine
 * walks when awarding milestone tiers (T3: 30 天连续 → 铁铜银金王者逐档发放).
 */
export function ladderTiersAscending(ladder: AchievementLadder): AchievementTier[] {
  return Object.entries(ladder)
    .filter(([tier]) => tier !== 'flat')
    .sort((a, b) => a[1] - b[1])
    .map(([tier]) => tier as AchievementTier);
}

/** Rank of a tier in the medal hierarchy (flat sorts below iron). */
export function tierRank(tier: AchievementTier): number {
  const idx = TIER_ORDER.indexOf(tier);
  return idx === -1 ? -1 : idx;
}

/**
 * The highest tier among the given tiers (by medal hierarchy, not by ladder
 * threshold). Used to compute the "award" field of the wall: the highest
 * medal the user has actually earned this season (spec §7b).
 */
export function highestTier(tiers: readonly AchievementTier[]): AchievementTier | null {
  let best: AchievementTier | null = null;
  for (const t of tiers) {
    if (best === null || tierRank(t) > tierRank(best)) best = t;
  }
  return best;
}

// =============================================================
// Season reads
// =============================================================

export const SEASON_COLUMNS = 'id, name, starts_on, ends_on, is_current';

/** The current season (is_current = 1). Null when no season is current. */
export async function getCurrentSeason(db: D1Database): Promise<Season | null> {
  const row = await db
    .prepare(`SELECT ${SEASON_COLUMNS} FROM seasons WHERE is_current = 1 LIMIT 1`)
    .first<Season>();
  return row ?? null;
}

/** A specific season by id (for the archive tab, spec §7b). */
export async function getSeasonById(
  db: D1Database,
  seasonId: number,
): Promise<Season | null> {
  const row = await db
    .prepare(`SELECT ${SEASON_COLUMNS} FROM seasons WHERE id = ?`)
    .bind(seasonId)
    .first<Season>();
  return row ?? null;
}

/**
 * All seasons, newest first by starts_on. Used by the admin season list and
 * the wall's archive tab.
 */
export async function listSeasons(db: D1Database): Promise<Season[]> {
  const result = await db
    .prepare(`SELECT ${SEASON_COLUMNS} FROM seasons ORDER BY starts_on DESC, id DESC`)
    .all<Season>();
  return result.results ?? [];
}

// =============================================================
// Achievement reads
// =============================================================

export const ACHIEVEMENT_COLUMNS =
  'id, grp, name, description, grant_mode, ladder_json, is_active, sort_order';

/** All active achievements, in display order. */
export async function listAchievements(
  db: D1Database,
  options: { includeInactive?: boolean } = {},
): Promise<Achievement[]> {
  const where = options.includeInactive ? '' : 'WHERE is_active = 1';
  const result = await db
    .prepare(
      `SELECT ${ACHIEVEMENT_COLUMNS} FROM achievements ${where}
       ORDER BY sort_order ASC, id ASC`,
    )
    .all<Achievement>();
  return result.results ?? [];
}

/** A single achievement by id. */
export async function getAchievement(
  db: D1Database,
  achievementId: number,
): Promise<Achievement | null> {
  const row = await db
    .prepare(`SELECT ${ACHIEVEMENT_COLUMNS} FROM achievements WHERE id = ?`)
    .bind(achievementId)
    .first<Achievement>();
  return row ?? null;
}

// =============================================================
// Award reads
// =============================================================

export const AWARD_COLUMNS =
  'id, achievement_id, user_id, tier, season_id, status, granted_by, granted_at, revoked_at, revoked_by';

/**
 * Has this (season, achievement, user, tier) ever been awarded?
 *
 * Idempotency rule (spec §8a): "同季同 ach 同 tier 只发一次" counts rows in
 * BOTH 'active' and 'revoked' state — a revoked award still counts as
 * "已发过", so the streak engine never auto-reissues a revoked medal.
 * Admin can re-grant explicitly (that creates a NEW award row).
 */
export async function hasTierBeenAwarded(
  db: D1Database,
  args: {
    seasonId: number;
    achievementId: number;
    userId: number;
    tier: AchievementTier;
  },
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id FROM achievement_awards
       WHERE season_id = ? AND achievement_id = ? AND user_id = ? AND tier = ?
       LIMIT 1`,
    )
    .bind(args.seasonId, args.achievementId, args.userId, args.tier)
    .first<{ id: number }>();
  return row !== null;
}

/** All awards for a user in a season (any status). */
export async function listAwardsForUserSeason(
  db: D1Database,
  userId: number,
  seasonId: number,
): Promise<AchievementAward[]> {
  const result = await db
    .prepare(
      `SELECT ${AWARD_COLUMNS} FROM achievement_awards
       WHERE user_id = ? AND season_id = ?
       ORDER BY granted_at ASC, id ASC`,
    )
    .bind(userId, seasonId)
    .all<AchievementAward>();
  return result.results ?? [];
}

/** A single award row by id. */
export async function getAward(
  db: D1Database,
  awardId: number,
): Promise<AchievementAward | null> {
  const row = await db
    .prepare(`SELECT ${AWARD_COLUMNS} FROM achievement_awards WHERE id = ?`)
    .bind(awardId)
    .first<AchievementAward>();
  return row ?? null;
}

// =============================================================
// Pet-token ledger (spec §5)
// =============================================================

/** source_ref of the mint row for an award. */
export function mintSourceRef(awardId: number): string {
  return `achievement:award:${awardId}`;
}

/** source_ref of the burn (compensation) row for an award. */
export function burnSourceRef(awardId: number): string {
  return `achievement:award:${awardId}:burn`;
}

/**
 * Has this award already been burned (tokens taken back)?
 * The burn row's source_ref carries the ':burn' suffix, so this never
 * collides with the mint row's source_ref.
 */
export async function hasBurnEvent(
  db: D1Database,
  awardId: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id FROM score_events
       WHERE source_ref = ? AND type = 'pet_tokens' AND change_value < 0
       LIMIT 1`,
    )
    .bind(burnSourceRef(awardId))
    .first<{ id: number }>();
  return row !== null;
}

/**
 * Does a mint row exist for this award? Used by the burn path to make sure
 * we only burn what was actually minted.
 */
export async function findMintEvent(
  db: D1Database,
  awardId: number,
): Promise<{ id: number; change_value: number } | null> {
  const row = await db
    .prepare(
      `SELECT id, change_value FROM score_events
       WHERE source_ref = ? AND type = 'pet_tokens' AND change_value > 0
       LIMIT 1`,
    )
    .bind(mintSourceRef(awardId))
    .first<{ id: number; change_value: number }>();
  return row ?? null;
}

/**
 * Current pet-token (🌟 星币) balance for a user.
 *
 * Same derivation as coins: SUM(change_value) over approved pet_tokens
 * events. Pending / rejected / revoked events do NOT count.
 */
export async function getPetTokenBalance(
  db: D1Database,
  userId: number,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(change_value), 0) AS balance
       FROM score_events
       WHERE user_id = ? AND type = 'pet_tokens' AND status = 'approved'`,
    )
    .bind(userId)
    .first<{ balance: number }>();
  return Number(row?.balance ?? 0);
}

/**
 * Build the SQL for minting pet tokens for an award.
 *
 * Returned as {query, params} (not a D1PreparedStatement) so the route layer
 * can compose it into a db.batch() together with the award INSERT — the award
 * id is only known after that INSERT, so the mint is written as a second
 * statement using `last_insert_rowid()` to reference the award id.
 */
export function buildPetTokenMintSQL(
  userId: number,
  amount: number,
  reason: string,
): { query: string; params: unknown[] } {
  return {
    query:
      `INSERT INTO score_events ` +
      `(user_id, type, change_value, reason, status, submitted_by, source, source_ref, week_of, created_at) ` +
      `VALUES (?, 'pet_tokens', ?, ?, 'approved', 'system', 'achievement', ` +
      `'achievement:award:' || last_insert_rowid(), NULL, unixepoch())`,
    params: [userId, amount, reason],
  };
}

/**
 * Build the SQL for burning pet tokens back for a revoked award.
 *
 * Symmetric to the mint: same amount, negated. The source_ref carries the
 * ':burn' suffix so the mint row and the burn row are distinguishable, and
 * the award id is bound directly (the revoke path already knows it).
 *
 * The `WHERE NOT EXISTS` clause is the authoritative form of burn gate 2
 * (spec §5, R10): even if two revokes race, only one burn row can ever
 * exist for a given award. The caller's JS-level check is a fast path that
 * also tells us the right number to report.
 */
export function buildPetTokenBurnSQL(
  userId: number,
  awardId: number,
  amount: number,
  reason: string,
): { query: string; params: unknown[] } {
  return {
    query:
      `INSERT INTO score_events ` +
      `(user_id, type, change_value, reason, status, submitted_by, source, source_ref, week_of, created_at) ` +
      `SELECT ?, 'pet_tokens', ?, ?, 'approved', 'pm', 'achievement', ?, NULL, unixepoch() ` +
      `WHERE NOT EXISTS (` +
      `SELECT 1 FROM score_events WHERE source_ref = ? AND type = 'pet_tokens' AND change_value < 0` +
      `)`,
    params: [
      userId,
      -amount,
      reason,
      burnSourceRef(awardId),
      burnSourceRef(awardId),
    ],
  };
}

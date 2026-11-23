// src/utils/achievement-service.ts
// Achievement grant / revoke orchestration (spec docs/achievements-spec.md).
//
// This is the single place where an award is created or revoked, so the
// money rules (pet-token mint / symmetric burn) can't drift between the
// admin API and the automatic streak engine.
//
// Atomicity (D1 batch semantics):
//   grant  = [INSERT achievement_awards] [INSERT score_events (mint)] [INSERT audit_log]
//   revoke = [UPDATE achievement_awards → revoked] [INSERT score_events (burn)] [INSERT audit_log]
//
//   The mint row references the award via SQLite's `last_insert_rowid()`,
//   so the award id is never a placeholder — see buildPetTokenMintSQL().
//
//   The burn row CANNOT use last_insert_rowid() (the statement before it is
//   an UPDATE, which does not change last_insert_rowid in a way that
//   identifies the award), so the award id is bound directly. It is a
//   non-FK column of score_events (source_ref is TEXT), so binding is safe.

import type {
  Achievement,
  AchievementAward,
  AchievementTier,
  D1Database,
} from '../db/types.ts';
import {
  buildPetTokenBurnSQL,
  buildPetTokenMintSQL,
  getAward,
  hasBurnEvent,
  hasTierBeenAwarded,
  tokensForTier,
} from './achievements.ts';

export interface GrantResult {
  award: AchievementAward;
  /** Number of pet tokens minted (0 if the tier maps to no tokens). */
  tokensMinted: number;
  /** id of the minted score_events row (0 when nothing was minted). */
  tokenEventId: number;
}

export interface RevokeResult {
  award: AchievementAward;
  /** Number of pet tokens burned back (0 when the burn gate blocked it). */
  tokensBurned: number;
  /** id of the burn score_events row (0 when nothing was burned). */
  tokenEventId: number;
  /** True when the burn was skipped because it already happened. */
  burnSkipped: boolean;
}

export interface GrantOptions {
  db: D1Database;
  achievement: Achievement;
  userId: number;
  tier: AchievementTier;
  seasonId: number;
  /**
   * Who granted it — the PM's user id for admin grants, or NULL for the
   * streak engine (no human actor). NULL is NOT a placeholder: the column
   * is FK-enforced against users(id), so 0 would violate the FK (D1 7500).
   */
  grantedBy: number | null;
  /** Audit actor: 'pm' for admin grants, 'system' for the streak engine. */
  actor: 'pm' | 'system';
  /** Whether to mint pet tokens. The streak engine mints too (spec §8). */
  mintTokens?: boolean;
  /**
   * 完成日期 (spec §7c) — 'YYYY-MM-DD' (Asia/Shanghai 日历日) 或 NULL。
   * PM 在发放时填「这件事是哪天完成的」。格式由 API 层校验 (400),
   * 这里只负责落库。
   */
  completedOn?: string | null;
  /**
   * 完成内容 (spec §7c) — 自由文本 (≤100 字) 或 NULL。
   * 例: 「英语课外班默写全对」。长度由 API 层校验 (400)。
   */
  note?: string | null;
}

/**
 * Create an award row and mint its pet tokens, atomically.
 *
 * Re-granting the same tier is allowed (spec §7b: "admin grant 端点允许同档
 * 重发") — each grant creates a NEW award row with its own id, so the token
 * source_ref (`achievement:award:<award_id>`) never collides and each grant
 * mints its own tokens.
 *
 * The streak engine, by contrast, checks hasTierBeenAwarded() BEFORE
 * calling this, so it never double-issues (spec §8a).
 */
export async function grantAchievementAward(
  opts: GrantOptions,
): Promise<GrantResult> {
  const { db, achievement, userId, tier, seasonId, grantedBy, actor } = opts;
  const mintTokens = opts.mintTokens ?? true;
  const amount = tokensForTier(tier);
  const now = Math.floor(Date.now() / 1000);
  // 完成详情 (spec §7c) — 两列都可 NULL: PM 没记就是 NULL, 不是空串。
  const completedOn = opts.completedOn ?? null;
  const note = opts.note ?? null;

  const statements: ReturnType<D1Database['prepare']>[] = [];

  // 1. The award row itself. This is the producer — the mint row below
  //    references it through last_insert_rowid().
  statements.push(
    db
      .prepare(
        `INSERT INTO achievement_awards
           (achievement_id, user_id, tier, season_id, status, granted_by, granted_at,
            completed_on, note)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      )
      .bind(achievement.id, userId, tier, seasonId, grantedBy, now, completedOn, note),
  );

  // 2. Pet-token mint (spec §5). The source_ref is derived from the award
  //    id via last_insert_rowid() — never a placeholder, so the ledger row
  //    is always traceable to exactly one award.
  if (mintTokens && amount > 0) {
    const mint = buildPetTokenMintSQL(
      userId,
      amount,
      `成就奖励: ${achievement.name} (${tier})`,
    );
    statements.push(db.prepare(mint.query).bind(...mint.params));
  }

  // 3. Audit trail (spec §3). target_user_id = the child who earned it;
  //    details carry the tier / award context the admin log renders.
  statements.push(
    db
      .prepare(
        `INSERT INTO audit_log
           (actor, action, target_event_id, target_user_id, details, created_at)
         VALUES (?, 'achievement_grant', NULL, ?, ?, ?)`,
      )
      .bind(
        actor,
        userId,
        JSON.stringify({
          achievement_id: achievement.id,
          achievement_name: achievement.name,
          tier,
          season_id: seasonId,
          tokens: mintTokens ? amount : 0,
          granted_by: grantedBy,
          // 完成详情 (spec §7c) — 审计面也要能看到 PM 当时记了什么。
          completed_on: completedOn,
          note,
        }),
        now,
      ),
  );

  const results = await db.batch(statements);
  const awardId = Number(results[0]?.meta?.last_row_id ?? 0);
  const tokenEventId =
    mintTokens && amount > 0 ? Number(results[1]?.meta?.last_row_id ?? 0) : 0;

  const award: AchievementAward = {
    id: awardId,
    achievement_id: achievement.id,
    user_id: userId,
    tier,
    season_id: seasonId,
    status: 'active',
    granted_by: grantedBy,
    granted_at: now,
    revoked_at: null,
    revoked_by: null,
    completed_on: completedOn,
    note,
  };

  return { award, tokensMinted: mintTokens ? amount : 0, tokenEventId };
}

export interface RevokeOptions {
  db: D1Database;
  awardId: number;
  /** PM user id performing the revoke. */
  revokedBy: number;
  /** Audit actor — 'pm' for admin revokes. */
  actor?: 'pm' | 'system';
  /** Set when the caller already loaded the row (avoids a re-read). */
  award?: AchievementAward;
}

export type RevokeOutcome =
  | { ok: true; result: RevokeResult }
  | { ok: false; code: 'NOT_FOUND' | 'ALREADY_REVOKED'; message: string };

/**
 * Revoke an award: flip its status AND burn the pet tokens it minted.
 *
 * Burn double gate (spec §5, R10):
 *   gate 1 — the award row must still be 'active' (a revoked award is
 *             never burned a second time)
 *   gate 2 — no burn row may already exist for this award
 *
 * If either gate fails, the award is still flipped to 'revoked' (the first
 * revoke wins) but NO burn row is written — the tokens are not taken back
 * twice.
 */
export async function revokeAchievementAward(
  opts: RevokeOptions,
): Promise<RevokeOutcome> {
  const { db, awardId, revokedBy } = opts;
  const actor = opts.actor ?? 'pm';

  const award = opts.award ?? (await getAward(db, awardId));
  if (!award) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'award not found',
    };
  }

  // Gate 1 — a revoked award is never burned. Returning early means we
  // write NOTHING at all (no status flip, no burn, no audit row) for an
  // already-revoked award, so a double-click can't produce a second audit
  // entry or a second burn.
  if (award.status !== 'active') {
    return {
      ok: false,
      code: 'ALREADY_REVOKED',
      message: 'award is already revoked',
    };
  }

  const now = Math.floor(Date.now() / 1000);

  // Gate 2 — never burn twice for the same award. The JS-level check gives
  // us an accurate "tokensBurned" number for the response; the SQL-level
  // guard inside the burn statement (INSERT ... WHERE NOT EXISTS) is the
  // authoritative one, because it closes the race window between this read
  // and the write.
  const alreadyBurned = await hasBurnEvent(db, awardId);

  const amount = tokensForTier(award.tier);
  const shouldBurn = !alreadyBurned && amount > 0;

  const statements: ReturnType<D1Database['prepare']>[] = [];

  // 1. Flip the award to revoked. The `status = 'active'` predicate makes
  //    the UPDATE itself idempotent under concurrency: a second revoke
  //    affects 0 rows and cannot overwrite revoked_at / revoked_by.
  statements.push(
    db
      .prepare(
        `UPDATE achievement_awards
         SET status = 'revoked', revoked_at = ?, revoked_by = ?
         WHERE id = ? AND status = 'active'`,
      )
      .bind(now, revokedBy, awardId),
  );

  // 2. Symmetric burn (spec §5). Only written when both gates pass; the
  //    WHERE NOT EXISTS clause re-checks gate 2 inside the transaction.
  if (shouldBurn) {
    const burn = buildPetTokenBurnSQL(
      award.user_id,
      awardId,
      amount,
      `成就撤销: 烧回 ${amount} 星币`,
    );
    statements.push(db.prepare(burn.query).bind(...burn.params));
  }

  // 3. Audit trail (spec §3).
  statements.push(
    db
      .prepare(
        `INSERT INTO audit_log
           (actor, action, target_event_id, target_user_id, details, created_at)
         VALUES (?, 'achievement_revoke', NULL, ?, ?, ?)`,
      )
      .bind(
        actor,
        award.user_id,
        JSON.stringify({
          award_id: awardId,
          achievement_id: award.achievement_id,
          tier: award.tier,
          season_id: award.season_id,
          tokens_burned: shouldBurn ? amount : 0,
          burn_skipped: !shouldBurn,
          revoked_by: revokedBy,
        }),
        now,
      ),
  );

  const results = await db.batch(statements);
  const tokenEventId = shouldBurn ? Number(results[1]?.meta?.last_row_id ?? 0) : 0;

  return {
    ok: true,
    result: {
      award: {
        ...award,
        status: 'revoked',
        revoked_at: now,
        revoked_by: revokedBy,
      },
      tokensBurned: shouldBurn ? amount : 0,
      tokenEventId,
      burnSkipped: !shouldBurn,
    },
  };
}

/**
 * Guard for the streak engine: has this (season, achievement, user, tier)
 * already been awarded — counting revoked rows too (spec §8a)?
 *
 * Exported through achievements.ts; re-exported here so callers that deal
 * with awards don't need two imports.
 */
export { hasTierBeenAwarded };

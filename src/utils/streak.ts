// src/utils/streak.ts
// Automatic achievement engine for the "自律生活" award (spec §8 / §8a).
//
// The award is earned by completing ALL of today's due tasks, N days in a
// row. When the streak crosses a ladder threshold, the matching medal is
// granted automatically (plus its pet tokens) and written to the audit log.
//
// Streak semantics (spec §8a):
//   * Count backwards from today, one calendar day at a time. The first day
//     that is NOT fully completed ends the streak.
//   * If today is not fully completed yet, the streak is counted up to
//     yesterday — the engine never claims a day that hasn't happened yet.
//   * The denominator is "tasks due that day": tasks with is_active = 1
//     whose active_days is NULL/empty (every day) or contains that day's
//     ISO weekday. A task that wasn't due that day must not block the streak.
//   * Days before the current season's starts_on don't count toward the
//     season's ladder.
//
// Idempotency (spec §8a): a medal is granted at most once per
// (season, achievement, user, tier). The check counts revoked awards too —
// the engine never auto-reissues a revoked medal; only an explicit admin
// grant can do that.

import type {
  Achievement,
  AchievementTier,
  D1Database,
} from '../db/types.ts';
import {
  getCurrentSeason,
  hasTierBeenAwarded,
  listAchievements,
  ladderTiersAscending,
  parseLadder,
} from './achievements.ts';
import { grantAchievementAward } from './achievement-service.ts';
import { parseActiveDays } from './coin.ts';
import { shanghaiDateToUnix, todayShanghai } from './week.ts';

const MS_PER_DAY = 86_400_000;

/** ISO weekday (Mon=1 .. Sun=7) for a 'YYYY-MM-DD' calendar date. */
function isoDayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1, d));
  return target.getUTCDay() || 7;
}

/** Shift a 'YYYY-MM-DD' date by N days. */
function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1, d) + days * MS_PER_DAY);
  const yy = target.getUTCFullYear();
  const mm = String(target.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(target.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Compare two 'YYYY-MM-DD' dates lexicographically (ISO format sorts). */
function dateIsBefore(a: string, b: string): boolean {
  return a < b;
}

export interface DueTask {
  id: number;
  active_days: string | null;
  /** Unix seconds the task was created (used to exclude not-yet-existing tasks). */
  created_at?: number;
}

/**
 * Was every task due on `date` completed on that date?
 *
 * Mirrors isAllTasksCompleted() in src/utils/coin.ts, but for an arbitrary
 * (historical) date rather than just today — the streak engine walks back
 * through past days.
 *
 * Returns false when no task was due that day (nothing to "complete all of"),
 * which means the streak cannot be extended by a day with no tasks at all.
 */
export async function isAllTasksCompletedOn(
  db: D1Database,
  userId: number,
  date: string,
  dueTasks: DueTask[],
): Promise<boolean> {
  if (dueTasks.length === 0) return false;

  const rows = await db
    .prepare(
      `SELECT task_id FROM task_completions
       WHERE user_id = ? AND completed_date = ? AND status = 'active'`,
    )
    .bind(userId, date)
    .all<{ task_id: number }>();
  const doneSet = new Set((rows.results ?? []).map((r) => r.task_id));

  return dueTasks.every((t) => doneSet.has(t.id));
}

/**
 * The set of tasks due on a given calendar date.
 *
 * A task is due on `date` when is_active = 1 AND (active_days is NULL/empty
 * → every day, OR the date's ISO weekday is in active_days).
 *
 * A task created AFTER `date` is not due on that date — the child could not
 * have completed a task that did not exist yet. Without this filter, adding
 * a new task mid-season would retroactively break the child's accumulated
 * streak on every past day.
 */
export function dueTasksForDate(allTasks: DueTask[], date: string): DueTask[] {
  const weekday = isoDayOf(date);
  // The date's start instant in Asia/Shanghai, for the created_at comparison.
  const dateStartUnix = shanghaiDateToUnix(date);
  return allTasks.filter((t) => {
    if (t.created_at !== undefined && t.created_at > dateStartUnix) return false;
    const days = parseActiveDays(t.active_days);
    return days === null || days.length === 0 || days.includes(weekday);
  });
}

export interface StreakEvaluation {
  /** Current consecutive all-complete days (counted within the season). */
  streak: number;
  /** The day the streak was measured up to. */
  as_of: string;
  /** Season the streak was evaluated against. */
  season_id: number | null;
  /** Medals granted during this evaluation. */
  granted: Array<{
    achievement_id: number;
    achievement_name: string;
    tier: AchievementTier;
    award_id: number;
    tokens_minted: number;
  }>;
  /** Tiers that were skipped because they had already been awarded. */
  skipped: Array<{ achievement_id: number; tier: AchievementTier }>;
}

/**
 * Evaluate the streak for a user and grant any newly-earned medals.
 *
 * Best-effort by design: the caller wraps this in try/catch so a failure
 * never rolls back the task completion that triggered it (spec §8).
 */
export async function evaluateStreakForUser(
  db: D1Database,
  userId: number,
  options: { today?: string } = {},
): Promise<StreakEvaluation> {
  const today = options.today ?? todayShanghai();
  const season = await getCurrentSeason(db);

  const evaluation: StreakEvaluation = {
    streak: 0,
    as_of: today,
    season_id: season?.id ?? null,
    granted: [],
    skipped: [],
  };

  if (!season) return evaluation;

  // Only 'auto_streak' achievements are engine-driven (spec §6 grant_mode).
  const allAchievements = await listAchievements(db);
  const streakAchievements = allAchievements.filter(
    (a) => a.grant_mode === 'auto_streak',
  );
  if (streakAchievements.length === 0) return evaluation;

  // All active tasks (the due-set is derived per day from active_days).
  // created_at is fetched so a task added mid-season doesn't retroactively
  // break the streak on days before it existed.
  const taskRows = await db
    .prepare(`SELECT id, active_days, created_at FROM tasks WHERE is_active = 1`)
    .all<DueTask>();
  const allTasks: DueTask[] = taskRows.results ?? [];

  // Walk backwards from today, counting consecutive fully-completed days.
  //
  // Today is included only if it is already fully complete — otherwise the
  // streak is counted up to yesterday (spec §8a: 不夸大). Concretely:
  //   - today complete     → count today, then walk back
  //   - today incomplete   → skip today (don't break the streak), count from
  //                           yesterday backwards
  let cursor = today;
  let streak = 0;
  let lastCountedDate: string | null = null;
  // Hard stop: don't walk forever. 400 days is far beyond any ladder
  // threshold (the largest is 30 days) and keeps the query bounded.
  const MAX_LOOKBACK_DAYS = 400;

  for (let i = 0; i < MAX_LOOKBACK_DAYS; i++) {
    // Season boundary: only days on/after starts_on count (spec §8a).
    if (dateIsBefore(cursor, season.starts_on)) break;

    const due = dueTasksForDate(allTasks, cursor);
    const complete = await isAllTasksCompletedOn(db, userId, cursor, due);

    if (!complete) {
      // Today not complete yet → don't break the streak, just don't extend
      // it. Any earlier incomplete day ends the streak for good.
      if (cursor === today) {
        cursor = shiftDate(cursor, -1);
        continue;
      }
      break;
    }
    streak++;
    lastCountedDate = cursor;
    cursor = shiftDate(cursor, -1);
  }

  evaluation.streak = streak;
  // The streak is "as of" the last day that actually counted. When today
  // was counted, that's today; when today is still in progress, it's
  // yesterday (or the last counted day before a break).
  evaluation.as_of = streak > 0 ? lastCountedDate ?? today : today;

  if (streak === 0) return evaluation;

  // Grant every ladder tier the streak has reached and that was never
  // granted before (spec §8a: 同季同 ach 同 tier 只发一次).
  for (const achievement of streakAchievements) {
    const ladder = parseLadder(achievement.ladder_json);
    const tiers = ladderTiersAscending(ladder);
    for (const tier of tiers) {
      const threshold = ladder[tier];
      if (threshold === undefined || streak < threshold) continue;

      const already = await hasTierBeenAwarded(db, {
        seasonId: season.id,
        achievementId: achievement.id,
        userId,
        tier,
      });
      if (already) {
        evaluation.skipped.push({ achievement_id: achievement.id, tier });
        continue;
      }

      const result = await grantAchievementAward({
        db,
        achievement,
        userId,
        tier,
        seasonId: season.id,
        // No human actor — the engine granted it. NULL, not 0: the column
        // is FK-enforced against users(id) (R4: no 0 placeholders on FK
        // columns).
        grantedBy: null,
        actor: 'system',
      });
      evaluation.granted.push({
        achievement_id: achievement.id,
        achievement_name: achievement.name,
        tier,
        award_id: result.award.id,
        tokens_minted: result.tokensMinted,
      });
    }
  }

  return evaluation;
}

/**
 * Re-exported for callers that only need the current day's due-set without
 * running a full evaluation (e.g. diagnostics).
 */
export { dueTasksForDate as computeDueTasks };
export type { Achievement };

// tests/unit/achievement-streak.test.ts
// The 自律生活 streak engine (spec §8 / §8a / §8b).
//
// Covers the PM acceptance cases T1-T7 from spec §8b verbatim:
//
//   T1  | 连续 2 天全卡 (铁=2)          | 自动发铁牌 +1 星币 + audit
//   T2  | 中断 1 天后重新 2 天           | 不重复发铁牌 (幂等)
//   T2a | 同一天重复 /complete           | 幂等, 不重复发
//   T3  | 30 天连续                     | 铁铜银金王者逐档自动发放
//   T4  | 赛季切换 (S1→S2)              | S1 awards 归档展示, S2 从零开始
//   T5  | streak=2 已发铁, revoke 后仍连续 | 引擎不自动补发 (幂等含 revoked)
//   T6  | /complete 当天未全卡 (部分任务) | streak 不增长
//   T7  | 非 dueToday 任务缺席            | 不影响 streak (分母只算应做任务)

import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/worker.ts';
import { signSession } from '../../src/auth/session.ts';
import {
  addAchievement,
  addSeason,
  addTask,
  addUser,
  completeTask,
  makeMockDb,
  petTokenBalance,
  petTokenEvents,
  type MockState,
} from './achievements-mock.ts';
import { shanghaiDateToUnix } from '../../src/utils/week.ts';

const SECRET = 'unit-test-secret-1234567890';
const CHILD_ID = 2;
const PM_ID = 1;

// A fixed "today" so the date arithmetic is deterministic. 2026-11-10 is a
// Tuesday (ISO day 2).
const TODAY = '2026-11-10';

let mock = makeMockDb();
let state: MockState;

beforeEach(() => {
  mock = makeMockDb();
  state = mock.state;
  addUser(state, PM_ID, 'pm');
  addUser(state, CHILD_ID, 'child');
});

function envObj() {
  return { DB: mock.db, JWT_SECRET: SECRET };
}

async function call(path: string, init: RequestInit = {}) {
  return app.request(`http://test.local${path}`, init, envObj());
}

async function pmCookie(userId = PM_ID): Promise<string> {
  // A far-future expiry: these tests pin the system clock (to control
  // "today" for the streak engine), and a clock-pinned token with a
  // near expiry would be rejected as expired.
  const token = await signSession(
    { user_id: userId, exp: 2_000_000_000 },
    SECRET,
  );
  return `pm_session=${token}`;
}

/** Shift a 'YYYY-MM-DD' date by N days (test-local helper). */
function shift(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  const yy = target.getUTCFullYear();
  const mm = String(target.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(target.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** The 自律生活 achievement with the spec §2 day ladder (2/4/8/15/30). */
function addStreakAchievement(overrides: Record<string, unknown> = {}) {
  return addAchievement(state, {
    grp: 'life',
    name: '自律生活',
    grant_mode: 'auto_streak',
    ladder_json: '{"iron":2,"bronze":4,"silver":8,"gold":15,"king":30}',
    ...overrides,
  });
}

/** Mark every due task complete for a date. */
function completeAllTasksOn(date: string, taskIds: number[]) {
  for (const taskId of taskIds) {
    completeTask(state, taskId, CHILD_ID, date);
  }
}

/**
 * Run the streak engine through the admin debug endpoint, with "today"
 * pinned to the given date.
 *
 * The engine reads the calendar date from the system clock, so the test
 * pins the clock via vi.setSystemTime. (The engine accepts an explicit
 * `today` option, but the HTTP endpoint uses the clock.)
 */
async function evalStreak(cookie: string, today: string) {
  const { vi } = await import('vitest');
  vi.useFakeTimers();
  try {
    // Set the clock to noon Shanghai time on the target date so
    // todayShanghai() resolves to it.
    const ms = shanghaiDateToUnix(today) * 1000 + 12 * 3600 * 1000;
    vi.setSystemTime(new Date(ms));
    const r = await call('/api/admin/achievements/eval-streak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ user_id: CHILD_ID }),
    });
    expect(r.status).toBe(200);
    return (await r.json()) as {
      streak: number;
      granted: Array<{ tier: string; achievement_name: string; tokens_minted: number }>;
      skipped: Array<{ tier: string }>;
    };
  } finally {
    vi.useRealTimers();
  }
}

// =============================================================
// T1 — 连续 2 天全卡 → 自动发铁牌 +1 星币 + audit
// =============================================================
describe('T1 — 连续 2 天全卡 (铁=2)', () => {
  it('grants the iron medal, mints 1 token and writes an audit row', async () => {
    addSeason(state, { id: 1, starts_on: '2026-09-01', is_current: 1 });
    addStreakAchievement({ id: 4 });
    const task = addTask(state, { id: 1 });

    completeAllTasksOn(shift(TODAY, -1), [task.id]);
    completeAllTasksOn(TODAY, [task.id]);

    const cookie = await pmCookie();
    const result = await evalStreak(cookie, TODAY);

    expect(result.streak).toBe(2);
    expect(result.granted).toHaveLength(1);
    expect(result.granted[0].tier).toBe('iron');
    expect(result.granted[0].achievement_name).toBe('自律生活');

    // One award row.
    expect(state.awards).toHaveLength(1);
    expect(state.awards[0].tier).toBe('iron');
    expect(state.awards[0].status).toBe('active');

    // +1 星币 (铁牌 = 1, spec §5).
    const events = petTokenEvents(state, CHILD_ID);
    expect(events).toHaveLength(1);
    expect(events[0].change_value).toBe(1);
    expect(events[0].source_ref).toBe(`achievement:award:${state.awards[0].id}`);
    expect(petTokenBalance(state, CHILD_ID)).toBe(1);

    // Audit row.
    const audit = state.audit.find((a) => a.action === 'achievement_grant');
    expect(audit).toBeDefined();
    expect(audit!.actor).toBe('system');
    const details = JSON.parse(audit!.details) as Record<string, unknown>;
    expect(details.tier).toBe('iron');
    expect(details.tokens).toBe(1);
  });

  it('does NOT grant a medal below the threshold (streak=1 < iron=2)', async () => {
    addSeason(state, { id: 1, starts_on: '2026-09-01', is_current: 1 });
    addStreakAchievement({ id: 4 });
    const task = addTask(state, { id: 1 });

    completeAllTasksOn(TODAY, [task.id]);

    const cookie = await pmCookie();
    const result = await evalStreak(cookie, TODAY);

    expect(result.streak).toBe(1);
    expect(result.granted).toHaveLength(0);
    expect(state.awards).toHaveLength(0);
    expect(petTokenEvents(state, CHILD_ID)).toHaveLength(0);
  });
});

// =============================================================
// T2 — 中断 1 天后重新 2 天 → 不重复发铁牌 (幂等)
// =============================================================
describe('T2 — 中断 1 天后重新 2 天 (幂等)', () => {
  it('does not re-grant the iron medal after a break', async () => {
    addSeason(state, { id: 1, starts_on: '2026-09-01', is_current: 1 });
    addStreakAchievement({ id: 4 });
    const task = addTask(state, { id: 1 });
    const cookie = await pmCookie();

    // First run: 2 consecutive days → iron granted.
    completeAllTasksOn(shift(TODAY, -1), [task.id]);
    completeAllTasksOn(TODAY, [task.id]);
    const first = await evalStreak(cookie, TODAY);
    expect(first.granted).toHaveLength(1);
    expect(first.streak).toBe(2);

    // Break: a day with no completions (later-1), then 2 fresh days.
    // Days: ... -1, 0 (first run), +1 (break — not completed), +2, +3.
    const later = shift(TODAY, 3);
    completeAllTasksOn(shift(later, -1), [task.id]);
    completeAllTasksOn(later, [task.id]);

    const second = await evalStreak(cookie, later);
    expect(second.streak).toBe(2);
    // Still exactly ONE award — the tier was already granted.
    expect(second.granted).toHaveLength(0);
    expect(second.skipped.map((s) => s.tier)).toContain('iron');
    expect(state.awards).toHaveLength(1);
    // No extra tokens minted.
    expect(petTokenEvents(state, CHILD_ID)).toHaveLength(1);
    expect(petTokenBalance(state, CHILD_ID)).toBe(1);
  });
});

// =============================================================
// T2a — 同一天重复 /complete → 幂等, 不重复发
// =============================================================
describe('T2a — 同一天重复评估 (幂等)', () => {
  it('grants only once across repeated evaluations', async () => {
    addSeason(state, { id: 1, starts_on: '2026-09-01', is_current: 1 });
    addStreakAchievement({ id: 4 });
    const task = addTask(state, { id: 1 });
    completeAllTasksOn(shift(TODAY, -1), [task.id]);
    completeAllTasksOn(TODAY, [task.id]);

    const cookie = await pmCookie();
    const first = await evalStreak(cookie, TODAY);
    expect(first.granted).toHaveLength(1);

    const second = await evalStreak(cookie, TODAY);
    expect(second.granted).toHaveLength(0);
    expect(second.streak).toBe(2);

    // Exactly one award, one mint.
    expect(state.awards).toHaveLength(1);
    expect(petTokenEvents(state, CHILD_ID)).toHaveLength(1);
    expect(petTokenBalance(state, CHILD_ID)).toBe(1);
  });
});

// =============================================================
// T3 — 30 天连续 → 铁铜银金王者逐档自动发放
// =============================================================
describe('T3 — 30 天连续 → 逐档自动发放', () => {
  it('grants every reached tier, each with its own tokens', async () => {
    addSeason(state, { id: 1, starts_on: '2026-09-01', is_current: 1 });
    addStreakAchievement({ id: 4 });
    const task = addTask(state, { id: 1 });

    // 30 consecutive days ending today.
    for (let i = 29; i >= 0; i--) {
      completeAllTasksOn(shift(TODAY, -i), [task.id]);
    }

    const cookie = await pmCookie();
    const result = await evalStreak(cookie, TODAY);

    expect(result.streak).toBe(30);

    // Thresholds 2/4/8/15/30 are all reached → all five tiers granted.
    const tiers = result.granted.map((g) => g.tier);
    expect(tiers).toEqual(['iron', 'bronze', 'silver', 'gold', 'king']);
    expect(state.awards).toHaveLength(5);

    // Tokens per tier: 铁1 + 铜2 + 银3 + 金5 + 王者8 = 19.
    expect(petTokenEvents(state, CHILD_ID)).toHaveLength(5);
    expect(petTokenBalance(state, CHILD_ID)).toBe(19);

    // Each mint is anchored on its own award id.
    const refs = petTokenEvents(state, CHILD_ID).map((e) => e.source_ref);
    expect(new Set(refs).size).toBe(5);
  });

  it('grants only the tiers reached (streak=4 → iron + bronze)', async () => {
    addSeason(state, { id: 1, starts_on: '2026-09-01', is_current: 1 });
    addStreakAchievement({ id: 4 });
    const task = addTask(state, { id: 1 });

    for (let i = 3; i >= 0; i--) {
      completeAllTasksOn(shift(TODAY, -i), [task.id]);
    }

    const cookie = await pmCookie();
    const result = await evalStreak(cookie, TODAY);

    expect(result.streak).toBe(4);
    expect(result.granted.map((g) => g.tier)).toEqual(['iron', 'bronze']);
    expect(petTokenBalance(state, CHILD_ID)).toBe(3);
  });
});

// =============================================================
// T4 — 赛季切换 (S1→S2) → S1 归档, S2 从零开始
// =============================================================
describe('T4 — 赛季切换', () => {
  it('counts only days within the current season, and starts fresh in S2', async () => {
    // S1 ends right before today; S2 starts today.
    addSeason(state, {
      id: 1,
      name: 'S1 · 四年级上学期',
      starts_on: '2026-09-01',
      ends_on: shift(TODAY, -1),
      is_current: 0,
    });
    addSeason(state, {
      id: 2,
      name: 'S2 · 五年级下学期',
      starts_on: TODAY,
      ends_on: null,
      is_current: 1,
    });
    addStreakAchievement({ id: 4 });
    const task = addTask(state, { id: 1 });

    // 10 days of completions, but only 1 of them falls inside S2.
    for (let i = 9; i >= 0; i--) {
      completeAllTasksOn(shift(TODAY, -i), [task.id]);
    }

    const cookie = await pmCookie();
    const result = await evalStreak(cookie, TODAY);

    // The season boundary cuts the streak at 1 day (only today is in S2).
    expect(result.streak).toBe(1);
    // 1 < iron threshold (2) → nothing granted in S2.
    expect(result.granted).toHaveLength(0);
    expect(state.awards).toHaveLength(0);
  });

  it('awards land in the current season, and S1 awards stay in S1', async () => {
    // S1 is current to begin with; S2 is created later by the switch.
    const s1 = addSeason(state, {
      id: 1,
      name: 'S1',
      starts_on: '2026-09-01',
      ends_on: null,
      is_current: 1,
    });
    addStreakAchievement({ id: 4 });
    const task = addTask(state, { id: 1 });

    // First earn the iron medal in S1 (2 days inside S1).
    const s1Today = shift(TODAY, -3);
    for (const d of [shift(s1Today, -1), s1Today]) {
      completeAllTasksOn(d, [task.id]);
    }
    const cookie = await pmCookie();
    const s1Result = await evalStreak(cookie, s1Today);
    expect(s1Result.granted).toHaveLength(1);
    expect(state.awards[0].season_id).toBe(1);

    // Now the PM starts S2 (the new season becomes current, S1 is
    // archived). The streak restarts from zero in S2.
    s1.ends_on = shift(TODAY, -1);
    s1.is_current = 0;
    addSeason(state, {
      id: 2,
      name: 'S2',
      starts_on: TODAY,
      ends_on: null,
      is_current: 1,
    });

    // Two fresh days inside S2.
    completeAllTasksOn(TODAY, [task.id]);
    completeAllTasksOn(shift(TODAY, 1), [task.id]);
    const s2Result = await evalStreak(cookie, shift(TODAY, 1));
    expect(s2Result.streak).toBe(2);
    // Idempotency is per-season: S2 may grant its own iron medal even
    // though S1 already had one.
    expect(s2Result.granted.map((g) => g.tier)).toEqual(['iron']);
    expect(state.awards[1].season_id).toBe(2);
    // S1's award is archived but still attached to S1.
    expect(state.awards.filter((a) => a.season_id === 1)).toHaveLength(1);
    expect(state.awards.filter((a) => a.season_id === 2)).toHaveLength(1);
  });
});

// =============================================================
// T5 — revoke 后仍连续 → 引擎不自动补发 (幂等含 revoked)
// =============================================================
describe('T5 — revoke 后引擎不自动补发', () => {
  it('does not re-grant a revoked tier even though the streak continues', async () => {
    addSeason(state, { id: 1, starts_on: '2026-09-01', is_current: 1 });
    addStreakAchievement({ id: 4 });
    const task = addTask(state, { id: 1 });
    completeAllTasksOn(shift(TODAY, -1), [task.id]);
    completeAllTasksOn(TODAY, [task.id]);

    const cookie = await pmCookie();
    const first = await evalStreak(cookie, TODAY);
    expect(first.granted).toHaveLength(1);
    const awardId = state.awards[0].id;

    // PM revokes the iron medal (burns the token back).
    const revoke = await call('/api/admin/achievement-awards/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ award_id: awardId, confirm: true }),
    });
    expect(revoke.status).toBe(200);
    expect(petTokenBalance(state, CHILD_ID)).toBe(0);

    // The streak is still 2 days, but the engine must NOT auto-reissue
    // the revoked tier (idempotency counts revoked rows too).
    const second = await evalStreak(cookie, TODAY);
    expect(second.streak).toBe(2);
    expect(second.granted).toHaveLength(0);
    expect(second.skipped.map((s) => s.tier)).toContain('iron');
    expect(state.awards).toHaveLength(1);
    expect(petTokenEvents(state, CHILD_ID)).toHaveLength(2); // +1 and -1, no new mint
  });
});

// =============================================================
// T6 — 当天未全卡 (部分任务) → streak 不增长
// =============================================================
describe('T6 — 当天未全卡', () => {
  it('does not grow the streak when only some tasks are done', async () => {
    addSeason(state, { id: 1, starts_on: '2026-09-01', is_current: 1 });
    addStreakAchievement({ id: 4 });
    const taskA = addTask(state, { id: 1 });
    const taskB = addTask(state, { id: 2 });

    // Yesterday: fully complete. Today: only task A.
    completeAllTasksOn(shift(TODAY, -1), [taskA.id, taskB.id]);
    completeAllTasksOn(TODAY, [taskA.id]);

    const cookie = await pmCookie();
    const result = await evalStreak(cookie, TODAY);

    // Today is incomplete → the streak counts up to yesterday only.
    expect(result.streak).toBe(1);
    expect(result.granted).toHaveLength(0);
    expect(state.awards).toHaveLength(0);
  });

  it('counts the streak up to yesterday when today is still in progress', async () => {
    addSeason(state, { id: 1, starts_on: '2026-09-01', is_current: 1 });
    addStreakAchievement({ id: 4 });
    const taskA = addTask(state, { id: 1 });
    const taskB = addTask(state, { id: 2 });

    // Two fully-complete days, then a partial today.
    completeAllTasksOn(shift(TODAY, -2), [taskA.id, taskB.id]);
    completeAllTasksOn(shift(TODAY, -1), [taskA.id, taskB.id]);
    completeAllTasksOn(TODAY, [taskA.id]);

    const cookie = await pmCookie();
    const result = await evalStreak(cookie, TODAY);

    // 2 days (yesterday and the day before) → iron granted, but NOT
    // overstated to 3.
    expect(result.streak).toBe(2);
    expect(result.granted.map((g) => g.tier)).toEqual(['iron']);
  });
});

// =============================================================
// T7 — 非 dueToday 任务缺席 → 不影响 streak (分母只算应做任务)
// =============================================================
describe('T7 — 非 dueToday 任务缺席', () => {
  it('ignores a task that was not due that weekday', async () => {
    addSeason(state, { id: 1, starts_on: '2026-09-01', is_current: 1 });
    addStreakAchievement({ id: 4 });

    // Task A is due every day.
    const taskA = addTask(state, { id: 1, active_days: null });
    // Task B is due only on Mondays (ISO 1).
    const taskB = addTask(state, { id: 2, active_days: [1] });

    // Two days, only task A completed. 2026-11-10 is a Tuesday and
    // 2026-11-09 is a Monday — on Monday, task B IS due, so use two
    // non-Monday days: 2026-11-10 (Tue) and 2026-11-11 (Wed).
    completeAllTasksOn('2026-11-10', [taskA.id]);
    completeAllTasksOn('2026-11-11', [taskA.id]);

    const cookie = await pmCookie();
    const result = await evalStreak(cookie, '2026-11-11');

    // Task B was due on neither day → it must not block the streak.
    expect(result.streak).toBe(2);
    expect(result.granted.map((g) => g.tier)).toEqual(['iron']);
    expect(state.awards).toHaveLength(1);
  });

  it('does block the streak when a task that WAS due that day is missing', async () => {
    addSeason(state, { id: 1, starts_on: '2026-09-01', is_current: 1 });
    addStreakAchievement({ id: 4 });
    const taskA = addTask(state, { id: 1, active_days: null });
    const taskB = addTask(state, { id: 2, active_days: null });

    // Only task A done on both days.
    completeAllTasksOn('2026-11-10', [taskA.id]);
    completeAllTasksOn('2026-11-11', [taskA.id]);

    const cookie = await pmCookie();
    const result = await evalStreak(cookie, '2026-11-11');

    expect(result.streak).toBe(0);
    expect(result.granted).toHaveLength(0);
  });
});

// =============================================================
// Season boundary + misc
// =============================================================
describe('streak engine — misc', () => {
  it('returns a zero streak when there is no current season', async () => {
    addStreakAchievement({ id: 4 });
    const task = addTask(state, { id: 1 });
    completeAllTasksOn(TODAY, [task.id]);

    const cookie = await pmCookie();
    const result = await evalStreak(cookie, TODAY);
    expect(result.streak).toBe(0);
    expect(state.awards).toHaveLength(0);
  });

  it('only counts days on/after the season start', async () => {
    // Season starts yesterday, so only 1 day counts.
    addSeason(state, { id: 1, starts_on: shift(TODAY, -1), is_current: 1 });
    addStreakAchievement({ id: 4 });
    const task = addTask(state, { id: 1 });
    completeAllTasksOn(shift(TODAY, -5), [task.id]);
    completeAllTasksOn(shift(TODAY, -4), [task.id]);
    completeAllTasksOn(shift(TODAY, -3), [task.id]);
    completeAllTasksOn(shift(TODAY, -2), [task.id]);
    completeAllTasksOn(shift(TODAY, -1), [task.id]);
    completeAllTasksOn(TODAY, [task.id]);

    const cookie = await pmCookie();
    const result = await evalStreak(cookie, TODAY);
    // Only yesterday + today fall inside the season → streak = 2.
    expect(result.streak).toBe(2);
  });

  it('ignores non auto_streak achievements', async () => {
    addSeason(state, { id: 1, starts_on: '2026-09-01', is_current: 1 });
    addAchievement(state, {
      id: 1,
      grant_mode: 'admin_tier',
      ladder_json: '{"iron":1}',
    });
    const task = addTask(state, { id: 1 });
    completeAllTasksOn(TODAY, [task.id]);

    const cookie = await pmCookie();
    const result = await evalStreak(cookie, TODAY);
    expect(result.granted).toHaveLength(0);
    expect(state.awards).toHaveLength(0);
  });

  it('requires a PM session (admin auth on eval-streak)', async () => {
    addSeason(state, { id: 1, starts_on: '2026-09-01', is_current: 1 });
    const r = await call('/api/admin/achievements/eval-streak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: CHILD_ID }),
    });
    expect(r.status).toBe(401);
  });

  it('a task created mid-day IS due on its creation day', async () => {
    // Regression: comparing created_at against the START of the day would
    // exclude a task created at 10:00 from its own creation day.
    addSeason(state, { id: 1, starts_on: '2026-09-01', is_current: 1 });
    addStreakAchievement({ id: 4 });

    // Created at 10:00 Shanghai on 2026-11-09 (= 02:00 UTC).
    const createdAt10am = Math.floor(Date.UTC(2026, 10, 9, 2, 0, 0) / 1000);
    const task = addTask(state, { id: 1, created_at: createdAt10am });

    completeAllTasksOn('2026-11-09', [task.id]);
    completeAllTasksOn('2026-11-10', [task.id]);

    const cookie = await pmCookie();
    const result = await evalStreak(cookie, '2026-11-10');

    // Both days count — the task was due on the day it was created.
    expect(result.streak).toBe(2);
    expect(result.granted.map((g) => g.tier)).toEqual(['iron']);
  });

  it('a task created AFTER a past day does not break that past day', async () => {
    // The task did not exist on 2026-11-08, so it cannot have been due
    // that day — the child's streak must survive the task being added.
    addSeason(state, { id: 1, starts_on: '2026-09-01', is_current: 1 });
    addStreakAchievement({ id: 4 });

    // Created at 10:00 Shanghai on 2026-11-09.
    const createdAt10am = Math.floor(Date.UTC(2026, 10, 9, 2, 0, 0) / 1000);
    const task = addTask(state, { id: 1, created_at: createdAt10am });

    // Only 2026-11-08 and 2026-11-09 could have the task completed.
    completeAllTasksOn('2026-11-08', [task.id]);
    completeAllTasksOn('2026-11-09', [task.id]);
    completeAllTasksOn('2026-11-10', [task.id]);

    const cookie = await pmCookie();
    const result = await evalStreak(cookie, '2026-11-10');

    // 2026-11-08 does not count (task didn't exist), so the streak is 2.
    expect(result.streak).toBe(2);
  });
});

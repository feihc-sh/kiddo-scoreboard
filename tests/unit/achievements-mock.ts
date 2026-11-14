// tests/unit/achievements-mock.ts
// Shared in-memory D1 mock for the achievement system tests.
//
// This mock mirrors REAL SQL semantics, not just "return canned data":
//
//   * `last_insert_rowid()` is connection-level and persists across
//     statements within a batch — the mock tracks it the same way. The
//     pet-token mint row derives its source_ref from it
//     ('achievement:award:' || last_insert_rowid()), so the mock must
//     resolve that to the REAL award id, not a placeholder.
//   * An INSERT that inserts 0 rows (the burn's `WHERE NOT EXISTS` guard)
//     leaves last_insert_rowid() unchanged — like SQLite.
//   * The burn statement is a conditional INSERT ... SELECT ... WHERE NOT
//     EXISTS; the mock evaluates the NOT EXISTS against the live table.
//   * Every write appends to a per-batch capture list so tests can assert
//     the exact statement sequence (R4: FK columns must be populated
//     INSIDE the batch, never backfilled afterwards).
//
// R4 verification trap: a naive mock that just returns `last_row_id` for
// every statement would happily accept a batch that writes a score_event
// whose source_ref points at a non-existent award. The mock below
// resolves source_ref from the real award row that was inserted earlier in
// the same batch, so a test can assert the FK actually holds.

import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
} from '../../src/db/types.ts';

// -------------------------------------------------------------
// Row shapes
// -------------------------------------------------------------
export interface MockUser {
  id: number;
  name: string;
  role: 'child' | 'pm';
  pin_hash: string | null;
  created_at: number;
  updated_at: number;
}

export interface MockTask {
  id: number;
  name: string;
  token_reward: number;
  target_account: string;
  icon: string | null;
  category: string;
  is_active: 0 | 1;
  sort_order: number;
  cutoff_time: string | null;
  is_self_lockout: 0 | 1;
  active_days: number[] | null;
  created_at: number;
  updated_at: number;
}

export interface MockCompletion {
  id: number;
  task_id: number;
  user_id: number;
  status: 'active' | 'revoked';
  completed_date: string;
  completed_at: number;
  awarded_event_id: number | null;
  revoked_at: number | null;
  revoked_by: number | null;
}

export interface MockScoreEvent {
  id: number;
  user_id: number;
  type: string;
  change_value: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'revoked';
  submitted_by: string;
  source: string;
  source_ref: string | null;
  reviewed_by: number | null;
  reviewed_at: number | null;
  week_of: string | null;
  created_at: number;
}

export interface MockAudit {
  id: number;
  actor: string;
  action: string;
  target_event_id: number | null;
  target_user_id: number | null;
  details: string;
  created_at: number;
}

export interface MockSeason {
  id: number;
  name: string;
  starts_on: string;
  ends_on: string | null;
  is_current: 0 | 1;
}

export interface MockAchievement {
  id: number;
  grp: string;
  name: string;
  description: string | null;
  grant_mode: string;
  ladder_json: string | null;
  is_active: 0 | 1;
  sort_order: number;
}

export interface MockAward {
  id: number;
  achievement_id: number;
  user_id: number;
  tier: string;
  season_id: number;
  status: 'active' | 'revoked';
  granted_by: number | null;
  granted_at: number;
  revoked_at: number | null;
  revoked_by: number | null;
}

/** A prepared statement, captured for assertions. */
export interface CapturedStmt {
  query: string;
  params: unknown[];
}

export interface MockState {
  users: MockUser[];
  tasks: MockTask[];
  completions: MockCompletion[];
  events: MockScoreEvent[];
  audit: MockAudit[];
  seasons: MockSeason[];
  achievements: MockAchievement[];
  awards: MockAward[];
  nextIds: {
    user: number;
    task: number;
    completion: number;
    event: number;
    audit: number;
    season: number;
    achievement: number;
    award: number;
  };
  /** Every batch invocation, in order, for statement-level assertions. */
  batches: CapturedStmt[][];
  /** now() override for deterministic timestamps. */
  now: number;
}

export interface MockDb {
  db: D1Database;
  state: MockState;
}

type Tagged = D1PreparedStatement & { __captured?: CapturedStmt };

const NOW = 1_700_000_000;

export function makeMockState(): MockState {
  return {
    users: [],
    tasks: [],
    completions: [],
    events: [],
    audit: [],
    seasons: [],
    achievements: [],
    awards: [],
    nextIds: {
      user: 1,
      task: 1,
      completion: 1,
      event: 1,
      audit: 1,
      season: 1,
      achievement: 1,
      award: 1,
    },
    batches: [],
    now: NOW,
  };
}

/** Normalize a query so regex matching is whitespace-insensitive. */
function norm(q: string): string {
  return q.trim().replace(/\s+/g, ' ');
}

// -------------------------------------------------------------
// Statement execution
// -------------------------------------------------------------

/**
 * Execute a statement against the mock state.
 * Returns the D1-style result. `lastInsertRowId` is threaded through so
 * `last_insert_rowid()` resolves exactly like SQLite's connection-level
 * rowid (and is NOT advanced by an INSERT that writes 0 rows).
 */
function execute(
  state: MockState,
  query: string,
  params: unknown[],
  lastInsertRowId: number,
): { result: D1Result<unknown>; lastInsertRowId: number } {
  const q = norm(query);
  const noop = { success: true, meta: { changes: 0, last_row_id: lastInsertRowId, duration: 0 } };

  // ---------------------------------------------------------------
  // INSERT INTO achievement_awards
  // ---------------------------------------------------------------
  if (/^INSERT INTO achievement_awards/i.test(q)) {
    const id = state.nextIds.award++;
    const row: MockAward = {
      id,
      achievement_id: params[0] as number,
      user_id: params[1] as number,
      tier: params[2] as string,
      season_id: params[3] as number,
      status: 'active',
      granted_by: (params[4] ?? null) as number | null,
      granted_at: (params[5] as number) ?? state.now,
      revoked_at: null,
      revoked_by: null,
    };
    state.awards.push(row);
    return {
      result: { success: true, meta: { changes: 1, last_row_id: id, duration: 0 } },
      lastInsertRowId: id,
    };
  }

  // ---------------------------------------------------------------
  // UPDATE achievement_awards (revoke)
  // ---------------------------------------------------------------
  if (/^UPDATE achievement_awards/i.test(q)) {
    const revokedAt = params[0] as number;
    const revokedBy = params[1] as number;
    const id = params[2] as number;
    // The statement carries `AND status = 'active'` — a second revoke
    // affects 0 rows (SQLite semantics the mock must mirror).
    const row = state.awards.find((a) => a.id === id && a.status === 'active');
    if (row) {
      row.status = 'revoked';
      row.revoked_at = revokedAt;
      row.revoked_by = revokedBy;
      return {
        result: { success: true, meta: { changes: 1, last_row_id: lastInsertRowId, duration: 0 } },
        lastInsertRowId,
      };
    }
    return { result: noop, lastInsertRowId };
  }

  // ---------------------------------------------------------------
  // INSERT INTO score_events
  //   - mint: source_ref = 'achievement:award:' || last_insert_rowid()
  //   - burn: INSERT ... SELECT ... WHERE NOT EXISTS (...)
  //   - coin: plain insert with bound source_ref
  //
  // NOTE on bound-param positions: the mint and burn statements inline
  // `type` / `status` / `submitted_by` / `source` as SQL literals, so their
  // bound params start at [user_id, change_value, reason] — NOT at
  // [user_id, type, change_value, ...] like the plain coin insert. The mock
  // must branch on the statement shape, not assume one layout.
  // ---------------------------------------------------------------
  if (/^INSERT INTO score_events/i.test(q)) {
    const isBurn = /WHERE NOT EXISTS/i.test(q);
    const isMint = /last_insert_rowid\(\)/i.test(q) && !isBurn;

    if (isBurn) {
      // Params: [user_id, -amount, reason, burnRef, burnRef]
      const burnRef = params[3] as string;
      const alreadyBurned = state.events.some(
        (e) => e.source_ref === burnRef && e.type === 'pet_tokens' && e.change_value < 0,
      );
      if (alreadyBurned) {
        // 0 rows inserted → last_insert_rowid() unchanged (SQLite semantics).
        return { result: noop, lastInsertRowId };
      }
      const id = state.nextIds.event++;
      state.events.push({
        id,
        user_id: params[0] as number,
        type: 'pet_tokens',
        change_value: params[1] as number,
        reason: params[2] as string,
        status: 'approved',
        submitted_by: 'pm',
        source: 'achievement',
        source_ref: burnRef,
        reviewed_by: null,
        reviewed_at: null,
        week_of: null,
        created_at: state.now,
      });
      return {
        result: { success: true, meta: { changes: 1, last_row_id: id, duration: 0 } },
        lastInsertRowId: id,
      };
    }

    const id = state.nextIds.event++;
    // The mint resolves its source_ref from the CURRENT connection rowid,
    // i.e. the award id inserted earlier in the same batch.
    const sourceRef = isMint
      ? `achievement:award:${lastInsertRowId}`
      : ((params[4] as string | undefined) ?? null);

    const ev: MockScoreEvent = isMint
      ? {
          id,
          user_id: params[0] as number,
          type: 'pet_tokens',
          change_value: params[1] as number,
          reason: params[2] as string,
          status: 'approved',
          submitted_by: 'system',
          source: 'achievement',
          source_ref: sourceRef,
          reviewed_by: null,
          reviewed_at: null,
          week_of: null,
          created_at: state.now,
        }
      : {
          id,
          user_id: params[0] as number,
          type: (params[1] as string) ?? 'coins',
          change_value: params[2] as number,
          reason: params[3] as string,
          status: 'approved',
          submitted_by: 'child',
          source: 'task',
          source_ref: sourceRef,
          reviewed_by: null,
          reviewed_at: null,
          week_of: null,
          created_at: state.now,
        };
    state.events.push(ev);
    return {
      result: { success: true, meta: { changes: 1, last_row_id: id, duration: 0 } },
      lastInsertRowId: id,
    };
  }

  // ---------------------------------------------------------------
  // INSERT INTO audit_log
  // ---------------------------------------------------------------
  // The achievement statements bind the actor and the action:
  //   VALUES (?, 'achievement_grant', NULL, ?, ?, ?)
  //   → params: [actor, target_user_id, details, created_at]
  // The me/tasks flow inlines both and binds (target_user_id, details):
  //   VALUES ('child', 'task_complete', last_insert_rowid(), ?, ?, ?)
  //   → params: [target_user_id, details]
  // Distinguish by counting the params AND by checking whether the actor
  // slot is a literal in the SQL.
  if (/^INSERT INTO audit_log/i.test(q)) {
    const id = state.nextIds.audit++;
    // The action is always the 2nd VALUES slot, as a literal. The 1st slot
    // (actor) may be a literal or a bound '?'.
    const actionMatch = /VALUES\s*\(\s*[^,]*,\s*'([^']+)'/i.exec(q);
    const literalAction = actionMatch ? actionMatch[1] : null;
    const actorLiteralMatch = /VALUES\s*\(\s*'([^']+)'/i.exec(q);
    const literalActor = actorLiteralMatch ? actorLiteralMatch[1] : null;
    // A bound actor shows up as '?' in the first VALUES slot.
    const actorIsBound = /VALUES\s*\(\s*\?/i.test(q);

    let actor: string;
    let action: string;
    let target_event_id: number | null;
    let target_user_id: number | null;
    let details: string;
    let created_at: number;

    if (actorIsBound && params.length >= 4) {
      // (actor, target_user_id, details, created_at) — action is a literal.
      actor = params[0] as string;
      action = literalAction ?? 'unknown';
      target_event_id = null;
      target_user_id = params[1] as number;
      details = params[2] as string;
      created_at = params[3] as number;
    } else if (params.length === 2) {
      // (target_user_id, details) — actor/action inlined, target_event_id
      // via last_insert_rowid().
      actor = literalActor ?? 'system';
      action = literalAction ?? 'unknown';
      target_event_id = lastInsertRowId;
      target_user_id = params[0] as number;
      details = params[1] as string;
      created_at = state.now;
    } else if (params.length === 3) {
      // (target_user_id, details, created_at)
      actor = literalActor ?? 'pm';
      action = literalAction ?? 'unknown';
      target_event_id = null;
      target_user_id = params[0] as number;
      details = params[1] as string;
      created_at = params[2] as number;
    } else {
      actor = params[0] as string;
      action = literalAction ?? 'unknown';
      target_event_id = null;
      target_user_id = params[1] as number;
      details = params[2] as string;
      created_at = params[3] as number;
    }

    state.audit.push({
      id,
      actor,
      action,
      target_event_id,
      target_user_id,
      details,
      created_at,
    });
    return {
      result: { success: true, meta: { changes: 1, last_row_id: id, duration: 0 } },
      lastInsertRowId: id,
    };
  }

  // ---------------------------------------------------------------
  // INSERT INTO task_completions (me/tasks flow)
  // ---------------------------------------------------------------
  if (/^INSERT INTO task_completions/i.test(q)) {
    const id = state.nextIds.completion++;
    state.completions.push({
      id,
      task_id: params[0] as number,
      user_id: params[1] as number,
      status: 'active',
      completed_date: params[2] as string,
      completed_at: state.now,
      awarded_event_id: lastInsertRowId,
      revoked_at: null,
      revoked_by: null,
    });
    return {
      result: { success: true, meta: { changes: 1, last_row_id: id, duration: 0 } },
      lastInsertRowId: id,
    };
  }

  // ---------------------------------------------------------------
  // INSERT INTO seasons
  // ---------------------------------------------------------------
  if (/^INSERT INTO seasons/i.test(q)) {
    const id = state.nextIds.season++;
    state.seasons.push({
      id,
      name: params[0] as string,
      starts_on: params[1] as string,
      ends_on: (params[2] ?? null) as string | null,
      // The column is a 0|1 flag (SQLite has no boolean type).
      is_current: ((params[3] as number) ?? 0) === 1 ? 1 : 0,
    });
    return {
      result: { success: true, meta: { changes: 1, last_row_id: id, duration: 0 } },
      lastInsertRowId: id,
    };
  }

  // ---------------------------------------------------------------
  // UPDATE seasons SET is_current = 0 WHERE is_current = 1
  // ---------------------------------------------------------------
  if (/^UPDATE seasons/i.test(q)) {
    let changes = 0;
    for (const s of state.seasons) {
      if (s.is_current === 1) {
        s.is_current = 0;
        changes++;
      }
    }
    return {
      result: { success: true, meta: { changes, last_row_id: lastInsertRowId, duration: 0 } },
      lastInsertRowId,
    };
  }

  return { result: noop, lastInsertRowId };
}

// -------------------------------------------------------------
// Query routing (first / all)
// -------------------------------------------------------------

function runSelect(state: MockState, query: string, params: unknown[]): unknown[] {
  const q = norm(query);

  // --- seasons ---
  if (/FROM seasons/i.test(q)) {
    if (/WHERE is_current = 1/i.test(q)) {
      return state.seasons.filter((s) => s.is_current === 1);
    }
    if (/WHERE id = \?/i.test(q)) {
      return state.seasons.filter((s) => s.id === params[0]);
    }
    const sorted = [...state.seasons].sort(
      (a, b) => b.starts_on.localeCompare(a.starts_on) || b.id - a.id,
    );
    return sorted;
  }

  // --- achievements ---
  if (/FROM achievements/i.test(q)) {
    if (/WHERE id = \?/i.test(q)) {
      return state.achievements.filter((a) => a.id === params[0]);
    }
    if (/WHERE is_active = 1/i.test(q)) {
      return [...state.achievements]
        .filter((a) => a.is_active === 1)
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    }
    return [...state.achievements].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  }

  // --- achievement_awards ---
  if (/FROM achievement_awards/i.test(q)) {
    if (/WHERE season_id = \? AND achievement_id = \? AND user_id = \? AND tier = \?/i.test(q)) {
      const [seasonId, achievementId, userId, tier] = params as [
        number,
        number,
        number,
        string,
      ];
      // Idempotency counts revoked rows too (spec §8a).
      return state.awards.filter(
        (a) =>
          a.season_id === seasonId &&
          a.achievement_id === achievementId &&
          a.user_id === userId &&
          a.tier === tier,
      );
    }
    if (/WHERE user_id = \? AND season_id = \?/i.test(q)) {
      const [userId, seasonId] = params as [number, number];
      return state.awards
        .filter((a) => a.user_id === userId && a.season_id === seasonId)
        .sort((a, b) => a.granted_at - b.granted_at || a.id - b.id);
    }
    if (/WHERE id = \?/i.test(q)) {
      return state.awards.filter((a) => a.id === params[0]);
    }
    if (/WHERE status = \?/i.test(q)) {
      const status = params[0] as string;
      return [...state.awards]
        .filter((a) => a.status === status)
        .sort((a, b) => b.granted_at - a.granted_at || b.id - a.id);
    }
    return [...state.awards].sort((a, b) => b.granted_at - a.granted_at || b.id - a.id);
  }

  // --- score_events ---
  if (/FROM score_events/i.test(q)) {
    // Balance sum for a single account type.
    if (/COALESCE\(SUM\(change_value\), 0\) AS balance/i.test(q)) {
      const userId = params[0] as number;
      const total = state.events
        .filter(
          (e) =>
            e.user_id === userId &&
            e.type === 'pet_tokens' &&
            e.status === 'approved',
        )
        .reduce((s, e) => s + e.change_value, 0);
      return [{ balance: total }];
    }
    // Grouped balance (computeBalance).
    if (/GROUP BY type/i.test(q)) {
      const userId = params[0] as number;
      const grouped = new Map<string, number>();
      for (const e of state.events) {
        if (e.user_id !== userId || e.status !== 'approved') continue;
        grouped.set(e.type, (grouped.get(e.type) ?? 0) + e.change_value);
      }
      return Array.from(grouped, ([type, total]) => ({ type, total }));
    }
    // Burn lookup.
    if (/change_value < 0/i.test(q)) {
      const sourceRef = params[0] as string;
      return state.events.filter(
        (e) =>
          e.source_ref === sourceRef &&
          e.type === 'pet_tokens' &&
          e.change_value < 0,
      );
    }
    // Mint lookup.
    if (/change_value > 0/i.test(q)) {
      const sourceRef = params[0] as string;
      return state.events.filter(
        (e) =>
          e.source_ref === sourceRef &&
          e.type === 'pet_tokens' &&
          e.change_value > 0,
      );
    }
    return [];
  }

  // --- tasks ---
  if (/FROM tasks/i.test(q)) {
    if (/WHERE is_active = 1/i.test(q)) {
      return state.tasks
        .filter((t) => t.is_active === 1)
        .map((t) => ({
          id: t.id,
          active_days: t.active_days,
          created_at: t.created_at,
        }));
    }
    if (/WHERE id = \?/i.test(q)) {
      return state.tasks.filter((t) => t.id === params[0]);
    }
    return state.tasks;
  }

  // --- task_completions ---
  if (/FROM task_completions/i.test(q)) {
    if (/completed_date = \? AND status = 'active'/i.test(q)) {
      const [userId, date] = params as [number, string];
      return state.completions
        .filter(
          (c) =>
            c.user_id === userId &&
            c.completed_date === date &&
            c.status === 'active',
        )
        .map((c) => ({ task_id: c.task_id }));
    }
    if (/WHERE task_id = \? AND user_id = \? AND status = 'active' AND completed_date = \?/i.test(q)) {
      const [taskId, userId, date] = params as [number, number, string];
      return state.completions.filter(
        (c) =>
          c.task_id === taskId &&
          c.user_id === userId &&
          c.status === 'active' &&
          c.completed_date === date,
      );
    }
    return state.completions;
  }

  // --- users ---
  if (/FROM users/i.test(q)) {
    if (/WHERE role = 'pm'/i.test(q)) {
      return state.users.filter((u) => u.role === 'pm');
    }
    if (/WHERE id = \?/i.test(q)) {
      return state.users.filter((u) => u.id === params[0]);
    }
    return state.users;
  }

  return [];
}

// -------------------------------------------------------------
// Factory
// -------------------------------------------------------------

export function makeMockDb(): MockDb {
  const state = makeMockState();
  let lastInsertRowId = 0;

  const db: D1Database = {
    prepare(query: string): D1PreparedStatement {
      let params: unknown[] = [];
      const stmt: Tagged = {
        bind(...values: unknown[]): D1PreparedStatement {
          params = values;
          (stmt as Tagged).__captured = { query: norm(query), params };
          return stmt;
        },
        first<T = unknown>(): Promise<T | null> {
          const rows = runSelect(state, query, params);
          return Promise.resolve((rows.length > 0 ? rows[0] : null) as T | null);
        },
        all<T = unknown>(): Promise<D1Result<T>> {
          const rows = runSelect(state, query, params);
          return Promise.resolve({ results: rows as unknown as T[], success: true });
        },
        run<T = unknown>(): Promise<D1Result<T>> {
          const { result, lastInsertRowId: nextId } = execute(state, query, params, lastInsertRowId);
          lastInsertRowId = nextId;
          return Promise.resolve(result as D1Result<T>);
        },
        raw<T = unknown>(): Promise<T[]> {
          return Promise.resolve([]);
        },
      };
      (stmt as Tagged).__captured = { query: norm(query), params: [] };
      return stmt;
    },
    batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      const captured = statements.map((s) => {
        const tag = (s as Tagged).__captured ?? { query: '', params: [] };
        return { query: tag.query, params: tag.params };
      });
      state.batches.push(captured);

      const results: D1Result<T>[] = [];
      for (const s of statements) {
        const tag = (s as Tagged).__captured ?? { query: '', params: [] };
        const { result, lastInsertRowId: nextId } = execute(state, tag.query, tag.params, lastInsertRowId);
        lastInsertRowId = nextId;
        results.push(result as D1Result<T>);
      }
      return Promise.resolve(results);
    },
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
  };

  return { db, state };
}

// -------------------------------------------------------------
// Fixtures
// -------------------------------------------------------------

export function addUser(
  state: MockState,
  id: number,
  role: 'child' | 'pm' = 'child',
): MockUser {
  const user: MockUser = {
    id,
    name: role === 'pm' ? 'PM' : 'Kid',
    role,
    pin_hash: 'fake-hash',
    created_at: state.now,
    updated_at: state.now,
  };
  state.users.push(user);
  return user;
}

export function addSeason(
  state: MockState,
  overrides: Partial<MockSeason> = {},
): MockSeason {
  const season: MockSeason = {
    id: state.nextIds.season++,
    name: 'S1 · 四年级上学期',
    starts_on: '2026-09-01',
    ends_on: null,
    is_current: 1,
    ...overrides,
  };
  state.seasons.push(season);
  return season;
}

/** Set a season's current flag (0 | 1). */
export function setSeasonCurrent(season: MockSeason, isCurrent: boolean): void {
  season.is_current = isCurrent ? 1 : 0;
}

export function addAchievement(
  state: MockState,
  overrides: Partial<MockAchievement> = {},
): MockAchievement {
  const achievement: MockAchievement = {
    id: state.nextIds.achievement++,
    grp: 'study',
    name: '语文默写全对',
    description: '获得一次语文默写全对',
    grant_mode: 'admin_tier',
    ladder_json: '{"iron":1,"bronze":3,"silver":5,"gold":8,"king":10}',
    is_active: 1,
    sort_order: 1,
    ...overrides,
  };
  state.achievements.push(achievement);
  return achievement;
}

export function addTask(
  state: MockState,
  overrides: Partial<MockTask> = {},
): MockTask {
  const task: MockTask = {
    id: state.nextIds.task++,
    name: `task ${state.nextIds.task}`,
    token_reward: 10,
    target_account: 'game_time',
    icon: null,
    category: 'habit',
    is_active: 1,
    sort_order: 0,
    cutoff_time: null,
    is_self_lockout: 0,
    active_days: null,
    created_at: state.now,
    updated_at: state.now,
    ...overrides,
  };
  state.tasks.push(task);
  return task;
}

/** Mark a task as completed on a date (status='active'). */
export function completeTask(
  state: MockState,
  taskId: number,
  userId: number,
  date: string,
): MockCompletion {
  const completion: MockCompletion = {
    id: state.nextIds.completion++,
    task_id: taskId,
    user_id: userId,
    status: 'active',
    completed_date: date,
    completed_at: state.now,
    awarded_event_id: null,
    revoked_at: null,
    revoked_by: null,
  };
  state.completions.push(completion);
  return completion;
}

/** The pet-token ledger rows for a user, oldest first. */
export function petTokenEvents(state: MockState, userId: number): MockScoreEvent[] {
  return state.events.filter((e) => e.type === 'pet_tokens' && e.user_id === userId);
}

/** The pet-token balance for a user (sum of approved events). */
export function petTokenBalance(state: MockState, userId: number): number {
  return petTokenEvents(state, userId)
    .filter((e) => e.status === 'approved')
    .reduce((s, e) => s + e.change_value, 0);
}

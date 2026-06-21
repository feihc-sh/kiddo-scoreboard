// tests/e2e/helpers/db.ts
// D1 reset + seed helpers for e2e tests.
// Uses `wrangler d1 execute --local` to clear and re-seed the local D1.
// All tests should call clearAllData() in beforeEach to ensure isolation.
//
// 3-shard limitation: wrangler 4.98 d1 execute --persist-to <abs-path> resolves
// <abs-path> as relative to CWD (strips the leading /), so we cannot give each
// shard its own D1 sqlite file. All shards share the default D1 at
// <CWD>/.wrangler/state/v3/d1/. Tests are short and isolation is best-effort.
// TODO: switch to sqlite3 CLI direct read/write to bypass wrangler's path quirk.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { globSync } from 'node:fs';
import { resolve } from 'node:path';

// Use process.cwd() so this works regardless of where the project is cloned
// (was hardcoded to /Users/tidusmaomao/workspace/kiddo-scoreboard which broke
// forks/branches/clones in other paths). Tests must be run from the project
// root (`npm test` or `playwright test` from package.json cwd).
const WRANGLER_CWD = process.cwd();

// Locate the workerd D1 sqlite file (used by both wrangler d1 execute and
// the running workerd process — both read the same file).
// §3.11 EDGE-7: skip the empty 00000000-... placeholder that workerd creates
// for bindings that don't have their own sqlite file yet. The real data lives
// in the hashed file (e.g. c2048...sqlite) — sort by file size desc so we pick
// the largest (the actual D1 with tables) over the empty 0-byte placeholder.
function d1SqlitePath(): string {
  const dir = `${WRANGLER_CWD}/.wrangler/state/v3/d1/miniflare-D1DatabaseObject`;
  const files = globSync(`${dir}/*.sqlite`)
    .filter(p => !p.includes('-shm') && !p.includes('-wal'))
    .map(p => ({ path: p, size: readFileSync(p).length }))
    .filter(f => f.size > 0)
    .sort((a, b) => b.size - a.size);
  if (files.length === 0) throw new Error(`No non-empty D1 sqlite file found in ${dir}`);
  return files[0].path;
}

/** Run a SQL command against the local D1 sqlite file. Both wrangler dev and
 *  `wrangler d1 execute` read this file, so changes are immediately visible
 *  to the running workerd process (no cache-stale issue). */
export function d1Exec(sql: string): unknown {
  const out = execFileSync(
    'sqlite3',
    [d1SqlitePath(), sql],
    { encoding: 'utf-8', timeout: 15000 }
  );
  return out;
}

/** SQL string literal. Use single quotes; escape any single quotes in the value by doubling. */
function sqlStr(s: string | null | undefined): string {
  if (s === null || s === undefined) return 'NULL';
  return "'" + String(s).replace(/'/g, "''") + "'";
}

/** SQL numeric literal. Pass as-is. */
function sqlNum(n: number | undefined | null): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'NULL';
  return String(n);
}

/** Wipe all dynamic tables (events, completions, audit) but keep users/tasks. */
export function clearDynamicData(): void {
  d1Exec('DELETE FROM auth_attempts; DELETE FROM audit_log; DELETE FROM task_completions; DELETE FROM score_events;');
}

/** Full reset: drop users/tasks too. Use sparingly (each task config test will recreate them). */
export function clearAllData(): void {
  d1Exec(
    'DELETE FROM auth_attempts; DELETE FROM audit_log; DELETE FROM task_completions; ' +
    'DELETE FROM score_events; DELETE FROM tasks; DELETE FROM users; ' +
    'DELETE FROM running_records; DELETE FROM running_points; DELETE FROM running_maps; ' +
    'DELETE FROM running_progress;'
  );
}

/** Re-seed the default running map + points (Shanghai→Suzhou 95 km, 10 nodes).
 *  Item #011 Stage 1 ships these via migrations/0010_seed_shanghai_suzhou.sql.
 *  Tests call clearAllData() which wipes them; this helper re-applies the seed
 *  so the running check-in tests don't depend on migration timing.
 *
 *  Kept in sync with the 0010 migration — if the seed changes there, update
 *  here too. We do NOT use wrangler to apply migrations mid-test (would race
 *  with the workerd process the tests are running against).
 */
export function seedRunningMap(): void {
  const now = Math.floor(Date.now() / 1000);
  d1Exec(`
    INSERT OR IGNORE INTO running_maps (id, name, theme, total_km, is_active, display_order, created_at)
    VALUES (1, '上海 → 苏州', 'shanghai-suzhou', 95.0, 1, 1, ${now});
  `);
  d1Exec(`
    INSERT OR IGNORE INTO running_points (id, map_id, name, order_index, cum_km) VALUES
      (1,  1, '🏁 上海·普陀区 (起点)',     0,   0.0),
      (2,  1, '嘉定新城',                 1,   8.0),
      (3,  1, '太仓',                     2,  22.0),
      (4,  1, '昆山花桥',                 3,  32.0),
      (5,  1, '昆山城区',                 4,  45.0),
      (6,  1, '阳澄湖',                   5,  58.0),
      (7,  1, '苏州相城区',               6,  72.0),
      (8,  1, '苏州姑苏区',               7,  82.0),
      (9,  1, '苏州工业园区',             8,  89.0),
      (10, 1, '🚩 苏州·金鸡湖 (终点)',    9,  95.0);
  `);
}

/** Seed a PM user with the given PIN. Returns the user id. */
export function seedPmUser(pin = '123654', id = 1): number {
  const secret = readDevSecret();
  // hash-pin.mjs writes to stdout the hash string. Capture it.
  const hashOut = execFileSync(
    'node',
    ['scripts/hash-pin.mjs', pin, secret],
    { cwd: WRANGLER_CWD, encoding: 'utf-8' }
  ).trim();

  const now = Math.floor(Date.now() / 1000);
  const sql =
    `INSERT INTO users (id, name, role, pin_hash, created_at, updated_at) ` +
    `VALUES (${sqlNum(id)}, ${sqlStr('PM')}, ${sqlStr('pm')}, ${sqlStr(hashOut)}, ${sqlNum(now)}, ${sqlNum(now)}) ` +
    `ON CONFLICT(id) DO UPDATE SET pin_hash=excluded.pin_hash, name='PM', updated_at=excluded.updated_at;`;
  d1Exec(sql);
  return id;
}

/** Seed a child user (id=2, name='' for first-time) or with a name set. */
export function seedChildUser(name: string | null = '', id = 2): number {
  const now = Math.floor(Date.now() / 1000);
  // Per schema, name is NOT NULL. "" indicates first-time (not yet set).
  const finalName = name ?? '';
  const sql =
    `INSERT INTO users (id, name, role, pin_hash, created_at, updated_at) ` +
    `VALUES (${sqlNum(id)}, ${sqlStr(finalName)}, ${sqlStr('child')}, NULL, ${sqlNum(now)}, ${sqlNum(now)}) ` +
    `ON CONFLICT(id) DO UPDATE SET name=${sqlStr(finalName)}, updated_at=excluded.updated_at;`;
  d1Exec(sql);
  return id;
}

/** Seed an active task. Returns the task id. */
export function seedTask(overrides: Partial<{
  id: number;
  name: string;
  token_reward: number;
  target_account: 'game_time' | 'pocket_money';
  icon: string;
  category: 'habit' | 'study' | 'chore' | 'custom';
  sort_order: number;
  is_active: 0 | 1;
}> = {}): number {
  const id = overrides.id ?? 100 + Math.floor(Math.random() * 100000);
  const name = overrides.name ?? '整理书桌';
  const token_reward = overrides.token_reward ?? 5;
  const target_account = overrides.target_account ?? 'pocket_money';
  const icon = overrides.icon ?? '📚';
  const category = overrides.category ?? 'chore';
  const sort_order = overrides.sort_order ?? 0;
  const is_active = overrides.is_active ?? 1;
  const now = Math.floor(Date.now() / 1000);
  const sql =
    `INSERT INTO tasks (id, name, token_reward, target_account, icon, category, sort_order, is_active, created_at, updated_at) ` +
    `VALUES (${sqlNum(id)}, ${sqlStr(name)}, ${sqlNum(token_reward)}, ${sqlStr(target_account)}, ${sqlStr(icon)}, ${sqlStr(category)}, ${sqlNum(sort_order)}, ${sqlNum(is_active)}, ${sqlNum(now)}, ${sqlNum(now)}) ` +
    `ON CONFLICT(id) DO UPDATE SET name=excluded.name, token_reward=excluded.token_reward, target_account=excluded.target_account, is_active=excluded.is_active, updated_at=excluded.updated_at;`;
  d1Exec(sql);
  return id;
}

/** Seed a score event. Returns the event id. */
export function seedEvent(overrides: Partial<{
  id: number;
  user_id: number;
  type: 'game_time' | 'pocket_money';
  change_value: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'revoked';
  submitted_by: 'child' | 'pm' | 'system';
  source: 'manual' | 'task' | 'weekly_grant' | 'exchange';
  week_of: string;
}> = {}): number {
  const id = overrides.id ?? 1000 + Math.floor(Math.random() * 100000);
  const user_id = overrides.user_id ?? 2;
  const type = overrides.type ?? 'game_time';
  const change_value = overrides.change_value ?? 10;
  const reason = overrides.reason ?? 'sample';
  const status = overrides.status ?? 'approved';
  const submitted_by = overrides.submitted_by ?? 'pm';
  const source = overrides.source ?? 'manual';
  // week_of: ISO 8601 week string, e.g. '2026-W23'
  const week_of = overrides.week_of ?? currentIsoWeek();
  const now = Math.floor(Date.now() / 1000);
  const sql =
    `INSERT INTO score_events (id, user_id, type, change_value, reason, status, submitted_by, source, week_of, created_at) ` +
    `VALUES (${sqlNum(id)}, ${sqlNum(user_id)}, ${sqlStr(type)}, ${sqlNum(change_value)}, ${sqlStr(reason)}, ${sqlStr(status)}, ${sqlStr(submitted_by)}, ${sqlStr(source)}, ${sqlStr(week_of)}, ${sqlNum(now)});`;
  d1Exec(sql);
  return id;
}

/** Seed a task_completion for a child + task + date. Returns the completion id.
 *
 *  Input `completed_at` is a Shanghai-local wall-clock string
 *  'YYYY-MM-DD HH:MM:SS' (matches the test pattern in ui-calendar-day-detail
 *  and other e2e specs). The helper derives `completed_date` (the SH date)
 *  and converts the wall-clock time to a unix-seconds INTEGER for the
 *  `completed_at` column — matches the canonical schema in
 *  ui-admin-revoke-event-sync.spec.ts (which sets `completed_at` to
 *  `Math.floor(Date.now() / 1000)`).
 *
 *  Note: `created_at` was previously inserted but is not a column of the
 *  `task_completions` table (see migrations/0001_initial.sql). Removed —
 *  the schema columns are id, task_id, user_id, status, completed_date,
 *  completed_at, awarded_event_id, revoked_at, revoked_by.
 */
export function seedTaskCompletion(overrides: Partial<{
  id: number;
  user_id: number;
  task_id: number;
  completed_at: string; // 'YYYY-MM-DD HH:MM:SS' in Asia/Shanghai (TZ +08:00)
  status: 'active' | 'revoked';
}> = {}): number {
  const id = overrides.id ?? 2000 + Math.floor(Math.random() * 100000);
  const user_id = overrides.user_id ?? 2;
  const task_id = overrides.task_id ?? 100;
  // Default to today (Shanghai) at 08:00:00 local time
  const completed_at_str = overrides.completed_at ?? shanghaiToday() + ' 08:00:00';
  const status = overrides.status ?? 'active';
  // Derive completed_date (SH date 'YYYY-MM-DD') + unix-seconds completed_at
  const completed_date = completed_at_str.split(' ')[0];
  // Parse 'YYYY-MM-DD HH:MM:SS' as Asia/Shanghai (+08:00) → unix seconds
  const completedAtUnix = Math.floor(
    new Date(completed_at_str.replace(' ', 'T') + '+08:00').getTime() / 1000
  );
  const sql =
    `INSERT INTO task_completions (id, task_id, user_id, status, completed_date, completed_at) ` +
    `VALUES (${sqlNum(id)}, ${sqlNum(task_id)}, ${sqlNum(user_id)}, ${sqlStr(status)}, ${sqlStr(completed_date)}, ${sqlNum(completedAtUnix)}) ` +
    `ON CONFLICT(id) DO UPDATE SET completed_at=excluded.completed_at, status=excluded.status;`;
  d1Exec(sql);
  return id;
}

function readDevSecret(): string {
  const p = `${WRANGLER_CWD}/.dev.vars`;
  if (!existsSync(p)) {
    throw new Error(`.dev.vars not found at ${p} — run 'npm run dev' first or create .dev.vars with JWT_SECRET`);
  }
  const m = readFileSync(p, 'utf-8').match(/^JWT_SECRET=(.+)$/m);
  if (!m) throw new Error('JWT_SECRET not found in .dev.vars');
  return m[1].trim();
}

function currentIsoWeek(): string {
  // Quick ISO week computation
  const d = new Date();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;  // Mon=0, Sun=6
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Today in Asia/Shanghai as 'YYYY-MM-DD'. Matches the server-side
 * `todayShanghai()` in src/utils/week.ts (UTC+8, no DST).
 *
 * Why not just `new Date().toISOString().slice(0, 10)`? That's UTC date,
 * which crosses midnight 8 hours before Shanghai — so when the test runs
 * after UTC 16:00 (= Shanghai 00:00 next day), the seed's `completed_date`
 * will be off-by-one relative to what `/api/admin/task-completions`
 * filters on (the endpoint defaults `date` to `todayShanghai()`).
 *
 * Use this for any `completed_date` seed that is later read back through
 * the admin completions list endpoint.
 */
export function shanghaiToday(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

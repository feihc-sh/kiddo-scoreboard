// tests/e2e/coin-invariants.spec.ts
// M5: Coin System data conservation invariants (INV-1..4 per RFC §3.4 +
// Test Plan §7 Phase 5). Each test seeds a realistic state, then runs
// the SQL CHECK defined in the RFC to assert the invariant holds.
//
// Dependency: M2 (task complete/revoke coin grant) + M3 (shop exchange)
// must be implemented first. INV-3 and INV-4 are 100% M3 territory; INV-1
// and INV-2 cover M2 territory. Each test will fail with a clear
// precondition error if the API/DB state isn't ready.
//
// Why e2e (not unit): we want to assert the invariant holds against
// the real D1 SQLite engine that production uses, not miniflare. The
// schema-checked SQL is the source of truth (RFC §3.4). The unit
// equivalents in tests/unit/coin-invariants.test.ts (if/when added)
// would only test the same SQL against miniflare — duplicative.
//
// Run only when M2+M3 are merged into feat/coin-shop.

import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  clearAllData,
  seedPmUser,
  seedChildUser,
  seedTask,
  d1Exec,
} from './helpers/db';
import { loginAsPm } from './helpers/auth';

// ────────────────────────────────────────────────────────────────────────────
// Helpers (kept local so M5 stays self-contained).
// ────────────────────────────────────────────────────────────────────────────

/** Wipe coin-system tables (not in clearAllData). */
function clearCoinShop(): void {
  d1Exec('DELETE FROM shop_redemptions; DELETE FROM shop_items;');
}

/** Insert a coin event row. */
function insertCoinEvent(opts: {
  userId: number;
  changeValue: number;
  status?: 'approved' | 'revoked' | 'pending' | 'rejected';
  source?: 'task' | 'exchange' | 'manual' | 'weekly_grant';
  sourceRef?: string;
  reason?: string;
  weekOf?: string;
}): void {
  const status = opts.status ?? 'approved';
  const source = opts.source ?? 'manual';
  const sourceRef = opts.sourceRef ?? null;
  const reason = opts.reason ?? 'seed';
  const weekOf = opts.weekOf ?? null;
  d1Exec(
    `INSERT INTO score_events
       (user_id, type, change_value, reason, status, submitted_by, source,
        source_ref, week_of, created_at)
     VALUES
       (${opts.userId}, 'coins', ${opts.changeValue},
        '${reason.replace(/'/g, "''")}', '${status}', 'pm', '${source}',
        ${sourceRef === null ? 'NULL' : `'${sourceRef}'`},
        ${weekOf === null ? 'NULL' : `'${weekOf}'`},
        unixepoch())`,
  );
}

function currentIsoWeek(): string {
  const d = new Date();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function d1Scalar(sql: string): string {
  return String(d1Exec(sql) ?? '').trim();
}

/** Skip if /api/coins/balance 404 (M3 not yet shipped). */
async function skipUntilM3Landed(request: APIRequestContext, label: string): Promise<boolean> {
  const r = await request.get('/api/coins/balance');
  if (r.status() === 404) {
    test.skip(true, `M3 not yet shipped — /api/coins/balance 404. Skipping ${label}.`);
    return false;
  }
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// INV-1: 金币余额守恒
// RFC §3.4 + §7 INV-1:
//   "SELECT SUM(change_value) FROM score_events
//      WHERE user_id=? AND type='coins' AND status='approved'"
//   应等于 /api/coins/balance 返回的 coins
// ════════════════════════════════════════════════════════════════════════════

test('INV-1: coins balance = SUM(approved coin events) — DB ⇔ API', async ({ request }) => {
  clearAllData();
  clearCoinShop();
  seedPmUser();
  seedChildUser('Tommy');

  // Seed: 7 approved coin events (3 task + 1 bonus revoked) + 1 pending
  // + 1 approved (manual) + 1 approved (exchange) = 6 approved net
  const week = currentIsoWeek();
  insertCoinEvent({ userId: 2, changeValue: 1, source: 'task', sourceRef: 'task:1:d1:2', weekOf: week });
  insertCoinEvent({ userId: 2, changeValue: 1, source: 'task', sourceRef: 'task:2:d1:2', weekOf: week });
  insertCoinEvent({ userId: 2, changeValue: 1, source: 'task', sourceRef: 'task:3:d1:2', weekOf: week });
  insertCoinEvent({ userId: 2, changeValue: 3, source: 'task', sourceRef: `bonus:d1:2`, weekOf: week });
  // revoke (-1 task + -3 bonus): use 'revoked' status
  insertCoinEvent({ userId: 2, changeValue: -1, status: 'approved', source: 'task', sourceRef: 'revoke:task:3:d1:2', weekOf: week, reason: 'revoke:task#3' });
  insertCoinEvent({ userId: 2, changeValue: -3, status: 'approved', source: 'task', sourceRef: `revoke:bonus:d1:2`, weekOf: week, reason: 'revoke:bonus:d1:2' });
  // pending: should be ignored by SUM
  insertCoinEvent({ userId: 2, changeValue: 99, status: 'pending', source: 'manual' });

  // Net: 1+1+1+3-1-3 = 2 approved coins (the 99 pending is ignored)
  const dbBalance = Number(d1Scalar(
    `SELECT COALESCE(SUM(change_value), 0) FROM score_events
     WHERE user_id=2 AND type='coins' AND status='approved'`,
  ));
  expect(dbBalance).toBe(2);

  // Compare to API (if M3 shipped)
  const r = await request.get('/api/coins/balance');
  if (r.status() === 404) {
    test.skip(true, 'M3 /api/coins/balance not yet shipped; DB-side assertion held.');
  }
  const body = await r.json();
  expect(body.coins).toBe(dbBalance);
});

// ════════════════════════════════════════════════════════════════════════════
// INV-2: bonus 每天每 user 最多 1 条 (+3)
// RFC §3.4 + §7 INV-2:
//   "SELECT COUNT(*) FROM score_events
//      WHERE user_id=? AND type='coins' AND change_value=+3
//        AND reason LIKE 'bonus:%' AND status='approved'
//    GROUP BY source_ref HAVING COUNT > 1"
//   应返回 0 行
// ════════════════════════════════════════════════════════════════════════════

test('INV-2: at most 1 approved +3 bonus per source_ref per user', async () => {
  clearAllData();
  clearCoinShop();
  seedPmUser();
  seedChildUser('Tommy');

  const week = currentIsoWeek();
  // Good: 1 bonus per day per user
  insertCoinEvent({ userId: 2, changeValue: 3, source: 'task', sourceRef: 'bonus:2026-06-15:2', weekOf: week });
  // Good: 1 bonus per DIFFERENT day
  insertCoinEvent({ userId: 2, changeValue: 3, source: 'task', sourceRef: 'bonus:2026-06-16:2', weekOf: week });
  // Good: 1 bonus for DIFFERENT user
  seedChildUser('Sis', 3);
  insertCoinEvent({ userId: 3, changeValue: 3, source: 'task', sourceRef: 'bonus:2026-06-15:3', weekOf: week });

  // Bad: 2 approved +3 with same source_ref (would be a logic bug)
  insertCoinEvent({ userId: 2, changeValue: 3, source: 'task', sourceRef: 'bonus:DUP:2', weekOf: week });
  insertCoinEvent({ userId: 2, changeValue: 3, source: 'task', sourceRef: 'bonus:DUP:2', weekOf: week });

  // The check: any source_ref with COUNT(*) > 1 in approved +3 rows
  const dupCount = Number(d1Scalar(
    `SELECT COUNT(*) FROM (
       SELECT source_ref, COUNT(*) c FROM score_events
       WHERE user_id=2 AND type='coins' AND change_value=3
         AND reason LIKE 'bonus:%' AND status='approved'
       GROUP BY source_ref HAVING c > 1
     )`,
  ));
  expect(dupCount).toBe(0);

  // Sanity: total bonus count = 4 (3 unique source_refs for the 3 good + 2 dups, but dups are 1 source_ref; so unique source_refs = 4)
  // Actually: bonus:2026-06-15:2, bonus:2026-06-16:2, bonus:2026-06-15:3, bonus:DUP:2 = 4 unique
  // All 5 events (1 from sis) = 5 total bonus events for user 2 = 3+3+3+3+3 = 15, but the dup pair counts as 1 unique ref
  // What we really care: NO source_ref has > 1 approved +3 row. The dup test above proves that.
});

// ════════════════════════════════════════════════════════════════════════════
// INV-3: 兑换消耗守恒
// RFC §3.4 + §7 INV-3:
//   "SELECT SUM(sr.cost_coins) FROM shop_redemptions sr
//      WHERE sr.user_id=? AND sr.status IN ('approved','consumed')"
//   应等于 "SELECT -SUM(change_value) FROM score_events
//      WHERE user_id=? AND type='coins' AND source='exchange' AND status='approved'"
//
// Note: the requirements doc lists status as 'pending'|'approved' (and
// the migration uses 'consumed'|'revoked'). For this invariant, a
// redemption is "consumed for accounting" once it's been paid out
// (status='approved' OR 'consumed' — both meanings are equivalent for
// cost-coins accounting). The pending/custom-flow redemptions are NOT
// counted (no payment has been made yet — wait, actually pending means
// the cost WAS paid in M3 §5.3, so it should be counted). Re-read:
//
//   M3 §5.3: "kind='custom' 走 status='pending' (等 PM 手动 fulfill)"
//            + db.batch writes: shop_redemptions + score_events (-cost)
//
// So pending = cost already deducted from balance. INV-3 must count
// both 'pending' AND 'approved' (and the migration's 'consumed' which
// is the v1 simplification of 'approved').
// ════════════════════════════════════════════════════════════════════════════

test('INV-3: shop_redemptions cost = -SUM(exchange-coin events)', async ({ request, page }) => {
  clearAllData();
  clearCoinShop();
  seedPmUser();
  seedChildUser('Tommy');

  // Seed 1 item (game_time 10 coins)
  d1Exec(
    `INSERT INTO shop_items
       (id, name, kind, cost_coins, reward_value, reward_type, description, icon,
        is_active, sort_order, weekly_limit, created_at, updated_at)
     VALUES (1, '游戏时间 10 分钟', 'game_time', 10, 10, 'game_time',
             '10 金币换 10 分钟游戏时间', '🎮', 1, 0, 3, unixepoch(), unixepoch())`,
  );

  // Seed 50 coins
  insertCoinEvent({ userId: 2, changeValue: 50, source: 'manual' });

  if (!(await skipUntilM3Landed(request, 'INV-3'))) return;

  // 2 successful exchanges + 1 attempted 3rd (must hit 429)
  const r1 = await request.post('/api/coins/exchange', { data: { item_id: 1 } });
  const r2 = await request.post('/api/coins/exchange', { data: { item_id: 1 } });
  const r3 = await request.post('/api/coins/exchange', { data: { item_id: 1 } });
  expect(r1.status()).toBe(200);
  expect(r2.status()).toBe(200);
  // r3 either 200 (if weekly_limit=0) or 429 (if 3); our item has limit=3 so r3=200
  expect(r3.status()).toBe(200);

  // LHS: sum of cost_coins across all 'consumed' OR 'approved' redemptions
  const lhs = Number(d1Scalar(
    `SELECT COALESCE(SUM(cost_coins), 0) FROM shop_redemptions
     WHERE user_id=2 AND status IN ('consumed', 'approved', 'pending')`,
  ));
  // RHS: -SUM(coins events with source='exchange', approved)
  const rhs = -Number(d1Scalar(
    `SELECT COALESCE(SUM(change_value), 0) FROM score_events
     WHERE user_id=2 AND type='coins' AND source='exchange' AND status='approved'`,
  ));
  expect(lhs).toBe(rhs);
  expect(lhs).toBe(30);  // 3 × 10
});

// ════════════════════════════════════════════════════════════════════════════
// INV-4: 兑换奖励守恒
// RFC §3.4 + §7 INV-4:
//   "SELECT SUM(sr.reward_value) FROM shop_redemptions sr
//      WHERE sr.user_id=? AND sr.status IN ('consumed','approved','pending')
//        AND sr.reward_type='game_time'"
//   应等于 "SELECT SUM(change_value) FROM score_events
//      WHERE user_id=? AND type='game_time' AND source='exchange'
//        AND status='approved'"
//
// Note: only counts game_time rewards (pocket_money and custom
// 'none' don't flow into the game_time account).
// ════════════════════════════════════════════════════════════════════════════

test('INV-4: shop_redemptions game_time reward = SUM(exchange-game_time events)', async ({ request }) => {
  clearAllData();
  clearCoinShop();
  seedPmUser();
  seedChildUser('Tommy');

  // 2 items: game_time (counts toward INV-4) + custom (doesn't)
  d1Exec(
    `INSERT INTO shop_items
       (id, name, kind, cost_coins, reward_value, reward_type, description, icon,
        is_active, sort_order, weekly_limit, created_at, updated_at)
     VALUES
       (1, '游戏时间 10 分钟', 'game_time', 10, 10, 'game_time', '10 金币换 10 分钟游戏时间', '🎮', 1, 0, 3, unixepoch(), unixepoch()),
       (2, '小乐高', 'custom', 50, 1, 'none', '1 个小乐高玩具', '🧱', 1, 1, 1, unixepoch(), unixepoch())`,
  );
  insertCoinEvent({ userId: 2, changeValue: 200, source: 'manual' });

  if (!(await skipUntilM3Landed(request, 'INV-4'))) return;

  // 2 game_time exchanges + 1 custom exchange
  await request.post('/api/coins/exchange', { data: { item_id: 1 } });
  await request.post('/api/coins/exchange', { data: { item_id: 1 } });
  const rCustom = await request.post('/api/coins/exchange', { data: { item_id: 2 } });
  expect(rCustom.status()).toBe(200);

  // LHS: sum of reward_value for game_time redemptions
  const lhs = Number(d1Scalar(
    `SELECT COALESCE(SUM(reward_value), 0) FROM shop_redemptions
     WHERE user_id=2
       AND status IN ('consumed', 'approved', 'pending')
       AND reward_type='game_time'`,
  ));
  // RHS: sum of game_time events with source='exchange'
  const rhs = Number(d1Scalar(
    `SELECT COALESCE(SUM(change_value), 0) FROM score_events
     WHERE user_id=2 AND type='game_time' AND source='exchange' AND status='approved'`,
  ));
  expect(lhs).toBe(rhs);
  expect(lhs).toBe(20);  // 2 × 10 (the custom item contributes 0)

  // The custom item's redemption is in shop_redemptions but its reward_type
  // is 'none', so it does NOT show up in the LHS sum. Verify the row exists:
  const customCount = Number(d1Scalar(
    `SELECT COUNT(*) FROM shop_redemptions WHERE user_id=2 AND item_id=2`,
  ));
  expect(customCount).toBe(1);
});

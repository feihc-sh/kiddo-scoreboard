// tests/e2e/coin-system.spec.ts
// M5: Coin System e2e functional tests (F1..F12 per RFC §7 + Test Plan §2).
//
// Dependency: M3 (src/routes/me/coins.ts + src/routes/shop/*) + M4
// (public/shop.html + public/shop.js + app.js click handler) must be
// implemented first. These tests will all fail at the network layer
// (404/timeout on /api/coins/*, /api/shop/items) until M3 lands, and the
// UI tests (F9-F12) will additionally fail at selector time until M4
// ships the /shop page + data-testid attributes.
//
// Run only when M3+M4 are merged into feat/coin-shop.
//
// API contract assumed (must match M3 implementation, see
// docs/coin-shop-requirements.md §5.1-§5.5 + docs/coin-system-test-plan.md §2):
//   GET    /api/coins/balance       → { coins, weekly_remaining, week_of }
//   GET    /api/coins/redemptions   → [ { id, item_id, item_name, item_icon,
//                                         cost_coins, reward_value, reward_type,
//                                         status, redeemed_at, week_of, ... } ]
//   GET    /api/shop/items          → [ { id, name, kind, cost_coins,
//                                         reward_value, description, icon,
//                                         weekly_limit_remaining } ]
//   POST   /api/coins/exchange      body { item_id }
//                                   200 → { redemption_id, item, new_balance,
//                                           weekly_remaining }
//                                   400 insufficient_coins { need, have }
//                                   400 invalid_item_id
//                                   429 weekly_limit_reached { used, limit }
//   POST   /api/admin/shop/fulfill/:redemption_id  (PM only)
//                                   200 → { redemption_id, status }
//   POST   /api/me/tasks/:id/complete             (existing M2)
//   POST   /api/admin/task-completions/:id/revoke (existing M2)
//
// Note: requirements doc §5.3 lists shop_redemptions.status enum as
// 'pending' | 'approved' (custom items start pending, PM fulfills). The
// existing migration 0007_coin_system.sql has 'consumed' | 'revoked'
// (v1 simplification, no PM-fulfill flow). The spec asserts the
// BUSINESS state (custom items start unfulfilled, fulfill flips them to
// "done") and accepts both naming schemes — see F7-note and the
// F6 helper comment for the tolerance.
//
// Selector convention: F9/F10/F11/F12 use data-testid attributes
// (per Test Plan §2 TC-F9/TC-F10/TC-F11/TC-F12). M4 must add these
// attributes to /shop.html. If M4 forgets, the failing test message
// will point at the missing attribute.

import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  clearAllData,
  seedPmUser,
  seedChildUser,
  seedTask,
  d1Exec,
} from './helpers/db';
import { loginAsPm } from './helpers/auth';

// Local copy of helpers/db.ts currentIsoWeek() (which is private). Mirrors
// the same algorithm: ISO 8601 week-of-year string in Asia/Shanghai TZ.
function currentIsoWeek(): string {
  const d = new Date();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;  // Mon=0, Sun=6
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((target.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Shared seed helpers (M3-specific — extend existing helpers/db.ts would
// be out of scope for this spec; keep them local so M5 stays self-contained).
// ────────────────────────────────────────────────────────────────────────────

interface ShopItemSeed {
  id?: number;
  name: string;
  kind: 'game_time' | 'pocket_money' | 'custom';
  cost_coins: number;
  reward_value: number;
  reward_type: 'game_time' | 'pocket_money' | 'none';
  description?: string;
  icon?: string;
  is_active?: 0 | 1;
  weekly_limit?: number;
}

/** Insert/upsert a shop_item. Returns the actual id used. */
function seedShopItem(item: ShopItemSeed): number {
  const id = item.id ?? Math.floor(Math.random() * 100000) + 100;
  const name = item.name;
  const kind = item.kind;
  const cost = item.cost_coins;
  const rewardValue = item.reward_value;
  const rewardType = item.reward_type;
  const description = item.description ?? '';
  const icon = item.icon ?? '🎁';
  const isActive = item.is_active ?? 1;
  const weeklyLimit = item.weekly_limit ?? 3;
  const now = Math.floor(Date.now() / 1000);
  d1Exec(
    `INSERT INTO shop_items
       (id, name, kind, cost_coins, reward_value, reward_type, description,
        icon, is_active, sort_order, weekly_limit, created_at, updated_at)
     VALUES (${id}, '${name.replace(/'/g, "''")}', '${kind}', ${cost}, ${rewardValue},
             '${rewardType}', '${description.replace(/'/g, "''")}', '${icon}',
             ${isActive}, 0, ${weeklyLimit}, ${now}, ${now})
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, kind=excluded.kind, cost_coins=excluded.cost_coins,
       reward_value=excluded.reward_value, reward_type=excluded.reward_type,
       description=excluded.description, icon=excluded.icon,
       is_active=excluded.is_active, weekly_limit=excluded.weekly_limit,
       updated_at=excluded.updated_at;`,
  );
  return id;
}

/** Standard 2-item shop seed (RFC §2 + requirements §2 "M3 商品 list 已拍"). */
function seedStandardShop(): { gameTime: number; legos: number } {
  return {
    gameTime: seedShopItem({
      id: 1,
      name: '游戏时间 10 分钟',
      kind: 'game_time',
      cost_coins: 10,
      reward_value: 10,
      reward_type: 'game_time',
      description: '用 10 金币兑换 10 分钟游戏时间',
      icon: '🎮',
      weekly_limit: 3,
    }),
    legos: seedShopItem({
      id: 2,
      name: '小乐高',
      kind: 'custom',
      cost_coins: 50,
      reward_value: 1,
      reward_type: 'none',
      description: '1 个小乐高玩具',
      icon: '🧱',
      weekly_limit: 1,
    }),
  };
}

/**
 * Wipe coin-system tables (not handled by clearAllData in helpers/db.ts).
 * Call BEFORE clearAllData() so task_completions / score_events cascade
 * can still touch shop_redemptions. Actually no — we call this AFTER
 * clearAllData since FKs from shop_redemptions → users / shop_items
 * need the parents to stay around. We just clean the leaf tables.
 */
function clearCoinShop(): void {
  d1Exec('DELETE FROM shop_redemptions; DELETE FROM shop_items;');
}

/**
 * Read a single scalar from score_events / shop_redemptions.
 * sqlite3 returns the value as a string in stdout.
 */
function d1Scalar(sql: string): string {
  return String(d1Exec(sql) ?? '').trim();
}

/** Sum a numeric column from score_events for one user. */
function sumScoreEvents(userId: number, predicate: string): number {
  const v = d1Scalar(
    `SELECT COALESCE(SUM(change_value), 0) FROM score_events
     WHERE user_id=${userId} AND ${predicate}`,
  );
  return Number(v);
}

/** Wait for /api/coins/balance to return 200. Skips test if 404 (M3 not yet shipped). */
async function skipUntilM3Landed(request: APIRequestContext, label: string): Promise<boolean> {
  const r = await request.get('/api/coins/balance');
  if (r.status() === 404) {
    test.skip(true, `M3 not yet shipped — /api/coins/balance 404. Skipping ${label}.`);
    return false;
  }
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// F1: 任务完成 +1 金币
// RFC §7 F1 + Test Plan §2 TC-F1
// ════════════════════════════════════════════════════════════════════════════

test('F1: child completes a task → +1 coin, balance=1, score_events row', async ({ request }) => {
  clearAllData();
  clearCoinShop();
  seedPmUser();
  seedChildUser('Tommy');
  const taskId = seedTask({ name: '刷牙', icon: '🦷', token_reward: 1, target_account: 'pocket_money' });

  const r = await request.post(`/api/me/tasks/${taskId}/complete`);
  expect([200, 201]).toContain(r.status());
  const body = await r.json();
  // RFC §5.1 step 5: response includes coins_balance and bonus_awarded
  expect(body).toHaveProperty('coins_balance', 1);
  expect(body).toHaveProperty('bonus_awarded', false);

  // DB: exactly 1 coin event (+1, approved)
  const coinsApproved = sumScoreEvents(2, `type='coins' AND status='approved'`);
  expect(coinsApproved).toBe(1);

  // DB: the new score_event row
  const ev = d1Scalar(
    `SELECT reason FROM score_events
     WHERE user_id=2 AND type='coins' AND change_value=1
     ORDER BY id DESC LIMIT 1`,
  );
  expect(ev).toBe(`task:#${taskId}`);

  // task_completion row inserted
  const tcId = d1Scalar(
    `SELECT id FROM task_completions WHERE user_id=2 AND task_id=${taskId} ORDER BY id DESC LIMIT 1`,
  );
  expect(Number(tcId)).toBeGreaterThan(0);
});

// ════════════════════════════════════════════════════════════════════════════
// F2: 全任务完成 +3 bonus
// RFC §7 F2 + Test Plan §2 TC-F2
// ════════════════════════════════════════════════════════════════════════════

test('F2: completing the last of N tasks → +1 coin + +3 bonus (atomic)', async ({ request }) => {
  clearAllData();
  clearCoinShop();
  seedPmUser();
  seedChildUser('Tommy');
  const t1 = seedTask({ name: '刷牙', sort_order: 1 });
  const t2 = seedTask({ name: '整理书桌', sort_order: 2 });
  const t3 = seedTask({ name: '阅读 20 分钟', sort_order: 3 });

  // Complete 2/3 first
  await request.post(`/api/me/tasks/${t1}/complete`);
  await request.post(`/api/me/tasks/${t2}/complete`);
  // After 2/3, balance = 2, no bonus
  let coins = sumScoreEvents(2, `type='coins' AND status='approved'`);
  expect(coins).toBe(2);
  const bonusesBefore = d1Scalar(
    `SELECT COUNT(*) FROM score_events WHERE user_id=2 AND type='coins'
     AND change_value=3 AND reason LIKE 'bonus:%'`,
  );
  expect(bonusesBefore).toBe('0');

  // Complete the 3rd → bonus fires
  const r3 = await request.post(`/api/me/tasks/${t3}/complete`);
  expect([200, 201]).toContain(r3.status());
  const body3 = await r3.json();
  expect(body3).toHaveProperty('coins_balance', 5);  // 2 + 1 task + 3 bonus - 1 (the 3rd task itself adds +1)
  expect(body3).toHaveProperty('bonus_awarded', true);

  // DB: 1 new +1 task event + 1 new +3 bonus event
  const coinRows = d1Scalar(
    `SELECT COUNT(*) FROM score_events WHERE user_id=2 AND type='coins' AND change_value=1`,
  );
  expect(Number(coinRows)).toBe(3);
  const bonusRows = d1Scalar(
    `SELECT COUNT(*) FROM score_events WHERE user_id=2 AND type='coins'
     AND change_value=3 AND reason LIKE 'bonus:%' AND status='approved'`,
  );
  expect(Number(bonusRows)).toBe(1);

  // INV-2: same source_ref has at most 1 approved +3 bonus row
  const dupBonus = d1Scalar(
    `SELECT COUNT(*) FROM (
       SELECT source_ref, COUNT(*) c FROM score_events
       WHERE user_id=2 AND type='coins' AND change_value=3
         AND reason LIKE 'bonus:%' AND status='approved'
       GROUP BY source_ref HAVING c > 1
     )`,
  );
  expect(Number(dupBonus)).toBe(0);
});

// ════════════════════════════════════════════════════════════════════════════
// F3: 撤销任务回收 -1 金币
// RFC §7 F3 + Test Plan §2 TC-F3
// ════════════════════════════════════════════════════════════════════════════

test('F3: PM revokes a task completion → -1 coin event, balance restored', async ({ request, page }) => {
  clearAllData();
  clearCoinShop();
  seedPmUser();
  seedChildUser('Tommy');
  const taskId = seedTask({ name: '刷牙' });

  // child completes
  await request.post(`/api/me/tasks/${taskId}/complete`);
  expect(sumScoreEvents(2, `type='coins' AND status='approved'`)).toBe(1);

  // PM logs in, revokes
  await loginAsPm(page.context().request);
  const tcId = d1Scalar(
    `SELECT id FROM task_completions WHERE user_id=2 AND task_id=${taskId}
     ORDER BY id DESC LIMIT 1`,
  );
  const rev = await request.post(`/api/admin/task-completions/${tcId}/revoke`);
  expect([200, 204]).toContain(rev.status());

  // task_completion status → revoked
  const tcStatus = d1Scalar(`SELECT status FROM task_completions WHERE id=${tcId}`);
  expect(tcStatus).toBe('revoked');

  // -1 coin event written
  const negCount = Number(d1Scalar(
    `SELECT COUNT(*) FROM score_events
     WHERE user_id=2 AND type='coins' AND change_value=-1`,
  ));
  expect(negCount).toBeGreaterThanOrEqual(1);

  // balance restored
  const finalBalance = sumScoreEvents(2, `type='coins' AND status='approved'`);
  expect(finalBalance).toBe(0);
});

// ════════════════════════════════════════════════════════════════════════════
// F4: 撤销任务回收 bonus -3（如果 bonus 已发）
// RFC §7 F4 + Test Plan §2 TC-F4
// ════════════════════════════════════════════════════════════════════════════

test('F4: revoke after all-tasks-done → also reverses +3 bonus', async ({ request, page }) => {
  clearAllData();
  clearCoinShop();
  seedPmUser();
  seedChildUser('Tommy');
  const t1 = seedTask({ name: 'a', sort_order: 1 });
  const t2 = seedTask({ name: 'b', sort_order: 2 });
  const t3 = seedTask({ name: 'c', sort_order: 3 });

  // Complete all 3 → bonus fires (F2)
  await request.post(`/api/me/tasks/${t1}/complete`);
  await request.post(`/api/me/tasks/${t2}/complete`);
  await request.post(`/api/me/tasks/${t3}/complete`);
  expect(sumScoreEvents(2, `type='coins' AND status='approved'`)).toBe(6);

  // PM revokes t1
  await loginAsPm(page.context().request);
  const tcId = d1Scalar(
    `SELECT id FROM task_completions WHERE user_id=2 AND task_id=${t1}
     ORDER BY id DESC LIMIT 1`,
  );
  await request.post(`/api/admin/task-completions/${tcId}/revoke`);

  // Now: +1 (t2) +1 (t3) +3 (bonus) -1 (t1 revoke) -3 (bonus revoke) = +1
  const final = sumScoreEvents(2, `type='coins' AND status='approved'`);
  expect(final).toBe(1);

  // -3 bonus revoke event exists
  const neg3 = Number(d1Scalar(
    `SELECT COUNT(*) FROM score_events
     WHERE user_id=2 AND type='coins' AND change_value=-3
     AND reason LIKE 'revoke:bonus:%'`,
  ));
  expect(neg3).toBeGreaterThanOrEqual(1);
});

// ════════════════════════════════════════════════════════════════════════════
// F5: 撤销后重做再发 bonus
// RFC §7 F5 + Test Plan §2 TC-F5
// ════════════════════════════════════════════════════════════════════════════

test('F5: revoke all 3 → redo all 3 → bonus re-issues (idempotent on source_ref)', async ({ request, page }) => {
  clearAllData();
  clearCoinShop();
  seedPmUser();
  seedChildUser('Tommy');
  const t1 = seedTask({ name: 'a', sort_order: 1 });
  const t2 = seedTask({ name: 'b', sort_order: 2 });
  const t3 = seedTask({ name: 'c', sort_order: 3 });

  await request.post(`/api/me/tasks/${t1}/complete`);
  await request.post(`/api/me/tasks/${t2}/complete`);
  await request.post(`/api/me/tasks/${t3}/complete`);

  await loginAsPm(page.context().request);
  // Revoke all 3
  for (const t of [t1, t2, t3]) {
    const tcId = d1Scalar(
      `SELECT id FROM task_completions WHERE user_id=2 AND task_id=${t}
       ORDER BY id DESC LIMIT 1`,
    );
    await request.post(`/api/admin/task-completions/${tcId}/revoke`);
  }
  expect(sumScoreEvents(2, `type='coins' AND status='approved'`)).toBe(0);

  // Redo all 3
  await request.post(`/api/me/tasks/${t1}/complete`);
  await request.post(`/api/me/tasks/${t2}/complete`);
  const r3 = await request.post(`/api/me/tasks/${t3}/complete`);
  expect([200, 201]).toContain(r3.status());
  const body3 = await r3.json();
  expect(body3).toHaveProperty('bonus_awarded', true);

  // Final: +1+1+1+3 = +6 coins (after the +6 -6 revoke, +6 redo)
  expect(sumScoreEvents(2, `type='coins' AND status='approved'`)).toBe(6);

  // INV-2: still at most 1 approved +3 bonus per source_ref
  const dupBonus = Number(d1Scalar(
    `SELECT COUNT(*) FROM (
       SELECT source_ref, COUNT(*) c FROM score_events
       WHERE user_id=2 AND type='coins' AND change_value=3
         AND reason LIKE 'bonus:%' AND status='approved'
       GROUP BY source_ref HAVING c > 1
     )`,
  ));
  expect(dupBonus).toBe(0);
});

// ════════════════════════════════════════════════════════════════════════════
// F6: 兑换扣金币 + 加游戏时间
// RFC §7 F6 + Test Plan §2 TC-F6
// ════════════════════════════════════════════════════════════════════════════

test('F6: POST /api/coins/exchange → -10 coins + +10 game_time + shop_redemption row', async ({ request }) => {
  clearAllData();
  clearCoinShop();
  seedPmUser();
  seedChildUser('Tommy');
  const items = seedStandardShop();

  // Seed 15 coins
  d1Exec(
    `INSERT INTO score_events
       (user_id, type, change_value, reason, status, submitted_by, source, week_of, created_at)
     VALUES (2, 'coins', 15, 'seed', 'approved', 'pm', 'manual', '${currentIsoWeek()}', unixepoch())`,
  );

  const r = await request.post('/api/coins/exchange', { data: { item_id: items.gameTime } });
  expect(r.status()).toBe(200);
  const body = await r.json();
  expect(body).toHaveProperty('redemption_id');
  expect(body).toHaveProperty('item.id', items.gameTime);
  expect(body).toHaveProperty('new_balance.coins', 5);
  expect(body).toHaveProperty('new_balance.game_time', 10);
  expect(body).toHaveProperty('weekly_remaining', 2);

  // DB: 2 new score_events (-10 coins, +10 game_time)
  const coinNeg = Number(d1Scalar(
    `SELECT COUNT(*) FROM score_events
     WHERE user_id=2 AND type='coins' AND change_value=-10
     AND source='exchange' AND status='approved'`,
  ));
  expect(coinNeg).toBe(1);
  const gtPos = Number(d1Scalar(
    `SELECT COUNT(*) FROM score_events
     WHERE user_id=2 AND type='game_time' AND change_value=10
     AND source='exchange' AND status='approved'`,
  ));
  expect(gtPos).toBe(1);

  // DB: shop_redemption row with consumed/approved status (M3 schema discrepancy:
  // requirements doc says 'pending'|'approved', migration 0007 says
  // 'consumed'|'revoked'. The redemption should be in its "done" state,
  // which is 'approved' OR 'consumed' — accept either.)
  const status = d1Scalar(
    `SELECT status FROM shop_redemptions WHERE user_id=2 ORDER BY id DESC LIMIT 1`,
  );
  expect(['approved', 'consumed']).toContain(status);
});

// ════════════════════════════════════════════════════════════════════════════
// F7: 周限额 3 次
// RFC §7 F7 + Test Plan §2 TC-F7
// ════════════════════════════════════════════════════════════════════════════

test('F7: 4th exchange in same week → 429 weekly_limit_reached, no writes', async ({ request }) => {
  clearAllData();
  clearCoinShop();
  seedPmUser();
  seedChildUser('Tommy');
  const items = seedStandardShop();

  // Seed 100 coins (enough for 4 exchanges)
  d1Exec(
    `INSERT INTO score_events
       (user_id, type, change_value, reason, status, submitted_by, source, week_of, created_at)
     VALUES (2, 'coins', 100, 'seed', 'approved', 'pm', 'manual', '${currentIsoWeek()}', unixepoch())`,
  );

  // 3 successful exchanges
  for (let i = 0; i < 3; i++) {
    const r = await request.post('/api/coins/exchange', { data: { item_id: items.gameTime } });
    expect(r.status()).toBe(200);
  }
  const doneCount = Number(d1Scalar(
    `SELECT COUNT(*) FROM shop_redemptions WHERE user_id=2`,
  ));
  expect(doneCount).toBe(3);

  // 4th must fail with 429
  const r4 = await request.post('/api/coins/exchange', { data: { item_id: items.gameTime } });
  expect(r4.status()).toBe(429);
  const body4 = await r4.json();
  expect(body4.error?.code).toBe('weekly_limit_reached');
  expect(body4.error?.details).toMatchObject({ used: 3, limit: 3 });

  // DB: still 3 redemptions (no 4th row, no 4th pair of score_events)
  const finalCount = Number(d1Scalar(
    `SELECT COUNT(*) FROM shop_redemptions WHERE user_id=2`,
  ));
  expect(finalCount).toBe(3);
  const negCoins = Number(d1Scalar(
    `SELECT COUNT(*) FROM score_events
     WHERE user_id=2 AND type='coins' AND change_value=-10 AND source='exchange'`,
  ));
  expect(negCoins).toBe(3);
});

// ════════════════════════════════════════════════════════════════════════════
// F8: 跨周自动重置
// RFC §7 F8 + Test Plan §2 TC-F8
//
// Note: wrangler dev uses server clock. We can't vi.setSystemTime() at
// the wrangler-process level. Instead we backdate the existing
// shop_redemptions.redeemed_at into the previous ISO week so the API
// computes weekly_remaining against the current week (RFC §4.4).
// ════════════════════════════════════════════════════════════════════════════

test('F8: backdated redemptions (prev week) → current-week limit resets', async ({ request }) => {
  clearAllData();
  clearCoinShop();
  seedPmUser();
  seedChildUser('Tommy');
  const items = seedStandardShop();

  d1Exec(
    `INSERT INTO score_events
       (user_id, type, change_value, reason, status, submitted_by, source, week_of, created_at)
     VALUES (2, 'coins', 100, 'seed', 'approved', 'pm', 'manual', '${currentIsoWeek()}', unixepoch())`,
  );

  // Simulate "used 3 in previous week" by direct INSERT with prior week_of
  // (preserves the realistic shape: row exists, count in W24 stays 0)
  const prevWeek = prevIsoWeek();
  d1Exec(
    `INSERT INTO shop_redemptions
       (user_id, item_id, week_of, cost_coins, reward_value, reward_type,
        status, redeemed_at, coin_event_id, reward_event_id, created_at)
     VALUES (2, ${items.gameTime}, '${prevWeek}', 10, 10, 'game_time',
             'consumed', strftime('%s','now')-604800, 1, 2, strftime('%s','now')-604800)`,
  );

  // Balance: GET /api/coins/balance should report weekly_remaining = 3 (not 0)
  const r = await request.get('/api/coins/balance');
  if (r.status() === 404) {
    test.skip(true, 'M3 /api/coins/balance not yet shipped');
  }
  const body = await r.json();
  expect(body).toHaveProperty('weekly_remaining', 3);
  expect(body).toHaveProperty('week_of', currentIsoWeek());
  expect(body).toHaveProperty('coins', 100);

  // A 1st exchange in current week should succeed (limit reset)
  const r1 = await request.post('/api/coins/exchange', { data: { item_id: items.gameTime } });
  expect(r1.status()).toBe(200);
  const body1 = await r1.json();
  expect(body1).toHaveProperty('weekly_remaining', 2);
});

/** Previous ISO week string (e.g. '2026-W24' → '2026-W23'). */
function prevIsoWeek(): string {
  const m = currentIsoWeek().match(/^(\d{4})-W(\d{2})$/);
  if (!m) throw new Error(`Bad current week: ${currentIsoWeek()}`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week === 1) return `${year - 1}-W52`;
  return `${year}-W${String(week - 1).padStart(2, '0')}`;
}

// ════════════════════════════════════════════════════════════════════════════
// F9: 按钮置灰 (余额不足) — UI
// RFC §7 F9 + Test Plan §2 TC-F9
// ════════════════════════════════════════════════════════════════════════════

test('F9: shop page — item card shows disabled "还差 X 金币" button when balance < cost', async ({ page, request }) => {
  clearAllData();
  clearCoinShop();
  seedPmUser();
  seedChildUser('Tommy');
  const items = seedStandardShop();

  // Seed only 5 coins (item costs 10)
  d1Exec(
    `INSERT INTO score_events
       (user_id, type, change_value, reason, status, submitted_by, source, week_of, created_at)
     VALUES (2, 'coins', 5, 'seed', 'approved', 'pm', 'manual', '${currentIsoWeek()}', unixepoch())`,
  );

  if (!(await skipUntilM3Landed(request, 'F9'))) return;

  await page.goto('/shop.html');
  await expect(page.locator(`[data-testid="exchange-btn-${items.gameTime}"]`)).toBeVisible();

  const btn = page.locator(`[data-testid="exchange-btn-${items.gameTime}"]`);
  await expect(btn).toBeDisabled();
  await expect(btn).toContainText(/还差\s*5\s*金币/);

  // computed style sanity (Mecha 风格: 置灰 opacity 0.5, cursor not-allowed)
  const style = await btn.evaluate((el) => {
    const cs = (globalThis as any).getComputedStyle(el);
    return { opacity: cs.opacity, cursor: cs.cursor };
  });
  expect(Number(style.opacity)).toBeLessThan(1);
  expect(['not-allowed', 'default']).toContain(style.cursor);  // browser may report either; either is OK

  // Bypass test: API must still refuse even if button is clicked
  let apiCalled = false;
  page.on('request', (req) => {
    if (req.url().includes('/api/coins/exchange')) apiCalled = true;
  });
  // button is disabled, so click() is a no-op (no network)
  await btn.click({ force: true }).catch(() => {});
  await page.waitForTimeout(200);
  expect(apiCalled).toBe(false);

  // Direct API call confirms server-side guard
  const bypass = await request.post('/api/coins/exchange', { data: { item_id: items.gameTime } });
  expect(bypass.status()).toBe(400);
  const bypassBody = await bypass.json();
  expect(bypassBody.error?.code).toBe('insufficient_coins');
  expect(bypassBody.error?.details).toMatchObject({ need: 10, have: 5 });
});

// ════════════════════════════════════════════════════════════════════════════
// F10: 按钮置灰 (周次数用完) — UI
// RFC §7 F10 + Test Plan §2 TC-F10
// ════════════════════════════════════════════════════════════════════════════

test('F10: shop page — exchange button shows "本周已用 N/M 次" when weekly_limit exhausted', async ({ page, request }) => {
  clearAllData();
  clearCoinShop();
  seedPmUser();
  seedChildUser('Tommy');
  const items = seedStandardShop();

  // Seed 100 coins + 3 redemptions in current week (game_time item)
  d1Exec(
    `INSERT INTO score_events
       (user_id, type, change_value, reason, status, submitted_by, source, week_of, created_at)
     VALUES (2, 'coins', 100, 'seed', 'approved', 'pm', 'manual', '${currentIsoWeek()}', unixepoch())`,
  );
  for (let i = 0; i < 3; i++) {
    await request.post('/api/coins/exchange', { data: { item_id: items.gameTime } });
  }

  if (!(await skipUntilM3Landed(request, 'F10'))) return;

  await page.goto('/shop.html');
  await expect(page.locator(`[data-testid="exchange-btn-${items.gameTime}"]`)).toBeVisible();

  const btn = page.locator(`[data-testid="exchange-btn-${items.gameTime}"]`);
  await expect(btn).toBeDisabled();
  await expect(btn).toContainText(/本周已用\s*3\s*\/\s*3\s*次/);

  await expect(page.locator('[data-testid="weekly-remaining"]')).toContainText(/0\s*\/\s*3/);

  // API-side guard
  const bypass = await request.post('/api/coins/exchange', { data: { item_id: items.gameTime } });
  expect(bypass.status()).toBe(429);
  const bypassBody = await bypass.json();
  expect(bypassBody.error?.code).toBe('weekly_limit_reached');
  expect(bypassBody.error?.details).toMatchObject({ used: 3, limit: 3 });
});

// ════════════════════════════════════════════════════════════════════════════
// F11: 兑换历史展示 — UI
// RFC §7 F11 + Test Plan §2 TC-F11
// ════════════════════════════════════════════════════════════════════════════

test('F11: shop page — redemption history shows entries (this-week + all-time)', async ({ page, request }) => {
  clearAllData();
  clearCoinShop();
  seedPmUser();
  seedChildUser('Tommy');
  const items = seedStandardShop();

  // Seed 100 coins + 2 exchanges in current week + 1 in previous week
  d1Exec(
    `INSERT INTO score_events
       (user_id, type, change_value, reason, status, submitted_by, source, week_of, created_at)
     VALUES (2, 'coins', 100, 'seed', 'approved', 'pm', 'manual', '${currentIsoWeek()}', unixepoch())`,
  );
  await request.post('/api/coins/exchange', { data: { item_id: items.gameTime } });
  await request.post('/api/coins/exchange', { data: { item_id: items.gameTime } });

  // Backdate a 3rd into the previous week
  d1Exec(
    `INSERT INTO shop_redemptions
       (user_id, item_id, week_of, cost_coins, reward_value, reward_type,
        status, redeemed_at, coin_event_id, reward_event_id, created_at)
     VALUES (2, ${items.gameTime}, '${prevIsoWeek()}', 10, 10, 'game_time',
             'consumed', strftime('%s','now')-604800, 1, 2, strftime('%s','now')-604800)`,
  );

  if (!(await skipUntilM3Landed(request, 'F11'))) return;

  await page.goto('/shop.html');

  // "本周兑换历史" → 2 entries
  const weekHist = page.locator('[data-testid="week-history"] [data-testid="history-item"]');
  await expect(weekHist).toHaveCount(2);

  // "历史兑换" → at least 1 (the backdated one) — but the spec allows recent-30
  // filtering, so we accept ≥ 1 (the backdated prev-week row)
  const allHist = page.locator('[data-testid="all-history"] [data-testid="history-item"]');
  const allCount = await allHist.count();
  expect(allCount).toBeGreaterThanOrEqual(1);

  // First (newest) entry shape
  const firstEntry = weekHist.first();
  await expect(firstEntry).toContainText('🎮');                              // icon
  await expect(firstEntry).toContainText('游戏时间 10 分钟');                // name
  await expect(firstEntry).toContainText(/10\s*🪙|10\s*金币/);              // cost
  // Time format: YYYY-MM-DD HH:mm
  const text = await firstEntry.textContent();
  expect(text).toMatch(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/);
});

// ════════════════════════════════════════════════════════════════════════════
// F12: 第 3 个 balance card 显示 + 跳转 — UI
// RFC §7 F12 + Test Plan §2 TC-F12
// ════════════════════════════════════════════════════════════════════════════

test('F12: index.html — 3rd balance card shows coin balance + click navigates to /shop.html', async ({ page, request }) => {
  clearAllData();
  clearCoinShop();
  seedPmUser();
  seedChildUser('Tommy');
  seedStandardShop();

  // Seed 1 coin
  d1Exec(
    `INSERT INTO score_events
       (user_id, type, change_value, reason, status, submitted_by, source, week_of, created_at)
     VALUES (2, 'coins', 1, 'seed', 'approved', 'pm', 'manual', '${currentIsoWeek()}', unixepoch())`,
  );

  await page.goto('/');
  await expect(page.locator('#card-coins')).toBeVisible();

  // 3rd card is the coin card, NOT the fc0604b placeholder
  const coinsCard = page.locator('#card-coins');
  await expect(coinsCard).toBeVisible();
  await expect(coinsCard).not.toHaveClass(/placeholder/);
  await expect(coinsCard).toContainText('金币');
  await expect(coinsCard).toContainText('1');
  // Cursor: pointer (M4 §6.2 follow-up: clickable)
  const cursor = await coinsCard.evaluate((el) => (globalThis as any).getComputedStyle(el).cursor);
  expect(cursor).toBe('pointer');

  // Click → navigate to /shop.html
  await coinsCard.click();
  await page.waitForURL(/\/shop(\.html)?$/, { timeout: 5000 });
  expect(page.url()).toMatch(/\/shop(\.html)?$/);
  await expect(page.locator('#shop-root, [data-testid="shop-items"]').first()).toBeVisible();
});

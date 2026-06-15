// tests/e2e/coin-visual-regression.spec.ts
// M5: Coin System visual regression (per feihao #9 拍板 2026-06-15).
//
// 5 Playwright screenshot baselines at iPad (gen 7) landscape viewport
// (1180×820, set by playwright.config.ts project 'iPad Safari'). On
// first run with --update-snapshots (or no baseline present), Playwright
// captures and saves; subsequent runs diff against the baseline with
// maxDiffPixelRatio: 0.01 (1% pixel-difference tolerance).
//
// Dependency: M3 (API) + M4 (/shop.html page) must be implemented
// first. Baseline capture and run all gate on M3+M4 being merged.
//
// Baseline location: tests/e2e/coin-visual-regression.spec.ts-snapshots/
// Playwright will create the directory on first capture. Commit the
// baseline PNGs alongside the spec.
//
// How to capture (or refresh) baselines:
//   1. Ensure M3+M4 are merged on the working branch.
//   2. Start wrangler dev or let playwright.config.ts webServer start it.
//   3. Run:
//        npx playwright test tests/e2e/coin-visual-regression.spec.ts --update-snapshots
//   4. Visually inspect the captured PNGs in:
//        tests/e2e/coin-visual-regression.spec.ts-snapshots/iPad Safari/
//      (open in image viewer; confirm they look right)
//   5. Commit the baseline PNGs.
//
// Selector contract (must be implemented by M4):
//   - [data-testid="shop-items"]           (root container of the item grid)
//   - [data-testid="shop-item-{id}"]       (one card per item)
//   - [data-testid="exchange-btn-{id}"]     (one button per card)
//   - [data-testid="weekly-remaining"]     (the "本周剩余 N/M" widget)
//   - [data-testid="confirm-modal"]        (the confirm-exchange modal)
//   - [data-testid="toast"]                (the success toast)
//
// Tolerance rationale (maxDiffPixelRatio: 0.01):
//   - 1% of 1180×820 = 9676 pixels (out of ~967k). Tight enough to
//     catch layout/colour regressions; loose enough to absorb the
//     minor anti-alias variance between iPad Safari (Chromium engine
//     in Playwright) rendering runs.
//   - If a baseline update is needed after an intentional UI tweak:
//        npx playwright test tests/e2e/coin-visual-regression.spec.ts --update-snapshots

import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  clearAllData,
  seedPmUser,
  seedChildUser,
  d1Exec,
} from './helpers/db';

// ────────────────────────────────────────────────────────────────────────────
// Helpers (kept local so M5 stays self-contained).
// ────────────────────────────────────────────────────────────────────────────

function clearCoinShop(): void {
  d1Exec('DELETE FROM shop_redemptions; DELETE FROM shop_items;');
}

function seedShopItem(opts: {
  id: number;
  name: string;
  kind: 'game_time' | 'pocket_money' | 'custom';
  cost_coins: number;
  reward_value: number;
  reward_type: 'game_time' | 'pocket_money' | 'none';
  description?: string;
  icon?: string;
  weekly_limit?: number;
  is_active?: 0 | 1;
}): void {
  const description = (opts.description ?? '').replace(/'/g, "''");
  d1Exec(
    `INSERT INTO shop_items
       (id, name, kind, cost_coins, reward_value, reward_type, description, icon,
        is_active, sort_order, weekly_limit, created_at, updated_at)
     VALUES (${opts.id}, '${opts.name}', '${opts.kind}', ${opts.cost_coins},
             ${opts.reward_value}, '${opts.reward_type}', '${description}', '${opts.icon ?? '🎁'}',
             ${opts.is_active ?? 1}, 0, ${opts.weekly_limit ?? 3},
             unixepoch(), unixepoch())`,
  );
}

function seedStandardShop(): void {
  seedShopItem({
    id: 1,
    name: '游戏时间 10 分钟',
    kind: 'game_time',
    cost_coins: 10,
    reward_value: 10,
    reward_type: 'game_time',
    description: '用 10 金币兑换 10 分钟游戏时间',
    icon: '🎮',
    weekly_limit: 3,
  });
  seedShopItem({
    id: 2,
    name: '小乐高',
    kind: 'custom',
    cost_coins: 50,
    reward_value: 1,
    reward_type: 'none',
    description: '1 个小乐高玩具',
    icon: '🧱',
    weekly_limit: 1,
  });
}

function seedCoinBalance(userId: number, coins: number): void {
  d1Exec(
    `INSERT INTO score_events
       (user_id, type, change_value, reason, status, submitted_by, source, created_at)
     VALUES (${userId}, 'coins', ${coins}, 'seed', 'approved', 'pm', 'manual', unixepoch())`,
  );
}

/** Skip the test if the shop page isn't served (M4 not yet shipped). */
async function skipUntilM4Landed(request: APIRequestContext, label: string): Promise<boolean> {
  const r = await request.get('/shop.html');
  if (r.status() >= 400) {
    test.skip(true, `M4 not yet shipped — /shop.html ${r.status()}. Skipping ${label}.`);
    return false;
  }
  return true;
}

/** Skip the test if the items API isn't served (M3 not yet shipped). */
async function skipUntilM3Landed(request: APIRequestContext, label: string): Promise<boolean> {
  const r = await request.get('/api/shop/items');
  if (r.status() === 404) {
    test.skip(true, `M3 not yet shipped — /api/shop/items 404. Skipping ${label}.`);
    return false;
  }
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// Visual #1: 商店页 grid 2 列 (默认状态)
// Baseline: shop-page-default.png
// ════════════════════════════════════════════════════════════════════════════

test('visual: shop page default — 2-column item grid, both items, full balance', async ({ page, request }) => {
  clearAllData();
  clearCoinShop();
  seedPmUser();
  seedChildUser('Tommy');
  seedStandardShop();
  seedCoinBalance(2, 100);

  if (!(await skipUntilM4Landed(request, 'visual#1'))) return;
  if (!(await skipUntilM3Landed(request, 'visual#1'))) return;

  await page.goto('/shop.html');
  // Wait for the item grid to render
  await expect(page.locator('[data-testid="shop-items"]')).toBeVisible();
  await expect(page.locator('[data-testid="shop-item-1"]')).toBeVisible();
  await expect(page.locator('[data-testid="shop-item-2"]')).toBeVisible();

  // Compare full page screenshot against baseline
  await expect(page).toHaveScreenshot('shop-page-default.png', {
    maxDiffPixelRatio: 0.01,
    fullPage: false,
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Visual #2: 兑换 confirm 弹窗
// Baseline: shop-confirm-modal.png
// ════════════════════════════════════════════════════════════════════════════

test('visual: confirm modal — clicking "兑换" opens the confirmation dialog', async ({ page, request }) => {
  clearAllData();
  clearCoinShop();
  seedPmUser();
  seedChildUser('Tommy');
  seedStandardShop();
  seedCoinBalance(2, 100);

  if (!(await skipUntilM4Landed(request, 'visual#2'))) return;
  if (!(await skipUntilM3Landed(request, 'visual#2'))) return;

  await page.goto('/shop.html');
  await expect(page.locator('[data-testid="shop-items"]')).toBeVisible();

  // Click "兑换" on item 1
  await page.locator('[data-testid="exchange-btn-1"]').click();

  // Wait for the confirm modal to appear
  const modal = page.locator('[data-testid="confirm-modal"]');
  await expect(modal).toBeVisible();

  // Screenshot the modal area (Playwright captures the viewport by default;
  // the modal is centered overlay so fullPage would include the dimmed
  // shop below — that's the intended baseline showing the modal context)
  await expect(page).toHaveScreenshot('shop-confirm-modal.png', {
    maxDiffPixelRatio: 0.01,
    fullPage: false,
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Visual #3: 余额不足按钮置灰
// Baseline: shop-insufficient-coins.png
// ════════════════════════════════════════════════════════════════════════════

test('visual: insufficient coins — item 1 button disabled, "还差 X 金币" label', async ({ page, request }) => {
  clearAllData();
  clearCoinShop();
  seedPmUser();
  seedChildUser('Tommy');
  seedStandardShop();
  // Only 5 coins — item 1 costs 10
  seedCoinBalance(2, 5);

  if (!(await skipUntilM4Landed(request, 'visual#3'))) return;
  if (!(await skipUntilM3Landed(request, 'visual#3'))) return;

  await page.goto('/shop.html');
  await expect(page.locator('[data-testid="shop-items"]')).toBeVisible();

  // Item 1 button must be disabled and show the "还差 X 金币" text
  const btn = page.locator('[data-testid="exchange-btn-1"]');
  await expect(btn).toBeDisabled();
  await expect(btn).toContainText(/还差\s*5\s*金币/);

  await expect(page).toHaveScreenshot('shop-insufficient-coins.png', {
    maxDiffPixelRatio: 0.01,
    fullPage: false,
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Visual #4: 周次数用完按钮置灰
// Baseline: shop-weekly-limit-reached.png
// ════════════════════════════════════════════════════════════════════════════

test('visual: weekly limit reached — item 1 button disabled, "本周已用 3/3 次" label', async ({ page, request }) => {
  clearAllData();
  clearCoinShop();
  seedPmUser();
  seedChildUser('Tommy');
  seedStandardShop();
  // 100 coins (plenty) but use the weekly limit
  seedCoinBalance(2, 100);

  if (!(await skipUntilM4Landed(request, 'visual#4'))) return;
  if (!(await skipUntilM3Landed(request, 'visual#4'))) return;

  // Burn 3 exchanges via the API
  for (let i = 0; i < 3; i++) {
    const r = await request.post('/api/coins/exchange', { data: { item_id: 1 } });
    expect(r.status()).toBe(200);
  }

  await page.goto('/shop.html');
  await expect(page.locator('[data-testid="shop-items"]')).toBeVisible();

  // Item 1 button must be disabled and show the "本周已用 3/3" text
  const btn = page.locator('[data-testid="exchange-btn-1"]');
  await expect(btn).toBeDisabled();
  await expect(btn).toContainText(/本周已用\s*3\s*\/\s*3/);

  // Weekly remaining widget shows 0/3
  await expect(page.locator('[data-testid="weekly-remaining"]')).toContainText(/0\s*\/\s*3/);

  await expect(page).toHaveScreenshot('shop-weekly-limit-reached.png', {
    maxDiffPixelRatio: 0.01,
    fullPage: false,
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Visual #5: 兑换成功 toast
// Baseline: shop-redemption-success.png
// ════════════════════════════════════════════════════════════════════════════

test('visual: redemption success — toast "✅ 兑换成功!" appears + balance updated', async ({ page, request }) => {
  clearAllData();
  clearCoinShop();
  seedPmUser();
  seedChildUser('Tommy');
  seedStandardShop();
  seedCoinBalance(2, 100);

  if (!(await skipUntilM4Landed(request, 'visual#5'))) return;
  if (!(await skipUntilM3Landed(request, 'visual#5'))) return;

  await page.goto('/shop.html');
  await expect(page.locator('[data-testid="shop-items"]')).toBeVisible();

  // Click "兑换" on item 1 → confirm modal → confirm
  await page.locator('[data-testid="exchange-btn-1"]').click();
  const modal = page.locator('[data-testid="confirm-modal"]');
  await expect(modal).toBeVisible();
  // The modal must have a "确定" / "确认" / "确认兑换" / similar confirm button.
  // M4 may use any label — try several common ones.
  const confirmBtn = modal.locator(
    'button:has-text("确定"), button:has-text("确认"), button:has-text("兑换"), button:has-text("Yes"), button:has-text("OK")',
  ).first();
  await confirmBtn.click();

  // Wait for the success toast
  const toast = page.locator('[data-testid="toast"]');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText(/兑换成功/);

  // Capture the toast + updated balance card area
  await expect(page).toHaveScreenshot('shop-redemption-success.png', {
    maxDiffPixelRatio: 0.01,
    fullPage: false,
  });
});

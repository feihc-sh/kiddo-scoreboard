// tests/e2e/ui-coin-bag.spec.ts
// Item #013 §5 — 金币袋 milestone modal e2e (跑步打卡到达新点位时触发)。
//
// 被测链路: submitRunning() 读 POST /api/running/records 的 new_points_reached[]
//   → showCoinBagModalQueue() 入队 → pumpCoinBagQueue() 同一时刻只弹 1 个
//   → showCoinBagModal() 填 title/amount + 播 4 段 keyframe 动画
//   → 点「继续跑!」关闭 → onClose → setTimeout(pumpCoinBagQueue, 0) 弹下一个。
// 队列严格串行 (_coinBagShowing latch), 一个关掉才轮到下一个。
//
// 动画 gate (Item #016 §4 UX): 「继续跑!」在打开时是 hidden, 等
// `#coin-bag-amount` 的 animationend (~3.0s) 才显示, 另有 3.5s safety
// fallback。所以这里一律用 Playwright 的 auto-wait (toBeVisible 会轮询到
// 按钮出现), 不用固定 waitForTimeout —— 断言写死 3.5s 会在 CI 慢机上假失败。
//
// 2 个 milestone 全部走 page.route() mock, 不依赖真实掷奖 (rollCoinPrize 的
// 金币数是随机的), 让串行队列的行为可确定复现。

import { test, expect, type Page } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, seedRunningMap } from './helpers/db';

/** window._coinBagQueueState() 的返回结构 (public/app.js:_coinBagQueueState) */
interface CoinBagQueueState {
  queueLength: number;
  showing: boolean;
}

/** 读 app.js 暴露的调试钩子: { queueLength: 待弹数量, showing: 当前是否正弹 }。
 *  tsconfig 没开 dom lib, 所以不能用裸 `window`, 走 globalThis + unknown cast。 */
function queueState(page: Page): Promise<CoinBagQueueState> {
  return page.evaluate(
    () =>
      (globalThis as unknown as { _coinBagQueueState: () => CoinBagQueueState })
        ._coinBagQueueState(),
  );
}

/** mock 的 check-in 响应。两个里程碑一次性到达 (一次跑 22 km 跨过
 *  嘉定新城 8km + 太仓 22km), 正好用来验证串行队列。
 *  cum_km=22 / total_km=95: 别让 r.cum_km >= r.total_km 成立, 否则
 *  submitRunning 会另外拉起 #running-completion-modal 干扰断言。 */
const TWO_MILESTONE_RESPONSE = {
  record_id: 90001,
  child_id: 2,
  map_id: 1,
  km: 22,
  cum_km: 22,
  total_km: 95,
  previous_cum_km: 0,
  new_points_reached: [
    { point_id: 2, name: '嘉定新城', cum_km: 8, awarded_coins: 2 },
    { point_id: 3, name: '太仓', cum_km: 22, awarded_coins: 3 },
  ],
  total_awarded_coins: 5,
};

/** 只拦 POST /api/running/records; GET (loadRunningState 初始化读 cum_km)
 *  和页面其它 API 一律放行到真实 worker。 */
async function mockCheckin(page: Page, body: unknown): Promise<void> {
  await page.route('**/api/running/records*', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

/** 等「继续跑!」真的可点再点 (见文件头动画 gate 说明), 然后关掉当前 modal。 */
async function closeCoinBagModal(page: Page): Promise<void> {
  const closeBtn = page.locator('#coin-bag-close');
  await expect(closeBtn).toBeVisible({ timeout: 8000 });
  await closeBtn.click();
}

/** 走 UI: 🏃 跑步 → 填公里数 → 提交。 */
async function submitCheckin(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('#btn-running').click();
  await expect(page.locator('#running-checkin-modal')).toBeVisible();
  await page.locator('#running-km-input').fill('22');
  await page.locator('#running-checkin-submit').click();
  await expect(page.locator('#running-checkin-modal')).toBeHidden();
}

test.describe('UI: Coin Bag Milestone Modal (Item #013 §5)', () => {
  test.beforeEach(() => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
    seedRunningMap();
  });

  test('SMOKE: check-in 返回里程碑 → 弹金币袋 modal, 动画播完前「继续跑!」不可点', async ({ page }) => {
    await mockCheckin(page, TWO_MILESTONE_RESPONSE);
    await submitCheckin(page);

    const modal = page.locator('#coin-bag-modal');
    await expect(modal).toBeVisible();
    // animate class 是 4 段 keyframe 的唯一开关 (app.css Item #013 §4)。
    await expect(modal).toHaveClass(/coin-bag-modal--animate/);

    // UX gate: 按钮在 showCoinBagModal 里被显式 hidden=true, 要等
    // #coin-bag-amount 的 animationend (~3.0s) 才 reveal。animationend
    // 窗口有 3s, 这里紧跟 modal 可见就查, 抢在 reveal 之前。
    await expect(page.locator('#coin-bag-close')).toBeHidden();

    // 第一个 milestone 的文案
    await expect(page.locator('#coin-bag-title')).toHaveText('🎉 恭喜到达 嘉定新城!');
    await expect(page.locator('#coin-bag-amount')).toHaveText('+2');
    await expect(page.locator('.coin-bag-unit')).toHaveText('枚 金币');

    // 同屏只有一个 modal 在弹, 第二个还排在队列里 (latch 生效)。
    expect(await queueState(page)).toEqual({ queueLength: 1, showing: true });

    // 动画结束后按钮自动出现 (3.0s animationend 或 3.5s safety fallback)。
    await expect(page.locator('#coin-bag-close')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#coin-bag-close')).toHaveText('继续跑!');
  });

  test('HAPPY-1: 2 个里程碑串行弹窗 — 先 嘉定新城 +2, 关掉后才弹 太仓 +3', async ({ page }) => {
    await mockCheckin(page, TWO_MILESTONE_RESPONSE);
    await submitCheckin(page);

    // ---- 第一个: 嘉定新城 +2 ----
    const title = page.locator('#coin-bag-title');
    const amount = page.locator('#coin-bag-amount');
    await expect(title).toHaveText('🎉 恭喜到达 嘉定新城!');
    await expect(amount).toHaveText('+2');
    // 第一个还没关 → 第二个不许出现 (太仓既不在标题也不在金额里)。
    expect(await queueState(page)).toEqual({ queueLength: 1, showing: true });

    // ---- 关掉第一个 ----
    await closeCoinBagModal(page);

    // ---- 第二个: 太仓 +3 (onClose → setTimeout(pumpCoinBagQueue, 0)) ----
    await expect(title).toHaveText('🎉 恭喜到达 太仓!', { timeout: 10000 });
    await expect(amount).toHaveText('+3', { timeout: 10000 });
    // 动画 class 被重挂 (reflow 后 re-add), 第二个的按钮同样从 hidden 起步。
    await expect(page.locator('#coin-bag-close')).toBeHidden();
    // 队列已排空, 但仍处于 showing (latch 还锁着, 等用户关)。
    expect(await queueState(page)).toEqual({ queueLength: 0, showing: true });

    // ---- 关掉第二个 ----
    await closeCoinBagModal(page);

    // 队列彻底走完: modal 隐藏 + latch 释放, 不再弹第三个。
    await expect(page.locator('#coin-bag-modal')).toBeHidden();
    expect(await queueState(page)).toEqual({ queueLength: 0, showing: false });
    // 动画 class 也被摘掉 (下次打开会重新触发 4 段 keyframe)。
    await expect(page.locator('#coin-bag-modal')).not.toHaveClass(/coin-bag-modal--animate/);
  });

  test('EDGE: new_points_reached 为空 → 不弹金币袋 modal', async ({ page }) => {
    await mockCheckin(page, { ...TWO_MILESTONE_RESPONSE, new_points_reached: [], total_awarded_coins: 0 });
    await submitCheckin(page);

    // toast 是 submitRunning 走到分支末尾的同步证据 —— 用它当「流程已跑完」的
    // 锚点, 不需要固定 sleep。
    await expect(page.locator('#toast')).toContainText('累计 22.0 km');
    await expect(page.locator('#coin-bag-modal')).toBeHidden();
    expect(await queueState(page)).toEqual({ queueLength: 0, showing: false });
  });
});
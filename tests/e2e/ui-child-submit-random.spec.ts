// tests/e2e/ui-child-submit-random.spec.ts
// 用户原话 (2026-06-09): "在用户端点击「提交申请」按钮, 随机填完表格后
// 点击提交, 查看用户端显示的 log 是否正确. 有没有多余的条目, 或者是缺少
// 的条目?"
//
// 目的: 模拟 8-10 岁小朋友"随便填 + 提交"的真实操作, 验证:
//   1. 每次提交 = log +1 条 (不多不少)
//   2. 每条内容跟提交的一致 (reason / amount / type / dir / status)
//   3. 多次提交之间 modal 正确 reset (不残留旧值)
//   4. double-click 不会触发 2 个 API call (P1 风险: child submit 没
//      inFlight 防抖, admin 端有, 子端没; race condition 下会创建 2 条)
//
// Random data 模拟"小朋友操作" — type/dir/amount/reason 全部随机,
// reason 加随机 suffix 防同 reason 误判.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser } from './helpers/db';

// ─── Random data pools ────────────────────────────────────────────────
const TYPES = ['game_time', 'pocket_money'] as const;
type AccountType = typeof TYPES[number];
const DIRS = [1, -1] as const;

const REASONS_GT = [
  '主动整理书桌', '写完作业', '练琴30分钟', '读课外书20分钟', '刷牙+洗脸',
  '收拾玩具', '帮妈妈买菜', '复习英语', '跳绳100个', '浇花',
];
const REASONS_PM = [
  '考试90+', '主动洗碗', '帮倒垃圾', '写作业没磨蹭', '叠被子',
  '帮弟弟系鞋带', '垃圾分类', '整理鞋柜', '遛狗15分钟', '帮忙摆餐具',
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randomReason(type: AccountType): string {
  const pool = type === 'game_time' ? REASONS_GT : REASONS_PM;
  return pick(pool);
}
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

// ─── Test cases ───────────────────────────────────────────────────────
test.describe('UI: Child Submit — Random Fill + Log Integrity', () => {
  test.beforeEach(() => {
    clearAllData();
    seedPmUser();
    seedChildUser('Tommy');
  });

  // ─── Case 1: SINGLE random submit → log 恰好 +1 ─────────────────────
  test('SINGLE: 随机填表 + 提交 → log 恰好多 1 条, 字段全部正确', async ({ page }) => {
    await page.goto('/');

    // 初始 log 是空的
    await expect(page.locator('#event-list .event-item')).toHaveCount(0);

    // 随机生成 1 笔
    const type = pick(TYPES);
    const dir = pick(DIRS);
    const amount = randInt(1, 15);
    const reason = randomReason(type) + '-' + randomSuffix();

    // 打开 modal
    await page.locator('#btn-submit').click();
    await expect(page.locator('#submit-modal')).toBeVisible();

    // 填表 + 提交
    await page.locator('#submit-type').selectOption(type);
    if (dir === -1) {
      await page.locator('.seg-btn[data-dir="-1"]').click();
      await expect(page.locator('.seg-btn[data-dir="-1"]')).toHaveClass(/seg-btn-active/);
    } else {
      await expect(page.locator('.seg-btn[data-dir="1"]')).toHaveClass(/seg-btn-active/);
    }
    await page.locator('#submit-amount').fill(String(amount));
    await page.locator('#submit-reason').fill(reason);
    await page.locator('#submit-form button[type="submit"]').click();

    // Modal 关闭
    await expect(page.locator('#submit-modal')).toBeHidden({ timeout: 5000 });

    // 关键断言 1: log 恰好多 1 条 (不多不少)
    const items = page.locator('#event-list .event-item');
    await expect(items).toHaveCount(1, { timeout: 5000 });

    // 关键断言 2: 字段全对
    const newRow = items.first();
    const expectedSign = dir === 1 ? '+' : '-';
    const expectedAmount = `${expectedSign}${amount}`;
    await expect(newRow).toContainText(expectedAmount);
    await expect(newRow).toContainText(reason);
    await expect(newRow).toContainText(type === 'game_time' ? '⚡' : '⚙️');
    await expect(newRow.locator('.event-status')).toHaveText('⏳ 待审');
    await expect(newRow).toHaveClass(/event-status-pending/);
  });

  // ─── Case 2: MULTI 5 random submits → log 恰好 +5 ───────────────────
  test('MULTI: 5 次随机填表 + 提交 → log 恰好多 5 条, 每条字段都正确', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#event-list .event-item')).toHaveCount(0);

    // 5 笔随机数据 (每笔 reason 加唯一 suffix 防同 reason 误判)
    const subs = Array.from({ length: 5 }, () => {
      const type = pick(TYPES);
      return {
        type,
        dir: pick(DIRS),
        amount: randInt(1, 20),
        reason: randomReason(type) + '-' + randomSuffix(),
      };
    });

    for (const s of subs) {
      await page.locator('#btn-submit').click();
      await expect(page.locator('#submit-modal')).toBeVisible();
      await page.locator('#submit-type').selectOption(s.type);
      if (s.dir === -1) await page.locator('.seg-btn[data-dir="-1"]').click();
      await page.locator('#submit-amount').fill(String(s.amount));
      await page.locator('#submit-reason').fill(s.reason);
      await page.locator('#submit-form button[type="submit"]').click();
      await expect(page.locator('#submit-modal')).toBeHidden({ timeout: 5000 });
    }

    // 关键断言 1: log 恰好多 5 条 (不多不少)
    const items = page.locator('#event-list .event-item');
    await expect(items).toHaveCount(5, { timeout: 5000 });

    // 关键断言 2: 5 条全部是 pending
    await expect(page.locator('#event-list .event-item.event-status-pending')).toHaveCount(5);

    // 关键断言 3: 每条内容都跟提交的对得上 (按 reason 找行, 验证 amount/icon)
    for (const s of subs) {
      const expectedSign = s.dir === 1 ? '+' : '-';
      const expectedAmount = `${expectedSign}${s.amount}`;
      const row = page.locator('#event-list .event-item').filter({ hasText: s.reason });
      await expect(row).toBeVisible();
      await expect(row).toContainText(expectedAmount);
      await expect(row).toContainText(s.type === 'game_time' ? '⚡' : '⚙️');
    }
  });

  // ─── Case 3: DOUBLE-CLICK race → 期望只 +1, 实际可能 +2 (P1 风险) ──
  // 子端 submitEvent() 没有 inFlight 防双击 (admin 端有, child 没).
  // 小朋友点 1 次, 实际触发 2 个 POST, log 多 1 条"幽灵 event".
  // 用 page.evaluate 直接派发 2 次 submit event 来确凿模拟 race condition
  // (Promise.all([click, click]) 在 Playwright 内部不一定真并发).
  test('DOUBLE-CLICK RACE: 派发 2 次 form submit event → log 应当只多 1 条 (child submit 无 inFlight)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#event-list .event-item')).toHaveCount(0);

    const type = 'game_time';
    const amount = 5;
    const reason = 'double-click 测试-' + Date.now();

    await page.locator('#btn-submit').click();
    await expect(page.locator('#submit-modal')).toBeVisible();
    await page.locator('#submit-type').selectOption(type);
    await page.locator('#submit-amount').fill(String(amount));
    await page.locator('#submit-reason').fill(reason);

    // 关键: 用 page.evaluate 在浏览器里同步派发 2 次 submit event,
    // 模拟"用户在 await api() 期间快速点 2 次" 的真实 race.
    // 第 1 次 submit 进入 submitEvent 内的 await api() (异步, 让出);
    // 第 2 次 submit 紧接着被派发, submitEvent 又被调用一次 → 2 个 POST.
    await page.evaluate(() => {
      const form = document.querySelector('#submit-form');
      // 第 1 次: 通过 requestSubmit (跟点击 button[type=submit] 等效)
      form.requestSubmit();
      // 第 2 次: 紧接着再 requestSubmit, 模拟 double-click race
      form.requestSubmit();
    });

    // 等 modal 关闭 (closeSubmitModal 在第 1 个 await api() 之后)
    await expect(page.locator('#submit-modal')).toBeHidden({ timeout: 5000 });

    // 等 log 渲染完 (submitEvent 内部: await api + closeSubmitModal + loadEvents().then(renderEvents))
    await page.waitForTimeout(500);

    // 关键断言: 应该只多 1 条 (有 inFlight 防抖).
    // 当前 child submit 没 inFlight, 实际可能多 2 条 → 失败 = 确认 bug.
    const items = page.locator('#event-list .event-item');
    await expect(items).toHaveCount(1, { timeout: 5000 });
  });
});

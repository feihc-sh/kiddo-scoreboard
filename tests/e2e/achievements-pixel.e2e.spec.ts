// tests/e2e/achievements-pixel.e2e.spec.ts
// 像素成就墙 (PIXEL ACHIEVEMENT WALL) e2e 冒烟。
//
// 覆盖 Stage 1-3 的关键路径:
//   SMOKE-1 — 页面加载 → 8 张卡片渲染 (3 组 × 奖项)
//   SMOKE-2 — 点卡片 → 像素详情弹窗打开 (图标 / 档位 / 阶梯列表)
//   SMOKE-3 — 关闭弹窗 (关闭按钮 / Esc / 遮罩点击)
//   SMOKE-4 — 已解锁奖项显示金色框 + 「已获得」, 未解锁显示暗灰 + 提示语
//   SMOKE-5 — 入口: 打卡页「🏅 成就」链接指向像素墙; 墙上有「返回主面板」
//
// 前置: 本地 D1 需已 apply migrations (scripts/clean-test-db.sh 会做)。
// 成就目录 (8 个 seed 奖项) + S1 赛季由 migration 0021 种下 —— 这里只清
// 运行时产生的 award 行, 让「未解锁」断言从已知状态开始。

import { test, expect } from '@playwright/test';
import { clearAchievementData, seedChildUser, d1Exec } from './helpers/db';

/** 种一枚已发放的牌, 让弹窗走「已解锁」分支。 */
function seedAward(achievementId: number, tier: string, seasonId = 1): void {
  const now = Math.floor(Date.now() / 1000);
  d1Exec(
    `INSERT INTO achievement_awards ` +
    `(achievement_id, user_id, tier, season_id, status, granted_by, granted_at) ` +
    `VALUES (${achievementId}, 2, '${tier}', ${seasonId}, 'active', 1, ${now});`
  );
}

test.describe('像素成就墙 (PIXEL ACHIEVEMENT WALL)', () => {
  test.beforeEach(() => {
    clearAchievementData();
    seedChildUser('Tommy');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SMOKE-1: 页面加载 → 8 卡渲染
  // ───────────────────────────────────────────────────────────────────────────
  test('PIXEL-SMOKE-01: 加载成就墙 → 渲染 8 张卡片 + 3 个分组', async ({ page }) => {
    await page.goto('/achievements-pixel');

    // 加载态先出现, 数据回来后墙可见
    await expect(page.locator('.pixel-card').first()).toBeVisible({ timeout: 15_000 });

    // 8 个 seed 奖项 (学习 3 + 生活 2 + 技能 3)
    await expect(page.locator('.pixel-card')).toHaveCount(8);

    // 三个分组横幅 (学习组 / 生活组 / 技能组)
    await expect(page.locator('.group-banner')).toHaveCount(3);
    await expect(page.locator('.group-banner h2')).toHaveText(['学习组', '生活组', '技能组']);

    // 卡片名来自 API (不是演示数据)
    await expect(page.locator('.card-name').first()).toHaveText('语文默写全对');

    // 每张卡片一个像素图标
    await expect(page.locator('.pixel-card .pixel-icon-slot svg')).toHaveCount(8);

    // 总进度条: 0 已解锁
    await expect(page.locator('#overall-num')).toHaveText('0 / 8');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SMOKE-2: 点卡片 → 弹窗打开
  // ───────────────────────────────────────────────────────────────────────────
  test('PIXEL-SMOKE-02: 点卡片 → 像素详情弹窗打开 (图标 / 阶梯 / pip)', async ({ page }) => {
    await page.goto('/achievements-pixel');
    await expect(page.locator('.pixel-card').first()).toBeVisible({ timeout: 15_000 });

    await page.locator('.pixel-card[data-award="1"]').click();

    const modal = page.locator('#detail-modal');
    await expect(modal).toHaveClass(/open/);
    await expect(modal).toHaveAttribute('aria-hidden', 'false');

    // 大图像素图标
    await expect(page.locator('#modal-icon svg')).toHaveCount(1);
    // 名称 / 组名 / 描述
    await expect(page.locator('#modal-title')).toHaveText('语文默写全对');
    await expect(page.locator('#modal-category')).toContainText('学习组');
    await expect(page.locator('#modal-desc')).toHaveText('获得一次语文默写全对');
    // 5 档 pip 行
    await expect(page.locator('#modal-pips .pip')).toHaveCount(5);
    // 各档所需次数列表 (铁 1 / 铜 3 / 银 5 / 金 8 / 王者 10)
    await expect(page.locator('#modal-ladder li')).toHaveCount(5);
    await expect(page.locator('#modal-ladder li').first()).toContainText('累计 1 次');
    await expect(page.locator('#modal-ladder li').last()).toContainText('累计 10 次');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SMOKE-3: 三种关闭方式
  // ───────────────────────────────────────────────────────────────────────────
  test('PIXEL-SMOKE-03: 弹窗可通过关闭按钮 / Esc / 遮罩点击关闭', async ({ page }) => {
    await page.goto('/achievements-pixel');
    await expect(page.locator('.pixel-card').first()).toBeVisible({ timeout: 15_000 });

    const modal = page.locator('#detail-modal');

    // (a) 关闭按钮
    await page.locator('.pixel-card[data-award="1"]').click();
    await expect(modal).toHaveClass(/open/);
    await page.locator('#close-modal-btn').click();
    await expect(modal).not.toHaveClass(/open/);

    // (b) Esc
    await page.locator('.pixel-card[data-award="2"]').click();
    await expect(modal).toHaveClass(/open/);
    await page.keyboard.press('Escape');
    await expect(modal).not.toHaveClass(/open/);

    // (c) 点遮罩 (视口左上角 = 弹窗外的遮罩层)
    await page.locator('.pixel-card[data-award="3"]').click();
    await expect(modal).toHaveClass(/open/);
    await page.mouse.click(5, 5);
    await expect(modal).not.toHaveClass(/open/);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SMOKE-4: 已解锁 / 未解锁 两种视觉态
  // ───────────────────────────────────────────────────────────────────────────
  test('PIXEL-SMOKE-04: 已解锁 → 金色框 + 「已获得」; 未解锁 → 暗灰 + 提示语', async ({ page }) => {
    // 发一枚金牌给「语文默写全对」
    seedAward(1, 'gold');

    await page.goto('/achievements-pixel');
    await expect(page.locator('.pixel-card').first()).toBeVisible({ timeout: 15_000 });

    // 总进度: 1 已解锁
    await expect(page.locator('#overall-num')).toHaveText('1 / 8');
    // 卡片用金牌主题
    await expect(page.locator('.pixel-card[data-award="1"]')).toHaveClass(/tier-gold/);

    // 已解锁奖项的弹窗: 金色框 + 「已获得」+ 金牌徽章
    await page.locator('.pixel-card[data-award="1"]').click();
    await expect(page.locator('#modal-card')).toHaveClass(/unlocked/);
    await expect(page.locator('#modal-status-text')).toHaveText('已获得');
    await expect(page.locator('#modal-tier-badge')).toHaveText('金牌');
    // 铁/铜/银/金 4 档已点亮, 王者档是下一档 (闪烁)
    await expect(page.locator('#modal-pips .pip.reached')).toHaveCount(4);
    await expect(page.locator('#modal-pips .pip.next')).toHaveCount(1);
    await page.locator('#close-modal-btn').click();

    // 未解锁奖项的弹窗: 暗灰 + 提示语
    await page.locator('.pixel-card[data-award="2"]').click();
    await expect(page.locator('#modal-card')).toHaveClass(/locked/);
    await expect(page.locator('#modal-status-text')).toHaveText('未解锁 — 继续努力，小骑士！');
    await expect(page.locator('#modal-tier-badge')).toHaveText('未解锁');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SMOKE-5: 入口与返回
  // ───────────────────────────────────────────────────────────────────────────
  test('PIXEL-SMOKE-05: 打卡页入口指向像素墙, 墙上有「返回主面板」', async ({ page }) => {
    // 打卡页的成就入口
    await page.goto('/');
    await expect(page.locator('#achievements-link')).toHaveAttribute('href', '/achievements-pixel.html');

    // 墙上有返回主面板的链接
    await page.goto('/achievements-pixel');
    await expect(page.locator('#back-link')).toHaveAttribute('href', '/index.html');
    await expect(page.locator('#back-link')).toContainText('返回主面板');
  });
});

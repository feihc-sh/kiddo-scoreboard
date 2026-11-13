// tests/e2e/admin-achievement-panel.spec.ts
// Card 3: PM admin 成就发放面板 e2e (spec docs/achievements-spec.md §9).
//
// 覆盖:
//   SMOKE  — 「🏅 成就发放」section 存在且可见
//   HAPPY-1 — 选 admin_tier 奖项 → 选牌级 → 发放 → toast 成功 → 日志出现该行
//   HAPPY-2 — 对刚发放的记录点撤销 → 二次确认 → 该行变成「已撤销」
//   EDGE-1 — admin_flat 奖项的牌级下拉**只有**「平发」; admin_tier 不含「平发」
//   EDGE-2 — 撤销按钮在已撤销行上不显示
//   EDGE-3 — 切换奖项会重算牌级下拉 (不留上一个奖项的残值)
//
// 前置: 本地 D1 需已 apply migrations (scripts/clean-test-db.sh 会做)。
// 登录流程照抄 admin-task-toggle.spec.ts (page.context().request 登录,
// cookie 落在浏览器 context 上)。

import { test, expect } from '@playwright/test';
import { clearAllData, clearAchievementData, seedPmUser, seedChildUser, d1Exec } from './helpers/db';
import { loginAsPm } from './helpers/auth';

test.describe('Admin 成就发放面板 (spec §9)', () => {
  test.beforeEach(async ({ page }) => {
    clearAllData();
    // The achievements catalog (8 seed awards) + S1 season are seeded by
    // migration 0021 — only the runtime award rows are wiped here.
    clearAchievementData();
    seedPmUser();
    seedChildUser('Tommy');
    // Use page.context().request so the cookie is set on the browser context,
    // not on the separate API-only request fixture.
    await loginAsPm(page.context().request);
    await page.goto('/admin/');
    // The section is collapsed by default → open it.
    await page.locator('#sec-achievements summary').click();
    await page.waitForTimeout(300);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // SMOKE
  // ───────────────────────────────────────────────────────────────────────────
  test('ACHIEVEMENT-SMOKE-01: 「🏅 成就发放」section 存在且可见', async ({ page }) => {
    const section = page.locator('#sec-achievements');
    await expect(section).toBeVisible();
    await expect(section.locator('summary')).toContainText('🏅 成就发放');

    // 发放表单 + 日志表 + 赛季管理都在
    await expect(page.locator('#achievement-grant-form')).toBeVisible();
    // 日志容器是空的 (还没发过牌) → 空 div 高度为 0, 只能断言 attached;
    // 「没有发放记录」空状态才是可见的那个。
    await expect(page.locator('#achievement-awards-list')).toBeAttached();
    await expect(page.locator('#achievement-awards-empty')).toBeVisible();
    await expect(page.locator('#achievement-current-season')).toBeVisible();
  });

  test('ACHIEVEMENT-SMOKE-02: 奖项下拉由 /api/admin/seasons 填充 (8 个 seed 奖项)', async ({ page }) => {
    const options = page.locator('#achievement-select option');
    await expect(options).toHaveCount(8);
    // 平发奖 (admin_flat) 与语文默写全对 (admin_tier) 都在目录里
    await expect(page.locator('#achievement-select')).toContainText('语文默写全对');
    await expect(page.locator('#achievement-select')).toContainText('创新家务奖');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // EDGE-1: 牌级下拉按 grant_mode + ladder 动态生成
  // ───────────────────────────────────────────────────────────────────────────
  test('ACHIEVEMENT-EDGE-01: admin_flat 奖项的牌级下拉只有「平发」', async ({ page }) => {
    // 创新家务奖 (id=5, admin_flat)
    await page.locator('#achievement-select').selectOption('5');
    await page.waitForTimeout(150);

    const opts = page.locator('#achievement-tier-select option');
    await expect(opts).toHaveCount(1);
    await expect(page.locator('#achievement-tier-select')).toHaveValue('flat');
    await expect(page.locator('#achievement-tier-select')).toContainText('平发');
  });

  test('ACHIEVEMENT-EDGE-02: admin_tier 奖项的牌级下拉不含「平发」, 且带 ladder 提示', async ({ page }) => {
    // 语文默写全对 (id=1, admin_tier, ladder 1/3/5/8/10)
    await page.locator('#achievement-select').selectOption('1');
    await page.waitForTimeout(150);

    const opts = page.locator('#achievement-tier-select option');
    await expect(opts).toHaveCount(5);
    await expect(page.locator('#achievement-tier-select')).not.toContainText('平发');
    // ladder 值 = 累计次数提示
    await expect(page.locator('#achievement-tier-select')).toContainText('铁牌 (累计 1 次)');
    await expect(page.locator('#achievement-tier-select')).toContainText('铜牌 (累计 3 次)');
  });

  test('ACHIEVEMENT-EDGE-03: 切换奖项会重算牌级下拉 (不留上一个奖项的残值)', async ({ page }) => {
    // 先选平发奖 → tier = 'flat'
    await page.locator('#achievement-select').selectOption('5');
    await page.waitForTimeout(150);
    await expect(page.locator('#achievement-tier-select')).toHaveValue('flat');

    // 换成 admin_tier 奖项 → 'flat' 必须消失
    await page.locator('#achievement-select').selectOption('1');
    await page.waitForTimeout(150);
    await expect(page.locator('#achievement-tier-select option')).toHaveCount(5);
    await expect(page.locator('#achievement-tier-select')).not.toHaveValue('flat');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // HAPPY-1: 发放
  // ───────────────────────────────────────────────────────────────────────────
  test('ACHIEVEMENT-HAPPY-01: 发放成就牌 → toast 成功 → 日志出现该行', async ({ page }) => {
    await page.locator('#achievement-select').selectOption('1');
    await page.waitForTimeout(150);
    await page.locator('#achievement-tier-select').selectOption('bronze');
    await page.locator('#achievement-grant-form input[name="user_id"]').fill('2');

    await page.locator('#btn-grant-achievement').click();
    await expect(page.locator('#toast')).toContainText('已发放', { timeout: 10_000 });

    // 日志里出现这条记录 (奖项名 + 牌级)
    const row = page.locator('#achievement-awards-list .pm-row').first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('语文默写全对');
    await expect(row).toContainText('铜牌');
    await expect(row).toContainText('✅ 已发放');

    // 后端真的落了库
    const rows = d1Exec(
      "SELECT tier, status FROM achievement_awards WHERE achievement_id = 1 AND user_id = 2 ORDER BY id DESC LIMIT 1;"
    ) as string;
    expect(rows).toContain('bronze');
    expect(rows).toContain('active');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // HAPPY-2: 撤销 (二次确认)
  // ───────────────────────────────────────────────────────────────────────────
  test('ACHIEVEMENT-HAPPY-02: 撤销成就牌 → 二次确认 → 该行变成「已撤销」', async ({ page }) => {
    // 先发一枚
    await page.locator('#achievement-select').selectOption('1');
    await page.waitForTimeout(150);
    await page.locator('#achievement-tier-select').selectOption('gold');
    await page.locator('#btn-grant-achievement').click();
    await expect(page.locator('#toast')).toContainText('已发放', { timeout: 10_000 });

    // 二次确认: 弹窗必须出现, 并明确说明「烧回」代币
    let confirmMessage = '';
    page.once('dialog', async (dialog) => {
      confirmMessage = dialog.message();
      await dialog.accept();
    });
    await page.locator('#achievement-awards-list button[data-act="revoke-achievement"]').first().click();
    await expect(page.locator('#toast')).toContainText('已撤销', { timeout: 10_000 });
    expect(confirmMessage).toContain('烧回');

    // 该行变成「已撤销」
    const row = page.locator('#achievement-awards-list .pm-row').first();
    await expect(row).toContainText('↩️ 已撤销');

    // 后端状态翻转
    const rows = d1Exec(
      "SELECT status FROM achievement_awards WHERE achievement_id = 1 ORDER BY id DESC LIMIT 1;"
    ) as string;
    expect(rows).toContain('revoked');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // EDGE-2: 已撤销行不再显示撤销按钮
  // ───────────────────────────────────────────────────────────────────────────
  test('ACHIEVEMENT-EDGE-04: 撤销按钮在已撤销行上不显示', async ({ page }) => {
    await page.locator('#achievement-select').selectOption('1');
    await page.waitForTimeout(150);
    await page.locator('#achievement-tier-select').selectOption('iron');
    await page.locator('#btn-grant-achievement').click();
    await expect(page.locator('#toast')).toContainText('已发放', { timeout: 10_000 });

    // 撤销它
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#achievement-awards-list button[data-act="revoke-achievement"]').first().click();
    await expect(page.locator('#toast')).toContainText('已撤销', { timeout: 10_000 });

    // 已撤销的行里没有撤销按钮了
    const revokedRow = page.locator('#achievement-awards-list .pm-row', { hasText: '↩️ 已撤销' }).first();
    await expect(revokedRow).toBeVisible();
    await expect(revokedRow.locator('button[data-act="revoke-achievement"]')).toHaveCount(0);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // EDGE-3: 状态筛选 (审计面默认全量)
  // ───────────────────────────────────────────────────────────────────────────
  test('ACHIEVEMENT-EDGE-05: 状态筛选 全部/已发放/已撤销 走 query 参数', async ({ page }) => {
    await page.locator('#achievement-select').selectOption('1');
    await page.waitForTimeout(150);
    await page.locator('#achievement-tier-select').selectOption('silver');
    await page.locator('#btn-grant-achievement').click();
    await expect(page.locator('#toast')).toContainText('已发放', { timeout: 10_000 });

    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#achievement-awards-list button[data-act="revoke-achievement"]').first().click();
    await expect(page.locator('#toast')).toContainText('已撤销', { timeout: 10_000 });

    // 全部 → 1 行 (active + revoked 都在, 审计面不隐藏历史)
    await page.locator('#filter-achievement-status').selectOption('all');
    await page.waitForTimeout(300);
    await expect(page.locator('#achievement-awards-list .pm-row')).toHaveCount(1);

    // active → 0 行 (只剩被撤销的那条)
    await page.locator('#filter-achievement-status').selectOption('active');
    await page.waitForTimeout(300);
    await expect(page.locator('#achievement-awards-list .pm-row')).toHaveCount(0);

    // revoked → 1 行
    await page.locator('#filter-achievement-status').selectOption('revoked');
    await page.waitForTimeout(300);
    await expect(page.locator('#achievement-awards-list .pm-row')).toHaveCount(1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 赛季管理
  // ───────────────────────────────────────────────────────────────────────────
  test('ACHIEVEMENT-SEASON-01: 新建赛季 → 旧的归档, 新的成为当前赛季', async ({ page }) => {
    await page.locator('#achievement-season-form input[name="name"]').fill('S2 · 五年级下学期');
    await page.locator('#achievement-season-form input[name="starts_on"]').fill('2027-02-20');
    await page.locator('#achievement-season-form button[type="submit"]').click();
    await expect(page.locator('#toast')).toContainText('新赛季已创建', { timeout: 10_000 });

    // 当前赛季变成 S2
    await expect(page.locator('#achievement-current-season')).toContainText('S2 · 五年级下学期');
    // 赛季列表 2 条
    await expect(page.locator('#achievement-seasons-list .pm-row')).toHaveCount(2);
  });
});

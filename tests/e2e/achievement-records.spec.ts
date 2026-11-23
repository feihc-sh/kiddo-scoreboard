// tests/e2e/achievement-records.spec.ts
// 成就墙「完成记录」端到端 (spec docs/achievements-spec.md §7c, migration 0022).
//
// 覆盖 PM → 孩子侧的完整闭环:
//   HAPPY-1 — admin 发放时填「完成日期 + 完成内容」→ 后端落库
//   HAPPY-2 — 孩子侧成就详情弹窗显示该记录 (📅 日期 + 内容)
//   HAPPY-3 — 同档重发两次 → 弹窗按「最近的在前」列出两条
//   EDGE-1  — 未解锁的奖项 → 弹窗显示空状态文案
//   EDGE-2  — PM 只填日期不填内容 → 该条显示 '—' (内容位)
//   EDGE-3  — 发放日志行也显示完成详情
//   EDGE-4  — 新奖项「读完一本英文长篇小说」出现在孩子侧成就墙上
//
// 前置: 本地 D1 需已 apply migrations (scripts/clean-test-db.sh 会做,
//   含新的 0022)。

import { test, expect } from '@playwright/test';
import { clearAllData, clearAchievementData, seedPmUser, seedChildUser, d1Exec } from './helpers/db';
import { loginAsPm } from './helpers/auth';

/** 读出数据库里某奖项的完成记录 (按发放顺序)。 */
function readRecords(achievementId: number): Array<{ completed_on: string | null; note: string | null }> {
  const rows = d1Exec(
    `SELECT completed_on, note FROM achievement_awards ` +
    `WHERE achievement_id = ${achievementId} AND user_id = 2 AND status = 'active' ` +
    `ORDER BY id ASC;`,
  ) as string;
  if (!rows.trim()) return [];
  return rows
    .trim()
    .split('\n')
    .map((line) => {
      const [completedOn, note] = line.split('|');
      return { completed_on: completedOn, note };
    });
}

/** 在孩子侧成就墙上打开某个奖项的详情弹窗。 */
async function openKidModal(page: import('@playwright/test').Page, achievementName: string) {
  await page.goto('/achievements.html');
  await expect(page.locator('.zelda-card').first()).toBeVisible({ timeout: 15_000 });
  await page.locator('.zelda-card', { hasText: achievementName }).first().click();
  await expect(page.locator('#detail-modal')).toHaveClass(/open/);
}

test.describe('成就墙完成记录 (spec §7c)', () => {
  test.beforeEach(async ({ page }) => {
    clearAllData();
    // 成就目录 (9 个 seed 奖项, 含 0022 的英文长篇) + S1 赛季由 migration
    // 0021/0022 种下 —— 这里只清运行时产生的 award 行。
    clearAchievementData();
    seedPmUser();
    seedChildUser('Tommy');
    await loginAsPm(page.context().request);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // HAPPY-1: admin 发放时填完成详情
  // ───────────────────────────────────────────────────────────────────────────
  test('RECORDS-HAPPY-01: admin 填完成日期 + 完成内容 → 发放 → 后端落库', async ({ page }) => {
    await page.goto('/admin/');
    await page.locator('#sec-achievements summary').click();
    await page.waitForTimeout(300);

    await page.locator('#achievement-select').selectOption('2'); // 英语默写全对
    await page.waitForTimeout(150);
    await page.locator('#achievement-tier-select').selectOption('bronze');
    await page.locator('#achievement-grant-form input[name="user_id"]').fill('2');
    await page.locator('#achievement-grant-form input[name="completed_on"]').fill('2026-11-21');
    await page
      .locator('#achievement-grant-form input[name="note"]')
      .fill('英语课外班默写全对');

    await page.locator('#btn-grant-achievement').click();
    await expect(page.locator('#toast')).toContainText('已发放', { timeout: 10_000 });

    // 后端真的落了这两个字段。
    const records = readRecords(2);
    expect(records).toHaveLength(1);
    expect(records[0].completed_on).toBe('2026-11-21');
    expect(records[0].note).toBe('英语课外班默写全对');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // HAPPY-2: 孩子侧弹窗显示记录
  // ───────────────────────────────────────────────────────────────────────────
  test('RECORDS-HAPPY-02: 孩子侧成就详情弹窗显示 📅 日期 + 内容', async ({ page }) => {
    // 直接种一条带完成详情的发放记录 (不依赖 admin UI —— 那是 HAPPY-1 的职责)。
    const now = Math.floor(Date.now() / 1000);
    d1Exec(
      `INSERT INTO achievement_awards ` +
      `(achievement_id, user_id, tier, season_id, status, granted_by, granted_at, completed_on, note) ` +
      `VALUES (2, 2, 'bronze', 1, 'active', 1, ${now}, '2026-11-21', '英语课外班默写全对');`,
    );

    await openKidModal(page, '英语默写全对');

    const records = page.locator('#modal-records-list .modal-record');
    await expect(records).toHaveCount(1);
    await expect(records.first()).toContainText('2026-11-21');
    await expect(records.first()).toContainText('英语课外班默写全对');
    // 空状态不显示 (有记录时)。
    await expect(page.locator('#modal-records-empty')).toBeHidden();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // HAPPY-3: 同档重发 → 记录累积, 最近的在前
  // ───────────────────────────────────────────────────────────────────────────
  test('RECORDS-HAPPY-03: 同档重发两次 → 弹窗列出两条, 最近的在前', async ({ page }) => {
    const now = Math.floor(Date.now() / 1000);
    d1Exec(
      `INSERT INTO achievement_awards ` +
      `(achievement_id, user_id, tier, season_id, status, granted_by, granted_at, completed_on, note) ` +
      `VALUES (2, 2, 'bronze', 1, 'active', 1, ${now - 600}, '2026-11-01', '第一次打卡');`,
    );
    d1Exec(
      `INSERT INTO achievement_awards ` +
      `(achievement_id, user_id, tier, season_id, status, granted_by, granted_at, completed_on, note) ` +
      `VALUES (2, 2, 'bronze', 1, 'active', 1, ${now}, '2026-11-21', '第二次打卡');`,
    );

    await openKidModal(page, '英语默写全对');

    const records = page.locator('#modal-records-list .modal-record');
    await expect(records).toHaveCount(2);
    // 最近的在前 —— 第一条是 '第二次打卡'。
    await expect(records.first()).toContainText('第二次打卡');
    await expect(records.first()).toContainText('2026-11-21');
    await expect(records.last()).toContainText('第一次打卡');
    await expect(records.last()).toContainText('2026-11-01');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // EDGE-1: 未解锁 → 空状态文案
  // ───────────────────────────────────────────────────────────────────────────
  test('RECORDS-EDGE-01: 未解锁的奖项 → 弹窗显示空状态文案', async ({ page }) => {
    await openKidModal(page, '测评得优');

    // 记录区在, 但列表是空的, 显示空状态文案。
    await expect(page.locator('#modal-records')).toBeVisible();
    await expect(page.locator('#modal-records-list .modal-record')).toHaveCount(0);
    await expect(page.locator('#modal-records-empty')).toBeVisible();
    await expect(page.locator('#modal-records-empty')).toContainText('还没有记录');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // EDGE-2: 只填日期不填内容 → 内容位显示 '—'
  // ───────────────────────────────────────────────────────────────────────────
  test('RECORDS-EDGE-02: 只记了日期没记内容 → 内容位显示「—」', async ({ page }) => {
    const now = Math.floor(Date.now() / 1000);
    d1Exec(
      `INSERT INTO achievement_awards ` +
      `(achievement_id, user_id, tier, season_id, status, granted_by, granted_at, completed_on, note) ` +
      `VALUES (2, 2, 'bronze', 1, 'active', 1, ${now}, '2026-11-21', NULL);`,
    );

    await openKidModal(page, '英语默写全对');

    const record = page.locator('#modal-records-list .modal-record').first();
    await expect(record).toBeVisible();
    await expect(record).toContainText('2026-11-21');
    // 内容没记 → 显示 '—' (不是空白, 也不是编造的内容)。
    await expect(record.locator('.modal-record-note')).toHaveText('—');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // EDGE-3: 发放日志也显示完成详情
  // ───────────────────────────────────────────────────────────────────────────
  test('RECORDS-EDGE-03: admin 发放日志行显示完成日期 + 内容', async ({ page }) => {
    await page.goto('/admin/');
    await page.locator('#sec-achievements summary').click();
    await page.waitForTimeout(300);

    await page.locator('#achievement-select').selectOption('2');
    await page.waitForTimeout(150);
    await page.locator('#achievement-tier-select').selectOption('bronze');
    await page.locator('#achievement-grant-form input[name="completed_on"]').fill('2026-11-21');
    await page
      .locator('#achievement-grant-form input[name="note"]')
      .fill('英语课外班默写全对');
    await page.locator('#btn-grant-achievement').click();
    await expect(page.locator('#toast')).toContainText('已发放', { timeout: 10_000 });

    const row = page.locator('#achievement-awards-list .pm-row').first();
    await expect(row).toBeVisible();
    await expect(row.locator('.pm-row-note')).toContainText('2026-11-21');
    await expect(row.locator('.pm-row-note')).toContainText('英语课外班默写全对');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // EDGE-4: 新奖项「读完一本英文长篇小说」出现在成就墙上
  // ───────────────────────────────────────────────────────────────────────────
  test('RECORDS-EDGE-04: 新奖项「读完一本英文长篇小说」出现在孩子侧成就墙', async ({ page }) => {
    await page.goto('/achievements.html');
    await expect(page.locator('.zelda-card').first()).toBeVisible({ timeout: 15_000 });

    // 9 个奖项 (8 seed + 英文长篇)。
    await expect(page.locator('.zelda-card')).toHaveCount(9);

    const card = page.locator('.zelda-card', { hasText: '读完一本英文长篇小说' });
    await expect(card).toHaveCount(1);
    // 技能组 —— 中文长篇与英文长篇并列。
    const skillSection = page.locator('#group-skill');
    await expect(skillSection).toContainText('读完一本英文长篇小说');
  });
});

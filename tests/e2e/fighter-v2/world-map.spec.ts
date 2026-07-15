// tests/e2e/fighter-v2/world-map.spec.ts
//
// E2E tests for Fighter V2 world map navigation
// Uses iPad viewport 1024×768 from playwright.config.ts
//
// Tests: Navigate from world map to stage select to combat

import { test, expect, Page } from '@playwright/test';

test.describe('Fighter V2 World Map Navigation', () => {

  test.beforeEach(async ({ page }) => {
    // Clear localStorage before each test to ensure clean state
    await page.goto('/fighter/v2/fighter.html');
    await page.evaluate(() => localStorage.removeItem('fighterV2Bank'));
    await page.reload();
  });

  test('renders world map with 5 nodes', async ({ page }) => {
    // Should see world map view
    await expect(page.locator('#view-world-map')).toBeVisible();
    await expect(page.locator('.world-map__title')).toContainText('世界地图');

    // Should see 5 world nodes
    const nodes = page.locator('.world-node');
    await expect(nodes).toHaveCount(5);
  });

  test('shows correct world names', async ({ page }) => {
    const names = page.locator('.world-node__name');
    await expect(names.nth(0)).toContainText('菌绿森林');
    await expect(names.nth(1)).toContainText('多义虫巢穴');
    await expect(names.nth(2)).toContainText('拼写巨龙洞穴');
    await expect(names.nth(3)).toContainText('法师高塔');
    await expect(names.nth(4)).toContainText('终极城堡');
  });

  test('World 1 is current, Worlds 2-5 are locked on fresh start', async ({ page }) => {
    // World 1 should be current
    await expect(page.locator('.world-node').nth(0)).toHaveClass(/current/);

    // Worlds 2-5 should be locked
    await expect(page.locator('.world-node').nth(1)).toHaveClass(/locked/);
    await expect(page.locator('.world-node').nth(2)).toHaveClass(/locked/);
    await expect(page.locator('.world-node').nth(3)).toHaveClass(/locked/);
    await expect(page.locator('.world-node').nth(4)).toHaveClass(/locked/);
  });

  test('shows 🔒 emoji for locked worlds', async ({ page }) => {
    const icons = page.locator('.world-node__icon');
    // World 1 should have emoji (not locked)
    // Worlds 2-5 should show 🔒
    await expect(icons.nth(1)).toContainText('🔒');
    await expect(icons.nth(2)).toContainText('🔒');
  });

  test('clicking current world navigates to stage select', async ({ page }) => {
    // Click on World 1 (current)
    await page.locator('.world-node').nth(0).click();

    // Should show stage intro view
    await expect(page.locator('#view-stage-intro')).toBeVisible();
    await expect(page.locator('#view-world-map')).not.toBeVisible();

    // Should show World 1 header
    await expect(page.locator('.stage-intro__title')).toContainText('菌绿森林');
  });

  test('stage intro shows 3 stages for World 1', async ({ page }) => {
    // Navigate to stage select
    await page.locator('.world-node').nth(0).click();

    // Should show 3 stage items
    const stageItems = page.locator('.stage-item');
    await expect(stageItems).toHaveCount(3);
  });

  test('stage intro shows correct stage names (1-1, 1-2, 1-3)', async ({ page }) => {
    await page.locator('.world-node').nth(0).click();

    const names = page.locator('.stage-item__name');
    await expect(names.nth(0)).toContainText('1-1');
    await expect(names.nth(1)).toContainText('1-2');
    await expect(names.nth(2)).toContainText('1-3');
  });

  test('stage intro shows start buttons', async ({ page }) => {
    await page.locator('.world-node').nth(0).click();

    const startButtons = page.locator('.stage-item .btn--primary');
    await expect(startButtons).toHaveCount(3);
  });

  test('clicking back button returns to world map', async ({ page }) => {
    // Navigate to stage select
    await page.locator('.world-node').nth(0).click();

    // Click back button
    await page.locator('.back-btn').click();

    // Should be back on world map
    await expect(page.locator('#view-world-map')).toBeVisible();
    await expect(page.locator('#view-stage-intro')).not.toBeVisible();
  });

  test('clicking stage shows combat alert (P2 placeholder)', async ({ page }) => {
    // Set up dialog handler for alert
    let alertShown = false;
    let alertMessage = '';
    page.on('dialog', async (dialog) => {
      alertShown = true;
      alertMessage = dialog.message();
      await dialog.accept();
    });

    await page.locator('.world-node').nth(0).click();
    await page.locator('.stage-item').nth(0).click();

    // Should show alert
    await expect.poll(() => alertShown).toBe(true);
    expect(alertMessage).toContain('P3');
    expect(alertMessage).toContain('1-1');
  });

  test('HUD shows star count', async ({ page }) => {
    // Should show ⭐ and star count in HUD
    await expect(page.locator('.fighter-hud__stars')).toContainText('⭐');
    await expect(page.locator('#hud-stars')).toBeVisible();
  });

  test('star count persists after navigation', async ({ page }) => {
    // Set some stars in localStorage
    await page.evaluate(() => {
      const state = {
        v: 2,
        bank: { stars: 50 },
        session: { stars: 0, worldIdx: 0, stageIdx: 0, currentMonsterIdx: 0 },
        hero: { hp: 100, maxHp: 100, mp: 100, maxMp: 100, atk: 10, def: 0, shieldBuff: 0, shieldBuffRounds: 0, skillCooldowns: { fireball: 0, heal: 0, shield: 0 } },
        equipment: { sword: 'none', shield: 'none', potion: 'none' },
        progress: { worldsCleared: [] },
      };
      localStorage.setItem('fighterV2Bank', JSON.stringify(state));
    });

    await page.reload();

    // Star count should show 50
    await expect(page.locator('#hud-stars')).toContainText('50');
  });

  test('renders with theme colors for World 1', async ({ page }) => {
    // Navigate to stage select for World 1
    await page.locator('.world-node').nth(0).click();

    // Header should have World 1 theme class
    await expect(page.locator('.stage-intro__header--world-0')).toBeVisible();
  });

  test('clicking locked world does not navigate', async ({ page }) => {
    // Try to click on World 2 (locked)
    await page.locator('.world-node').nth(1).click();

    // Should still be on world map
    await expect(page.locator('#view-world-map')).toBeVisible();
    await expect(page.locator('#view-stage-intro')).not.toBeVisible();
  });

  test('renders path connectors between worlds', async ({ page }) => {
    // Should see 4 path connectors
    const paths = page.locator('.world-path');
    await expect(paths).toHaveCount(4);
  });

  test('cleared world shows cleared status', async ({ page }) => {
    // Simulate World 1 cleared
    await page.evaluate(() => {
      const state = {
        v: 2,
        bank: { stars: 0 },
        session: { stars: 0, worldIdx: 1, stageIdx: 0, currentMonsterIdx: 0 },
        hero: { hp: 100, maxHp: 100, mp: 100, maxMp: 100, atk: 10, def: 0, shieldBuff: 0, shieldBuffRounds: 0, skillCooldowns: { fireball: 0, heal: 0, shield: 0 } },
        equipment: { sword: 'none', shield: 'none', potion: 'none' },
        progress: { worldsCleared: [0] }, // World 1 cleared
      };
      localStorage.setItem('fighterV2Bank', JSON.stringify(state));
    });

    await page.reload();

    // World 1 should be cleared
    await expect(page.locator('.world-node').nth(0)).toHaveClass(/cleared/);
    // World 2 should be current
    await expect(page.locator('.world-node').nth(1)).toHaveClass(/current/);
  });

});

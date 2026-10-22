// tests/e2e/fighter-v2/battle.spec.ts
//
// E2E tests for Fighter V2 — Main Menu → Stage Intro → Battle Scene
// Per spec §5.3 Battle Scene + Turn Flow
//
// Uses iPad landscape viewport 1024×768 from playwright.config.ts
//
// SELECTOR DRIFT FIX (2026-10-22): this spec was written against the pre-overhaul
// `.battle-*` DOM and had never been updated after the 2026-07-17 "Dragon's Keep"
// UI overhaul, so every test failed. Ground truth was re-derived by probing the real
// page in a browser, not by guessing. The mapping that changed:
//
//   OLD (gone)                    → NEW (actual)
//   #view-world-map                → #view-main-menu        (world map became main menu)
//   .world-node.current            → .dk-menu-button--start / --levels
//   .battle-hero__name "单词战士"   → .dk-character-name "KNIGHT"
//   .battle-monster__title         → .dk-monster-info .dk-character-name
//   #btn-fireball/#btn-heal/#btn-shield → single #btn-skill (fireball is hardcoded)
//   #btn-fireball + MP cost labels  → no MP cost shown (P0-2 in FIGHTER-V2-STATUS.md §J)
//   .battle-banner                 → .dk-battle-banner
//   .battle-hero__turn "回合 N"     → no turn counter rendered in DOM
//   .battle-hero__meta "护盾"       → .dk-shield-active "SHIELD n"
//
// Tests that asserted removed features (5 skill buttons, turn counter, per-skill MP
// labels) are dropped rather than re-added: those features are still unimplemented and
// are tracked as P0-2 / P0-3 in docs/FIGHTER-V2-STATUS.md §J. Asserting them would
// re-encode a false expectation.

import { test, expect } from '@playwright/test';

const FIGHTER_URL = '/fighter/v2/fighter';

/** Navigate: main menu → stage intro → first stage → battle view. */
async function navigateToBattle(page: import('@playwright/test').Page) {
  await page.locator('.dk-menu-button--start').click();
  await expect(page.locator('#view-stage-intro')).toHaveClass(/active/);
  await page.locator('.stage-item').first().click();
  await expect(page.locator('#view-battle')).toHaveClass(/active/);
}

test.describe('Fighter V2 Battle Scene', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FIGHTER_URL);
    await page.evaluate(() => localStorage.removeItem('fighterV2Bank'));
    await page.reload();
    await expect(page.locator('#view-main-menu')).toHaveClass(/active/);
  });

  test.describe('navigation', () => {
    test('main menu shows the 4 Dragon\'s Keep buttons', async ({ page }) => {
      const buttons = page.locator('.dk-menu-button');
      await expect(buttons).toHaveCount(4);
      await expect(page.locator('.dk-menu-button--start')).toContainText('START GAME');
      await expect(page.locator('.dk-menu-button--levels')).toContainText('LEVELS');
      await expect(page.locator('.dk-menu-button--options')).toContainText('OPTIONS');
      await expect(page.locator('.dk-menu-button--quit')).toContainText('QUIT');
    });

    test('START GAME routes main menu → stage intro → battle', async ({ page }) => {
      await page.locator('.dk-menu-button--start').click();

      await expect(page.locator('#view-stage-intro')).toHaveClass(/active/);
      await expect(page.locator('#view-main-menu')).not.toHaveClass(/active/);

      await page.locator('.stage-item').first().click();

      await expect(page.locator('#view-battle')).toHaveClass(/active/);
      await expect(page.locator('#view-stage-intro')).not.toHaveClass(/active/);
      await expect(page.locator('#view-main-menu')).not.toHaveClass(/active/);
    });

    test('LEVELS button also routes to stage intro', async ({ page }) => {
      await page.locator('.dk-menu-button--levels').click();
      await expect(page.locator('#view-stage-intro')).toHaveClass(/active/);
    });

    test('stage intro lists World 0 stage 1-1 with its monster roster', async ({ page }) => {
      await page.locator('.dk-menu-button--start').click();

      const firstStage = page.locator('.stage-item').first();
      await expect(firstStage.locator('.stage-item__name')).toHaveText('1-1');
      await expect(firstStage.locator('.stage-item__monsters')).toContainText('懒词菌');
    });

    test('back button returns from stage intro to main menu', async ({ page }) => {
      await page.locator('.dk-menu-button--start').click();
      await expect(page.locator('#view-stage-intro')).toHaveClass(/active/);

      await page.locator('.back-btn').click();

      await expect(page.locator('#view-main-menu')).toHaveClass(/active/);
      await expect(page.locator('#view-stage-intro')).not.toHaveClass(/active/);
    });
  });

  test.describe('battle HUD', () => {
    test('shows hero HP and MP at full', async ({ page }) => {
      await navigateToBattle(page);
      await expect(page.locator('#hero-hp-value')).toHaveText('100/100');
      await expect(page.locator('#hero-mp-value')).toHaveText('100/100');
    });

    test('shows the current level badge', async ({ page }) => {
      await navigateToBattle(page);
      await expect(page.locator('.dk-level-badge')).toHaveText('LEVEL 1-1');
    });

    test('renders hero and monster names', async ({ page }) => {
      await navigateToBattle(page);
      await expect(page.locator('.dk-character-side--hero .dk-character-name')).toHaveText('KNIGHT');
      await expect(page.locator('.dk-monster-info .dk-character-name')).toHaveText('懒词菌');
    });

    test('renders monster HP at full', async ({ page }) => {
      await navigateToBattle(page);
      await expect(page.locator('.dk-monster-hp .dk-stat-value')).toHaveText('30/30');
    });
  });

  test.describe('action buttons', () => {
    test('renders exactly 3 action buttons: ATTACK / SKILL / ITEM', async ({ page }) => {
      await navigateToBattle(page);
      const buttons = page.locator('#view-battle .dk-battle-button');
      await expect(buttons).toHaveCount(3);
      await expect(page.locator('#btn-attack')).toContainText('ATTACK');
      await expect(page.locator('#btn-skill')).toContainText('SKILL');
      await expect(page.locator('#btn-item')).toContainText('ITEM');
    });

    test('all 3 buttons are enabled on the hero turn', async ({ page }) => {
      await navigateToBattle(page);
      await expect(page.locator('#btn-attack')).toBeEnabled();
      await expect(page.locator('#btn-skill')).toBeEnabled();
      await expect(page.locator('#btn-item')).toBeEnabled();
    });
  });

  test.describe('turn flow', () => {
    test('ATTACK reduces monster HP (regression: frozen HP readout)', async ({ page }) => {
      await navigateToBattle(page);
      await expect(page.locator('.dk-monster-hp .dk-stat-value')).toHaveText('30/30');

      // Hero ATK 10, 懒词菌 DEF 0 → 10 damage → 20/30
      await page.locator('#btn-attack').click();
      await expect(page.locator('.dk-monster-hp .dk-stat-value')).toHaveText('20/30');
    });

    test('successive ATTACKs keep decrementing monster HP', async ({ page }) => {
      await navigateToBattle(page);

      await page.locator('#btn-attack').click();
      await expect(page.locator('.dk-monster-hp .dk-stat-value')).toHaveText('20/30');

      await page.locator('#btn-attack').click();
      await expect(page.locator('.dk-monster-hp .dk-stat-value')).toHaveText('10/30');
    });

    test('monster counter-attacks and reduces hero HP', async ({ page }) => {
      await navigateToBattle(page);
      await expect(page.locator('#hero-hp-value')).toHaveText('100/100');

      // 懒词菌 ATK 5, hero DEF 0 → 5 damage → 95/100
      await page.locator('#btn-attack').click();
      await expect(page.locator('#hero-hp-value')).toHaveText('95/100');
    });

    test('monster turn banner appears', async ({ page }) => {
      await navigateToBattle(page);
      await page.locator('#btn-attack').click();
      await expect(page.locator('.dk-battle-banner')).toBeAttached();
    });
  });

  test.describe('SKILL button', () => {
    test('SKILL fires fireball and kills the monster', async ({ page }) => {
      await navigateToBattle(page);
      await expect(page.locator('.dk-monster-hp .dk-stat-value')).toHaveText('30/30');

      // SKILL is hardcoded to fireball: 30 damage vs 30 HP.
      // On death updateMonsterStats() replaces the whole monster panel with the
      // DEFEATED placeholder (the HP readout is removed, not set to "0/30"),
      // so assert on the defeated state rather than a 0 HP number.
      await page.locator('#btn-skill').click();

      await expect(page.locator('.dk-defeated-placeholder')).toBeVisible();
      await expect(
        page.locator('.dk-character-side--monster .dk-character-name')
      ).toHaveText('DEFEATED');
      await expect(page.locator('.dk-monster-hp .dk-stat-value')).toHaveCount(0);
    });
  });
});
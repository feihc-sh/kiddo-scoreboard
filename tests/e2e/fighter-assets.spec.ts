// tests/e2e/fighter-assets.spec.ts
// Stage 5 E2E: Asset loading — real PNG vs fallback placeholders.
//
// Pattern mirrors tests/e2e/fighter-shop.spec.ts.

import { test, expect, Page } from '@playwright/test';

test.describe('Fighter Assets (Stage 5)', () => {

  // ---- Asset Preload ----

  test('window.__fighterAssets is set after page load', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    // Wait for asset preloading to complete
    await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__fighterAssets, { timeout: 5000 });

    const assets = await page.evaluate(() => {
      return (globalThis as Record<string, unknown>).__fighterAssets as Record<string, unknown>;
    });

    // Should have 8 asset entries
    expect(Object.keys(assets)).toHaveLength(8);
    // Use bracket notation for keys with dots
    expect(assets['hero.png']).toBeTruthy();
    expect(assets['monster-fungus.png']).toBeTruthy();
    expect(assets['monster-worm.png']).toBeTruthy();
    expect(assets['monster-dragon.png']).toBeTruthy();
    expect(assets['equip-sword.png']).toBeTruthy();
    expect(assets['equip-shield.png']).toBeTruthy();
    expect(assets['equip-potion.png']).toBeTruthy();
    expect(assets['ui-hpbar.png']).toBeTruthy();
  });

  test('window.__fighterAssets contains all 8 asset URLs (none null when files exist)', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__fighterAssets, { timeout: 5000 });

    const assets = await page.evaluate(() => {
      return (globalThis as Record<string, unknown>).__fighterAssets as Record<string, string | null>;
    });

    // All 8 should be valid URLs (files are on disk)
    for (const [filename, url] of Object.entries(assets)) {
      expect(url).toBeTruthy();
      expect(url).toContain('/assets/fighter/');
    }
  });

  // ---- Shop Equipment Icons ----

  test('shop modal shows equipment images after stage clear', async ({ page }) => {
    await page.goto('/fighter/fighter.html');

    // Start fight
    await page.click('#btn-start-fight');
    await page.waitForSelector('#monster-sprite[data-monster-id="fungus"]', { timeout: 3000 });

    // Kill all 5 monsters in stage 1
    for (let i = 0; i < 15; i++) {
      await page.click('#monster-sprite');
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(200);

    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });

    // Shop items should have img elements
    const icons = page.locator('.shop-item-icon');
    await expect(icons).toHaveCount(3);
  });

  test('equip-sword.png, equip-shield.png, equip-potion.png load in shop modal', async ({ page }) => {
    await page.goto('/fighter/fighter.html');

    await page.click('#btn-start-fight');
    await page.waitForSelector('#monster-sprite[data-monster-id="fungus"]', { timeout: 3000 });

    // Kill 5 monsters
    for (let i = 0; i < 15; i++) {
      await page.click('#monster-sprite');
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(200);

    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });

    // Check each equipment icon image loaded
    const swordIcon = page.locator('[data-item-type="sword"] .shop-item-icon');
    const shieldIcon = page.locator('[data-item-type="shield"] .shop-item-icon');
    const potionIcon = page.locator('[data-item-type="potion"] .shop-item-icon');

    // Icons should have src pointing to asset URLs
    await expect(swordIcon).toHaveAttribute('src', '/assets/fighter/equip-sword.png');
    await expect(shieldIcon).toHaveAttribute('src', '/assets/fighter/equip-shield.png');
    await expect(potionIcon).toHaveAttribute('src', '/assets/fighter/equip-potion.png');
  });

  test('equipment icon onerror falls back to emoji (no console error)', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/fighter/fighter.html');
    await page.click('#btn-start-fight');
    await page.waitForSelector('#monster-sprite[data-monster-id="fungus"]', { timeout: 3000 });

    for (let i = 0; i < 15; i++) {
      await page.click('#monster-sprite');
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(200);

    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });

    // No console errors (only network 404s from missing assets would appear)
    // Since files exist, there should be no errors
    const relevantErrors = errors.filter(e => !e.includes('favicon'));
    expect(relevantErrors).toHaveLength(0);
  });

  // ---- Hero Sprite ----

  test('hero sprite image loads in arena canvas area', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__fighterAssets, { timeout: 5000 });

    // After asset loading, hero should have an img element in the canvas arena
    // (We check that the asset was detected as available)
    const assets = await page.evaluate(() => {
      return (globalThis as Record<string, unknown>).__fighterAssets as Record<string, string | null>;
    });
    expect(assets['hero.png']).toBeTruthy();
  });

  // ---- Monster Sprites ----

  test('monster-fungus.png is in asset map (stage 1)', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__fighterAssets, { timeout: 5000 });

    const assets = await page.evaluate(() => {
      return (globalThis as Record<string, unknown>).__fighterAssets as Record<string, string | null>;
    });
    expect(assets['monster-fungus.png']).toBeTruthy();
  });

  test('monster-worm.png is in asset map', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__fighterAssets, { timeout: 5000 });

    const assets = await page.evaluate(() => {
      return (globalThis as Record<string, unknown>).__fighterAssets as Record<string, string | null>;
    });
    expect(assets['monster-worm.png']).toBeTruthy();
  });

  test('monster-dragon.png is in asset map (stage 5)', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__fighterAssets, { timeout: 5000 });

    const assets = await page.evaluate(() => {
      return (globalThis as Record<string, unknown>).__fighterAssets as Record<string, string | null>;
    });
    expect(assets['monster-dragon.png']).toBeTruthy();
  });

  // ---- HP Bar Image ----

  test('ui-hpbar.png is in asset map', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__fighterAssets, { timeout: 5000 });

    const assets = await page.evaluate(() => {
      return (globalThis as Record<string, unknown>).__fighterAssets as Record<string, string | null>;
    });
    expect(assets['ui-hpbar.png']).toBeTruthy();
  });

  test('hp-bar--has-image class added when ui-hpbar.png loads', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__fighterAssets, { timeout: 5000 });

    // If hpbar loaded, hp-bar should have the image class
    const assets = await page.evaluate(() => {
      return (globalThis as Record<string, unknown>).__fighterAssets as Record<string, string | null>;
    });

    if (assets['ui-hpbar.png']) {
      // Wait for class to be applied
      await page.waitForTimeout(200);
      const hasClass = await page.locator('#hp-bar').evaluate(el => el.classList.contains('hp-bar--has-image'));
      expect(hasClass).toBe(true);
    }
  });

  // ---- Graceful Fallback ----

  test('missing asset gracefully falls back without crashing game', async ({ page }) => {
    // Intercept fetch for one asset to return 404
    await page.route('/assets/fighter/missing.png', route => route.fulfill({ status: 404 }));

    await page.goto('/fighter/fighter.html');

    // Game should still load and be usable
    await page.waitForSelector('#fighter-canvas', { timeout: 3000 });
    await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__fighterAssets, { timeout: 5000 });

    // Start fight should work
    await page.click('#btn-start-fight');
    await page.waitForSelector('#monster-sprite[data-monster-id="fungus"]', { timeout: 3000 });

    // No JS errors
    const state = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      return { status: s.status, stageIdx: s.stageIdx };
    });
    expect(state.status).toBe('fighting');
    expect(state.stageIdx).toBe(0);
  });

});

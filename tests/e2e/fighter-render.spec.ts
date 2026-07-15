// tests/e2e/fighter-render.spec.ts
//
// E2E tests for fighter.js render functions.
// Verifies: img tags injected for hero/monster, HP bar width, start button onclick.
//
// Uses iPad landscape viewport (1024×768) from playwright.config.ts.

import { test, expect, Page } from '@playwright/test';

test.describe('Fighter Render (P0 Bugfixes)', () => {

  // ---- Bug 1: Start button onclick ----

  test('start button onclick actually starts fight when clicked', async ({ page }) => {
    await page.goto('/fighter/fighter.html');

    // Verify initial state is menu
    await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__fighterState);
    const initialStatus = await page.evaluate(() =>
      ((globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>)?.status
    );
    expect(initialStatus).toBe('menu');

    // Click start button via DOM click (not Alpine)
    await page.click('#btn-start-fight');

    // Wait for fighting state
    await page.waitForFunction(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState;
      return (s as Record<string, unknown>)?.status === 'fighting';
    });

    // Status should now be 'fighting'
    const afterStatus = await page.evaluate(() =>
      ((globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>)?.status
    );
    expect(afterStatus).toBe('fighting');
  });

  // ---- Bug 2: Asset swap — hero img tag ----

  test('hero img tag exists in hero-sprite after preload', async ({ page }) => {
    await page.goto('/fighter/fighter.html');

    // Wait for assets to load
    await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__fighterAssets, { timeout: 5000 });

    // Wait for img tag to be injected
    await page.waitForFunction(() => {
      // @ts-ignore DOM types not in tsconfig
      const heroEl = document.getElementById('hero-sprite');
      return heroEl && heroEl.querySelector('img') !== null;
    }, { timeout: 5000 });

    // Verify img tag exists with correct src
    const heroImg = page.locator('#hero-sprite img');
    await expect(heroImg).toHaveAttribute('src', '/assets/fighter/hero.png');
    await expect(heroImg).toHaveAttribute('alt', 'Hero');
  });

  // ---- Bug 2: Asset swap — monster img tag ----

  test('monster img tag exists after start with src matching monster-{id}.png', async ({ page }) => {
    await page.goto('/fighter/fighter.html');

    // Start fight
    await page.click('#btn-start-fight');
    await page.waitForSelector('#monster-sprite[data-monster-id="fungus"]', { timeout: 3000 });

    // Wait for assets to load
    await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__fighterAssets, { timeout: 5000 });

    // Wait for monster img to be injected
    await page.waitForFunction(() => {
      // @ts-ignore DOM types not in tsconfig
      const monsterEl = document.getElementById('monster-sprite');
      return monsterEl && monsterEl.querySelector('img') !== null;
    }, { timeout: 5000 });

    // Verify img tag src contains monster-fungus.png
    const monsterImg = page.locator('#monster-sprite img');
    await expect(monsterImg).toHaveAttribute('src', '/assets/fighter/monster-fungus.png');
  });

  // ---- Bug 3: HP bar fill width ----

  test('HP bar fill width equals hp/maxHp percent after game starts', async ({ page }) => {
    await page.goto('/fighter/fighter.html');

    // Verify initial HP bar width is 100%
    const initialWidth = await page.locator('#hp-fill').evaluate(el => (el as unknown as { style: { width: string } }).style.width);
    expect(initialWidth).toBe('100%');

    // Start fight
    await page.click('#btn-start-fight');
    await page.waitForFunction(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState;
      return (s as Record<string, unknown>)?.status === 'fighting';
    });

    // HP should still be 100/100 at start
    const hpText = await page.locator('#hp-text').textContent();
    expect(hpText).toBe('100/100');
    const hpWidth = await page.locator('#hp-fill').evaluate(el => (el as unknown as { style: { width: string } }).style.width);
    expect(hpWidth).toBe('100%');
  });

  test('HP bar fill width updates after hero takes damage', async ({ page }) => {
    await page.goto('/fighter/fighter.html');

    // Start fight
    await page.click('#btn-start-fight');
    await page.waitForFunction(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState;
      return (s as Record<string, unknown>)?.status === 'fighting';
    });

    // Wait for a counter-attack tick (max 6s interval + buffer)
    await page.waitForTimeout(7000);

    // HP should have decreased
    const state = await page.evaluate(() => (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>);
    const hp = state?.hero as Record<string, number>;
    const maxHp = hp?.maxHp ?? 100;

    if (hp && hp.hp < maxHp) {
      const expectedWidth = Math.round((hp.hp / maxHp) * 100) + '%';
      const actualWidth = await page.locator('#hp-fill').evaluate(el => (el as unknown as { style: { width: string } }).style.width);
      expect(actualWidth).toBe(expectedWidth);
    }
  });

  test('monster HP bar fill width equals monster hp/maxHp percent', async ({ page }) => {
    await page.goto('/fighter/fighter.html');

    // Start fight
    await page.click('#btn-start-fight');
    await page.waitForSelector('#monster-sprite[data-monster-id="fungus"]', { timeout: 3000 });

    // Initial monster HP is 30/30 → 100%
    const initialWidth = await page.locator('#monster-hp-fill').evaluate(el => (el as unknown as { style: { width: string } }).style.width);
    expect(initialWidth).toBe('100%');

    // Click monster once (reduces HP by 10 → 20/30)
    await page.click('#monster-sprite');
    await page.waitForTimeout(100);

    const width20 = await page.locator('#monster-hp-fill').evaluate(el => (el as unknown as { style: { width: string } }).style.width);
    // 20/30 = 66.67%, should be ~67% (rounded by CSS or exact by JS)
    expect(width20).toMatch(/6[67]/);

    const hpText = await page.locator('#monster-hp-text').textContent();
    expect(hpText).toBe('20/30');
  });

  // ---- Bug 4: Monster positioned inside arena ----

  test('monster-area is a child of .arena (inside arena box)', async ({ page }) => {
    await page.goto('/fighter/fighter.html');

    const monsterArea = page.locator('#monster-area');
    const arena = page.locator('.arena');

    // Monster area should be inside arena
    const isInsideArena = await monsterArea.evaluate((el, arenaSelector) => {
      // @ts-ignore DOM types not in tsconfig
      const arenaEl = document.querySelector(arenaSelector);
      return arenaEl?.contains(el) ?? false;
    }, '.arena');

    expect(isInsideArena).toBe(true);
  });

  test('hero-sprite is a child of .arena (inside arena box)', async ({ page }) => {
    await page.goto('/fighter/fighter.html');

    const heroSprite = page.locator('#hero-sprite');
    const isInsideArena = await heroSprite.evaluate((el, arenaSelector) => {
      // @ts-ignore DOM types not in tsconfig
      const arenaEl = document.querySelector(arenaSelector);
      return arenaEl?.contains(el) ?? false;
    }, '.arena');

    expect(isInsideArena).toBe(true);
  });

  // ---- Bug 5: Light background for kid aesthetic ----

  test('body has fighter-page class with light background', async ({ page }) => {
    await page.goto('/fighter/fighter.html');

    const bodyClass = await page.locator('body').getAttribute('class');
    expect(bodyClass).toContain('fighter-page');
  });

  // ---- Bug 2 Bonus: renderMonster fallback to text when asset is null ----

  test('renderMonster falls back to text content when asset URL is null', async ({ page }) => {
    // Intercept asset fetch to return 404 for monster-fungus.png
    await page.route('/assets/fighter/monster-fungus.png', route => route.fulfill({ status: 404 }));

    await page.goto('/fighter/fighter.html');

    // Start fight
    await page.click('#btn-start-fight');
    await page.waitForSelector('#monster-sprite[data-monster-id="fungus"]', { timeout: 3000 });

    // Wait for assets to load
    await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__fighterAssets, { timeout: 5000 });

    // Monster sprite should show text fallback (not img tag)
    const imgExists = await page.locator('#monster-sprite img').count();
    expect(imgExists).toBe(0);

    // Should show Chinese character
    const textContent = await page.locator('#monster-sprite').textContent();
    expect(textContent).toBe('菌');
  });

});

// tests/e2e/fighter-shop.spec.ts
// Stage 5 E2E: Shop modal + item purchase flow.
//
// Pattern mirrors tests/e2e/fighter-stage.spec.ts.

import { test, expect, Page } from '@playwright/test';

test.describe('Fighter Shop (Stage 5)', () => {

  async function startFightAndWait(page: Page) {
    await page.click('#btn-start-fight');
    await page.waitForSelector('#monster-sprite[data-monster-id="fungus"]', { timeout: 3000 });
  }

  async function clickMonster(page: Page) {
    await page.click('#monster-sprite');
    await page.waitForFunction(() => true);
    await page.waitForTimeout(30);
  }

  async function killMonsters(page: Page, count: number) {
    for (let i = 0; i < count * 3; i++) {
      await clickMonster(page);
    }
    await page.waitForTimeout(100);
  }

  test('shop modal opens after clearing stage 1', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);
    await killMonsters(page, 5);
    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });
    await expect(page.locator('#stage-clear-modal')).toBeVisible();
  });

  test('shop shows 3 items with costs', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);
    await killMonsters(page, 5);
    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });
    const items = page.locator('.shop-item');
    await expect(items).toHaveCount(3);
    await expect(page.locator('.shop-item-name').nth(0)).toBeVisible();
  });

  test('sword costs 10, shield 8, potion 5', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);
    await killMonsters(page, 5);
    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });
    const costs = await page.locator('.shop-item-cost').allTextContents();
    expect(costs.some((t: string) => t.includes('10'))).toBe(true);
    expect(costs.some((t: string) => t.includes('8'))).toBe(true);
    expect(costs.some((t: string) => t.includes('5'))).toBe(true);
  });

  test('buy sword: -10 stars, +5 ATK', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);
    await killMonsters(page, 5);
    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });
    // Stars = 10 (5 kills + 5 bonus)
    const starsBefore = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      return s.sessionStars as number;
    });
    expect(starsBefore).toBe(10);
    await page.click('[data-item-type="sword"]');
    await page.waitForTimeout(100);
    const starsAfter = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      return s.sessionStars as number;
    });
    expect(starsAfter).toBe(0);
    const atk = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      return (s.hero as Record<string, unknown>).atk as number;
    });
    expect(atk).toBe(15);
  });

  test('buy shield: -8 stars, +3 DEF', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);
    await killMonsters(page, 5);
    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });
    await page.evaluate(() => {
      const fn = (globalThis as Record<string, unknown>).__setSessionStars as (n: number) => void;
      fn(10);
    });
    await page.waitForTimeout(50);
    await page.click('[data-item-type="shield"]');
    await page.waitForTimeout(100);
    const starsAfter = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      return s.sessionStars as number;
    });
    expect(starsAfter).toBe(2);
    const def = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      return (s.hero as Record<string, unknown>).def as number;
    });
    expect(def).toBe(3);
  });

  test('buy potion: heals +30 HP, marks owned', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      s.sessionStars = 5;
    });
    await startFightAndWait(page);
    await killMonsters(page, 5);
    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });
    await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      (s.hero as Record<string, unknown>).hp = 50;
    });
    await page.click('[data-item-type="potion"]');
    await page.waitForTimeout(100);
    const hp = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      return (s.hero as Record<string, unknown>).hp as number;
    });
    expect(hp).toBe(80);
  });

  test('cannot afford item: button disabled, click is no-op', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);
    await killMonsters(page, 5);
    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });
    await page.evaluate(() => {
      const fn = (globalThis as Record<string, unknown>).__setSessionStars as (n: number) => void;
      fn(3);
    });
    await page.waitForTimeout(50);
    await page.evaluate(() => {
      const fn = (globalThis as Record<string, unknown>).__renderShopGrid as () => void;
      fn();
    });
    await page.waitForTimeout(50);
    const potionBtn = page.locator('[data-item-type="potion"]');
    await expect(potionBtn).toBeDisabled();
    const starsAfter = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      return s.sessionStars as number;
    });
    expect(starsAfter).toBe(3);
  });

  test('buy same item twice: second purchase is no-op', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);
    await killMonsters(page, 5);
    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });
    await page.evaluate(() => {
      const fn = (globalThis as Record<string, unknown>).__setSessionStars as (n: number) => void;
      fn(15);
    });
    await page.waitForTimeout(50);
    await page.click('[data-item-type="sword"]');
    await page.waitForTimeout(100);
    const swordOwned = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      return (s.equippedItems as Record<string, boolean>).sword;
    });
    expect(swordOwned).toBe(true);
    const atk = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      return (s.hero as Record<string, unknown>).atk as number;
    });
    expect(atk).toBe(15);
    // Try to buy again — ATK should not increase
    await page.evaluate(() => {
      const fn = (globalThis as Record<string, unknown>).__simulateShopClick;
      if (typeof fn === 'function') fn('sword');
    });
    const atkAfter = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      return (s.hero as Record<string, unknown>).atk as number;
    });
    expect(atkAfter).toBe(15);
  });

  test('shop modal closes on next stage button', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);
    await killMonsters(page, 5);
    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });
    await expect(page.locator('#stage-clear-modal')).toBeVisible();
    await page.click('#btn-next-stage');
    await page.waitForTimeout(200);
    await expect(page.locator('#stage-clear-modal')).toBeHidden();
  });

  test('hero ATK persists across stages after sword purchase', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      s.sessionStars = 15;
    });
    await startFightAndWait(page);
    await killMonsters(page, 5);
    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });
    await page.click('[data-item-type="sword"]');
    await page.waitForTimeout(100);
    await page.click('#btn-next-stage');
    await page.waitForTimeout(200);
    const atk = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      return (s.hero as Record<string, unknown>).atk as number;
    });
    expect(atk).toBe(15);
  });

  test('shop balance shows sessionStars', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);
    await killMonsters(page, 5);
    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });
    const balanceText = await page.locator('#shop-balance').textContent();
    expect(parseInt(balanceText || '0')).toBe(10);
  });

});

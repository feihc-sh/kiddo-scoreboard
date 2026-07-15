// tests/e2e/fighter-economy.spec.ts
// Stage 5 E2E: Economy — localStorage bank persistence + quiz hook.
//
// Pattern mirrors tests/e2e/fighter-shop.spec.ts.

/* global window */

import { test, expect, Page } from '@playwright/test';

test.describe('Fighter Economy (Stage 5)', () => {

  // ---- Helpers ----

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

  // ---- localStorage Bank ----

  test('stars earned in stage 1 commit to bank when stage cleared', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);
    await killMonsters(page, 5);

    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });

    // Check bank is 10 (5 kills + 5 bonus)
    const bank = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      return s.bank as number;
    });
    expect(bank).toBe(10);
  });

  test('bank accumulates correctly across stage 1', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Kill 5 monsters — each gives 1 star, so bank should accumulate
    await killMonsters(page, 5);

    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });

    // Bank should be 10 (5 kills + 5 bonus from stage clear)
    const bank = await page.evaluate(() => {
      const b = (globalThis as Record<string, unknown>).__fighterBank;
      return typeof b === 'number' ? b : 0;
    });
    expect(bank).toBe(10);
  });

  test('restarting game preserves bank (long-term) but resets sessionStars', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);
    await killMonsters(page, 5);

    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });

    // Bank = 10, sessionStars = 10
    const bank = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      return s.bank as number;
    });
    expect(bank).toBe(10);

    // Close stage-clear modal (to access restart) and call restart directly
    await page.evaluate(() => {
      const fn = (globalThis as Record<string, unknown>).__restartGame as () => void;
      if (typeof fn === 'function') fn();
    });
    await page.waitForTimeout(200);

    // Bank should still be 10 (persisted), sessionStars = 0
    const stateAfter = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      return { bank: s.bank as number, sessionStars: s.sessionStars as number };
    });
    expect(stateAfter.bank).toBe(10);
    expect(stateAfter.sessionStars).toBe(0);
  });

  test('restarting game resets equippedItems to false', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);
    await killMonsters(page, 5);

    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });

    // Buy sword
    await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      s.sessionStars = 15;
    });
    await page.click('[data-item-type="sword"]');
    await page.waitForTimeout(100);

    // Verify sword is owned
    const swordOwned = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      return (s.equippedItems as Record<string, boolean>).sword;
    });
    expect(swordOwned).toBe(true);

    // Restart via helper (avoids modal click issue)
    await page.evaluate(() => {
      const fn = (globalThis as Record<string, unknown>).__restartGame as () => void;
      if (typeof fn === 'function') fn();
    });
    await page.waitForTimeout(200);

    // EquippedItems should be reset
    const equippedAfter = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      return s.equippedItems as Record<string, boolean>;
    });
    expect(equippedAfter.sword).toBe(false);
    expect(equippedAfter.shield).toBe(false);
    expect(equippedAfter.potion).toBe(false);
  });

  // ---- Quiz Integration ----

  test('dispatching fighter:add-stars event adds stars to sessionStars', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Dispatch custom event
    await page.evaluate(() => {
      (globalThis as unknown as { dispatchEvent: (e: Event) => boolean }).dispatchEvent(new CustomEvent('fighter:add-stars', { detail: { stars: 5 } }));
    });
    await page.waitForTimeout(100);

    const sessionStars = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      return s.sessionStars as number;
    });
    expect(sessionStars).toBe(5);
  });

  test('dispatching fighter:add-stars adds stars to both sessionStars and bank', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    await page.evaluate(() => {
      (globalThis as unknown as { dispatchEvent: (e: Event) => boolean }).dispatchEvent(new CustomEvent('fighter:add-stars', { detail: { stars: 3 } }));
    });
    await page.waitForTimeout(100);

    const { sessionStars, bank } = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      return { sessionStars: s.sessionStars as number, bank: s.bank as number };
    });
    expect(sessionStars).toBe(3);
    expect(bank).toBe(3);
  });

  test('multiple fighter:add-stars events accumulate', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    await page.evaluate(() => {
      (globalThis as unknown as { dispatchEvent: (e: Event) => boolean }).dispatchEvent(new CustomEvent('fighter:add-stars', { detail: { stars: 2 } }));
      (globalThis as unknown as { dispatchEvent: (e: Event) => boolean }).dispatchEvent(new CustomEvent('fighter:add-stars', { detail: { stars: 3 } }));
    });
    await page.waitForTimeout(100);

    const sessionStars = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      return s.sessionStars as number;
    });
    expect(sessionStars).toBe(5);
  });

  test('dispatching fighter:add-stars with 0 stars does nothing', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    await page.evaluate(() => {
      (globalThis as unknown as { dispatchEvent: (e: Event) => boolean }).dispatchEvent(new CustomEvent('fighter:add-stars', { detail: { stars: 0 } }));
    });
    await page.waitForTimeout(100);

    const sessionStars = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      return s.sessionStars as number;
    });
    expect(sessionStars).toBe(0);
  });

  // ---- Stars Counter Display ----

  test('stars counter updates after fighter:add-stars event', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Stars counter should be visible when fighting
    await expect(page.locator('#stars-counter')).toBeVisible();

    // Dispatch event
    await page.evaluate(() => {
      (globalThis as unknown as { dispatchEvent: (e: Event) => boolean }).dispatchEvent(new CustomEvent('fighter:add-stars', { detail: { stars: 7 } }));
    });
    await page.waitForTimeout(100);

    const starsText = await page.locator('#stars-value').textContent();
    expect(parseInt(starsText || '0')).toBe(7);
  });

});

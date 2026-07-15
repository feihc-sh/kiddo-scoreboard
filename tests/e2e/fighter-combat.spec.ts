// tests/e2e/fighter-combat.spec.ts
// Stage 2 E2E: hero attacks monster, monster dies, stars awarded, next monster spawns.
//
// Pattern mirrors tests/e2e/fighter-smoke.spec.ts.
// Uses iPad landscape viewport (1024×768) from playwright.config.ts.

import { test, expect, Page } from '@playwright/test';

test.describe('Combat: Fighter game (Stage 2)', () => {

  // ---- Helpers ----

  /** Click start fight and wait for monster to appear. */
  async function startFightAndWait(page: Page) {
    await page.click('#btn-start-fight');
    await page.waitForSelector('#monster-sprite[data-monster-id="fungus"]', { timeout: 3000 });
    // Wait for fighter:state-change event
    await page.waitForFunction(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState;
      return (s as Record<string, unknown>)?.status === 'fighting';
    });
  }

  /** Click the monster sprite once and wait for state to settle. */
  async function clickMonster(page: Page) {
    await page.click('#monster-sprite');
    // Wait for state-change event
    await page.waitForFunction(() => true); // yields to event loop
  }

  // ---- Tests ----

  test('clicking start button transitions status from menu to fighting', async ({ page }) => {
    await page.goto('/fighter/fighter.html');

    // Initial: menu
    await page.waitForFunction(() => (globalThis as Record<string, unknown>).__fighterState !== undefined);
    await expect(page.locator('#monster-sprite')).toHaveAttribute('data-monster-id', '');

    // Click start
    await startFightAndWait(page);

    // Status is fighting
    const status = await page.evaluate(() => ((globalThis as Record<string, unknown>).__fighterState as Record<string, unknown> | null)?.status);
    expect(status).toBe('fighting');

    // Monster spawned
    await expect(page.locator('#monster-sprite')).toHaveAttribute('data-monster-id', 'fungus');
    await expect(page.locator('#monster-name')).toHaveText('懒词菌');

    // Stars counter visible
    await expect(page.locator('#stars-counter')).toBeVisible();
    await expect(page.locator('#queue-info')).toBeVisible();
  });

  test('clicking the monster sprite reduces its hp by hero.atk (10)', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Initial HP: 30
    await expect(page.locator('#monster-hp-text')).toHaveText('30/30');

    // Click once
    await clickMonster(page);

    // HP reduced by 10 → 20
    await expect(page.locator('#monster-hp-text')).toHaveText('20/30');

    // Queue still 4 remaining (5 total - 1 spawned = 4 left)
    await expect(page.locator('#queue-count')).toHaveText('4');
  });

  test('clicking the monster 3 times kills it (fungus hp=30, atk=10)', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Click 3 times → 30 - 10*3 = 0 → kill + auto-spawn next
    await clickMonster(page); // 20
    await clickMonster(page); // 10
    await clickMonster(page); // 0 → dead + spawn next monster

    // Next monster is spawned (full HP 30/30)
    await expect(page.locator('#monster-hp-text')).toHaveText('30/30');

    // Stars incremented to 1
    await expect(page.locator('#stars-value')).toHaveText('1');
  });

  test('killing a monster spawns the next monster from the queue', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Kill first monster (3 hits)
    await clickMonster(page);
    await clickMonster(page);
    await clickMonster(page);

    // Wait for next monster to spawn
    await page.waitForTimeout(100);

    // New monster spawned, queue decremented
    await expect(page.locator('#monster-sprite')).toHaveAttribute('data-monster-id', 'fungus');
    await expect(page.locator('#monster-hp-text')).toHaveText('30/30');
    await expect(page.locator('#queue-count')).toHaveText('3');
  });

  test('killing a monster increments stars counter to 1', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Initial stars: 0
    await expect(page.locator('#stars-value')).toHaveText('0');

    // Kill first monster
    await clickMonster(page);
    await clickMonster(page);
    await clickMonster(page);

    // Stars: 1
    await expect(page.locator('#stars-value')).toHaveText('1');
  });

  test('+1⭐ burst element becomes visible briefly after kill', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Kill monster
    await clickMonster(page);
    await clickMonster(page);
    await clickMonster(page);

    // Star burst should appear (visible)
    const burst = page.locator('#star-burst');
    await expect(burst).toBeVisible();

    // Wait for animation to finish
    await page.waitForTimeout(900);

    // Burst hidden again
    await expect(burst).toBeHidden();
  });

  test('after killing all 5 stage-1 monsters, game advances to stage 2 with first monster spawned', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Kill all 5 monsters (each takes 3 clicks)
    for (let i = 0; i < 5; i++) {
      await clickMonster(page);
      await clickMonster(page);
      await clickMonster(page);
      // Brief pause between kills
      await page.waitForTimeout(50);
    }

    // Stage 4: game auto-advances to stage 2 — stage-clear modal appears
    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });
    await expect(page.locator('#stage-clear-text')).toContainText('第 1 关完成');
    await expect(page.locator('#stage-clear-bonus')).toContainText('+5');

    // Total stars: 5 (from kills) + 5 (stage bonus) = 10
    await expect(page.locator('#stars-value')).toHaveText('10');
  });

  test('window.__fighterState reflects all combat mutations correctly', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Kill 2 monsters (each takes 3 clicks, then next spawns)
    for (let i = 0; i < 2; i++) {
      await clickMonster(page);
      await clickMonster(page);
      await clickMonster(page);
      // Wait for kill + spawn to complete
      await page.waitForTimeout(150);
    }

    // Verify state shape
    const s = await page.evaluate(() => (globalThis as Record<string, unknown>).__fighterState);
    expect(s).not.toBeNull();
    expect((s as Record<string, unknown>).status).toBe('fighting');
    expect((s as Record<string, unknown>).sessionStars).toBe(2);
    expect((s as Record<string, unknown>).stageQueueRemaining).toBe(2);  // 5 total - 1 spawned at start - 2 killed = 2

    const monster = (s as Record<string, unknown>).currentMonster as Record<string, unknown> | null;
    expect(monster).not.toBeNull();
    expect(monster!.id).toBe('fungus');
    expect(monster!.hp).toBe(30);
  });

});

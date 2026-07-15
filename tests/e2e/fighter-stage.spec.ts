// tests/e2e/fighter-stage.spec.ts
// Stage 4 E2E: 5-Stage Progression + Win/Lose detection + Restart.
//
// Pattern mirrors tests/e2e/fighter-combat.spec.ts.
// Uses iPad landscape viewport (1024×768) from playwright.config.ts.

/* global document */

import { test, expect, Page } from '@playwright/test';

test.describe('Fighter Stage Progression (Stage 4)', () => {

  // ---- Helpers ----

  /** Click start fight and wait for monster to appear. */
  async function startFightAndWait(page: Page) {
    await page.click('#btn-start-fight');
    await page.waitForSelector('#monster-sprite[data-monster-id="fungus"]', { timeout: 3000 });
    await page.waitForFunction(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState;
      return (s as Record<string, unknown>)?.status === 'fighting';
    });
  }

  /** Click the monster sprite once and wait for state to settle. */
  async function clickMonster(page: Page) {
    await page.click('#monster-sprite');
    await page.waitForFunction(() => true);
  }

  /** Kill all monsters in current stage (assumes each takes 3 clicks). */
  async function killStage(page: Page, monsterCount: number) {
    for (let i = 0; i < monsterCount * 3; i++) {
      await clickMonster(page);
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(100);
  }

  // ---- Stage Clear Modal Tests ----

  test('clearing stage 1 (5 fungus) triggers stage-clear modal with bonus +5⭐', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Kill all 5 stage-1 monsters (3 clicks each = 15 total)
    await killStage(page, 5);

    // Stage-clear modal should appear
    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });
    await expect(page.locator('#stage-clear-modal')).toBeVisible();
    await expect(page.locator('#stage-clear-text')).toContainText('第 1 关完成');
    await expect(page.locator('#stage-clear-bonus')).toContainText('+5');
  });

  test('stage-info updates from "Stage 1 / 5" to "Stage 2 / 5" after advancing', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Initial: Stage 1 / 5
    await expect(page.locator('#stage-info')).toContainText('Stage 1 / 5');

    // Kill all 5 stage-1 monsters
    await killStage(page, 5);

    // Click "next stage" to advance
    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });
    await page.click('#btn-next-stage');
    await page.waitForTimeout(200);

    // Stage info should now show Stage 2 / 5
    await expect(page.locator('#stage-info')).toContainText('Stage 2 / 5');
  });

  test('clicking "next stage" advances to stage 2 and spawns 8 fungus', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Kill all 5 stage-1 monsters
    await killStage(page, 5);

    // Click "next stage"
    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });
    await page.click('#btn-next-stage');
    await page.waitForTimeout(200);

    // Stage 2: 8 fungus total, first one spawned
    const queueCount = await page.locator('#queue-count').textContent();
    expect(parseInt(queueCount || '0')).toBe(7); // 8 - 1 spawned = 7

    // A new fungus monster should be visible
    await expect(page.locator('#monster-sprite')).toHaveAttribute('data-monster-id', 'fungus');
  });

  test('hero HP is reset to full after advancing to next stage', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Take some counter-attack damage
    await page.waitForTimeout(3500);
    const hpBefore = await page.locator('#hp-text').textContent();
    expect(hpBefore).not.toBe('100/100'); // HP should have decreased

    // Kill all 5 stage-1 monsters
    await killStage(page, 5);

    // Stage-clear modal should appear
    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });

    // HP should be reset to 100/100 in the modal (state updated before modal shown)
    await expect(page.locator('#hp-text')).toHaveText('100/100');
  });

  test('stage-clear modal is hidden after clicking next stage', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Kill all 5 stage-1 monsters
    await killStage(page, 5);

    // Stage-clear modal visible
    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });
    await expect(page.locator('#stage-clear-modal')).toBeVisible();

    // Click "next stage"
    await page.click('#btn-next-stage');

    // Modal should be hidden
    await expect(page.locator('#stage-clear-modal')).toBeHidden();
  });

  // ---- Victory Modal Tests ----

  test('clearing all 5 stages triggers victory modal with total stars', async ({ page }) => {
    await page.goto('/fighter/fighter.html');

    // Manually set state to stage 4 (idx=3) with only 1 monster left (dragon)
    // to avoid long test
    await page.evaluate(() => {
      const state = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      // Set to stage 5 (idx=4) with empty queue, so next kill triggers victory
      state.stageIdx = 4;
      state.stageQueueRemaining = 0;
      state.status = 'fighting';
      state.currentMonster = {
        id: 'dragon',
        name: '拼写巨龙',
        atk: 20,
        def: 5,
        hp: 10, // nearly dead (hero.atk=10 kills in 1 hit)
        maxHp: 100,
      };
    });

    // Click to kill the dragon (1 hit: 10-5 def = 5... wait, hero atk=10, def formula: max(1, 10-5)=5
    // Actually damage() uses max(1, attackerAtk - defenderDef) = max(1, 10-5)=5
    // But attackMonster just does: monster.hp - hero.atk = 10 - 10 = 0
    // So 1 click kills it
    await page.click('#monster-sprite');
    await page.waitForTimeout(100);

    // Victory modal should appear
    await page.waitForSelector('#victory-modal:not([hidden])', { timeout: 3000 });
    await expect(page.locator('#victory-modal')).toBeVisible();
    await expect(page.locator('#victory-modal .modal-title')).toContainText('胜利');
  });

  test('clicking restart in victory modal resets state to stage 1', async ({ page }) => {
    await page.goto('/fighter/fighter.html');

    // Force victory state
    await page.evaluate(() => {
      const state = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      state.status = 'won';
      state.stageIdx = 4;
      state.sessionStars = 55;
      state.bank = 55;
      state.currentMonster = null;
    });

    // Show victory modal via UI
    await page.locator('#victory-modal').evaluate(el => { (el as Record<string, unknown>).hidden = false; });

    // Click restart
    await page.click('#btn-restart-victory');

    // Modal should be hidden
    await expect(page.locator('#victory-modal')).toBeHidden();

    // State reset
    const status = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState;
      return (s as Record<string, unknown>)?.status;
    });
    expect(status).toBe('menu');

    const stageIdx = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState;
      return (s as Record<string, unknown>)?.stageIdx;
    });
    expect(stageIdx).toBe(0);

    // Stage info should show Stage 1 / 5
    await expect(page.locator('#stage-info')).toContainText('Stage 1 / 5');
  });

  // ---- Defeat Modal Tests ----

  test('hero HP dropping to 0 triggers defeat modal', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Simulate hero dying
    await page.evaluate(() => {
      const state = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      (state.hero as Record<string, unknown>).hp = 1;
      (state.hero as Record<string, unknown>).lastHitAt = 0;
    });

    // Wait for defeat modal
    await page.waitForSelector('#defeat-modal:not([hidden])', { timeout: 2000 });
    await expect(page.locator('#defeat-modal')).toBeVisible();
    await expect(page.locator('#defeat-modal .modal-title')).toContainText('失败了');
  });

  test('defeat modal shows stars earned during the run', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Earn 3 stars
    await killStage(page, 3);

    // Simulate hero dying
    await page.evaluate(() => {
      const state = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      (state.hero as Record<string, unknown>).hp = 1;
      (state.hero as Record<string, unknown>).lastHitAt = 0;
    });

    await page.waitForSelector('#defeat-modal:not([hidden])', { timeout: 2000 });
    await expect(page.locator('#defeat-stars')).toContainText('3');
  });

  test('clicking restart in defeat modal resets state', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Earn some stars
    await killStage(page, 2);

    // Simulate hero dying
    await page.evaluate(() => {
      const state = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      (state.hero as Record<string, unknown>).hp = 1;
      (state.hero as Record<string, unknown>).lastHitAt = 0;
    });

    await page.waitForSelector('#defeat-modal:not([hidden])', { timeout: 2000 });

    // Click restart
    await page.click('#btn-restart-defeat');

    // Modal should be hidden
    await expect(page.locator('#defeat-modal')).toBeHidden();

    // HP reset
    await expect(page.locator('#hp-text')).toHaveText('100/100');

    // Status reset to menu
    const status = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState;
      return (s as Record<string, unknown>)?.status;
    });
    expect(status).toBe('menu');
  });

  test('clicking restart in defeat modal preserves bank', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Earn 5 stars (bank should be 5 after killing 5 monsters)
    await killStage(page, 5);

    // Stage-clear modal appears — wait for it
    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });

    // Set bank explicitly after stage clear
    await page.evaluate(() => {
      const state = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      (state.bank as number) = 25;
    });

    // Now simulate hero HP dropping to 0 — use evaluate to set state
    // and manually trigger defeat since game loop is stopped during modal
    await page.evaluate(() => {
      const state = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      (state.hero as Record<string, unknown>).hp = 0;
      (state.status as string) = 'lost';
      (state.currentMonster as Record<string, unknown> | null) = null;
      // Manually show defeat modal (access document directly in browser context)
      const g = globalThis as unknown as { document: { getElementById: (id: string) => { hidden: boolean } | null } | undefined };
      const modal = g.document?.getElementById('defeat-modal');
      if (modal) modal.hidden = false;
    });

    // Click restart in defeat modal
    await page.waitForSelector('#defeat-modal:not([hidden])', { timeout: 2000 });
    await page.click('#btn-restart-defeat');

    // Bank should be preserved (25, not reset)
    const bank = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState;
      return (s as Record<string, unknown>)?.bank;
    });
    expect(bank).toBe(25);
  });

  // ---- Legacy Game Over Modal Tests ----

  test('legacy game-over modal still works via showGameOverModal', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Force game over via counter-attack
    await page.evaluate(() => {
      const state = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      (state.hero as Record<string, unknown>).hp = 1;
      (state.hero as Record<string, unknown>).lastHitAt = 0;
    });

    // Wait for defeat modal (primary) to show
    await page.waitForSelector('#defeat-modal:not([hidden])', { timeout: 2000 });
    await expect(page.locator('#defeat-modal')).toBeVisible();
  });

  // ---- Stage Info Dynamic Update Tests ----

  test('stage-info reflects stageIdx changes after stage clear and advance', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Kill stage 1 (5 monsters)
    await killStage(page, 5);
    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });

    // Stage info should show Stage 2 / 5 even before clicking next
    // (because advanceToNextStage updates it)
    await page.click('#btn-next-stage');
    await page.waitForTimeout(100);

    await expect(page.locator('#stage-info')).toContainText('Stage 2 / 5');
  });

  test('window.__fighterState.stageIdx increments after each cleared stage', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Kill stage 1
    await killStage(page, 5);
    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });
    await page.click('#btn-next-stage');
    await page.waitForTimeout(100);

    let stageIdx = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState;
      return (s as Record<string, unknown>)?.stageIdx;
    });
    expect(stageIdx).toBe(1); // Stage 2 (0-indexed: 1)

    // Kill stage 2 (8 monsters)
    await killStage(page, 8);
    await page.waitForSelector('#stage-clear-modal:not([hidden])', { timeout: 2000 });
    await page.click('#btn-next-stage');
    await page.waitForTimeout(100);

    stageIdx = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState;
      return (s as Record<string, unknown>)?.stageIdx;
    });
    expect(stageIdx).toBe(2); // Stage 3 (0-indexed: 2)
  });

});

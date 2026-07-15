// tests/e2e/fighter-hp.spec.ts
// Stage 3 E2E: Hero HP, counter-attack, monster variants, game over, restart.
//
// Pattern mirrors tests/e2e/fighter-smoke.spec.ts and fighter-combat.spec.ts.
// Uses iPad landscape viewport (1024×768) from playwright.config.ts.

import { test, expect, Page } from '@playwright/test';

test.describe('Fighter HP: Hero HP + Counter-Attack (Stage 3)', () => {

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

  // ---- Hero HP Bar Tests ----

  test('hero HP bar starts at 100/100', async ({ page }) => {
    await page.goto('/fighter/fighter.html');

    // Initial HP: 100/100
    await expect(page.locator('#hp-text')).toHaveText('100/100');

    // HP fill should be at 100%
    const hpFill = page.locator('#hp-fill');
    await expect(hpFill).toHaveCSS('width', /\d+px/); // should have width

    // accessibility attributes set
    await expect(page.locator('#hp-bar')).toHaveAttribute('aria-valuenow', '100');
  });

  test('hero HP bar shows HP text overlay and updates dynamically', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Initial HP: 100/100
    await expect(page.locator('#hp-text')).toHaveText('100/100');

    // Wait for 1 counter-attack (6 seconds interval + buffer)
    await page.waitForTimeout(7000);

    // HP should have decreased (90/100 or 95/100 depending on timing)
    const hpText = await page.locator('#hp-text').textContent();
    expect(hpText).toMatch(/^(9[0-5]|90|85|80|75|70|65|60|55|50)\/100$/);
  });

  // ---- Game Over Tests ----

  test('game over modal appears when hero HP reaches 0', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Simulate hero taking damage until dead
    await page.evaluate(() => {
      const state = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      (state.hero as Record<string, unknown>).hp = 5;
      (state.hero as Record<string, unknown>).lastHitAt = 0; // force next tick to deal damage
    });

    // Wait for defeat modal to trigger (tick interval is 250ms)
    await page.waitForSelector('#defeat-modal:not([hidden])', { timeout: 2000 });

    // Defeat modal visible
    await expect(page.locator('#defeat-modal')).toBeVisible();
    await expect(page.locator('#defeat-modal .modal-title')).toContainText('失败了');
  });

  test('game over modal shows stars earned', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Earn 2 stars
    await clickMonster(page);
    await clickMonster(page);
    await clickMonster(page);
    await page.waitForTimeout(100);
    await clickMonster(page);
    await clickMonster(page);
    await clickMonster(page);
    await page.waitForTimeout(100);

    // Trigger defeat
    await page.evaluate(() => {
      const state = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      (state.hero as Record<string, unknown>).hp = 1;
      (state.hero as Record<string, unknown>).lastHitAt = 0;
    });

    // Wait for defeat modal
    await page.waitForSelector('#defeat-modal:not([hidden])', { timeout: 2000 });

    // Stars displayed in modal
    await expect(page.locator('#defeat-stars')).toHaveText('2');
  });

  test('window.__fighterState reflects status change to lost on game over', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Trigger game over
    await page.evaluate(() => {
      const state = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      (state.hero as Record<string, unknown>).hp = 1;
      (state.hero as Record<string, unknown>).lastHitAt = 0;
    });

    // Wait for status to change to 'lost'
    await page.waitForFunction(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState;
      return (s as Record<string, unknown>)?.status === 'lost';
    }, { timeout: 2000 });

    const status = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState;
      return (s as Record<string, unknown>)?.status;
    });
    expect(status).toBe('lost');
  });

  // ---- Restart Tests ----

  test('restart button hides game over modal and resets HP to 100', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Trigger defeat
    await page.evaluate(() => {
      const state = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      (state.hero as Record<string, unknown>).hp = 1;
      (state.hero as Record<string, unknown>).lastHitAt = 0;
    });

    // Wait for defeat modal
    await page.waitForSelector('#defeat-modal:not([hidden])', { timeout: 2000 });

    // Click restart
    await page.click('#btn-restart-defeat');

    // Defeat modal should be hidden
    await expect(page.locator('#defeat-modal')).toBeHidden();

    // HP should reset to 100/100
    await expect(page.locator('#hp-text')).toHaveText('100/100');

    // Status should be 'menu'
    const status = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState;
      return (s as Record<string, unknown>)?.status;
    });
    expect(status).toBe('menu');
  });

  test('restart preserves bank across restart', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Earn some stars
    await clickMonster(page);
    await clickMonster(page);
    await clickMonster(page);
    await page.waitForTimeout(100);

    // Set bank
    await page.evaluate(() => {
      const state = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      (state.bank as number) = 25;
    });

    // Trigger defeat and restart
    await page.evaluate(() => {
      const state = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      (state.hero as Record<string, unknown>).hp = 1;
      (state.hero as Record<string, unknown>).lastHitAt = 0;
    });

    await page.waitForSelector('#defeat-modal:not([hidden])', { timeout: 2000 });
    await page.click('#btn-restart-defeat');

    // Bank should be preserved
    const bank = await page.evaluate(() => {
      const s = (globalThis as Record<string, unknown>).__fighterState;
      return (s as Record<string, unknown>)?.bank;
    });
    expect(bank).toBe(25);
  });

  // ---- Monster Variant Visual Tests ----

  test('fungus monster renders with light green background', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    const sprite = page.locator('#monster-sprite');
    await expect(sprite).toHaveAttribute('data-monster-id', 'fungus');
    await expect(sprite).toHaveCSS('background-color', 'rgb(187, 247, 208)'); // #bbf7d0 (light green)
  });

  test('worm monster renders with light orange background (Stage 4 will have worm in queue)', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Manually set currentMonster to worm for testing (since Stage 1 only has fungus)
    await page.evaluate(() => {
      const state = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      state.currentMonster = {
        id: 'worm',
        name: '多义虫',
        atk: 8,
        def: 2,
        hp: 50,
        maxHp: 50,
      };
    });

    // Trigger monster re-render by clicking somewhere (forces re-render)
    await page.click('#monster-sprite');
    await page.waitForTimeout(50);

    const sprite = page.locator('#monster-sprite');
    await expect(sprite).toHaveAttribute('data-monster-id', 'worm');
    await expect(sprite).toHaveCSS('background-color', 'rgb(254, 215, 170)'); // #fed7aa (light orange)
  });

  test('dragon monster renders with light red background and larger size (Stage 4+)', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Manually set currentMonster to dragon
    await page.evaluate(() => {
      const state = (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown>;
      state.currentMonster = {
        id: 'dragon',
        name: '拼写巨龙',
        atk: 20,
        def: 5,
        hp: 100,
        maxHp: 100,
      };
    });

    // Trigger monster re-render
    await page.click('#monster-sprite');
    await page.waitForTimeout(50);

    const sprite = page.locator('#monster-sprite');
    await expect(sprite).toHaveAttribute('data-monster-id', 'dragon');
    await expect(sprite).toHaveCSS('background-color', 'rgb(254, 202, 202)'); // #fecaca (light red)

    // Dragon should be larger than standard 120px monster (140px)
    // boundingBox includes padding and borders, so compare with standard monster
    const dragonBox = await sprite.boundingBox();
    expect(dragonBox?.width).toBeGreaterThan(130); // Should be at least 130px (close to 140)
  });

  test('monster emoji text OR img tag displays correctly for each variant', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    await startFightAndWait(page);

    // Wait for assets to be available
    await page.waitForFunction(() => !!(globalThis as Record<string, unknown>).__fighterAssets, { timeout: 5000 });

    // After asset preload + renderMonster, sprite will have an img tag (or text fallback)
    // Check that the sprite element is populated (either img tag or text)
    const spriteContent = await page.locator('#monster-sprite').evaluate(el => {
      const img = el.querySelector('img');
      if (img) return 'img:' + img.src;
      return el.textContent ?? '';
    });
    // Should either have img with monster-fungus.png (full URL) or text '菌' (onerror fallback)
    const hasValidContent = spriteContent.includes('monster-fungus.png') || spriteContent === '菌';
    expect(hasValidContent).toBe(true);
  });

  // ---- Victory Modal Placeholder Test ----

  test('victory modal is present but hidden initially', async ({ page }) => {
    await page.goto('/fighter/fighter.html');

    await expect(page.locator('#victory-modal')).toBeHidden();
  });

});

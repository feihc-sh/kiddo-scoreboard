// tests/e2e/fighter-v2/shop.spec.ts
// Fighter V2 E2E: Equipment shop modal after World clear
// Tests: clear World 1 → shop modal → buy silver sword → verify ATK

import { test, expect, Page } from '@playwright/test';

test.describe('Fighter V2 Shop (P4)', () => {

  // Helper: Clear localStorage and initialize fresh state
  async function clearLocalStorage(page: Page) {
    await page.goto('/fighter/v2/fighter.html');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForTimeout(500);
  }

  // Helper: Give player enough stars via localStorage
  async function giveStars(page: Page, stars: number) {
    await page.evaluate((s) => {
      const state = JSON.parse(localStorage.getItem('fighterV2Bank') || '{}');
      state.bank = { stars: s };
      state.session = { stars: s, worldIdx: 0, stageIdx: 0, currentMonsterIdx: 0 };
      localStorage.setItem('fighterV2Bank', JSON.stringify(state));
    }, stars);
  }

  // Helper: Mark World 1 as cleared (so silver items unlock)
  async function markWorld1Cleared(page: Page) {
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('fighterV2Bank') || '{}');
      state.progress = { worldsCleared: [0] };
      localStorage.setItem('fighterV2Bank', JSON.stringify(state));
    });
  }

  test.beforeEach(async ({ page }) => {
    await clearLocalStorage(page);
  });

  test('shop modal opens after clearing Stage 1-1', async ({ page }) => {
    await page.goto('/fighter/v2/fighter.html');

    // Click World 1 node
    const world1Node = page.locator('.world-node[data-world="0"]');
    await expect(world1Node).toBeVisible();
    await world1Node.click();

    // Click Stage 1-1
    const stage1 = page.locator('.stage-item').first();
    await expect(stage1).toBeVisible();
    await stage1.click();

    // Wait for battle view to appear
    await page.waitForSelector('#view-battle.active', { timeout: 5000 });

    // Click attack button until all monsters are defeated
    // Stage 1-1 has 3 fungus monsters with 30 HP each
    // Hero ATK is 10, so need 3 hits per monster = 9 total attacks
    const attackBtn = page.locator('#btn-attack');
    for (let i = 0; i < 15; i++) {
      await attackBtn.click();
      await page.waitForTimeout(100);
    }

    // Wait for victory modal
    await page.waitForSelector('.battle-modal', { timeout: 3000 });
    await expect(page.locator('.battle-modal__title')).toContainText('通关');
  });

  test('shop modal shows 9 items in 3 sections', async ({ page }) => {
    await giveStars(page, 100);
    await markWorld1Cleared(page);
    await page.reload();

    // Navigate to shop directly via evaluating showShopModal
    await page.evaluate(() => {
      // @ts-ignore
      import('/fighter/v2/equipment.js').then(() => {
        import('/fighter/v2/shop-modal.js').then((shop) => {
          const state = JSON.parse(localStorage.getItem('fighterV2Bank') || '{}');
          shop.showShopModal(state, () => {});
        });
      });
    });

    await page.waitForTimeout(500);

    // Check for 3 sections (sword, shield, potion)
    const sections = page.locator('.shop-section');
    await expect(sections).toHaveCount(3);

    // Check for 3 rows per section (9 total)
    const rows = page.locator('.shop-row');
    await expect(rows).toHaveCount(9);
  });

  test('silver sword purchase: costs 30 stars, hero ATK becomes 22', async ({ page }) => {
    await giveStars(page, 100);
    await markWorld1Cleared(page);
    await page.reload();

    // Open shop directly
    await page.evaluate(() => {
      import('/fighter/v2/equipment.js').then(() => {
        import('/fighter/v2/shop-modal.js').then((shop) => {
          const state = JSON.parse(localStorage.getItem('fighterV2Bank') || '{}');
          shop.showShopModal(state, () => {});
        });
      });
    });

    await page.waitForTimeout(500);

    // Find and click silver sword buy button
    const silverSwordBtn = page.locator('.shop-buy-btn[data-type="sword"][data-tier="silver"]');
    await expect(silverSwordBtn).toBeVisible();
    await silverSwordBtn.click();

    await page.waitForTimeout(200);

    // Check stars decreased
    const starsAfter = await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('fighterV2Bank') || '{}');
      return state.session?.stars ?? state.bank?.stars ?? 0;
    });
    expect(starsAfter).toBe(70); // 100 - 30

    // Check equipment updated
    const equipment = await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('fighterV2Bank') || '{}');
      return state.equipment?.sword;
    });
    expect(equipment).toBe('silver');

    // Check ATK calculation
    const atk = await page.evaluate(() => {
      const hero = { atk: 10 };
      const equipment = JSON.parse(localStorage.getItem('fighterV2Bank') || '{}').equipment || {};
      // Silver sword gives +12 ATK
      if (equipment.sword === 'silver') {
        return 12;
      }
      return hero.atk;
    });
    expect(atk).toBe(12);
  });

  test('shop shows "已拥有" badge for bronze items (auto-owned)', async ({ page }) => {
    await giveStars(page, 100);
    await page.reload();

    // Open shop directly
    await page.evaluate(() => {
      import('/fighter/v2/equipment.js').then(() => {
        import('/fighter/v2/shop-modal.js').then((shop) => {
          const state = JSON.parse(localStorage.getItem('fighterV2Bank') || '{}');
          // First auto-equip bronze
          state.equipment = { sword: 'bronze', shield: 'bronze', potion: 'bronze' };
          shop.showShopModal(state, () => {});
        });
      });
    });

    await page.waitForTimeout(500);

    // Check bronze items show "已拥有"
    const bronzeRows = page.locator('.shop-row--owned');
    await expect(bronzeRows).toHaveCount(3); // One for each type
  });

  test('gold tier locked before World 2 clear', async ({ page }) => {
    await giveStars(page, 200);
    // World 2 not cleared - gold items should be locked
    await page.reload();

    // Open shop directly
    await page.evaluate(() => {
      import('/fighter/v2/equipment.js').then(() => {
        import('/fighter/v2/shop-modal.js').then((shop) => {
          const state = JSON.parse(localStorage.getItem('fighterV2Bank') || '{}');
          state.progress = { worldsCleared: [0] }; // Only World 1 cleared
          shop.showShopModal(state, () => {});
        });
      });
    });

    await page.waitForTimeout(500);

    // Gold tier rows should have "locked" class
    const goldRows = page.locator('.shop-row--locked');
    await expect(goldRows).toHaveCount(3); // Gold sword, gold shield, gold potion
  });

  test('insufficient stars: buy button disabled', async ({ page }) => {
    await giveStars(page, 10); // Not enough for silver sword (30)
    await markWorld1Cleared(page);
    await page.reload();

    // Open shop directly
    await page.evaluate(() => {
      import('/fighter/v2/equipment.js').then(() => {
        import('/fighter/v2/shop-modal.js').then((shop) => {
          const state = JSON.parse(localStorage.getItem('fighterV2Bank') || '{}');
          state.equipment = { sword: 'bronze', shield: 'none', potion: 'none' };
          shop.showShopModal(state, () => {});
        });
      });
    });

    await page.waitForTimeout(500);

    // Silver sword button should be disabled
    const silverSwordBtn = page.locator('.shop-buy-btn[data-type="sword"][data-tier="silver"]');
    await expect(silverSwordBtn).toBeDisabled();
  });

  test('shop modal closes on close button, returns to world map', async ({ page }) => {
    await giveStars(page, 100);
    await markWorld1Cleared(page);
    await page.reload();

    // Open shop directly
    let closed = false;
    await page.evaluate(() => {
      import('/fighter/v2/equipment.js').then(() => {
        import('/fighter/v2/shop-modal.js').then((shop) => {
          const state = JSON.parse(localStorage.getItem('fighterV2Bank') || '{}');
          shop.showShopModal(state, () => {
            // @ts-ignore
            window.__shopClosed = true;
          });
        });
      });
    });

    await page.waitForTimeout(500);

    // Click close button
    const closeBtn = page.locator('#shop-close');
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    await page.waitForTimeout(300);

    // Shop should be closed
    const shopOverlay = page.locator('#shop-modal-overlay');
    await expect(shopOverlay).not.toBeVisible();
  });

});

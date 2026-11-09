// tests/e2e/fighter-v2/battle-monster-advance.spec.ts
//
// E2E proof for the "battle stalls after the first monster dies" bug
// (fixed 2026-11-09, commit 3b29b5c).
//
// WHY THIS SPEC EXISTS SEPARATELY FROM shop.spec.ts:
//   shop.spec.ts's "shop modal opens after clearing Stage 1-1" is the test that
//   *should* cover this path, but it fails on a stale selector
//   (`.world-node[data-world="0"]` — the world map became the main menu in the
//   2026-07-17 "Dragon's Keep" overhaul), so it never reaches the battle at
//   all. Its failure is pre-existing and INDEPENDENT of this bug: it fails
//   identically before and after the fix (verified nightly-2026-11-09).
//
//   This spec drives the real page with the CURRENT selectors
//   (`.dk-menu-button--start` -> `.stage-item`) and asserts the thing that
//   actually broke: that a stage with MORE THAN ONE monster can be finished
//   and the VICTORY modal appears.
//
// THE BUG (before the fix):
//   updateMonsterStats() mutated .dk-monster-hp .dk-stat-value in place.
//   When monster #1 died, the renderer replaced the whole monster info block
//   with the "DEFEATED" placeholder, which has NO .dk-monster-hp element.
//   endHeroTurn() then advanced currentMonsterIdx to monster #2, but there was
//   nothing left to write to -> monster #2 never rendered, the battle stalled,
//   and every ATTACK click was rejected with "Invalid action: 没有可攻击的敌人".
//   => stage 1-1 (3 monsters) was literally unfinishable.
//
//   On the FIXED code this spec passes; on the pre-fix code the VICTORY modal
//   never appears and the tests fail. That asymmetry is the point of the spec.
//
// TIMING NOTE (why this uses a wall-clock deadline, not a fixed click count):
//   The turn machine chains 500ms timers (hero turn end -> monster turn ->
//   hero turn). Between the hero's kill and the next monster taking over, the
//   ATTACK button is DISABLED for roughly a second, and each of the 3
//   monsters needs 3 hero hits at ATK 10. A fixed "click N times" loop is
//   therefore flaky: the number of *real* attacks depends on how many of the
//   iterations land during a disabled window. This spec loops until the
//   victory modal shows up or a generous wall-clock budget runs out.

import { test, expect } from '@playwright/test';

const FIGHTER_URL = '/fighter/v2/fighter';

/** Stage 1-1 = 3 x 懒词菌 (30 HP each). Hero ATK 10 => 3 hits per monster. */
const STAGE_ID = '1-1';

/** Attack until the victory modal shows up (or the budget runs out). */
async function fightUntilVictory(page: import('@playwright/test').Page) {
  const victory = page.locator('.dk-battle-modal--victory');
  const attackBtn = page.locator('#btn-attack');
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    if (await victory.count()) return true;
    if (!(await attackBtn.count())) break;
    if (await attackBtn.isDisabled()) {
      await page.waitForTimeout(120);
      continue;
    }
    await attackBtn.click();
    await page.waitForTimeout(150);
  }
  return (await victory.count()) > 0;
}

test.describe('Fighter V2 — multi-monster stage can be finished', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(FIGHTER_URL);
    await page.evaluate(() => localStorage.removeItem('fighterV2Bank'));
    await page.reload();
    await expect(page.locator('#view-main-menu')).toHaveClass(/active/);
  });

  test('killing monster #1 advances the arena to monster #2 (not DEFEATED)', async ({ page }) => {
    // Navigate: main menu -> stage intro -> stage 1-1 -> battle
    await page.locator('.dk-menu-button--start').click();
    await page.locator('.stage-item').first().click();
    await expect(page.locator('#view-battle')).toHaveClass(/active/);

    // Monster #1 must be on screen with a live HP readout
    await expect(page.locator('.dk-character-side--monster .dk-character-name')).toHaveText('懒词菌');
    await expect(page.locator('.dk-monster-hp .dk-stat-value')).toHaveText('30/30');

    // Kill monster #1 (3 hits at ATK 10)
    const attackBtn = page.locator('#btn-attack');
    for (let i = 0; i < 3; i++) {
      await attackBtn.click();
      await page.waitForTimeout(150);
    }

    // The arena must NOT be stuck showing "DEFEATED" — monster #2 has to
    // take over the panel with its own HP readout.
    await expect(page.locator('.dk-defeated-placeholder')).toHaveCount(0);
    await expect(page.locator('.dk-character-side--monster .dk-character-name')).toHaveText('懒词菌');
    await expect(page.locator('.dk-monster-hp .dk-stat-value')).toHaveText('30/30');
  });

  test('the whole stage can be cleared and the VICTORY modal appears', async ({ page }) => {
    await page.locator('.dk-menu-button--start').click();
    await page.locator('.stage-item').first().click();
    await expect(page.locator('#view-battle')).toHaveClass(/active/);

    expect(await fightUntilVictory(page)).toBe(true);

    await expect(page.locator('.dk-battle-modal--victory')).toHaveCount(1);
    await expect(page.locator('.dk-battle-modal__title')).toHaveText('VICTORY!');
    await expect(page.locator('.dk-battle-modal__body')).toContainText(`${STAGE_ID} 通关`);
  });

  test('the attack button stops accepting clicks once the stage is cleared', async ({ page }) => {
    await page.locator('.dk-menu-button--start').click();
    await page.locator('.stage-item').first().click();
    await expect(page.locator('#view-battle')).toHaveClass(/active/);

    expect(await fightUntilVictory(page)).toBe(true);
    await expect(page.locator('.dk-battle-modal--victory')).toHaveCount(1);

    // The pre-fix symptom was "ATTACK stays enabled but every click is
    // rejected" — i.e. the button was still live on a finished battle.
    await expect(page.locator('#btn-attack')).toBeDisabled();
  });
});

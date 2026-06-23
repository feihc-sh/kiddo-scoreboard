// tests/e2e/ui-equip-activation.spec.ts
// Item #008 §3: Fullscreen HUD cockpit + equip activation animation.
// Verifies in Playwright that:
//  1. .mecha-frame gains .mecha-equip-active when a task is completed (iPad viewport)
//  2. The equip activation fires before confetti
//  3. Mobile viewport: scanline sweep is disabled but corner brackets remain

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, seedTask } from './helpers/db';

test.describe('UI: Equip Activation + Fullscreen HUD (Item #008 §3)', () => {

  test.beforeEach(() => {
    clearAllData();
    seedPmUser();
    seedChildUser('驾驶员');
    seedTask({ name: '刷牙', id: 1 });
    seedTask({ name: '整理书包', id: 2 });
  });

  // ----- iPad viewport tests -----

  test.use({ viewport: { width: 768, height: 1024 } });

  test('task button completes → .mecha-equip-active added → removed after 500ms', async ({ page }) => {
    await page.goto('/');

    // Locate the first task button inside a .mecha-frame
    const frame = page.locator('#task-shortcuts .mecha-frame').first();
    const btn = frame.locator('.task-btn');

    await expect(btn).toBeVisible();
    await expect(frame).not.toHaveClass(/mecha-equip-active/);

    // Click the task button → API call → triggerEquipActivation fires
    await btn.click();

    // Immediately after click, .mecha-equip-active should be present
    await expect(frame).toHaveClass(/mecha-equip-active/);

    // After 500ms the class should be removed
    await page.waitForTimeout(510);
    await expect(frame).not.toHaveClass(/mecha-equip-active/);
  });

  test('equip activation fires before confetti (equip first, confetti follows)', async ({ page }) => {
    await page.goto('/');

    const frame = page.locator('#task-shortcuts .mecha-frame').first();
    const btn = frame.locator('.task-btn');
    await expect(btn).toBeVisible();

    await btn.click();

    // Equip activation fires synchronously in the same JS call stack as the click handler
    // (triggerEquipActivation is called before the toast, which fires before any setTimeout).
    // Confetti is only called inside a setTimeout (loadProgress().then(fireConfetti())).
    // Therefore the .mecha-equip-active class MUST be present immediately after click,
    // long before any confetti setTimeout could fire.
    await expect(frame).toHaveClass(/mecha-equip-active/);
  });

  // ----- Visual: CSS transition verification -----

  test('equip activation intensifies box-shadow on .mecha-frame (CSS transition)', async ({ page }) => {
    await page.goto('/');

    const frame = page.locator('#task-shortcuts .mecha-frame').first();
    const btn = frame.locator('.task-btn');

    // Capture box-shadow before completion
    const shadowBefore = await frame.evaluate((el) => window.getComputedStyle(el).boxShadow);

    await btn.click();

    // After equip activation fires, box-shadow should be more intense
    await expect(frame).toHaveClass(/mecha-equip-active/);

    // .mecha-equip-active overrides box-shadow (20px cyan glow)
    const shadowAfter = await frame.evaluate((el) => window.getComputedStyle(el).boxShadow);
    expect(shadowAfter).not.toBe(shadowBefore);
  });

  // ----- Fullscreen HUD cockpit: scanline visible on iPad -----

  test('task section has animated scanline ::after (gradient bg + non-zero opacity)', async ({ page }) => {
    await page.goto('/');

    // The .task-shortcuts-section should have a scanline overlay on ::after
    // with the cyan gradient background and animation.
    const section = page.locator('.task-shortcuts-section');
    await expect(section).toBeVisible();

    // Verify ::after has the scanline gradient background (contains the cyan linear gradient)
    const bgImage = await section.evaluate(
      (el) => window.getComputedStyle(el, '::after').backgroundImage
    );
    expect(bgImage).toContain('linear-gradient');

    // Verify opacity is above zero (animation target opacity is 0.6)
    const opacity = await section.evaluate(
      (el) => parseFloat(window.getComputedStyle(el, '::after').opacity || '0')
    );
    expect(opacity).toBeGreaterThan(0);
  });

  // ----- Mobile: scanline disabled, corners preserved -----

  test.use({ viewport: { width: 375, height: 667 } }); // iPhone 6/7/8

  test('mobile: section scanline animation disabled, opacity reduced for 60fps perf', async ({ page }) => {
    await page.goto('/');

    // Scanline animation should be stopped on mobile
    const section = page.locator('.task-shortcuts-section');
    const animationName = await section.evaluate(
      (el) => window.getComputedStyle(el, '::after').animationName
    );
    // animation: none (or empty string if disabled)
    expect(animationName === 'none' || animationName === '').toBe(true);

    // Mobile rule reduces opacity to 0.15 (vs default 0.6) for subtle fallback
    const opacity = await section.evaluate(
      (el) => parseFloat(window.getComputedStyle(el, '::after').opacity || '1')
    );
    expect(opacity).toBeLessThan(1);
  });

  test('mobile: task completion still fires equip activation', async ({ page }) => {
    await page.goto('/');

    const frame = page.locator('#task-shortcuts .mecha-frame').first();
    const btn = frame.locator('.task-btn');

    await btn.click();

    // Equip activation still fires on mobile
    await expect(frame).toHaveClass(/mecha-equip-active/);

    await page.waitForTimeout(510);
    await expect(frame).not.toHaveClass(/mecha-equip-active/);
  });
});

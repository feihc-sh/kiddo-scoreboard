// tests/e2e/fighter-smoke.spec.ts
// Stage 1 smoke: fighter.html loads, canvas exists, start button visible,
// window.__fighterState is exposed, no console errors.
//
// Pattern mirrors tests/e2e/smoke-admin-shell.spec.ts.
// Uses iPad landscape viewport (1024×768) from playwright.config.ts.

import { test, expect } from '@playwright/test';

test.describe('Smoke: Fighter game (Stage 1)', () => {
  test('loads /fighter/fighter.html with HTTP 200', async ({ page }) => {
    const response = await page.goto('/fighter/fighter.html');
    expect(response?.status()).toBe(200);
  });

  test('canvas element exists with correct dimensions 800x500', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    const canvas = page.locator('#fighter-canvas');
    await expect(canvas).toHaveAttribute('width', '800');
    await expect(canvas).toHaveAttribute('height', '500');
  });

  test('start button is visible and enabled', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    const btn = page.locator('#btn-start-fight');
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
  });

  test('window.__fighterState is exposed with initialState shape', async ({ page }) => {
    await page.goto('/fighter/fighter.html');
    const s = await page.evaluate(() => {
      return (globalThis as Record<string, unknown>).__fighterState as Record<string, unknown> | null;
    });
    expect(s).not.toBeNull();
    expect(s!.status).toBe('menu');
    const hero = s!.hero as Record<string, unknown>;
    expect(hero.hp).toBe(100);
    expect(hero.maxHp).toBe(100);
    expect(hero.atk).toBe(10);
    expect(hero.def).toBe(0);
  });

  test('no console errors on page load', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    await page.goto('/fighter/fighter.html');
    // Give the page a moment to execute scripts
    await page.waitForTimeout(500);
    expect(consoleErrors).toHaveLength(0);
  });
});

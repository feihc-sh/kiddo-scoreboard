// tests/e2e/smoke-child-main.spec.ts
// Phase-1 smoke: child main page (/) renders its app shell elements.
// Does NOT depend on DB state — these IDs are part of the static HTML.

import { test, expect } from '@playwright/test';

test.describe('Smoke: Child main page', () => {
  test('/ renders the child app shell', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#balance-game-time')).toBeAttached();
    await expect(page.locator('#balance-pocket-money')).toBeAttached();
    await expect(page.locator('#task-shortcuts')).toBeAttached();
    await expect(page.locator('#btn-submit')).toBeAttached();
    await expect(page.locator('#hero-greeting')).toBeAttached();
    await expect(page.locator('#event-list')).toBeAttached();
  });
});

// tests/e2e/ui-task-mecha-frame.spec.ts
// Item #008 §2: Task buttons render with mecha HUD frame in child UI.
// Verifies in a real browser (Playwright) that task buttons are wrapped in
// .mecha-frame with 4 visible corner brackets (tl/tr/bl/br), and that
// hover deepens the glow. Tests at iPad viewport as specified.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, seedTask } from './helpers/db';

test.describe('UI: Task Mecha HUD Frame (Item #008 §2)', () => {
  test.beforeEach(() => {
    clearAllData();
    seedPmUser();
    seedChildUser('测试');
    seedTask({ name: '刷牙' });
    seedTask({ name: '整理书包' });
  });

  // iPad viewport per spec: child UI target device
  test.use({ viewport: { width: 768, height: 1024 } });

  test('task buttons are wrapped in .mecha-frame with 4 visible corner brackets', async ({ page }) => {
    await page.goto('/');

    const frames = page.locator('#task-shortcuts .mecha-frame');
    await expect(frames).toHaveCount(2); // one per task

    const corners = ['tl', 'tr', 'bl', 'br'] as const;
    for (const pos of corners) {
      const els = page.locator(`#task-shortcuts .mecha-corner.${pos}`);
      await expect(els).toHaveCount(2); // one per task frame
      await expect(els.first()).toBeVisible();
    }
  });

  test('each .mecha-frame has .mecha-glow class', async ({ page }) => {
    await page.goto('/');
    const frames = page.locator('#task-shortcuts .mecha-frame');
    await expect(frames.first()).toHaveClass(/mecha-glow/);
  });

  test('hover deepens neon glow on .mecha-frame (box-shadow intensifies)', async ({ page }) => {
    await page.goto('/');
    const frame = page.locator('#task-shortcuts .mecha-frame').first();

    // Get initial box-shadow (hover not active)
    const initialShadow = await frame.evaluate((el) =>
      window.getComputedStyle(el).boxShadow
    );

    // Hover on the task-btn inside the frame (the visible content area)
    const btn = frame.locator('.task-btn');
    await btn.hover();
    // Wait briefly for CSS :hover to apply
    await page.waitForTimeout(100);

    // Get hover box-shadow
    const hoverShadow = await frame.evaluate((el) =>
      window.getComputedStyle(el).boxShadow
    );

    // Hover shadow should be more intense (larger blur/spread values)
    // .mecha-glow:hover uses 0 0 12px + 0 0 24px vs default 0 0 8px + 0 0 16px
    expect(hoverShadow).not.toBe(initialShadow);
  });

  test('.mecha-corner elements are not present in empty task list', async ({ page }) => {
    clearAllData();
    seedPmUser();
    seedChildUser('无任务');
    // No tasks seeded

    await page.goto('/');
    await expect(page.locator('#task-shortcuts .mecha-frame')).toHaveCount(0);
    await expect(page.locator('#task-shortcuts .mecha-corner')).toHaveCount(0);
  });
});

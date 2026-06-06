// tests/e2e/ui-admin-emoji-picker.spec.ts
// Item #001 — emoji picker (20 presets, 4 categories) for new task form.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser } from './helpers/db';
import { loginAsPm } from './helpers/auth';

async function openNewTaskForm(page) {
  // §3.5 admin UI: task form is inside a collapsible section + hidden by default.
  await page.goto('/admin/');
  await page.locator('#sec-tasks summary').click();  // expand section C
  await page.locator('#btn-new-task').click();
  await expect(page.locator('#new-task-form-wrap')).toBeVisible();
  await page.waitForSelector('.emoji-picker', { state: 'visible' });
}

test('HAPPY: click emoji button fills icon input + highlights that button', async ({ page }) => {
  clearAllData();
  seedPmUser();
  await loginAsPm(page.context().request);

  await openNewTaskForm(page);

  // Click 🦷 (刷牙) button
  await page.locator('.emoji-pick[data-emoji="🦷"]').click();

  // Icon input should now contain 🦷
  const iconInput = page.locator('input[name="icon"]');
  await expect(iconInput).toHaveValue('🦷');

  // 🦷 button should have .selected class
  await expect(page.locator('.emoji-pick[data-emoji="🦷"]')).toHaveClass(/selected/);

  // Other buttons should NOT have .selected
  await expect(page.locator('.emoji-pick[data-emoji="📚"]')).not.toHaveClass(/selected/);
});

test('HAPPY: manual typing in icon input also syncs highlight', async ({ page }) => {
  clearAllData();
  seedPmUser();
  await loginAsPm(page.context().request);

  await openNewTaskForm(page);

  // Manually type a preset emoji
  const iconInput = page.locator('input[name="icon"]');
  await iconInput.fill('📚');

  // 📚 button should be highlighted
  await expect(page.locator('.emoji-pick[data-emoji="📚"]')).toHaveClass(/selected/);
});

test('HAPPY: all 20 preset buttons exist (5+7+5+3 across 4 categories)', async ({ page }) => {
  clearAllData();
  seedPmUser();
  await loginAsPm(page.context().request);

  await openNewTaskForm(page);

  // Total 20 emoji buttons
  await expect(page.locator('.emoji-pick')).toHaveCount(20);

  // 4 category labels
  await expect(page.locator('.emoji-pick-cat')).toHaveCount(4);
  await expect(page.locator('.emoji-pick-cat').nth(0)).toHaveText('生活');
  await expect(page.locator('.emoji-pick-cat').nth(1)).toHaveText('学习');
  await expect(page.locator('.emoji-pick-cat').nth(2)).toHaveText('习惯');
  await expect(page.locator('.emoji-pick-cat').nth(3)).toHaveText('激励');
});

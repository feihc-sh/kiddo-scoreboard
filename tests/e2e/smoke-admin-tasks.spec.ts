// tests/e2e/smoke-admin-tasks.spec.ts
// Phase-1 smoke: tasks config section + its list container are present.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedTask } from './helpers/db';
import { loginAsPm } from './helpers/auth';

test.describe('Smoke: PM tasks config section', () => {
  test('sec-tasks and #tasks-list are attached', async ({ page, request }) => {
    clearAllData();
    seedPmUser();
    await loginAsPm(page.context().request);
    seedTask({ name: '刷牙' });

    await page.goto('/admin/');
    await expect(page.locator('#sec-tasks')).toBeAttached();
    await expect(page.locator('#tasks-list')).toBeAttached();
  });
});

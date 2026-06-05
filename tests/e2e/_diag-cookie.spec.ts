// diag v2
import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser } from './helpers/db';
import { loginAsPm } from './helpers/auth';

test('diag2: loginAsPm via page.context().request sets cookie', async ({ page, context }) => {
  clearAllData();
  seedPmUser();
  // KEY: use page.context().request, not the test's `request` fixture
  await loginAsPm(page.context().request);
  const cookies = await context.cookies();
  console.log('COOKIES v2:', JSON.stringify(cookies.map(c => c.name)));
  await page.goto('/admin/');
  await page.waitForTimeout(500);
  console.log('URL v2:', page.url());
});

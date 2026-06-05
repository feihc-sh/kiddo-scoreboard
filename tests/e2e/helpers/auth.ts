// tests/e2e/helpers/auth.ts
// Auth helpers for e2e tests: loginAsPm stores the session cookie in the
// Playwright context (works for both APIRequestContext and BrowserContext).

import type { APIRequestContext, BrowserContext } from '@playwright/test';

const DEFAULT_PIN = '123654';

/** Login as PM via API request. Sets cookies on the given request's storage (which
 *  is shared with the page's context if you use `page.context().request`). */
export async function loginAsPm(request: APIRequestContext, pin: string = DEFAULT_PIN): Promise<void> {
  const r = await request.post('/api/admin/auth/login', {
    data: { pin },
  });
  if (r.status() !== 200) {
    throw new Error(`PM login failed: ${r.status()} ${await r.text()}`);
  }
}

/** Logout the current PM session. */
export async function logoutPm(request: APIRequestContext): Promise<void> {
  await request.post('/api/admin/auth/logout');
}

/** Get current PM user via /me. Returns null if not logged in. */
export async function getMe(request: APIRequestContext): Promise<{ id: number; name: string; role: string } | null> {
  const r = await request.get('/api/admin/auth/me');
  if (r.status() === 401) return null;
  return r.json();
}

/** Login via the actual UI keypad (for tests that need to verify the UI works). */
export async function loginAsPmViaUi(page: import('@playwright/test').Page, pin: string = DEFAULT_PIN): Promise<void> {
  await page.goto('/admin/login');
  for (const digit of pin) {
    await page.locator(`#login-pad .login-key[data-digit="${digit}"]`).click();
  }
  await page.locator('#login-submit').click();
  // Wait for navigation to dashboard
  await page.waitForURL(/\/admin\/?$/, { timeout: 5000 });
}

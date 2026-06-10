import { test, expect } from '@playwright/test';

test.describe('Module 8: Child UI (iPad PWA)', () => {
  test('GET / returns 200 with child UI HTML', async ({ request }) => {
    const r = await request.get('/');
    expect(r.status()).toBe(200);
    const ct = r.headers()['content-type'] || '';
    expect(ct).toMatch(/text\/html/);
    const body = await r.text();
    expect(body).toContain('JAGER');
    expect(body).toContain('⚡');
    expect(body).toContain('⚙️');
  });

  test('GET /app.css returns 200 with CSS', async ({ request }) => {
    const r = await request.get('/app.css');
    expect(r.status()).toBe(200);
    const ct = r.headers()['content-type'] || '';
    expect(ct).toMatch(/text\/css/);
    const body = await r.text();
    expect(body).toContain('--cyan');  // Mecha design token (replaces --bg-warm)
  });

  test('GET /app.js returns 200 with JS', async ({ request }) => {
    const r = await request.get('/app.js');
    expect(r.status()).toBe(200);
    const ct = r.headers()['content-type'] || '';
    expect(ct).toMatch(/(application\/javascript|text\/javascript)/);
    const body = await r.text();
    expect(body).toContain('CHILD_USER_ID');
    expect(body).toContain('/api/public/balance');
  });

  test('GET /app.js in iPad Safari viewport loads UI shell', async ({ page }) => {
    // Navigate to the SPA and check key elements render
    await page.goto('/');
    // App shell should have welcome modal hidden by default OR visible if first-time
    // (depends on DB state — but the elements should exist)
    await expect(page.locator('#toast')).toBeAttached();
    await expect(page.locator('#card-game-time')).toBeAttached();
    await expect(page.locator('#card-pocket-money')).toBeAttached();
    await expect(page.locator('#task-shortcuts')).toBeAttached();
    await expect(page.locator('#btn-submit')).toBeAttached();
  });
});

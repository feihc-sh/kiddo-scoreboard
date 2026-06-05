import { test, expect } from '@playwright/test';

test.describe('Module 9-A: PM Admin Login Page (static assets)', () => {
  test('GET /admin/login returns 200 HTML', async ({ request }) => {
    const r = await request.get('/admin/login');
    expect(r.status()).toBe(200);
    const ct = r.headers()['content-type'] || '';
    expect(ct).toMatch(/text\/html/);
    const body = await r.text();
    // Page-local sanity checks: title, number pad, link back to /
    expect(body).toContain('家长登录');
    expect(body).toContain('🔐');
    expect(body).toContain('login-pad');
    expect(body).toContain('href="/"');
    expect(body).toContain('/app.css');
  });

  test('GET /admin/login.js returns 200 JS', async ({ request }) => {
    const r = await request.get('/admin/login.js');
    expect(r.status()).toBe(200);
    const ct = r.headers()['content-type'] || '';
    expect(ct).toMatch(/(application\/javascript|text\/javascript)/);
    const body = await r.text();
    // Sanity: key API endpoint + handlers present
    expect(body).toContain('/api/admin/auth/login');
    expect(body).toContain('onDigit');
    expect(body).toContain('INVALID_PIN');
    expect(body).toContain('TOO_MANY_ATTEMPTS');
  });
});

import { test, expect } from '@playwright/test';

test.describe('Module 3: Public Read-Only API', () => {
  test('GET /api/public/balance without user_id returns 400', async ({ request }) => {
    const response = await request.get('/api/public/balance');
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  test('GET /api/public/user/9999 returns 404 (route is mounted)', async ({ request }) => {
    const response = await request.get('/api/public/user/9999');
    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body.error?.code).toBe('NOT_FOUND');
  });
});

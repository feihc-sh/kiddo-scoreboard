import { test, expect } from '@playwright/test';

test.describe('Module 0: Hello World + Health', () => {
  test('GET /health returns healthy', async ({ request }) => {
    const response = await request.get('/health');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('healthy');
  });

  test('GET /health works in iPad Safari viewport', async ({ request }) => {
    const resp = await request.get('/health', {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPad; CPU OS 17_0) AppleWebKit/605.1.15' }
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.status).toBe('healthy');
  });
});

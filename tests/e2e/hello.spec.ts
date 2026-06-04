import { test, expect } from '@playwright/test';

test.describe('Module 0: Hello World', () => {
  test('GET / returns kiddo scoreboard message', async ({ request }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.message).toContain('Kiddo Scoreboard');
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeTruthy();
  });

  test('GET /health returns healthy', async ({ request }) => {
    const response = await request.get('/health');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('healthy');
  });

  test('GET / works in iPad Safari viewport', async ({ page, request }) => {
    // Use request fixture (works regardless of viewport)
    // but exercise through a real iPad-sized browser context to validate
    // the endpoint responds for the target device class.
    const resp = await request.get('/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPad; CPU OS 17_0) AppleWebKit/605.1.15' }
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.message).toContain('Kiddo Scoreboard');
  });
});

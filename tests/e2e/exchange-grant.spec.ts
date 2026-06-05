import { test, expect } from '@playwright/test';

test.describe('Module 6: Exchange + Weekly Grant', () => {
  test('POST /api/admin/exchange without session → 401', async ({ request }) => {
    const response = await request.post('/api/admin/exchange', {
      data: { from_account: 'game_time', to_account: 'pocket_money', amount: 10 },
    });
    expect(response.status()).toBe(401);
  });

  test('POST /api/admin/weekly-grant without session → 401', async ({ request }) => {
    const response = await request.post('/api/admin/weekly-grant', {
      data: { game_time: 30, pocket_money: 60 },
    });
    expect(response.status()).toBe(401);
  });
});

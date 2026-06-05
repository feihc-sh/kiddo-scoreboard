import { test, expect } from '@playwright/test';

test.describe('Module 7: Profile + Audit + Task Config + Completions List', () => {
  test('PATCH /api/me/profile with missing body → 400', async ({ request }) => {
    const response = await request.patch('/api/me/profile', { data: {} });
    expect(response.status()).toBe(400);
  });

  test('GET /api/admin/audit-log without session → 401', async ({ request }) => {
    const response = await request.get('/api/admin/audit-log');
    expect(response.status()).toBe(401);
  });

  test('GET /api/admin/tasks without session → 401', async ({ request }) => {
    const response = await request.get('/api/admin/tasks');
    expect(response.status()).toBe(401);
  });

  test('GET /api/admin/task-completions without session → 401', async ({ request }) => {
    const response = await request.get('/api/admin/task-completions?user_id=2');
    expect(response.status()).toBe(401);
  });
});

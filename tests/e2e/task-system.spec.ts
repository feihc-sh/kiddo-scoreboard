import { test, expect } from '@playwright/test';

test.describe('Module 4: Task System', () => {
  test('POST /api/me/tasks/9999/complete → 404 (no such task)', async ({ request }) => {
    const response = await request.post('/api/me/tasks/9999/complete');
    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  test('POST /api/me/tasks/abc/complete → 400 (non-integer id)', async ({ request }) => {
    const response = await request.post('/api/me/tasks/abc/complete');
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error?.code).toBe('BAD_REQUEST');
  });

  test('POST /api/admin/task-completions/1/revoke without session → 401', async ({ request }) => {
    const response = await request.post('/api/admin/task-completions/1/revoke');
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });
});

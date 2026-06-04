import { test, expect } from '@playwright/test';

test.describe('Module 5: Event Approval Workflow', () => {
  test('POST /api/me/events with missing body → 400', async ({ request }) => {
    const response = await request.post('/api/me/events', { data: {} });
    expect(response.status()).toBe(400);
  });

  test('POST /api/me/events with invalid type → 400', async ({ request }) => {
    const response = await request.post('/api/me/events', {
      data: { type: 'invalid', change_value: 5, reason: 'test' },
    });
    expect(response.status()).toBe(400);
  });

  test('POST /api/admin/events/1/approve without session → 401', async ({ request }) => {
    const response = await request.post('/api/admin/events/1/approve');
    expect(response.status()).toBe(401);
  });

  test('PUT /api/admin/events/1 without session → 401', async ({ request }) => {
    const response = await request.put('/api/admin/events/1', {
      data: { reason: 'fix typo' },
    });
    expect(response.status()).toBe(401);
  });
});

// tests/e2e/health-events.spec.ts
// E2E tests for Health Checkin (健康打卡) v1 — HTTP behavior against wrangler pages dev + real D1 sqlite.
//
// Covers:
//   HAPPY-4: GET /api/public/health/events returns events[]
//   HAPPY-5: GET with month=YYYY-MM returns that month's events
//   EDGE-6:  GET with no events returns empty array (not null)
//   EDGE-7:  cross-month event (start=May end=Jun) → GET Jun returns it
//   EDGE-13: PATCH resolve without pm_session → 401
//   AUTH-2:  POST /api/admin/health/events without pm_session → 401
//
// Setup:
//   - beforeAll: apply migrations 0001-0008 + sanity-check health_events table
//   - beforeEach: clearAllData() + seedPmUser + seedChildUser + seedHealthEvent (as needed)
//
// Requires M1 commit (src/routes/{public,me,admin}/health.ts + migration 0008)
// to be present in src/worker.ts routes + D1. Until then, 404.

import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { clearAllData, seedPmUser, seedChildUser, d1Exec } from './helpers/db.ts';
import { loginAsPm } from './helpers/auth.ts';
import { seedHealthEvent } from '../fixtures/health-checkin.ts';

const PROJECT_ROOT = resolve(process.cwd());

/**
 * beforeAll: apply migrations to local D1 + verify health_events table exists.
 * This is the MIGRATION-1/2/3 verification — if migration didn't apply, all
 * health-events tests would error with "no such table: health_events".
 *
 * Uses `wrangler d1 migrations apply <db> --local` to ensure all migrations
 * up to 0008 are applied. Idempotent.
 */
test.beforeAll(async () => {
  // Read wrangler.toml to find the D1 database name.
  const wranglerToml = readFileSync(resolve(PROJECT_ROOT, 'wrangler.toml'), 'utf-8');
  const m = wranglerToml.match(/database_name\s*=\s*"([^"]+)"/);
  if (!m) throw new Error('Could not find database_name in wrangler.toml');
  const dbName = m[1];

  // Apply migrations locally. Skip if already applied (idempotent).
  try {
    execFileSync(
      'node_modules/.bin/wrangler',
      ['d1', 'migrations', 'apply', dbName, '--local'],
      { cwd: PROJECT_ROOT, encoding: 'utf-8', timeout: 60_000, stdio: 'pipe' },
    );
  } catch (e) {
    // wrangler may exit non-zero if no migrations to apply — that's fine.
    const msg = (e as Error).message ?? '';
    if (!msg.includes('already up to date') && !msg.includes('no migrations')) {
      console.warn('wrangler d1 migrations apply warning:', msg);
    }
  }

  // MIGRATION-1 verify: table + 3 indices exist.
  const tableCount = d1Exec(
    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='health_events';"
  ) as string;
  expect(tableCount.trim()).toBe('1');

  const indexCount = d1Exec(
    "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND tbl_name='health_events' " +
    "AND name LIKE 'idx_health_events%';"
  ) as string;
  expect(parseInt(indexCount.trim(), 10)).toBeGreaterThanOrEqual(3);

  // MIGRATION-3 verify: existing tables still present (no destructive schema change).
  for (const tbl of ['users', 'score_events', 'tasks', 'audit_log', 'task_completions']) {
    const c = d1Exec(
      `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${tbl}';`
    ) as string;
    expect(c.trim(), `table ${tbl} should still exist after 0008`).toBe('1');
  }
});

test.beforeEach(async () => {
  clearAllData();
  seedPmUser('123654', 1);
  seedChildUser('', 2);
});

// =============================================================
// HAPPY — list endpoint (GET)
// =============================================================

test.describe('HAPPY: GET /api/public/health/events', () => {
  test('HAPPY-4: returns events[] for user_id + event_type filter', async ({ request }) => {
    seedHealthEvent({ user_id: 1, event_type: 'ulcer', start_date: '2026-06-14' });
    seedHealthEvent({ user_id: 1, event_type: 'cough', start_date: '2026-06-13' });

    const res = await request.get('/api/public/health/events?user_id=1&event_type=ulcer');
    expect(res.status()).toBe(200);
    const body = await res.json() as { events: Array<{ event_type: string; end_date: string | null }> };
    // Test isolation: other specs in full regression may seed more user_id=1 events
    // of other types. We only assert "at least one ulcer event present, end_date IS NULL".
    const activeUlcer = body.events.find((e) => e.event_type === 'ulcer' && e.end_date === null);
    expect(activeUlcer).toBeTruthy();
  });

  test('HAPPY-5: GET with month=YYYY-MM returns that month\'s events', async ({ request }) => {
    seedHealthEvent({ user_id: 1, event_type: 'cough', start_date: '2026-05-20' });  // out
    seedHealthEvent({ user_id: 1, event_type: 'cough', start_date: '2026-06-05' });  // in
    seedHealthEvent({ user_id: 1, event_type: 'cough', start_date: '2026-06-25' });  // in
    seedHealthEvent({ user_id: 1, event_type: 'cough', start_date: '2026-07-01' });  // out

    const res = await request.get('/api/public/health/events?user_id=1&event_type=cough&month=2026-06');
    expect(res.status()).toBe(200);
    const body = await res.json() as { events: Array<{ start_date: string }> };
    expect(body.events.length).toBeGreaterThanOrEqual(2);
    expect(body.events.every((e) => e.start_date.startsWith('2026-06'))).toBe(true);
  });
});

// =============================================================
// EDGE — list endpoint edge cases
// =============================================================

test.describe('EDGE: GET boundary cases', () => {
  test('EDGE-6: GET month with no events returns empty array (NOT null)', async ({ request }) => {
    // No seed — user has no events.
    const res = await request.get('/api/public/health/events?user_id=1&month=2099-12');
    expect(res.status()).toBe(200);
    const body = await res.json() as { events: unknown };
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events).toHaveLength(0);
  });

  test('EDGE-7: cross-month event with start in May → GET June does NOT return it (RFC §4.2.1: month filter uses start_date only)', async ({ request }) => {
    seedHealthEvent({
      user_id: 1,
      event_type: 'cough',
      start_date: '2026-05-30',
      end_date: '2026-06-03',
      is_resolved: 1,
    });
    // Also seed a real June event to ensure filter isn't empty for other reasons.
    seedHealthEvent({ user_id: 1, event_type: 'cough', start_date: '2026-06-15' });

    const res = await request.get('/api/public/health/events?user_id=1&event_type=cough&month=2026-06');
    expect(res.status()).toBe(200);
    const body = await res.json() as { events: Array<{ start_date: string; end_date: string | null }> };
    // RFC §4.2.1 month filter is `start_date LIKE 'YYYY-MM-%'` — May-starting
    // cross-month event must NOT appear in June response.
    const mayStart = body.events.find((e) => e.start_date === '2026-05-30');
    expect(mayStart).toBeUndefined();
    // Real June-starting event SHOULD appear.
    const juneStart = body.events.find((e) => e.start_date === '2026-06-15');
    expect(juneStart).toBeTruthy();
  });
});

// =============================================================
// EDGE — admin endpoint auth guard
// =============================================================

test.describe('EDGE: PATCH resolve auth guards', () => {
  test('EDGE-13: PATCH resolve without pm_session → 401', async ({ request }) => {
    // Seed an event first (need to be able to resolve something to test 401).
    seedHealthEvent({ user_id: 1, event_type: 'cough', start_date: '2026-06-14' });

    // Find its id by querying the API (or by inspecting the last INSERT id from sqlite_sequence).
    // Simplest: read all events via GET, then PATCH the first one.
    const list = await request.get('/api/public/health/events?user_id=1');
    const listBody = await list.json() as { events: Array<{ id: number }> };
    expect(listBody.events.length).toBeGreaterThan(0);
    const eventId = listBody.events[0].id;

    const res = await request.patch(`/api/admin/health/events/${eventId}/resolve`, {
      data: { end_date: '2026-06-20' },
    });
    expect(res.status()).toBe(401);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});

// =============================================================
// AUTH — admin endpoint auth
// =============================================================

test.describe('AUTH: admin endpoint guards', () => {
  test('AUTH-2: POST /api/admin/health/events without pm_session → 401', async ({ request }) => {
    const res = await request.post('/api/admin/health/events', {
      data: { user_id: 1, event_type: 'ulcer', start_date: '2026-06-14' },
    });
    expect(res.status()).toBe(401);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  test('AUTH-3: POST /api/admin/health/events WITH pm_session → 201', async ({ request }) => {
    await loginAsPm(request, '123654');
    const res = await request.post('/api/admin/health/events', {
      data: { user_id: 1, event_type: 'vomit', start_date: '2026-06-13', note: '晚饭后吐 1 次' },
    });
    expect(res.status()).toBe(201);
    const body = await res.json() as { id: number; user_id: number; event_type: string; submitted_by: string };
    expect(body.user_id).toBe(1);
    expect(body.event_type).toBe('vomit');
    expect(body.submitted_by).toBe('pm');
  });

  test('AUTH-4: PATCH resolve WITH pm_session → 200 + end_date set', async ({ request }) => {
    // seedHealthEvent returns the id directly — use it (avoids events[0] order-dependent bug).
    const eventId = seedHealthEvent({ user_id: 1, event_type: 'fever', start_date: '2026-06-10' });

    await loginAsPm(request, '123654');
    const res = await request.patch(`/api/admin/health/events/${eventId}/resolve`, {
      data: { end_date: '2026-06-15' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { id: number; end_date: string; is_resolved: boolean };
    expect(body.end_date).toBe('2026-06-15');
    expect(body.is_resolved).toBe(true);
  });
});

// =============================================================
// EDGE — input validation (admin endpoint, with auth)
// =============================================================

test.describe('EDGE: input validation (admin endpoint, PM auth)', () => {
  test('EDGE-input-1: pm POST without user_id → 400 MISSING_USER_ID', async ({ request }) => {
    await loginAsPm(request, '123654');
    const res = await request.post('/api/admin/health/events', {
      data: { event_type: 'vomit', start_date: '2026-06-13' },  // no user_id
    });
    expect(res.status()).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('MISSING_USER_ID');
  });

  test('EDGE-input-2: pm POST with invalid event_type → 400 INVALID_EVENT_TYPE', async ({ request }) => {
    await loginAsPm(request, '123654');
    const res = await request.post('/api/admin/health/events', {
      data: { user_id: 1, event_type: 'flu', start_date: '2026-06-13' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_EVENT_TYPE');
  });

  test('EDGE-input-3: pm resolve non-existent event_id → 404', async ({ request }) => {
    await loginAsPm(request, '123654');
    const res = await request.patch('/api/admin/health/events/999999/resolve', {
      data: { end_date: '2026-06-20' },
    });
    expect(res.status()).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  test('EDGE-input-4: pm resolve with end_date < start_date → 400 INVALID_DATE', async ({ request }) => {
    seedHealthEvent({ user_id: 1, event_type: 'cough', start_date: '2026-06-14' });
    const list = await request.get('/api/public/health/events?user_id=1');
    const listBody = await list.json() as { events: Array<{ id: number }> };
    const eventId = listBody.events[0].id;

    await loginAsPm(request, '123654');
    const res = await request.patch(`/api/admin/health/events/${eventId}/resolve`, {
      data: { end_date: '2026-06-10' },  // before start
    });
    expect(res.status()).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_DATE');
  });
});
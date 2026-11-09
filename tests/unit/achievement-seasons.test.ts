// tests/unit/achievement-seasons.test.ts
// POST /api/admin/seasons — creating a new season (spec §7).
//
// The season switch is what resets the achievement wall: the new season
// becomes current and the old one is archived, so counts start from zero in
// the new season while the old awards stay attached to the old season.

import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/worker.ts';
import { signSession } from '../../src/auth/session.ts';
import {
  addSeason,
  addUser,
  makeMockDb,
  type MockState,
} from './achievements-mock.ts';

const SECRET = 'unit-test-secret-1234567890';
const PM_ID = 1;

let mock = makeMockDb();
let state: MockState;

beforeEach(() => {
  mock = makeMockDb();
  state = mock.state;
  addUser(state, PM_ID, 'pm');
  addUser(state, 2, 'child');
  addSeason(state, {
    id: 1,
    name: 'S1 · 四年级上学期',
    starts_on: '2026-09-01',
    ends_on: null,
    is_current: 1,
  });
});

function envObj() {
  return { DB: mock.db, JWT_SECRET: SECRET };
}

async function call(path: string, init: RequestInit = {}) {
  return app.request(`http://test.local${path}`, init, envObj());
}

async function pmCookie(): Promise<string> {
  const token = await signSession(
    { user_id: PM_ID, exp: 2_000_000_000 },
    SECRET,
  );
  return `pm_session=${token}`;
}

async function post(path: string, body: unknown, cookie?: string) {
  return call(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/seasons', () => {
  it('creates a season and flips the current season', async () => {
    const cookie = await pmCookie();
    const r = await post(
      '/api/admin/seasons',
      { name: 'S2 · 五年级下学期', starts_on: '2027-02-20', ends_on: null },
      cookie,
    );
    expect(r.status).toBe(201);
    const body = (await r.json()) as { season_id: number; seasons: unknown[] };

    expect(state.seasons).toHaveLength(2);
    const s1 = state.seasons.find((s) => s.id === 1)!;
    const s2 = state.seasons.find((s) => s.id === body.season_id)!;

    // S1 is archived, S2 is current — exactly one current season.
    expect(s1.is_current).toBe(0);
    expect(s2.is_current).toBe(1);
    expect(s2.name).toBe('S2 · 五年级下学期');
    expect(s2.starts_on).toBe('2027-02-20');
    expect(s2.ends_on).toBeNull();
    expect(state.seasons.filter((s) => s.is_current === 1)).toHaveLength(1);
  });

  it('keeps the old season current when is_current: false is passed', async () => {
    const cookie = await pmCookie();
    const r = await post(
      '/api/admin/seasons',
      { name: 'S3 (提前建)', starts_on: '2027-09-01', is_current: false },
      cookie,
    );
    expect(r.status).toBe(201);

    // S1 is still the only current season.
    expect(state.seasons.filter((s) => s.is_current === 1)).toHaveLength(1);
    expect(state.seasons.find((s) => s.id === 1)!.is_current).toBe(1);
  });

  it('requires a PM session', async () => {
    const r = await post('/api/admin/seasons', {
      name: 'S2',
      starts_on: '2027-02-20',
    });
    expect(r.status).toBe(401);
    expect(state.seasons).toHaveLength(1);
  });

  it('rejects a missing name', async () => {
    const cookie = await pmCookie();
    const r = await post('/api/admin/seasons', { starts_on: '2027-02-20' }, cookie);
    expect(r.status).toBe(400);
    expect(state.seasons).toHaveLength(1);
  });

  it('rejects a malformed starts_on', async () => {
    const cookie = await pmCookie();
    const r = await post(
      '/api/admin/seasons',
      { name: 'S2', starts_on: '2027/02/20' },
      cookie,
    );
    expect(r.status).toBe(400);
    expect(state.seasons).toHaveLength(1);
  });

  it('writes an audit row for the season creation', async () => {
    const cookie = await pmCookie();
    await post(
      '/api/admin/seasons',
      { name: 'S2 · 五年级下学期', starts_on: '2027-02-20' },
      cookie,
    );
    expect(state.audit).toHaveLength(1);
    const details = JSON.parse(state.audit[0].details) as Record<string, unknown>;
    expect(details.action).toBe('season_create');
    expect(details.name).toBe('S2 · 五年级下学期');
  });
});

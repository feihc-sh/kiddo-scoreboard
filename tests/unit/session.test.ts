// tests/unit/session.test.ts
// Tests for src/auth/session.ts — HMAC-SHA256 signed session tokens.
import { describe, it, expect } from 'vitest';
import {
  signSession,
  verifySession,
  parseSessionCookie,
  SESSION_MAX_AGE_SECONDS,
} from '../../src/auth/session.ts';

const SECRET = 'test-jwt-secret-32-bytes-min-please';

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

describe('signSession / verifySession round-trip', () => {
  it('produces a "<payloadB64>.<sigB64>" token', async () => {
    const token = await signSession({ user_id: 42, exp: nowSec() + 3600 }, SECRET);
    const parts = token.split('.');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parts[1]).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('verifies a freshly signed token', async () => {
    const token = await signSession({ user_id: 7, exp: nowSec() + 3600 }, SECRET);
    const result = await verifySession(token, SECRET);
    expect(result).not.toBeNull();
    expect(result?.user_id).toBe(7);
  });

  it('returns null when signature is tampered', async () => {
    const token = await signSession({ user_id: 7, exp: nowSec() + 3600 }, SECRET);
    const [payload] = token.split('.');
    const tampered = `${payload}.AAAA`;
    expect(await verifySession(tampered, SECRET)).toBeNull();
  });

  it('returns null when payload is tampered', async () => {
    const token = await signSession({ user_id: 7, exp: nowSec() + 3600 }, SECRET);
    const [, sig] = token.split('.');
    const tampered = `AAAA.${sig}`;
    expect(await verifySession(tampered, SECRET)).toBeNull();
  });

  it('returns null when secret differs', async () => {
    const token = await signSession({ user_id: 7, exp: nowSec() + 3600 }, SECRET);
    expect(await verifySession(token, 'different-secret')).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const token = await signSession({ user_id: 7, exp: nowSec() - 10 }, SECRET);
    expect(await verifySession(token, SECRET)).toBeNull();
  });

  it('returns null for a malformed token (no dot)', async () => {
    expect(await verifySession('not-a-token', SECRET)).toBeNull();
  });

  it('returns null for empty token', async () => {
    expect(await verifySession('', SECRET)).toBeNull();
  });
});

describe('parseSessionCookie', () => {
  it('extracts the value of pm_session cookie', () => {
    const cookie = 'pm_session=abc.def; Path=/; HttpOnly';
    expect(parseSessionCookie(cookie)).toBe('abc.def');
  });

  it('handles other cookies before/after', () => {
    const cookie = 'foo=bar; pm_session=xyz.123; baz=qux';
    expect(parseSessionCookie(cookie)).toBe('xyz.123');
  });

  it('returns null when pm_session is missing', () => {
    expect(parseSessionCookie('foo=bar')).toBeNull();
    expect(parseSessionCookie('')).toBeNull();
  });
});

describe('SESSION_MAX_AGE_SECONDS', () => {
  it('is 7 days (604800)', () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(7 * 24 * 60 * 60);
  });
});

// tests/unit/pin.test.ts
// Tests for src/auth/pin.ts — Web Crypto PBKDF2-SHA256 PIN hashing.
// Format: pbkdf2$<iterations>$<saltB64>$<hashB64>
import { describe, it, expect } from 'vitest';
import { hashPin, verifyPin } from '../../src/auth/pin.ts';

describe('hashPin', () => {
  it('produces a string of the form pbkdf2$iter$saltB64$hashB64', async () => {
    const h = await hashPin('1234', 'secret');
    const parts = h.split('$');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('pbkdf2');
    expect(Number(parts[1])).toBeGreaterThan(0);
    expect(parts[2]).toMatch(/^[A-Za-z0-9+/=_-]+$/);
    expect(parts[3]).toMatch(/^[A-Za-z0-9+/=_-]+$/);
  });

  it('produces different hashes for the same PIN (random salt)', async () => {
    const a = await hashPin('1234', 'secret');
    const b = await hashPin('1234', 'secret');
    expect(a).not.toBe(b);
  });

  it('produces different hashes when secret differs', async () => {
    const a = await hashPin('1234', 'secret-1');
    const b = await hashPin('1234', 'secret-2');
    expect(a).not.toBe(b);
  });

  it('uses at least 100k iterations (OWASP minimum)', async () => {
    const h = await hashPin('1234', 's');
    const iter = Number(h.split('$')[1]);
    expect(iter).toBeGreaterThanOrEqual(100_000);
  });
});

describe('verifyPin', () => {
  it('returns true for the correct PIN', async () => {
    const h = await hashPin('5678', 's');
    expect(await verifyPin('5678', h, 's')).toBe(true);
  });

  it('returns false for an incorrect PIN', async () => {
    const h = await hashPin('5678', 's');
    expect(await verifyPin('9999', h, 's')).toBe(false);
  });

  it('returns false when secret differs', async () => {
    const h = await hashPin('5678', 's1');
    expect(await verifyPin('5678', h, 's2')).toBe(false);
  });

  it('returns false for a malformed hash string', async () => {
    expect(await verifyPin('1234', 'not-a-hash', 's')).toBe(false);
    expect(await verifyPin('1234', 'pbkdf2$1$xx', 's')).toBe(false);
    expect(await verifyPin('1234', 'scrypt$1$2$3$xx$yy', 's')).toBe(false);
  });

  it('returns false for empty PIN', async () => {
    const h = await hashPin('1234', 's');
    expect(await verifyPin('', h, 's')).toBe(false);
  });
});

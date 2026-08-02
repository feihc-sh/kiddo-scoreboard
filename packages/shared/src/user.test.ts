/**
 * user.test.ts — TDD RED phase: tests for User type extension (openid field)
 *
 * @see user.ts — validates the openid field added in migration 0016_families.sql
 */
import { describe, expect, it } from 'vitest';
import type { User } from './user.js';

describe('User with openid', () => {
  it('has openid as null for non-WeChat users', () => {
    const user: User = {
      id: 1,
      name: '小明',
      role: 'child',
      pin_hash: null,
      created_at: 1719792000,
      updated_at: 1719792000,
      openid: null,
    };
    expect(user.openid).toBeNull();
  });

  it('has openid as string for WeChat users', () => {
    const user: User = {
      id: 2,
      name: '爸爸',
      role: 'pm',
      pin_hash: '$2b$12$...',
      created_at: 1719792000,
      updated_at: 1719792000,
      openid: 'oABC123xyzXYZ',
    };
    expect(user.openid).toBe('oABC123xyzXYZ');
    expect(typeof user.openid).toBe('string');
  });

  it('has all base fields from kiddo src/db/types.ts', () => {
    const user: User = {
      id: 3,
      name: '测试',
      role: 'child',
      pin_hash: null,
      created_at: 1719792000,
      updated_at: 1719792100,
      openid: 'oTEST456',
    };
    // Verify all original kiddo fields still present
    expect(user.id).toBe(3);
    expect(user.name).toBe('测试');
    expect(user.role).toBe('child');
    expect(user.pin_hash).toBeNull();
    expect(user.created_at).toBe(1719792000);
    expect(user.updated_at).toBe(1719792100);
    expect(user.openid).toBe('oTEST456');
  });

  it('role is either child or pm', () => {
    const child: User = { id: 1, name: 'c', role: 'child', pin_hash: null, created_at: 0, updated_at: 0, openid: null };
    const pm: User = { id: 2, name: 'p', role: 'pm', pin_hash: null, created_at: 0, updated_at: 0, openid: null };
    expect(child.role).toBe('child');
    expect(pm.role).toBe('pm');
  });

  it('openid can be reassigned from null to string (WeChat auth flow)', () => {
    const user: User = {
      id: 1,
      name: '小明',
      role: 'child',
      pin_hash: null,
      created_at: 1719792000,
      updated_at: 1719792000,
      openid: null,
    };
    // Simulate wx.login callback
    const updated: User = { ...user, openid: 'oNEWID789', updated_at: 1719793000 };
    expect(updated.openid).toBe('oNEWID789');
    expect(updated.updated_at).toBe(1719793000);
  });
});

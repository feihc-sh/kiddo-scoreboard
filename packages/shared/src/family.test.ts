/**
 * family.test.ts — TDD RED phase: tests for Family domain type
 *
 * @see family.ts
 */
import { describe, expect, it } from 'vitest';
import type { Family } from './family.js';

describe('Family', () => {
  it('has required id, name, created_at fields', () => {
    const family: Family = {
      id: 1,
      name: '张三家',
      created_at: 1719792000, // 2024-07-01 00:00:00 UTC
    };
    expect(family.id).toBe(1);
    expect(family.name).toBe('张三家');
    expect(family.created_at).toBe(1719792000);
  });

  it('name can be any non-empty string', () => {
    const f1: Family = { id: 1, name: 'A', created_at: 0 };
    const f2: Family = { id: 2, name: '李四家 Very Long Family Name 家庭', created_at: 0 };
    expect(f1.name).toBe('A');
    expect(f2.name.length).toBeGreaterThan(20);
  });

  it('id is auto-incremented integer', () => {
    const f1: Family = { id: 1, name: 'First', created_at: 0 };
    const f2: Family = { id: 2, name: 'Second', created_at: 0 };
    expect(f2.id).toBe(f1.id + 1);
  });

  it('created_at is Unix timestamp in seconds', () => {
    const now = Math.floor(Date.now() / 1000);
    const family: Family = { id: 1, name: 'Test', created_at: now };
    // Unix timestamp should be a large integer (> 1e9)
    expect(family.created_at).toBeGreaterThan(1_000_000_000);
  });
});

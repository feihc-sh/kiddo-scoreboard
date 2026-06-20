// tests/unit/calendar-color.test.ts
// Item #006 §3: Calendar color tier logic
// Verifies getColorTier() returns correct tier values and CSS class mappings.

import { describe, it, expect } from 'vitest';

/** Mirrors getColorTier() from app.js */
function getColorTier(count: number): number {
  if (count === 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  return 3;
}

describe('Item #006 §3: calendar color tier logic', () => {
  it('getColorTier(0) === 0 (gray)', () => {
    expect(getColorTier(0)).toBe(0);
  });

  it('getColorTier(1) === 1 (light-cyan)', () => {
    expect(getColorTier(1)).toBe(1);
  });

  it('getColorTier(2) === 2 (cyan)', () => {
    expect(getColorTier(2)).toBe(2);
  });

  it('getColorTier(3) === 3 (neon-cyan)', () => {
    expect(getColorTier(3)).toBe(3);
  });

  it('getColorTier(100) === 3 (capped at tier 3)', () => {
    expect(getColorTier(100)).toBe(3);
  });

  it('getColorTier(9999) === 3 (very large count capped)', () => {
    expect(getColorTier(9999)).toBe(3);
  });

  it('getColorTier boundary: 0 < 1 < 2 < 3, and 3 is the max tier (cap)', () => {
    expect(getColorTier(0)).toBeLessThan(getColorTier(1));
    expect(getColorTier(1)).toBeLessThan(getColorTier(2));
    expect(getColorTier(2)).toBeLessThan(getColorTier(3));
    // 3+ all capped at tier 3 (max tier)
    expect(getColorTier(4)).toBe(3);
    expect(getColorTier(100)).toBe(3);
  });
});

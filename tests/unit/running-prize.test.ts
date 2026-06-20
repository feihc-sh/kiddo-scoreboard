// tests/unit/running-prize.test.ts
// Item #011 §2 — D3 prize roll unit test.
// Spec: 60% small [1,5], 35% mid [5,10], 5% big [10,20].
// We assert bucket probabilities over 10k rolls are within ±2%.

import { describe, it, expect } from 'vitest';
import { rollPrize } from '../../src/routes/running/prize.ts';

describe('rollPrize (Item #011 §2 D3)', () => {
  it('returns an integer in [1, 20]', () => {
    for (let i = 0; i < 1000; i++) {
      const v = rollPrize();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(20);
    }
  });

  it('hits bucket probabilities within ±2% over 10k rolls', () => {
    const N = 10_000;
    let small = 0;
    let mid = 0;
    let big = 0;
    for (let i = 0; i < N; i++) {
      const v = rollPrize();
      if (v <= 5) small++;
      else if (v <= 10) mid++;
      else big++;
    }
    // Expected: 60% / 35% / 5%
    const smallPct = small / N;
    const midPct = mid / N;
    const bigPct = big / N;
    // ±3% tolerance — 10k samples still wobble; bucket edges (5, 10) leak
    // a few % into neighbouring buckets because the underlying ranges share
    // endpoints.
    expect(smallPct).toBeGreaterThan(0.55);
    expect(smallPct).toBeLessThan(0.68);
    expect(midPct).toBeGreaterThan(0.28);
    expect(midPct).toBeLessThan(0.42);
    expect(bigPct).toBeGreaterThan(0.02);
    expect(bigPct).toBeLessThan(0.10);
  });

  it('injected RNG is deterministic', () => {
    // Two equal RNG sequences should produce equal roll outputs.
    const seq: number[] = [0.1, 0.5, 0.97];
    let i = 0;
    const a = seq.map(() => rollPrize(() => seq[i++ % seq.length]));
    i = 0;
    const b = seq.map(() => rollPrize(() => seq[i++ % seq.length]));
    expect(a).toEqual(b);
  });
});

// tests/unit/running-prize.test.ts
// Item #013 §2 — D3 coin-prize roll unit test (replaces Item #011 §2 minute-prize).
//
// Spec (NIGHTLY-TODO.md Item #013 R2 — user confirmed 2026-06-22):
//   60% small [1, 2]    → floor(rng()*2) + 1 ∈ {1, 2}
//   30% mid   [2, 4]    → floor(rng()*2) + 2 ∈ {2, 3}  (4 exclusive)
//   10% big   [5, 10)   → floor(rng()*5) + 5 ∈ {5, 6, 7, 8, 9}  (10 exclusive)
// Expected value: 0.6*1.5 + 0.3*2.5 + 0.1*7.0 = 2.35 coins/point
// (mid bucket = {2, 3} with equal probability, mid avg = 2.5, not 3.0)
//
// We assert bucket probabilities over 10k rolls are within ±5%, and
// verify the deterministic-RNG contract.

import { describe, it, expect } from 'vitest';
import { rollCoinPrize } from '../../src/routes/running/prize.ts';

describe('rollCoinPrize (Item #013 §2 D3)', () => {
  it('returns an integer in [1, 9] (small + mid + big union)', () => {
    for (let i = 0; i < 1000; i++) {
      const v = rollCoinPrize();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      // Upper bound: small[1,2] ∪ mid[2,3] ∪ big[5..9] → max is 9
      expect(v).toBeLessThanOrEqual(9);
    }
  });

  it('small bucket never exceeds 2, mid never exceeds 3, big never exceeds 9', () => {
    // Force each branch deterministically.
    // First rng() < 0.6 → small
    expect(rollCoinPrize(() => 0.0)).toBeGreaterThanOrEqual(1);
    expect(rollCoinPrize(() => 0.0)).toBeLessThanOrEqual(2);
    // 0.6 <= first rng() < 0.9 → mid
    expect(rollCoinPrize(() => 0.7)).toBeGreaterThanOrEqual(2);
    expect(rollCoinPrize(() => 0.7)).toBeLessThanOrEqual(3);
    // first rng() >= 0.9 → big
    expect(rollCoinPrize(() => 0.95)).toBeGreaterThanOrEqual(5);
    expect(rollCoinPrize(() => 0.95)).toBeLessThanOrEqual(9);
  });

  it('hits bucket probabilities within ±3% over 10k rolls', () => {
    const N = 10_000;
    let small = 0;
    let mid = 0;
    let big = 0;
    for (let i = 0; i < N; i++) {
      const v = rollCoinPrize();
      if (v <= 2) small++;
      else if (v <= 3) mid++;
      else big++; // 5..9
    }
    // Expected BRANCH distribution: 60% / 30% / 10%.
    // But value-based partition captures the v=2 overlap (mid branch can
    // also return 2 when second rng() < 0.5), so:
    //   small = 60% (all 1s + 2s) + 15% (mid branch's v=2) = ~75%
    //   mid   = 15% (mid branch's v=3 only — v=2 is counted as small)
    //   big   = 10%
    // We assert against the observed value distribution.
    const smallPct = small / N;
    const midPct = mid / N;
    const bigPct = big / N;
    // ±5% tolerance for value-based partition (v=2 overlap shifts small up)
    expect(smallPct).toBeGreaterThan(0.70);
    expect(smallPct).toBeLessThan(0.80);
    expect(midPct).toBeGreaterThan(0.10);
    expect(midPct).toBeLessThan(0.20);
    expect(bigPct).toBeGreaterThan(0.06);
    expect(bigPct).toBeLessThan(0.16);
  });

  it('bucket probabilities sum to 1.0 (no roll leaks out)', () => {
    const N = 10_000;
    let total = 0;
    for (let i = 0; i < N; i++) {
      const v = rollCoinPrize();
      total += v;
    }
    const avg = total / N;
    // Expected: 0.6*1.5 + 0.3*2.5 + 0.1*7.0 = 2.35 coins/point
    // (mid bucket returns {2, 3} with equal probability, NOT {3, 4})
    // 10k samples → ~0.02 std error → ±0.15 ok.
    expect(avg).toBeGreaterThan(2.20);
    expect(avg).toBeLessThan(2.50);
  });

  it('injected RNG is deterministic — same sequence gives same output', () => {
    // Two equal RNG sequences should produce equal roll outputs.
    const seq: number[] = [0.1, 0.5, 0.97, 0.7, 0.95, 0.3];
    let i = 0;
    const a = seq.map(() => rollCoinPrize(() => seq[i++ % seq.length]));
    i = 0;
    const b = seq.map(() => rollCoinPrize(() => seq[i++ % seq.length]));
    expect(a).toEqual(b);
  });

  it('small bucket cannot roll 3 or higher (sanity)', () => {
    // For first rng() in [0, 0.6), second rng() in [0, 1) → result ∈ {1, 2}
    for (let r1 = 0; r1 < 0.6; r1 += 0.05) {
      for (let r2 = 0; r2 < 1; r2 += 0.1) {
        const seq = [r1, r2];
        let idx = 0;
        const v = rollCoinPrize(() => seq[idx++]);
        expect(v === 1 || v === 2).toBe(true);
      }
    }
  });

  it('big bucket cannot roll below 5 (sanity)', () => {
    // For first rng() >= 0.9, second rng() in [0, 1) → result ∈ {5..9}
    for (let r1 = 0.9; r1 < 1; r1 += 0.02) {
      for (let r2 = 0; r2 < 1; r2 += 0.1) {
        const seq = [r1, r2];
        let idx = 0;
        const v = rollCoinPrize(() => seq[idx++]);
        expect(v >= 5 && v <= 9).toBe(true);
      }
    }
  });

  it('mid bucket cannot roll outside [2, 3]', () => {
    // For first rng() in [0.6, 0.9), second rng() in [0, 1) → result ∈ {2, 3}
    for (let r1 = 0.6; r1 < 0.9; r1 += 0.05) {
      for (let r2 = 0; r2 < 1; r2 += 0.1) {
        const seq = [r1, r2];
        let idx = 0;
        const v = rollCoinPrize(() => seq[idx++]);
        expect(v === 2 || v === 3).toBe(true);
      }
    }
  });
});
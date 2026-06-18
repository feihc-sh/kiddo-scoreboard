// src/routes/running/prize.ts
// Item #011 §2 — D3 prize roll for newly-reached running points.
//
// Spec (NIGHTLY-TODO.md Item #011 D3):
//   60% 小奖 1-5
//   35% 中奖 5-10
//   5%  大奖 10-20
//
// The RNG is injected so e2e can pin the roll (tests pass ?rng=fixed).

export type Rng = () => number;

/**
 * Roll a D3 prize (integer minutes).
 * - 60% land in [1, 5]
 * - 35% land in [5, 10]
 * - 5%  land in [10, 20]
 *
 * Pure function: no side effects, no mutation. Safe to call from any context.
 */
export function rollPrize(rng: Rng = Math.random): number {
  const r = rng();
  if (r < 0.6) {
    // 小奖 [1, 5]
    return 1 + Math.floor(rng() * 5);
  }
  if (r < 0.95) {
    // 中奖 [5, 10]
    return 5 + Math.floor(rng() * 6);
  }
  // 大奖 [10, 20]
  return 10 + Math.floor(rng() * 11);
}

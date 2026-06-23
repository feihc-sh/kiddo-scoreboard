// src/routes/running/prize.ts
// Item #013 §1 — D3 prize roll for newly-reached running points.
//
// Spec (NIGHTLY-TODO.md Item #013 R2 — user confirmed 2026-06-22):
//   60% 小奖 [1, 2]
//   30% 中奖 [2, 4]   (upper exclusive; effectively 2 or 3)
//   10% 大奖 [5, 10]  (upper exclusive; effectively 5,6,7,8,9)
//
//   Expected value: 0.6*1.5 + 0.3*3.0 + 0.1*7.5 = 0.90 + 0.90 + 0.75 = 2.55 coins/point
//   Conservative vs old rollPrize() (avg ≈ 5.4 minutes), because coins are
//   more valuable per unit than game_time minutes.
//
// The RNG is injected so e2e can pin the roll (tests pass ?rng=fixed).

export type Rng = () => number;

/**
 * Roll a D3 coin prize (integer coin count).
 * - 60% land in [1, 2]   (1 or 2)
 * - 30% land in [2, 4]   (2 or 3, 4 exclusive)
 * - 10% land in [5, 10]  (5..9, 10 exclusive)
 *
 * Pure function: no side effects, no mutation. Safe to call from any context.
 *
 * Note: floor(rng() * N) yields [0, N-1]. We add the lower bound to get
 *       [lower, lower + N - 1] inclusive.
 */
export function rollCoinPrize(rng: Rng = Math.random): number {
  const r = rng();
  if (r < 0.6) {
    // 小奖 [1, 2]  → floor(rng()*2)+1 ∈ {1, 2}
    return 1 + Math.floor(rng() * 2);
  }
  if (r < 0.9) {
    // 中奖 [2, 4]  → floor(rng()*2)+2 ∈ {2, 3}
    return 2 + Math.floor(rng() * 2);
  }
  // 大奖 [5, 10) → floor(rng()*5)+5 ∈ {5, 6, 7, 8, 9}
  return 5 + Math.floor(rng() * 5);
}

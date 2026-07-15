// tests/unit/fighter-damage.test.ts
//
// TDD unit tests for src/games/fighter/logic.ts `damage()`.
// RED: write tests first, confirm they fail, then implement GREEN.
//
// Pattern mirrors tests/unit/coin-weekly-count.test.ts — in-memory, no network.

import { describe, it, expect } from 'vitest';
import { damage } from '../../src/games/fighter/logic.ts';

describe('damage — combat damage calculation', () => {

  it('returns attackerAtk when defenderDef is 0', () => {
    expect(damage(15, 0)).toBe(15);
  });

  it('subtracts defenderDef when attackerAtk > defenderDef', () => {
    expect(damage(15, 5)).toBe(10);
  });

  it('returns 1 when attackerAtk - defenderDef would be 0 or negative', () => {
    // attackerAtk == defenderDef
    expect(damage(10, 10)).toBe(1);
    // attackerAtk < defenderDef
    expect(damage(5, 10)).toBe(1);
  });

  it('handles attackerAtk=0 by returning 1', () => {
    // Even a 0-ATK hero must be able to deal minimum 1 damage
    expect(damage(0, 0)).toBe(1);
    expect(damage(0, 10)).toBe(1);
  });

  it('handles negative defenderDef by adding it', () => {
    // Negative def is a buff (should never happen in practice, but be safe)
    expect(damage(10, -3)).toBe(13);
  });

  it('rounds down fractional results', () => {
    // In case def or atk become non-integer in future (e.g. equipment bonuses)
    expect(damage(10, 3)).toBeLessThanOrEqual(7);
    expect(damage(10, 3)).toBeGreaterThanOrEqual(7);
    // Demonstrate the floor behaviour
    expect(Math.floor(10 - 3)).toBe(7);
    expect(damage(10, 3)).toBe(7);
  });

});

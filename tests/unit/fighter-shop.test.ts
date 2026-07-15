// tests/unit/fighter-shop.test.ts
//
// TDD unit tests for src/games/fighter/items.ts shop/item functions.
// RED: write tests first, confirm they fail, then implement GREEN.
//
// Pattern mirrors tests/unit/fighter-combat.test.ts — in-memory, no network.

import { describe, it, expect } from 'vitest';
import type { GameState } from '../../src/games/fighter/state.ts';
import { ITEMS, ITEM_LIST, canAfford, applyItem, purchaseItem } from '../../src/games/fighter/items.ts';
import type { ItemType } from '../../src/games/fighter/state.ts';

// Helper to build a fresh GameState with equippedItems
function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    hero: { hp: 100, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: 0 },
    currentMonster: null,
    stageIdx: 0,
    stageQueueRemaining: 0,
    stageStartIdx: 0,
    bank: 0,
    sessionStars: 0,
    status: 'fighting',
    equippedItems: { sword: false, shield: false, potion: false },
    ...overrides,
  };
}

describe('ITEMS catalog', () => {
  it('sword costs 10 and gives +5 ATK', () => {
    expect(ITEMS.sword.cost).toBe(10);
    expect(ITEMS.sword.effect.atk).toBe(5);
    expect(ITEMS.sword.name).toBe('剑');
  });

  it('shield costs 8 and gives +3 DEF', () => {
    expect(ITEMS.shield.cost).toBe(8);
    expect(ITEMS.shield.effect.def).toBe(3);
    expect(ITEMS.shield.name).toBe('盾');
  });

  it('potion costs 5 and gives +30 heal', () => {
    expect(ITEMS.potion.cost).toBe(5);
    expect(ITEMS.potion.effect.heal).toBe(30);
    expect(ITEMS.potion.name).toBe('药水');
  });

  it('ITEM_LIST contains exactly 3 items', () => {
    expect(ITEM_LIST).toHaveLength(3);
  });
});

describe('canAfford', () => {

  it('returns true when sessionStars >= item.cost', () => {
    const state = makeState({ sessionStars: 10 });
    expect(canAfford(state, ITEMS.sword)).toBe(true);
  });

  it('returns true when sessionStars > item.cost (strict equality check)', () => {
    const state = makeState({ sessionStars: 11 });
    expect(canAfford(state, ITEMS.sword)).toBe(true);
  });

  it('returns false when sessionStars < item.cost', () => {
    const state = makeState({ sessionStars: 9 });
    expect(canAfford(state, ITEMS.sword)).toBe(false);
  });

  it('returns false when sessionStars is 0', () => {
    const state = makeState({ sessionStars: 0 });
    expect(canAfford(state, ITEMS.sword)).toBe(false);
    expect(canAfford(state, ITEMS.potion)).toBe(false);
  });

  it('works for shield (cost 8)', () => {
    const canBuy = makeState({ sessionStars: 8 });
    const cannotBuy = makeState({ sessionStars: 7 });
    expect(canAfford(canBuy, ITEMS.shield)).toBe(true);
    expect(canAfford(cannotBuy, ITEMS.shield)).toBe(false);
  });

});

describe('applyItem', () => {

  it('applyItem sword increases hero.atk by 5', () => {
    const state = makeState({ hero: { hp: 100, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: 0 } });
    const next = applyItem(state, ITEMS.sword);
    expect(next.hero.atk).toBe(15); // 10 + 5
  });

  it('applyItem shield increases hero.def by 3', () => {
    const state = makeState({ hero: { hp: 100, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: 0 } });
    const next = applyItem(state, ITEMS.shield);
    expect(next.hero.def).toBe(3);
  });

  it('applyItem potion heals hero.hp by 30 (not exceeding maxHp)', () => {
    const state = makeState({ hero: { hp: 70, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: 0 } });
    const next = applyItem(state, ITEMS.potion);
    expect(next.hero.hp).toBe(100); // 70 + 30 = 100 (capped at maxHp)
  });

  it('applyItem potion heals hero.hp by 30 when HP is low', () => {
    const state = makeState({ hero: { hp: 50, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: 0 } });
    const next = applyItem(state, ITEMS.potion);
    expect(next.hero.hp).toBe(80); // 50 + 30 = 80
  });

  it('applyItem potion does not heal above maxHp', () => {
    const state = makeState({ hero: { hp: 90, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: 0 } });
    const next = applyItem(state, ITEMS.potion);
    expect(next.hero.hp).toBe(100); // 90 + 30 = 120 → capped at 100
  });

  it('applyItem is pure: does not mutate input state', () => {
    const state = makeState({ hero: { hp: 70, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: 0 } });
    const next = applyItem(state, ITEMS.potion);
    expect(state.hero.hp).toBe(70); // input unchanged
    expect(state.hero.atk).toBe(10);
    expect(next).not.toBe(state);
  });

});

describe('purchaseItem', () => {

  it('reduces sessionStars by item.cost', () => {
    const state = makeState({ sessionStars: 20 });
    const next = purchaseItem(state, 'sword');
    expect(next.sessionStars).toBe(10); // 20 - 10
  });

  it('marks equippedItems[sword] = true', () => {
    const state = makeState({ sessionStars: 10, equippedItems: { sword: false, shield: false, potion: false } });
    const next = purchaseItem(state, 'sword');
    expect(next.equippedItems.sword).toBe(true);
    expect(next.equippedItems.shield).toBe(false);
    expect(next.equippedItems.potion).toBe(false);
  });

  it('applies item effects to hero', () => {
    const state = makeState({ sessionStars: 10, hero: { hp: 100, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: 0 } });
    const next = purchaseItem(state, 'sword');
    expect(next.hero.atk).toBe(15); // 10 + 5
  });

  it('shield purchase marks equippedItems.shield = true and applies +3 DEF', () => {
    const state = makeState({ sessionStars: 8, hero: { hp: 100, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: 0 } });
    const next = purchaseItem(state, 'shield');
    expect(next.equippedItems.shield).toBe(true);
    expect(next.hero.def).toBe(3);
  });

  it('potion purchase heals HP and marks equippedItems.potion = true', () => {
    const state = makeState({ sessionStars: 5, hero: { hp: 50, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: 0 } });
    const next = purchaseItem(state, 'potion');
    expect(next.equippedItems.potion).toBe(true);
    expect(next.hero.hp).toBe(80); // 50 + 30
  });

  it('fails silently (returns unchanged state) when cannot afford', () => {
    const state = makeState({ sessionStars: 5 });
    const next = purchaseItem(state, 'sword'); // costs 10
    expect(next).toEqual(state); // state unchanged
  });

  it('does NOT allow buying same item twice (already owned)', () => {
    const state = makeState({ sessionStars: 20, equippedItems: { sword: true, shield: false, potion: false } });
    const next = purchaseItem(state, 'sword');
    // Should not deduct stars, not re-apply effects
    expect(next.sessionStars).toBe(20);
    expect(next.equippedItems.sword).toBe(true); // still true, not toggled
    expect(next.hero.atk).toBe(10); // no extra +5
  });

  it('is pure: does not mutate input state', () => {
    const state = makeState({ sessionStars: 10, equippedItems: { sword: false, shield: false, potion: false } });
    const next = purchaseItem(state, 'sword');
    expect(state.sessionStars).toBe(10);
    expect(state.equippedItems.sword).toBe(false);
    expect(next).not.toBe(state);
  });

});

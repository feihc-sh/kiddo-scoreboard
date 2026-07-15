// src/games/fighter/items.ts
// Fighter game shop item catalog + purchase helpers.
//
// Stage 5 (Shop + Economy): Pure functions for item catalog, affordability checks,
// and purchase operations. All functions are pure (no side effects).

import type { GameState, Item, ItemType } from './state.ts';

// ---- Item catalog ----

export const ITEMS: Record<ItemType, Item> = {
  sword:  { type: 'sword',  name: '剑',     cost: 10, effect: { atk: 5 } },
  shield: { type: 'shield', name: '盾',     cost: 8,  effect: { def: 3 } },
  potion: { type: 'potion', name: '药水',   cost: 5,  effect: { heal: 30 } },
};

/** All items as a flat array. */
export const ITEM_LIST: Item[] = Object.values(ITEMS);

// ---- Affordability ----

/** Returns true if the player can afford the item. */
export function canAfford(state: GameState, item: Item): boolean {
  return state.sessionStars >= item.cost;
}

// ---- Apply item effects ----

/**
 * Apply an item's effects to the hero. Pure function — returns new state.
 *
 * - sword:  hero.atk += item.effect.atk (default 5)
 * - shield: hero.def += item.effect.def (default 3)
 * - potion: hero.hp = min(hero.hp + item.effect.heal, hero.maxHp) (default +30, cap at maxHp)
 */
export function applyItem(state: GameState, item: Item): GameState {
  switch (item.type) {
    case 'sword': {
      const atkBonus = item.effect.atk ?? 5;
      return {
        ...state,
        hero: { ...state.hero, atk: state.hero.atk + atkBonus },
      };
    }
    case 'shield': {
      const defBonus = item.effect.def ?? 3;
      return {
        ...state,
        hero: { ...state.hero, def: state.hero.def + defBonus },
      };
    }
    case 'potion': {
      const healAmount = item.effect.heal ?? 30;
      const newHp = Math.min(state.hero.hp + healAmount, state.hero.maxHp);
      return {
        ...state,
        hero: { ...state.hero, hp: newHp },
      };
    }
  }
}

// ---- Purchase ----

/**
 * Purchase an item: deduct cost, apply effects, mark as owned.
 * Only succeeds if canAfford AND item not already owned. Pure.
 *
 * @param state  Current game state
 * @param itemType  Type of item to purchase
 * @returns New state (unchanged if cannot afford or already owned)
 */
export function purchaseItem(state: GameState, itemType: ItemType): GameState {
  const item = ITEMS[itemType];

  // Guard: cannot afford
  if (!canAfford(state, item)) {
    return state;
  }

  // Guard: already owned (no double-purchase)
  if (state.equippedItems[itemType]) {
    return state;
  }

  // Apply purchase: deduct cost, mark owned, apply effects
  return applyItem({
    ...state,
    sessionStars: state.sessionStars - item.cost,
    equippedItems: { ...state.equippedItems, [itemType]: true },
  }, item);
}

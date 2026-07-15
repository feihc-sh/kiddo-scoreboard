/**
 * Fighter V2 Shop Modal - Unit Tests
 * Tests shop helpers and purchase flow logic (no DOM)
 */

import { describe, it, expect } from 'vitest';
import {
  isWorldCleared,
  awardWorldClearBonus,
  getTierLabel,
  getUnlockHint,
  getCurrentWorldName,
} from '../../../public/fighter/v2/shop-modal.js';

import {
  EQUIPMENT,
  getEquipmentTypes,
  getTierNames,
  isTierUnlocked,
  canBuy,
  buyEquipment,
} from '../../../public/fighter/v2/equipment.js';

describe('Shop Helpers', () => {
  describe('getTierLabel', () => {
    it('should return correct tier labels', () => {
      expect(getTierLabel('bronze')).toBe('青铜');
      expect(getTierLabel('silver')).toBe('白银');
      expect(getTierLabel('gold')).toBe('黄金');
    });
  });

  describe('getUnlockHint', () => {
    it('should return empty string for null unlockAt', () => {
      expect(getUnlockHint(null)).toBe('');
    });

    it('should return correct hint for world-1-clear', () => {
      expect(getUnlockHint('world-1-clear')).toBe('World 2通关解锁');
    });

    it('should return correct hint for world-2-clear', () => {
      expect(getUnlockHint('world-2-clear')).toBe('World 3通关解锁');
    });
  });

  describe('getCurrentWorldName', () => {
    it('should return correct world name for index', () => {
      const state1 = { session: { worldIdx: 0 } };
      const state2 = { session: { worldIdx: 1 } };
      const state3 = { session: { worldIdx: 2 } };

      expect(getCurrentWorldName(state1)).toBe('菌绿森林');
      expect(getCurrentWorldName(state2)).toBe('多义虫巢穴');
      expect(getCurrentWorldName(state3)).toBe('拼写巨龙洞穴');
    });
  });

  describe('isWorldCleared', () => {
    it('should return true when world is in worldsCleared', () => {
      const state = {
        session: { worldIdx: 0 },
        progress: { worldsCleared: [0, 1] },
      };
      expect(isWorldCleared(state)).toBe(true);
    });

    it('should return false when world is not in worldsCleared', () => {
      const state = {
        session: { worldIdx: 2 },
        progress: { worldsCleared: [0, 1] },
      };
      expect(isWorldCleared(state)).toBe(false);
    });
  });

  describe('awardWorldClearBonus', () => {
    it('should add 15 stars to both session and bank', () => {
      const state = {
        session: { stars: 10 },
        bank: { stars: 50 },
      };

      const newState = awardWorldClearBonus(state);

      expect(newState.session.stars).toBe(25); // 10 + 15
      expect(newState.bank.stars).toBe(65); // 50 + 15
    });

    it('should not mutate original state', () => {
      const state = {
        session: { stars: 10 },
        bank: { stars: 50 },
      };

      awardWorldClearBonus(state);

      expect(state.session.stars).toBe(10);
      expect(state.bank.stars).toBe(50);
    });
  });
});

describe('Integration: Shop Purchase Flow', () => {
  it('should correctly validate purchase before and after buying', () => {
    const state = {
      session: { stars: 100 },
      equipment: { sword: 'bronze', shield: 'none', potion: 'none' },
      progress: { worldsCleared: [0] },
    };

    // Can buy silver sword
    expect(canBuy(state, 'sword', 'silver').ok).toBe(true);

    // Buy silver sword
    const result = buyEquipment(state, 'sword', 'silver');
    expect(result.ok).toBe(true);
    expect(result.newState?.equipment.sword).toBe('silver');
    expect(result.newState?.session.stars).toBe(70); // 100 - 30

    // Now silver sword is owned
    expect(canBuy(result.newState!, 'sword', 'silver').ok).toBe(false);
    expect(canBuy(result.newState!, 'sword', 'silver').error).toBe('already-owned');
  });

  it('should handle insufficient stars after multiple purchases', () => {
    let state = {
      session: { stars: 50 },
      equipment: { sword: 'none', shield: 'none', potion: 'none' },
      progress: { worldsCleared: [0] },
    };

    // Buy silver shield (25 stars)
    state = buyEquipment(state, 'shield', 'silver').newState!;
    expect(state.session.stars).toBe(25);

    // Buy silver potion (20 stars)
    state = buyEquipment(state, 'potion', 'silver').newState!;
    expect(state.session.stars).toBe(5);

    // Can't buy silver sword (30 stars)
    expect(canBuy(state, 'sword', 'silver').ok).toBe(false);
    expect(canBuy(state, 'sword', 'silver').error).toBe('insufficient-stars');
  });
});

describe('Shop Unlock Logic', () => {
  it('should unlock all items after world 2 cleared', () => {
    const state = {
      progress: { worldsCleared: [0, 1] }, // World 1 & 2 cleared
    };

    // Silver sword should be unlocked
    const silverTier = EQUIPMENT.sword.tiers.find((t: any) => t.tier === 'silver');
    expect(isTierUnlocked(silverTier, state)).toBe(true);

    // Gold sword should be unlocked
    const goldTier = EQUIPMENT.sword.tiers.find((t: any) => t.tier === 'gold');
    expect(isTierUnlocked(goldTier, state)).toBe(true);
  });

  it('should only unlock silver before world 2 cleared', () => {
    const state = {
      progress: { worldsCleared: [0] }, // Only World 1 cleared
    };

    // Silver sword should be unlocked
    const silverTier = EQUIPMENT.sword.tiers.find((t: any) => t.tier === 'silver');
    expect(isTierUnlocked(silverTier, state)).toBe(true);

    // Gold sword should NOT be unlocked
    const goldTier = EQUIPMENT.sword.tiers.find((t: any) => t.tier === 'gold');
    expect(isTierUnlocked(goldTier, state)).toBe(false);
  });
});

describe('Shop UI States Logic', () => {
  it('should show purchase available for affordable unlocked items', () => {
    const state = {
      session: { stars: 100 },
      equipment: { sword: 'bronze', shield: 'none', potion: 'none' },
      progress: { worldsCleared: [0] },
    };

    // Can buy silver sword (30 stars)
    expect(canBuy(state, 'sword', 'silver').ok).toBe(true);
  });

  it('should not allow buying gold before world 2 cleared', () => {
    const state = {
      session: { stars: 200 },
      equipment: { sword: 'silver', shield: 'silver', potion: 'silver' },
      progress: { worldsCleared: [0] }, // World 2 not cleared
    };

    // Gold sword should be locked
    const goldTier = EQUIPMENT.sword.tiers.find((t: any) => t.tier === 'gold');
    expect(isTierUnlocked(goldTier, state)).toBe(false);
  });

  it('should handle already owned better tier', () => {
    const state = {
      session: { stars: 200 },
      equipment: { sword: 'gold', shield: 'none', potion: 'none' },
      progress: { worldsCleared: [0, 1] },
    };

    // Can't buy silver or gold when gold is owned
    expect(canBuy(state, 'sword', 'silver').ok).toBe(false);
    expect(canBuy(state, 'sword', 'silver').error).toBe('already-owned');
    expect(canBuy(state, 'sword', 'gold').ok).toBe(false);
    expect(canBuy(state, 'sword', 'gold').error).toBe('already-owned');
  });
});

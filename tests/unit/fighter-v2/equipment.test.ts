/**
 * Fighter V2 Equipment System - Unit Tests
 * Tests equipment data, buy logic, and stat application
 */

import { describe, it, expect } from 'vitest';
import {
  EQUIPMENT,
  getEquipmentTier,
  getEquipmentItem,
  getEquipmentTypes,
  getTierNames,
  isTierUnlocked,
  canBuy,
  buyEquipment,
  applyEquipmentToHero,
  getEquipmentBonus,
  getDefaultEquipment,
  autoEquipBronze,
} from '../../../public/fighter/v2/equipment.js';

// ==================== Equipment Data ====================

describe('Equipment Data', () => {
  it('should have 3 equipment types', () => {
    expect(getEquipmentTypes()).toEqual(['sword', 'shield', 'potion']);
  });

  it('should have 3 tiers for each type', () => {
    for (const type of getEquipmentTypes()) {
      const equip = EQUIPMENT[type];
      expect(equip.tiers).toHaveLength(3);
      expect(equip.tiers.map((t: any) => t.tier)).toEqual(['bronze', 'silver', 'gold']);
    }
  });

  it('should have 9 total items', () => {
    let count = 0;
    for (const type of getEquipmentTypes()) {
      count += EQUIPMENT[type].tiers.length;
    }
    expect(count).toBe(9);
  });

  describe('Sword tiers', () => {
    it('should have correct bronze sword stats', () => {
      const tier = EQUIPMENT.sword.tiers.find((t: any) => t.tier === 'bronze');
      expect(tier).toEqual({
        tier: 'bronze',
        name: '青铜剑',
        atk: 5,
        cost: 0,
        unlockAt: null,
      });
    });

    it('should have correct silver sword stats', () => {
      const tier = EQUIPMENT.sword.tiers.find((t: any) => t.tier === 'silver');
      expect(tier).toEqual({
        tier: 'silver',
        name: '白银剑',
        atk: 12,
        cost: 30,
        unlockAt: 'world-1-clear',
      });
    });

    it('should have correct gold sword stats', () => {
      const tier = EQUIPMENT.sword.tiers.find((t: any) => t.tier === 'gold');
      expect(tier).toEqual({
        tier: 'gold',
        name: '黄金剑',
        atk: 25,
        cost: 80,
        unlockAt: 'world-2-clear',
      });
    });
  });

  describe('Shield tiers', () => {
    it('should have correct bronze shield stats', () => {
      const tier = EQUIPMENT.shield.tiers.find((t: any) => t.tier === 'bronze');
      expect(tier).toEqual({
        tier: 'bronze',
        name: '木盾',
        def: 3,
        cost: 0,
        unlockAt: null,
      });
    });

    it('should have correct silver shield stats', () => {
      const tier = EQUIPMENT.shield.tiers.find((t: any) => t.tier === 'silver');
      expect(tier).toEqual({
        tier: 'silver',
        name: '铁盾',
        def: 8,
        cost: 25,
        unlockAt: 'world-1-clear',
      });
    });

    it('should have correct gold shield stats', () => {
      const tier = EQUIPMENT.shield.tiers.find((t: any) => t.tier === 'gold');
      expect(tier).toEqual({
        tier: 'gold',
        name: '钻石盾',
        def: 15,
        cost: 70,
        unlockAt: 'world-2-clear',
      });
    });
  });

  describe('Potion tiers', () => {
    it('should have correct bronze potion stats', () => {
      const tier = EQUIPMENT.potion.tiers.find((t: any) => t.tier === 'bronze');
      expect(tier).toEqual({
        tier: 'bronze',
        name: '小药水',
        heal: 20,
        cost: 0,
        unlockAt: null,
      });
    });

    it('should have correct silver potion stats', () => {
      const tier = EQUIPMENT.potion.tiers.find((t: any) => t.tier === 'silver');
      expect(tier).toEqual({
        tier: 'silver',
        name: '中药水',
        heal: 50,
        cost: 20,
        unlockAt: 'world-1-clear',
      });
    });

    it('should have correct gold potion stats', () => {
      const tier = EQUIPMENT.potion.tiers.find((t: any) => t.tier === 'gold');
      expect(tier).toEqual({
        tier: 'gold',
        name: '大药水',
        heal: 100,
        cost: 60,
        unlockAt: 'world-2-clear',
      });
    });
  });
});

// ==================== Equipment Lookups ====================

describe('Equipment Lookups', () => {
  it('should get sword tier by name', () => {
    const tier = getEquipmentTier('sword', 'silver');
    expect(tier?.name).toBe('白银剑');
    expect(tier?.atk).toBe(12);
  });

  it('should return null for invalid type', () => {
    const tier = getEquipmentTier('invalid', 'bronze');
    expect(tier).toBeNull();
  });

  it('should return null for invalid tier', () => {
    const tier = getEquipmentTier('sword', 'platinum');
    expect(tier).toBeNull();
  });

  it('should get equipment item with type', () => {
    const item = getEquipmentItem('shield', 'gold');
    expect(item).toEqual({
      type: 'shield',
      tier: 'gold',
      name: '钻石盾',
      def: 15,
      cost: 70,
      unlockAt: 'world-2-clear',
    });
  });
});

// ==================== Unlock Logic ====================

describe('Unlock Logic', () => {
  it('should unlock bronze by default', () => {
    const state = { progress: { worldsCleared: [] } };
    const bronzeTier = EQUIPMENT.sword.tiers.find((t: any) => t.tier === 'bronze');
    expect(isTierUnlocked(bronzeTier, state)).toBe(true);
  });

  it('should unlock silver after world 1 cleared', () => {
    const state = { progress: { worldsCleared: [0] } };
    const silverTier = EQUIPMENT.sword.tiers.find((t: any) => t.tier === 'silver');
    expect(isTierUnlocked(silverTier, state)).toBe(true);
  });

  it('should not unlock silver before world 1 cleared', () => {
    const state = { progress: { worldsCleared: [] } };
    const silverTier = EQUIPMENT.sword.tiers.find((t: any) => t.tier === 'silver');
    expect(isTierUnlocked(silverTier, state)).toBe(false);
  });

  it('should unlock gold after world 2 cleared', () => {
    const state = { progress: { worldsCleared: [0, 1] } };
    const goldTier = EQUIPMENT.sword.tiers.find((t: any) => t.tier === 'gold');
    expect(isTierUnlocked(goldTier, state)).toBe(true);
  });

  it('should not unlock gold before world 2 cleared', () => {
    const state = { progress: { worldsCleared: [0] } };
    const goldTier = EQUIPMENT.sword.tiers.find((t: any) => t.tier === 'gold');
    expect(isTierUnlocked(goldTier, state)).toBe(false);
  });
});

// ==================== Buy Logic ====================

describe('Buy Equipment', () => {
  const baseState = {
    session: { stars: 100 },
    equipment: { sword: 'none', shield: 'none', potion: 'none' },
    progress: { worldsCleared: [0, 1] }, // World 2 cleared, so all tiers unlocked
  };

  describe('canBuy validation', () => {
    it('should allow buying sword when affordable', () => {
      const result = canBuy(baseState, 'sword', 'silver');
      expect(result.ok).toBe(true);
    });

    it('should reject insufficient stars', () => {
      const poorState = { ...baseState, session: { stars: 10 } };
      const result = canBuy(poorState, 'sword', 'silver');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('insufficient-stars');
    });

    it('should reject already owned tier', () => {
      const ownedState = { ...baseState, equipment: { sword: 'silver', shield: 'none', potion: 'none' } };
      const result = canBuy(ownedState, 'sword', 'silver');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('already-owned');
    });

    it('should reject buying lower tier than owned', () => {
      const ownedState = { ...baseState, equipment: { sword: 'gold', shield: 'none', potion: 'none' } };
      const result = canBuy(ownedState, 'sword', 'silver');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('already-owned');
    });

    it('should allow buying higher tier', () => {
      const ownedState = { ...baseState, equipment: { sword: 'silver', shield: 'none', potion: 'none' } };
      const result = canBuy(ownedState, 'sword', 'gold');
      expect(result.ok).toBe(true);
    });
  });

  describe('buyEquipment', () => {
    it('should buy equipment and deduct stars', () => {
      const result = buyEquipment(baseState, 'sword', 'bronze');
      expect(result.ok).toBe(true);
      expect(result.newState).toBeDefined();
      expect(result.newState?.equipment.sword).toBe('bronze');
    });

    it('should return error for insufficient stars', () => {
      const poorState = { ...baseState, session: { stars: 0 } };
      const result = buyEquipment(poorState, 'sword', 'silver');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('insufficient-stars');
    });

    it('should return error for already owned', () => {
      const ownedState = { ...baseState, equipment: { sword: 'bronze', shield: 'none', potion: 'none' } };
      const result = buyEquipment(ownedState, 'sword', 'bronze');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('already-owned');
    });

    it('should return error for invalid type', () => {
      const result = buyEquipment(baseState, 'invalid', 'bronze');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('item-not-found');
    });

    it('should upgrade equipment tier correctly', () => {
      const ownedState = { ...baseState, equipment: { sword: 'bronze', shield: 'none', potion: 'none' } };
      const result = buyEquipment(ownedState, 'sword', 'silver');
      expect(result.ok).toBe(true);
      expect(result.newState?.equipment.sword).toBe('silver');
      expect(result.newState?.session.stars).toBe(70); // 100 - 30
    });

    it('should not mutate original state', () => {
      const originalState = JSON.stringify(baseState);
      buyEquipment(baseState, 'sword', 'bronze');
      expect(JSON.stringify(baseState)).toBe(originalState);
    });
  });
});

// ==================== Apply Equipment to Hero ====================

describe('Apply Equipment to Hero', () => {
  const baseHero = {
    hp: 100,
    maxHp: 100,
    mp: 100,
    maxMp: 100,
    atk: 10,
    def: 0,
  };

  it('should not change hero with no equipment', () => {
    const equipment = { sword: 'none', shield: 'none', potion: 'none' };
    const hero = applyEquipmentToHero(baseHero, equipment);
    expect(hero.atk).toBe(10);
    expect(hero.def).toBe(0);
  });

  it('should apply bronze sword ATK bonus', () => {
    const equipment = { sword: 'bronze', shield: 'none', potion: 'none' };
    const hero = applyEquipmentToHero(baseHero, equipment);
    expect(hero.atk).toBe(5); // Bronze sword = 5 ATK (replaces base)
    expect(hero.def).toBe(0);
  });

  it('should apply silver sword ATK bonus', () => {
    const equipment = { sword: 'silver', shield: 'none', potion: 'none' };
    const hero = applyEquipmentToHero(baseHero, equipment);
    expect(hero.atk).toBe(12); // Silver sword = 12 ATK
  });

  it('should apply gold sword ATK bonus', () => {
    const equipment = { sword: 'gold', shield: 'none', potion: 'none' };
    const hero = applyEquipmentToHero(baseHero, equipment);
    expect(hero.atk).toBe(25); // Gold sword = 25 ATK
  });

  it('should apply bronze shield DEF bonus', () => {
    const equipment = { sword: 'none', shield: 'bronze', potion: 'none' };
    const hero = applyEquipmentToHero(baseHero, equipment);
    expect(hero.def).toBe(3); // Bronze shield = 3 DEF
  });

  it('should apply silver shield DEF bonus', () => {
    const equipment = { sword: 'none', shield: 'silver', potion: 'none' };
    const hero = applyEquipmentToHero(baseHero, equipment);
    expect(hero.def).toBe(8); // Silver shield = 8 DEF
  });

  it('should apply gold shield DEF bonus', () => {
    const equipment = { sword: 'none', shield: 'gold', potion: 'none' };
    const hero = applyEquipmentToHero(baseHero, equipment);
    expect(hero.def).toBe(15); // Gold shield = 15 DEF
  });

  it('should apply both sword and shield bonuses', () => {
    const equipment = { sword: 'gold', shield: 'gold', potion: 'none' };
    const hero = applyEquipmentToHero(baseHero, equipment);
    expect(hero.atk).toBe(25);
    expect(hero.def).toBe(15);
  });

  it('should apply silver sword and bronze shield', () => {
    const equipment = { sword: 'silver', shield: 'bronze', potion: 'none' };
    const hero = applyEquipmentToHero(baseHero, equipment);
    expect(hero.atk).toBe(12);
    expect(hero.def).toBe(3);
  });

  it('should not mutate original hero', () => {
    const equipment = { sword: 'gold', shield: 'gold', potion: 'none' };
    const originalAtk = baseHero.atk;
    const originalDef = baseHero.def;
    applyEquipmentToHero(baseHero, equipment);
    expect(baseHero.atk).toBe(originalAtk);
    expect(baseHero.def).toBe(originalDef);
  });
});

// ==================== Equipment Bonus ====================

describe('Get Equipment Bonus', () => {
  it('should return zeros with no equipment', () => {
    const bonus = getEquipmentBonus({ sword: 'none', shield: 'none', potion: 'none' });
    expect(bonus).toEqual({ atk: 0, def: 0, heal: 0 });
  });

  it('should return correct bonus for gold equipment', () => {
    const bonus = getEquipmentBonus({ sword: 'gold', shield: 'gold', potion: 'gold' });
    expect(bonus).toEqual({ atk: 25, def: 15, heal: 100 });
  });

  it('should return correct bonus for silver equipment', () => {
    const bonus = getEquipmentBonus({ sword: 'silver', shield: 'silver', potion: 'silver' });
    expect(bonus).toEqual({ atk: 12, def: 8, heal: 50 });
  });
});

// ==================== Default Equipment ====================

describe('Default Equipment', () => {
  it('should return none for all types', () => {
    const defaultEquip = getDefaultEquipment();
    expect(defaultEquip).toEqual({ sword: 'none', shield: 'none', potion: 'none' });
  });
});

// ==================== Auto Equip Bronze ====================

describe('Auto Equip Bronze', () => {
  it('should equip bronze for all types when none owned', () => {
    const state = {
      equipment: { sword: 'none', shield: 'none', potion: 'none' },
    };
    const newState = autoEquipBronze(state);
    expect(newState.equipment.sword).toBe('bronze');
    expect(newState.equipment.shield).toBe('bronze');
    expect(newState.equipment.potion).toBe('bronze');
  });

  it('should not change state when bronze already owned', () => {
    const state = {
      equipment: { sword: 'bronze', shield: 'none', potion: 'none' },
    };
    const newState = autoEquipBronze(state);
    expect(newState.equipment.sword).toBe('bronze');
    expect(newState.equipment.shield).toBe('bronze');
    expect(newState.equipment.potion).toBe('bronze');
  });

  it('should not mutate original state', () => {
    const state = {
      equipment: { sword: 'none', shield: 'none', potion: 'none' },
    };
    autoEquipBronze(state);
    expect(state.equipment.sword).toBe('none');
  });
});

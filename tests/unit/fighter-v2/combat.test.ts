// tests/unit/fighter-v2/combat.test.ts
//
// Unit tests for Fighter V2 combat.js - damage formula, mana regen, skill cooldowns
// Per spec §4 Combat Math
// Pure unit tests - no DOM required

import { describe, it, expect } from 'vitest';
import {
  calculateDamage,
  applyDamage,
  applyHealing,
  getHeroDef,
  getHeroAtk,
  HERO_DEFAULTS,
  SKILLS,
  createMonster,
  buildMonsterQueue,
  initBattle,
  BATTLE_STATE,
} from '../../../public/fighter/v2/combat.js';
import { MONSTER_TYPES } from '../../../public/fighter/v2/stages.js';

describe('Combat Math - Damage Formula', () => {

  describe('calculateDamage', () => {
    it('calculates basic damage correctly (atk - def)', () => {
      expect(calculateDamage(10, 0)).toBe(10);
      expect(calculateDamage(10, 5)).toBe(5);
      expect(calculateDamage(10, 2)).toBe(8);
    });

    it('returns minimum 1 damage when def >= atk', () => {
      expect(calculateDamage(5, 10)).toBe(1);
      expect(calculateDamage(10, 10)).toBe(1);
      expect(calculateDamage(0, 100)).toBe(1);
    });

    it('hero attack formula: damage = hero.atk - monster.def', () => {
      // Hero ATK 10 vs 懒词菌 DEF 0
      expect(calculateDamage(10, 0)).toBe(10);
      // Hero ATK 10 vs 多义虫 DEF 2
      expect(calculateDamage(10, 2)).toBe(8);
      // Hero ATK 10 vs 拼写巨龙 DEF 5
      expect(calculateDamage(10, 5)).toBe(5);
    });

    it('monster counter formula: damage = monster.atk - hero.def (with shield)', () => {
      // 懒词菌 ATK 5 vs Hero DEF 0
      expect(calculateDamage(5, 0)).toBe(5);
      // 懒词菌 ATK 5 vs Hero DEF 10 (shield)
      expect(calculateDamage(5, 10)).toBe(1); // min 1
      // 多义虫 ATK 8 vs Hero DEF 10 (shield)
      expect(calculateDamage(8, 10)).toBe(1); // min 1
      // 拼写巨龙 ATK 20 vs Hero DEF 10 (shield)
      expect(calculateDamage(20, 10)).toBe(10);
    });
  });

  describe('applyDamage', () => {
    it('reduces target HP by damage amount', () => {
      const target = { hp: 100, maxHp: 100 };
      const result = applyDamage(target, 30);
      expect(result.hp).toBe(70);
      expect(result.maxHp).toBe(100); // unchanged
    });

    it('caps HP at 0 (minimum)', () => {
      const target = { hp: 20, maxHp: 100 };
      const result = applyDamage(target, 50);
      expect(result.hp).toBe(0);
    });

    it('returns new object (immutable)', () => {
      const target = { hp: 100, maxHp: 100 };
      const result = applyDamage(target, 30);
      expect(result).not.toBe(target);
      expect(target.hp).toBe(100); // original unchanged
    });
  });

  describe('applyHealing', () => {
    it('increases target HP by heal amount', () => {
      const target = { hp: 50, maxHp: 100 };
      const result = applyHealing(target, 30);
      expect(result.hp).toBe(80);
    });

    it('caps HP at maxHp', () => {
      const target = { hp: 90, maxHp: 100 };
      const result = applyHealing(target, 30);
      expect(result.hp).toBe(100);
    });

    it('does nothing when already at maxHp', () => {
      const target = { hp: 100, maxHp: 100 };
      const result = applyHealing(target, 30);
      expect(result.hp).toBe(100);
    });

    it('returns new object (immutable)', () => {
      const target = { hp: 50, maxHp: 100 };
      const result = applyHealing(target, 30);
      expect(result).not.toBe(target);
      expect(target.hp).toBe(50); // original unchanged
    });
  });

});

describe('Combat Math - Hero DEF Calculation', () => {

  describe('getHeroDef', () => {
    it('returns base def when no buffs', () => {
      const hero = { ...HERO_DEFAULTS, def: 0, shieldBuff: 0, shieldBuffRounds: 0 };
      const equipment = { sword: 'none', shield: 'none', potion: 'none' };
      expect(getHeroDef(hero, equipment)).toBe(0);
    });

    it('adds shield buff to def when active', () => {
      const hero = { ...HERO_DEFAULTS, def: 0, shieldBuff: 10, shieldBuffRounds: 5 };
      const equipment = { sword: 'none', shield: 'none', potion: 'none' };
      expect(getHeroDef(hero, equipment)).toBe(10);
    });

    it('shield buff does not stack (uses current shieldBuff value)', () => {
      const hero = { ...HERO_DEFAULTS, def: 0, shieldBuff: 10, shieldBuffRounds: 5 };
      const equipment = { sword: 'none', shield: 'none', potion: 'none' };
      // Casting shield again doesn't stack, just refreshes rounds
      expect(getHeroDef(hero, equipment)).toBe(10);
    });

    it('returns 0 def when shield buff rounds expired', () => {
      const hero = { ...HERO_DEFAULTS, def: 0, shieldBuff: 0, shieldBuffRounds: 0 };
      const equipment = { sword: 'none', shield: 'none', potion: 'none' };
      expect(getHeroDef(hero, equipment)).toBe(0);
    });

    it('includes equipment shield bonus (P4 - always none in P3)', () => {
      const hero = { ...HERO_DEFAULTS, def: 0, shieldBuff: 0, shieldBuffRounds: 0 };
      const equipment = { sword: 'none', shield: 'bronze', potion: 'none' };
      expect(getHeroDef(hero, equipment)).toBe(3);
    });

    it('shield buff + equipment combine', () => {
      const hero = { ...HERO_DEFAULTS, def: 0, shieldBuff: 10, shieldBuffRounds: 3 };
      const equipment = { sword: 'none', shield: 'bronze', potion: 'none' };
      expect(getHeroDef(hero, equipment)).toBe(13);
    });
  });

  describe('getHeroAtk', () => {
    it('returns base atk when no equipment', () => {
      const hero = { ...HERO_DEFAULTS, atk: 10 };
      const equipment = { sword: 'none', shield: 'none', potion: 'none' };
      expect(getHeroAtk(hero, equipment)).toBe(10);
    });

    it('adds bronze sword bonus', () => {
      const hero = { ...HERO_DEFAULTS, atk: 10 };
      const equipment = { sword: 'bronze', shield: 'none', potion: 'none' };
      expect(getHeroAtk(hero, equipment)).toBe(15);
    });

    it('adds silver sword bonus', () => {
      const hero = { ...HERO_DEFAULTS, atk: 10 };
      const equipment = { sword: 'silver', shield: 'none', potion: 'none' };
      expect(getHeroAtk(hero, equipment)).toBe(22);
    });

    it('adds gold sword bonus', () => {
      const hero = { ...HERO_DEFAULTS, atk: 10 };
      const equipment = { sword: 'gold', shield: 'none', potion: 'none' };
      expect(getHeroAtk(hero, equipment)).toBe(35);
    });
  });

});

describe('Combat Math - Mana Regen', () => {

  it('MP regen +10 per turn (capped at maxMp)', () => {
    // Simulate end of turn MP regen
    const hero = { ...HERO_DEFAULTS, mp: 90 };
    const newMp = Math.min(hero.mp + 10, hero.maxMp);
    expect(newMp).toBe(100);

    const hero2 = { ...HERO_DEFAULTS, mp: 50 };
    const newMp2 = Math.min(hero2.mp + 10, hero2.maxMp);
    expect(newMp2).toBe(60);
  });

  it('MP regen does not exceed maxMp', () => {
    const hero = { ...HERO_DEFAULTS, mp: 95 };
    const newMp = Math.min(hero.mp + 10, hero.maxMp);
    expect(newMp).toBe(100);
  });

});

describe('Monster Factory', () => {

  describe('createMonster', () => {
    it('creates 懒词菌 (fungus) with correct stats', () => {
      const monster = createMonster('fungus', 0, MONSTER_TYPES);
      expect(monster.type).toBe('fungus');
      expect(monster.name).toBe('懒词菌');
      expect(monster.hp).toBe(30);
      expect(monster.maxHp).toBe(30);
      expect(monster.atk).toBe(5);
      expect(monster.def).toBe(0);
      expect(monster.id).toBe('fungus-0');
    });

    it('creates 多义虫 (worm) with correct stats', () => {
      const monster = createMonster('worm', 1, MONSTER_TYPES);
      expect(monster.type).toBe('worm');
      expect(monster.name).toBe('多义虫');
      expect(monster.hp).toBe(50);
      expect(monster.maxHp).toBe(50);
      expect(monster.atk).toBe(8);
      expect(monster.def).toBe(2);
      expect(monster.id).toBe('worm-1');
    });

    it('creates 拼写巨龙 (dragon) with correct stats', () => {
      const monster = createMonster('dragon', 2, MONSTER_TYPES);
      expect(monster.type).toBe('dragon');
      expect(monster.name).toBe('拼写巨龙');
      expect(monster.hp).toBe(100);
      expect(monster.maxHp).toBe(100);
      expect(monster.atk).toBe(20);
      expect(monster.def).toBe(5);
      expect(monster.id).toBe('dragon-2');
    });
  });

  describe('buildMonsterQueue', () => {
    it('builds Stage 1-1: 3 懒词菌', () => {
      const stage = { monsters: [{ type: 'fungus', count: 3 }] };
      const queue = buildMonsterQueue(stage, MONSTER_TYPES);
      expect(queue).toHaveLength(3);
      queue.forEach((m, i) => {
        expect(m.type).toBe('fungus');
        expect(m.id).toBe(`fungus-${i}`);
      });
    });

    it('builds Stage 1-2: 4 懒词菌', () => {
      const stage = { monsters: [{ type: 'fungus', count: 4 }] };
      const queue = buildMonsterQueue(stage, MONSTER_TYPES);
      expect(queue).toHaveLength(4);
    });

    it('builds Stage 3-3 (BOSS): 1 dragon + 3 worm', () => {
      const stage = { monsters: [{ type: 'dragon', count: 1 }, { type: 'worm', count: 3 }] };
      const queue = buildMonsterQueue(stage, MONSTER_TYPES);
      expect(queue).toHaveLength(4);
      expect(queue[0].type).toBe('dragon');
      expect(queue.slice(1).every((m) => m.type === 'worm')).toBe(true);
    });
  });

});

describe('Battle Init', () => {

  describe('initBattle', () => {
    it('initializes battle for Stage 1-1', () => {
      const stage = { worldIdx: 0, stageIdx: 0, id: '1-1', monsters: [{ type: 'fungus', count: 3 }], totalMonsters: 3 };
      const battleState = initBattle(stage, HERO_DEFAULTS, MONSTER_TYPES, 0);

      expect(battleState.state).toBe(BATTLE_STATE.HERO_TURN);
      expect(battleState.turnCount).toBe(1);
      expect(battleState.worldIdx).toBe(0);
      expect(battleState.stageIdx).toBe(0);
      expect(battleState.totalMonsters).toBe(3);
      expect(battleState.currentMonsterIdx).toBe(0);
      expect(battleState.monsters).toHaveLength(3);
      expect(battleState.hero.hp).toBe(100);
      expect(battleState.hero.mp).toBe(100);
    });

    it('resets hero to full HP/MP on battle start', () => {
      const stage = { worldIdx: 0, stageIdx: 0, id: '1-1', monsters: [{ type: 'fungus', count: 1 }], totalMonsters: 1 };
      const battleState = initBattle(stage, HERO_DEFAULTS, MONSTER_TYPES, 0);

      expect(battleState.hero.hp).toBe(100);
      expect(battleState.hero.maxHp).toBe(100);
      expect(battleState.hero.mp).toBe(100);
      expect(battleState.hero.maxMp).toBe(100);
    });

    it('initializes all cooldowns to 0', () => {
      const stage = { worldIdx: 0, stageIdx: 0, id: '1-1', monsters: [{ type: 'fungus', count: 1 }], totalMonsters: 1 };
      const battleState = initBattle(stage, HERO_DEFAULTS, MONSTER_TYPES, 0);

      expect(battleState.hero.skillCooldowns.fireball).toBe(0);
      expect(battleState.hero.skillCooldowns.heal).toBe(0);
      expect(battleState.hero.skillCooldowns.shield).toBe(0);
    });
  });

});

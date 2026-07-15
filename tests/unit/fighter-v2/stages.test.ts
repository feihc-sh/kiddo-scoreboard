// tests/unit/fighter-v2/stages.test.ts
//
// Unit tests for Fighter V2 stages.js - 5 World × 3 stage data table
// Per spec §4 Stage Script
// Pure unit tests - no DOM required

import { describe, it, expect } from 'vitest';
import {
  STAGES,
  WORLDS,
  MONSTER_TYPES,
  getStage,
  getWorldStages,
  getWorld,
  isWorldUnlocked,
} from '../../../public/fighter/v2/stages.js';

describe('STAGES - Stage Script Table', () => {

  it('has exactly 15 stages (5 World × 3 Stage)', () => {
    expect(STAGES).toHaveLength(15);
  });

  it('World 1 has 3 stages', () => {
    const world1 = STAGES.filter((s) => s.worldIdx === 0);
    expect(world1).toHaveLength(3);
  });

  it('World 2 has 3 stages', () => {
    const world2 = STAGES.filter((s) => s.worldIdx === 1);
    expect(world2).toHaveLength(3);
  });

  it('World 3 has 3 stages', () => {
    const world3 = STAGES.filter((s) => s.worldIdx === 2);
    expect(world3).toHaveLength(3);
  });

  // ---- Stage 1-1 ----
  it('Stage 1-1 has 懒词菌 × 3', () => {
    const stage = STAGES.find((s) => s.id === '1-1');
    expect(stage).toBeDefined();
    expect(stage!.monsters).toEqual([{ type: 'fungus', count: 3 }]);
    expect(stage!.totalMonsters).toBe(3);
    expect(stage!.difficulty).toBe(1);
  });

  // ---- Stage 1-2 ----
  it('Stage 1-2 has 懒词菌 × 4', () => {
    const stage = STAGES.find((s) => s.id === '1-2');
    expect(stage).toBeDefined();
    expect(stage!.monsters).toEqual([{ type: 'fungus', count: 4 }]);
    expect(stage!.totalMonsters).toBe(4);
    expect(stage!.difficulty).toBe(1);
  });

  // ---- Stage 1-3 ----
  it('Stage 1-3 has 懒词菌 × 5', () => {
    const stage = STAGES.find((s) => s.id === '1-3');
    expect(stage).toBeDefined();
    expect(stage!.monsters).toEqual([{ type: 'fungus', count: 5 }]);
    expect(stage!.totalMonsters).toBe(5);
    expect(stage!.difficulty).toBe(1);
  });

  // ---- Stage 2-1 ----
  it('Stage 2-1 has 多义虫 × 3', () => {
    const stage = STAGES.find((s) => s.id === '2-1');
    expect(stage).toBeDefined();
    expect(stage!.monsters).toEqual([{ type: 'worm', count: 3 }]);
    expect(stage!.totalMonsters).toBe(3);
    expect(stage!.difficulty).toBe(1);
  });

  // ---- Stage 2-2 ----
  it('Stage 2-2 has 多义虫 × 4', () => {
    const stage = STAGES.find((s) => s.id === '2-2');
    expect(stage).toBeDefined();
    expect(stage!.monsters).toEqual([{ type: 'worm', count: 4 }]);
    expect(stage!.totalMonsters).toBe(4);
    expect(stage!.difficulty).toBe(1);
  });

  // ---- Stage 2-3 ----
  it('Stage 2-3 has 多义虫 × 5 + 懒词菌 × 2 = 7 total', () => {
    const stage = STAGES.find((s) => s.id === '2-3');
    expect(stage).toBeDefined();
    expect(stage!.monsters).toEqual([{ type: 'worm', count: 5 }, { type: 'fungus', count: 2 }]);
    expect(stage!.totalMonsters).toBe(7);
    expect(stage!.difficulty).toBe(2);
  });

  // ---- Stage 3-1 ----
  it('Stage 3-1 has 多义虫 × 4 + 懒词菌 × 2 = 6 total', () => {
    const stage = STAGES.find((s) => s.id === '3-1');
    expect(stage).toBeDefined();
    expect(stage!.monsters).toEqual([{ type: 'worm', count: 4 }, { type: 'fungus', count: 2 }]);
    expect(stage!.totalMonsters).toBe(6);
    expect(stage!.difficulty).toBe(2);
  });

  // ---- Stage 3-2 ----
  it('Stage 3-2 has 多义虫 × 6', () => {
    const stage = STAGES.find((s) => s.id === '3-2');
    expect(stage).toBeDefined();
    expect(stage!.monsters).toEqual([{ type: 'worm', count: 6 }]);
    expect(stage!.totalMonsters).toBe(6);
    expect(stage!.difficulty).toBe(2);
  });

  // ---- Stage 3-3 (BOSS) ----
  it('Stage 3-3 has 拼写巨龙 × 1 + 多义虫 × 3 = 4 total', () => {
    const stage = STAGES.find((s) => s.id === '3-3');
    expect(stage).toBeDefined();
    expect(stage!.monsters).toEqual([{ type: 'dragon', count: 1 }, { type: 'worm', count: 3 }]);
    expect(stage!.totalMonsters).toBe(4);
    expect(stage!.difficulty).toBe(3);
  });

  // ---- World 4-5 (deferred) ----
  it('World 4 has empty monsters (deferred)', () => {
    const world4 = STAGES.filter((s) => s.worldIdx === 3);
    expect(world4).toHaveLength(3);
    world4.forEach((s) => {
      expect(s.monsters).toHaveLength(0);
    });
  });

  it('World 5 has empty monsters (deferred)', () => {
    const world5 = STAGES.filter((s) => s.worldIdx === 4);
    expect(world5).toHaveLength(3);
    world5.forEach((s) => {
      expect(s.monsters).toHaveLength(0);
    });
  });

});

describe('WORLDS - World Metadata', () => {

  it('has exactly 5 worlds', () => {
    expect(WORLDS).toHaveLength(5);
  });

  it('World 1 (菌绿森林) is unlocked by default', () => {
    const world1 = WORLDS.find((w) => w.idx === 0);
    expect(world1!.name).toBe('菌绿森林');
    expect(world1!.unlockedBy).toBeNull();
  });

  it('World 2 (多义虫巢穴) is unlocked by clearing World 1', () => {
    const world2 = WORLDS.find((w) => w.idx === 1);
    expect(world2!.name).toBe('多义虫巢穴');
    expect(world2!.unlockedBy).toBe(0);
  });

  it('World 3 (拼写巨龙洞穴) is unlocked by clearing World 2', () => {
    const world3 = WORLDS.find((w) => w.idx === 2);
    expect(world3!.name).toBe('拼写巨龙洞穴');
    expect(world3!.unlockedBy).toBe(1);
  });

  it('World 4 (法师高塔) is unlocked by clearing World 3', () => {
    const world4 = WORLDS.find((w) => w.idx === 3);
    expect(world4!.name).toBe('法师高塔');
    expect(world4!.unlockedBy).toBe(2);
  });

  it('World 5 (终极城堡) is unlocked by clearing World 4', () => {
    const world5 = WORLDS.find((w) => w.idx === 4);
    expect(world5!.name).toBe('终极城堡');
    expect(world5!.unlockedBy).toBe(3);
  });

  it('each world has an emoji', () => {
    WORLDS.forEach((w) => {
      expect(w.emoji).toBeDefined();
      expect(w.emoji.length).toBeGreaterThan(0);
    });
  });

});

describe('MONSTER_TYPES - Monster Definitions', () => {

  it('懒词菌 (fungus) has correct stats', () => {
    const fungus = MONSTER_TYPES.fungus;
    expect(fungus.name).toBe('懒词菌');
    expect(fungus.hp).toBe(30);
    expect(fungus.atk).toBe(5);
    expect(fungus.def).toBe(0);
  });

  it('多义虫 (worm) has correct stats', () => {
    const worm = MONSTER_TYPES.worm;
    expect(worm.name).toBe('多义虫');
    expect(worm.hp).toBe(50);
    expect(worm.atk).toBe(8);
    expect(worm.def).toBe(2);
  });

  it('拼写巨龙 (dragon) has correct stats', () => {
    const dragon = MONSTER_TYPES.dragon;
    expect(dragon.name).toBe('拼写巨龙');
    expect(dragon.hp).toBe(100);
    expect(dragon.atk).toBe(20);
    expect(dragon.def).toBe(5);
  });

});

describe('Helper Functions', () => {

  describe('getStage', () => {
    it('returns correct stage for valid indices', () => {
      const stage = getStage(0, 0);
      expect(stage!.id).toBe('1-1');
    });

    it('returns undefined for invalid indices', () => {
      const stage = getStage(99, 99);
      expect(stage).toBeUndefined();
    });
  });

  describe('getWorldStages', () => {
    it('returns 3 stages for World 1', () => {
      const stages = getWorldStages(0);
      expect(stages).toHaveLength(3);
    });

    it('returns stages in stageIdx order', () => {
      const stages = getWorldStages(0);
      expect(stages[0].stageIdx).toBe(0);
      expect(stages[1].stageIdx).toBe(1);
      expect(stages[2].stageIdx).toBe(2);
    });
  });

  describe('getWorld', () => {
    it('returns correct world for valid index', () => {
      const world = getWorld(0);
      expect(world!.name).toBe('菌绿森林');
    });

    it('returns undefined for invalid index', () => {
      const world = getWorld(99);
      expect(world).toBeUndefined();
    });
  });

  describe('isWorldUnlocked', () => {
    it('World 1 is always unlocked', () => {
      expect(isWorldUnlocked(0, [])).toBe(true);
      expect(isWorldUnlocked(0, [0])).toBe(true);
    });

    it('World 2 is locked if World 1 not cleared', () => {
      expect(isWorldUnlocked(1, [])).toBe(false);
    });

    it('World 2 is unlocked if World 1 cleared', () => {
      expect(isWorldUnlocked(1, [0])).toBe(true);
    });

    it('World 3 is locked if World 2 not cleared', () => {
      expect(isWorldUnlocked(2, [])).toBe(false);
      expect(isWorldUnlocked(2, [0])).toBe(false);
    });

    it('World 3 is unlocked if World 2 cleared', () => {
      expect(isWorldUnlocked(2, [0, 1])).toBe(true);
    });
  });

});

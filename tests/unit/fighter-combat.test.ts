// tests/unit/fighter-combat.test.ts
//
// TDD unit tests for src/games/fighter/logic.ts combat functions.
// RED: write tests first, confirm they fail, then implement GREEN.
//
// Pattern mirrors tests/unit/fighter-damage.test.ts — in-memory, no network.

import { describe, it, expect } from 'vitest';
import {
  isMonsterDead,
  attackMonster,
  gainStars,
  spawnNextMonster,
  killCurrentMonster,
  startGame,
} from '../../src/games/fighter/logic.ts';
import type { GameState, Monster } from '../../src/games/fighter/state.ts';
import { STAGES, monsterHpFor } from '../../src/games/fighter/state.ts';

// Helper to build a fresh GameState
function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    hero: { hp: 100, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: 0 },
    currentMonster: null,
    stageIdx: 0,
    stageQueueRemaining: 0,
    stageStartIdx: 0,
    bank: 0,
    sessionStars: 0,
    status: 'menu',
    equippedItems: { sword: false, shield: false, potion: false },
    ...overrides,
  };
}

// Helper to build a monster template (no hp/maxHp)
function fungusTemplate() {
  return { id: 'fungus', name: '懒词菌', atk: 5, def: 0 };
}

// Helper to build a live monster
function liveFungus(overrides: Partial<Monster> = {}): Monster {
  return { id: 'fungus', name: '懒词菌', atk: 5, def: 0, hp: 30, maxHp: 30, ...overrides };
}

describe('isMonsterDead', () => {

  it('returns true when hp is 0', () => {
    expect(isMonsterDead(liveFungus({ hp: 0 }))).toBe(true);
  });

  it('returns true when hp is negative', () => {
    expect(isMonsterDead(liveFungus({ hp: -5 }))).toBe(true);
  });

  it('returns false when hp > 0', () => {
    expect(isMonsterDead(liveFungus({ hp: 1 }))).toBe(false);
    expect(isMonsterDead(liveFungus({ hp: 15 }))).toBe(false);
    expect(isMonsterDead(liveFungus({ hp: 30 }))).toBe(false);
  });

  it('returns true when monster is null (safety check)', () => {
    expect(isMonsterDead(null)).toBe(true);
  });

});

describe('attackMonster', () => {

  it('reduces currentMonster.hp by hero.atk', () => {
    const state = makeState({ currentMonster: liveFungus({ hp: 30, maxHp: 30 }) });
    const next = attackMonster(state);
    expect(next.currentMonster!.hp).toBe(20); // 30 - 10
  });

  it('clamps hp to 0 not negative', () => {
    const state = makeState({ currentMonster: liveFungus({ hp: 5, maxHp: 30 }) });
    const next = attackMonster(state);
    expect(next.currentMonster!.hp).toBe(0);
    expect(next.currentMonster!.hp).toBeGreaterThanOrEqual(0);
  });

  it('is pure: does not mutate input state', () => {
    const state = makeState({ currentMonster: liveFungus({ hp: 20, maxHp: 30 }) });
    const next = attackMonster(state);
    // Input state unchanged
    expect(state.currentMonster!.hp).toBe(20);
    // Output is a new object
    expect(next).not.toBe(state);
    expect(next.currentMonster).not.toBe(state.currentMonster);
  });

  it('returns unchanged state when currentMonster is null', () => {
    const state = makeState({ currentMonster: null });
    const next = attackMonster(state);
    expect(next).toEqual(state);
    expect(next.currentMonster).toBe(null);
  });

});

describe('gainStars', () => {

  it('increments sessionStars by amount', () => {
    const state = makeState({ sessionStars: 0 });
    const next = gainStars(state, 5);
    expect(next.sessionStars).toBe(5);
  });

  it('increments bank by amount', () => {
    const state = makeState({ bank: 10 });
    const next = gainStars(state, 3);
    expect(next.bank).toBe(13);
  });

  it('with 0 amount returns equivalent state', () => {
    const state = makeState({ sessionStars: 7, bank: 3 });
    const next = gainStars(state, 0);
    expect(next.sessionStars).toBe(7);
    expect(next.bank).toBe(3);
  });

  it('is pure: does not mutate input state', () => {
    const state = makeState({ sessionStars: 0, bank: 0 });
    const next = gainStars(state, 5);
    expect(state.sessionStars).toBe(0);
    expect(state.bank).toBe(0);
    expect(next).not.toBe(state);
  });

});

describe('spawnNextMonster', () => {

  it('sets currentMonster to first from stage queue with full HP', () => {
    // Properly initialized state with queue pre-loaded (stage 1: 5 fungus)
    const state = makeState({ stageIdx: 0, stageQueueRemaining: 5 });
    const next = spawnNextMonster(state);
    expect(next.currentMonster).not.toBeNull();
    expect(next.currentMonster!.id).toBe('fungus');
    expect(next.currentMonster!.hp).toBe(30);  // full HP from monsterHpFor
    expect(next.currentMonster!.maxHp).toBe(30);
  });

  it('decrements stage queue by 1', () => {
    const state = makeState({ stageIdx: 0, stageQueueRemaining: 5 });
    const next = spawnNextMonster(state);
    // STAGES[0] starts with 5 fungus
    expect(STAGES[0].monsters.length).toBe(5);
    // After spawn, 4 remain in queue
    expect(next.stageQueueRemaining).toBe(4);
  });

  it('returns state with currentMonster=null when queue is empty', () => {
    // Build a state with an empty queue (stage 1 fully consumed)
    const state = makeState({ stageIdx: 0, stageQueueRemaining: 0 });
    const next = spawnNextMonster(state);
    expect(next.currentMonster).toBeNull();
  });

  it('is pure: does not mutate input state', () => {
    const state = makeState({ stageIdx: 0, stageQueueRemaining: 5 });
    const next = spawnNextMonster(state);
    expect(next).not.toBe(state);
    expect(next.stageQueueRemaining).not.toBe(state.stageQueueRemaining);
  });

});

describe('killCurrentMonster', () => {

  it('awards 1 star and spawns next monster', () => {
    const state = makeState({
      currentMonster: liveFungus({ hp: 10 }), // nearly dead
      stageQueueRemaining: 5,  // 5 total in queue (will spawn 1 more)
    });
    const next = killCurrentMonster(state);
    expect(next.sessionStars).toBe(1);
    expect(next.currentMonster).not.toBeNull();
    expect(next.currentMonster!.id).toBe('fungus');
    expect(next.stageQueueRemaining).toBe(4);
  });

  it('on empty queue sets currentMonster=null (stage complete)', () => {
    const state = makeState({
      currentMonster: liveFungus({ hp: 10 }),
      stageQueueRemaining: 0, // no more monsters
    });
    const next = killCurrentMonster(state);
    expect(next.sessionStars).toBe(1);
    expect(next.currentMonster).toBeNull();
  });

  it('is pure: does not mutate input state', () => {
    const state = makeState({
      currentMonster: liveFungus({ hp: 10 }),
      stageQueueRemaining: 5,
      sessionStars: 0,
    });
    const next = killCurrentMonster(state);
    expect(state.sessionStars).toBe(0);
    expect(next).not.toBe(state);
  });

});

describe('startGame', () => {

  it('sets status to fighting and spawns first monster of stage 1', () => {
    const state = makeState({ status: 'menu' });
    const next = startGame(state);
    expect(next.status).toBe('fighting');
    expect(next.currentMonster).not.toBeNull();
    expect(next.currentMonster!.id).toBe('fungus');
    expect(next.stageQueueRemaining).toBe(4); // 5 total - 1 spawned
  });

  it('is pure: does not mutate input state', () => {
    const state = makeState({ status: 'menu' });
    const next = startGame(state);
    expect(state.status).toBe('menu');
    expect(next).not.toBe(state);
  });

});

describe('monsterHpFor (state helper)', () => {

  it('returns 30 for fungus', () => {
    expect(monsterHpFor(fungusTemplate())).toBe(30);
  });

  it('returns 50 for worm', () => {
    expect(monsterHpFor({ id: 'worm', name: '多义虫', atk: 8, def: 2 })).toBe(50);
  });

  it('returns 100 for dragon', () => {
    expect(monsterHpFor({ id: 'dragon', name: '拼写巨龙', atk: 20, def: 5 })).toBe(100);
  });

});

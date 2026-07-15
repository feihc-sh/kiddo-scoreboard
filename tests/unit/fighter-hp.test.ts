// tests/unit/fighter-hp.test.ts
//
// TDD unit tests for Stage 3: Hero HP + Counter-Attack + Monster Variants.
// RED: write tests first, confirm they fail, then implement GREEN.
//
// Pattern mirrors tests/unit/fighter-damage.test.ts and fighter-combat.test.ts

import { describe, it, expect } from 'vitest';
import {
  damage,
  monsterCounterAttack,
  tickGame,
  isGameOver,
  restartGame,
  makeMonster,
} from '../../src/games/fighter/logic.ts';
import type { GameState, Monster } from '../../src/games/fighter/state.ts';
import { STAGES, heroTakeDamage, MONSTER_VARIANTS } from '../../src/games/fighter/state.ts';

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

// Helper to build a live monster
function liveFungus(overrides: Partial<Monster> = {}): Monster {
  return { id: 'fungus', name: '懒词菌', atk: 5, def: 0, hp: 30, maxHp: 30, ...overrides };
}

function liveWorm(overrides: Partial<Monster> = {}): Monster {
  return { id: 'worm', name: '多义虫', atk: 8, def: 2, hp: 50, maxHp: 50, ...overrides };
}

function liveDragon(overrides: Partial<Monster> = {}): Monster {
  return { id: 'dragon', name: '拼写巨龙', atk: 20, def: 5, hp: 100, maxHp: 100, ...overrides };
}

describe('heroTakeDamage', () => {

  it('returns monster.atk when hero has no shield', () => {
    const hero = { hp: 100, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0 };
    const monster = liveFungus({ atk: 5 });
    expect(heroTakeDamage(monster, hero)).toBe(5);
  });

  it('subtracts shieldBonus from damage', () => {
    const hero = { hp: 100, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 3 };
    const monster = liveFungus({ atk: 5 });
    expect(heroTakeDamage(monster, hero)).toBe(2); // 5 - 3 = 2
  });

  it('returns at least 1 even with high shield', () => {
    const hero = { hp: 100, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 10 };
    const monster = liveFungus({ atk: 5 });
    expect(heroTakeDamage(monster, hero)).toBe(1); // max(1, 5 - 10) = 1
  });

});

describe('monsterCounterAttack', () => {

  it('reduces hero.hp by monster.atk (after shield reduction)', () => {
    const state = makeState({
      status: 'fighting',
      currentMonster: liveFungus({ atk: 5 }),
      hero: { hp: 100, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: 0 },
    });
    const nowMs = Date.now();
    const next = monsterCounterAttack(state, nowMs);
    expect(next.hero.hp).toBe(95); // 100 - 5
  });

  it('applies shieldBonus when hero has shield equipped', () => {
    const state = makeState({
      status: 'fighting',
      currentMonster: liveFungus({ atk: 5 }),
      hero: { hp: 100, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 3, lastHitAt: 0 },
    });
    const nowMs = Date.now();
    const next = monsterCounterAttack(state, nowMs);
    expect(next.hero.hp).toBe(98); // 100 - 2 (5 - 3 shield)
  });

  it('respects counterIntervalMs (no damage if too soon)', () => {
    const state = makeState({
      status: 'fighting',
      currentMonster: liveFungus({ atk: 5 }),
      hero: { hp: 100, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: Date.now() },
    });
    // Last hit was just now, counter interval is 3000ms for fungus
    const next = monsterCounterAttack(state, Date.now());
    expect(next.hero.hp).toBe(100); // No damage, not enough time passed
  });

  it('sets status to lost when hero.hp <= 0', () => {
    const state = makeState({
      status: 'fighting',
      currentMonster: liveFungus({ atk: 5 }),
      hero: { hp: 5, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: 0 },
    });
    const nowMs = Date.now();
    const next = monsterCounterAttack(state, nowMs);
    expect(next.status).toBe('lost');
    expect(next.currentMonster).toBeNull();
  });

  it('is no-op when status is not fighting', () => {
    const state = makeState({
      status: 'menu',
      currentMonster: liveFungus({ atk: 5 }),
      hero: { hp: 100, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: 0 },
    });
    const nowMs = Date.now();
    const next = monsterCounterAttack(state, nowMs);
    expect(next.hero.hp).toBe(100); // No change
  });

  it('is no-op when currentMonster is null', () => {
    const state = makeState({
      status: 'fighting',
      currentMonster: null,
      hero: { hp: 100, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: 0 },
    });
    const nowMs = Date.now();
    const next = monsterCounterAttack(state, nowMs);
    expect(next.hero.hp).toBe(100); // No change
  });

  it('updates hero.lastHitAt when damage is dealt', () => {
    const lastHitTime = Date.now() - 5000; // 5 seconds ago
    const state = makeState({
      status: 'fighting',
      currentMonster: liveFungus({ atk: 5 }),
      hero: { hp: 100, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: lastHitTime },
    });
    const nowMs = Date.now();
    const next = monsterCounterAttack(state, nowMs);
    expect(next.hero.lastHitAt).toBe(nowMs);
  });

  it('worm deals 8 damage per counter (atk:8, no shield)', () => {
    const state = makeState({
      status: 'fighting',
      currentMonster: liveWorm(),
      hero: { hp: 100, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: 0 },
    });
    const nowMs = Date.now();
    const next = monsterCounterAttack(state, nowMs);
    expect(next.hero.hp).toBe(92); // 100 - 8
  });

  it('dragon deals 20 damage per counter', () => {
    const state = makeState({
      status: 'fighting',
      currentMonster: liveDragon(),
      hero: { hp: 100, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: 0 },
    });
    const nowMs = Date.now();
    const next = monsterCounterAttack(state, nowMs);
    expect(next.hero.hp).toBe(80); // 100 - 20
  });

});

describe('isGameOver', () => {

  it('returns true when status is lost', () => {
    const state = makeState({ status: 'lost' });
    expect(isGameOver(state)).toBe(true);
  });

  it('returns false when status is fighting', () => {
    const state = makeState({ status: 'fighting' });
    expect(isGameOver(state)).toBe(false);
  });

  it('returns false when status is menu', () => {
    const state = makeState({ status: 'menu' });
    expect(isGameOver(state)).toBe(false);
  });

  it('returns false when status is won', () => {
    const state = makeState({ status: 'won' });
    expect(isGameOver(state)).toBe(false);
  });

});

describe('restartGame', () => {

  it('resets hero to full HP', () => {
    const state = makeState({
      hero: { hp: 20, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: Date.now() },
      sessionStars: 5,
      status: 'lost',
    });
    const next = restartGame(state);
    expect(next.hero.hp).toBe(100);
    expect(next.hero.maxHp).toBe(100);
  });

  it('resets stars to 0', () => {
    const state = makeState({ sessionStars: 10 });
    const next = restartGame(state);
    expect(next.sessionStars).toBe(0);
  });

  it('resets status to menu', () => {
    const state = makeState({ status: 'lost' });
    const next = restartGame(state);
    expect(next.status).toBe('menu');
  });

  it('preserves bank across restart', () => {
    const state = makeState({ bank: 25, sessionStars: 10, status: 'lost' });
    const next = restartGame(state);
    expect(next.bank).toBe(25);
  });

  it('is pure: does not mutate input state', () => {
    const state = makeState({ hero: { hp: 20, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: 0 }, sessionStars: 5 });
    const next = restartGame(state);
    expect(state.hero.hp).toBe(20);
    expect(state.sessionStars).toBe(5);
    expect(next).not.toBe(state);
  });

});

describe('makeMonster', () => {

  it('creates Monster with correct hp from variant', () => {
    const monster = makeMonster('fungus');
    expect(monster.hp).toBe(30);
    expect(monster.maxHp).toBe(30);
    expect(monster.atk).toBe(5);
    expect(monster.def).toBe(0);
  });

  it('dragon sets hp=100', () => {
    const monster = makeMonster('dragon');
    expect(monster.hp).toBe(100);
    expect(monster.maxHp).toBe(100);
    expect(monster.atk).toBe(20);
    expect(monster.def).toBe(5);
  });

  it('worm sets hp=50', () => {
    const monster = makeMonster('worm');
    expect(monster.hp).toBe(50);
    expect(monster.maxHp).toBe(50);
    expect(monster.atk).toBe(8);
    expect(monster.def).toBe(2);
  });

  it('fungus sets hp=30', () => {
    const monster = makeMonster('fungus');
    expect(monster.hp).toBe(30);
    expect(monster.maxHp).toBe(30);
  });

  it('includes name from variant', () => {
    expect(makeMonster('fungus').name).toBe('懒词菌');
    expect(makeMonster('worm').name).toBe('多义虫');
    expect(makeMonster('dragon').name).toBe('拼写巨龙');
  });

});

describe('tickGame', () => {

  it('is alias for monsterCounterAttack', () => {
    const state = makeState({
      status: 'fighting',
      currentMonster: liveFungus({ atk: 5 }),
      hero: { hp: 100, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: 0 },
    });
    const nowMs = Date.now();
    const tickResult = tickGame(state, nowMs);
    const counterResult = monsterCounterAttack(state, nowMs);
    expect(tickResult).toEqual(counterResult);
  });

});

describe('MONSTER_VARIANTS', () => {

  it('fungus has correct counterIntervalMs of 3000', () => {
    expect(MONSTER_VARIANTS.fungus.counterIntervalMs).toBe(3000);
  });

  it('worm has correct counterIntervalMs of 2500', () => {
    expect(MONSTER_VARIANTS.worm.counterIntervalMs).toBe(2500);
  });

  it('dragon has correct counterIntervalMs of 2000', () => {
    expect(MONSTER_VARIANTS.dragon.counterIntervalMs).toBe(2000);
  });

});

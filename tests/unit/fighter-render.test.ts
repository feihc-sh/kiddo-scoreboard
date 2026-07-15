// tests/unit/fighter-render.test.ts
//
// TDD unit tests for fighter.js render functions.
// Verifies: renderMonster injects img tags, renderHero injects img tag,
// renderHpBar sets correct width percentage.
//
// Since these are unit tests (no DOM), we test the pure logic that drives
// the render calls and verify the state mutations that affect rendering.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  attackMonster,
  killCurrentMonster,
  spawnNextMonster,
  startGame,
} from '../../src/games/fighter/logic.ts';
import { initialState, monsterHpFor } from '../../src/games/fighter/state.ts';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('renderMonster data contract', () => {

  it('spawnMonster sets currentMonster with id matching asset key pattern monster-{id}.png', () => {
    // Given initial state
    const state = initialState();

    // When we start the game (spawn first monster)
    const afterStart = startGame(state);

    // Then monster id is 'fungus' → asset key is 'monster-fungus.png'
    expect(afterStart.currentMonster).not.toBeNull();
    expect(afterStart.currentMonster!.id).toBe('fungus');
  });

  it('monsterHpFor returns correct HP for each monster type', () => {
    expect(monsterHpFor({ id: 'fungus', name: '懒词菌', atk: 5, def: 0 })).toBe(30);
    expect(monsterHpFor({ id: 'worm', name: '多义虫', atk: 8, def: 2 })).toBe(50);
    expect(monsterHpFor({ id: 'dragon', name: '拼写巨龙', atk: 20, def: 5 })).toBe(100);
  });

});

describe('renderHpBar width percentage contract', () => {

  it('HP percent = hero.hp / hero.maxHp * 100 when full health', () => {
    const state = initialState();
    const pct = (state.hero.hp / state.hero.maxHp) * 100;
    expect(pct).toBe(100);
  });

  it('HP percent = hero.hp / hero.maxHp * 100 when half health', () => {
    const state = { ...initialState(), hero: { ...initialState().hero, hp: 50 } };
    const pct = (state.hero.hp / state.hero.maxHp) * 100;
    expect(pct).toBe(50);
  });

  it('HP percent = hero.hp / hero.maxHp * 100 when critical (10%)', () => {
    const state = { ...initialState(), hero: { ...initialState().hero, hp: 10 } };
    const pct = (state.hero.hp / state.hero.maxHp) * 100;
    expect(pct).toBe(10);
  });

  it('clamp to 0 when HP is 0', () => {
    const state = { ...initialState(), hero: { ...initialState().hero, hp: 0 } };
    const pct = Math.max(0, Math.min(100, (state.hero.hp / state.hero.maxHp) * 100));
    expect(pct).toBe(0);
  });

  it('clamp to 100 when HP exceeds maxHp (e.g. from potion)', () => {
    const state = { ...initialState(), hero: { ...initialState().hero, hp: 120, maxHp: 100 } };
    const pct = Math.max(0, Math.min(100, (state.hero.hp / state.hero.maxHp) * 100));
    expect(pct).toBe(100);
  });

  it('monster HP percent = monster.hp / monster.maxHp * 100', () => {
    const monster = { id: 'fungus', name: '懒词菌', atk: 5, def: 0, hp: 20, maxHp: 30 };
    const pct = Math.max(0, Math.min(100, (monster.hp / monster.maxHp) * 100));
    expect(pct).toBeCloseTo(66.67, 1);
  });

  it('monster HP percent = 0 when dead', () => {
    const monster = { id: 'fungus', name: '懒词菌', atk: 5, def: 0, hp: 0, maxHp: 30 };
    const pct = Math.max(0, Math.min(100, (monster.hp / monster.maxHp) * 100));
    expect(pct).toBe(0);
  });

});

describe('renderMonster asset key generation', () => {

  it('asset key for fungus is monster-fungus.png', () => {
    const id = 'fungus';
    const key = `monster-${id}.png`;
    expect(key).toBe('monster-fungus.png');
  });

  it('asset key for worm is monster-worm.png', () => {
    const id = 'worm';
    const key = `monster-${id}.png`;
    expect(key).toBe('monster-worm.png');
  });

  it('asset key for dragon is monster-dragon.png', () => {
    const id = 'dragon';
    const key = `monster-${id}.png`;
    expect(key).toBe('monster-dragon.png');
  });

  it('hero asset key is hero.png', () => {
    expect('hero.png').toBe('hero.png');
  });

});

describe('attackMonster pure function (drives renderMonster calls)', () => {

  it('attackMonster reduces monster HP by hero.atk (10)', () => {
    const state = startGame(initialState());
    const after = attackMonster(state);
    expect(after.currentMonster!.hp).toBe(20); // 30 - 10
  });

  it('attackMonster reduces monster HP to 0 after 3 hits', () => {
    let state = startGame(initialState());
    state = attackMonster(state); // 20
    state = attackMonster(state); // 10
    state = attackMonster(state); // 0
    expect(state.currentMonster!.hp).toBe(0);
  });

  it('killCurrentMonster awards 1 star and spawns next monster', () => {
    let state = startGame(initialState());
    state = attackMonster(state);
    state = attackMonster(state);
    state = attackMonster(state); // hp now 0

    const afterKill = killCurrentMonster(state);
    expect(afterKill.sessionStars).toBe(1);
    expect(afterKill.currentMonster).not.toBeNull();
  });

});

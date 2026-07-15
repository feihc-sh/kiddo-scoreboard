// tests/unit/fighter-stage.test.ts
//
// TDD unit tests for Stage 4: 5-Stage Runner (Stage Progression + Win/Lose).
// RED: write tests first, confirm they fail, then implement GREEN.
// Pattern mirrors tests/unit/fighter-damage.test.ts — in-memory, no network.

import { describe, it, expect } from 'vitest';
import {
  evaluateStageTransition,
  advanceToNextStage,
  triggerVictory,
  triggerDefeat,
  restartGame,
} from '../../src/games/fighter/logic.ts';
import type { GameState, StageTransition } from '../../src/games/fighter/state.ts';
import { STAGES } from '../../src/games/fighter/state.ts';
import type { Monster } from '../../src/games/fighter/state.ts';

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
    status: 'fighting',
    equippedItems: { sword: false, shield: false, potion: false },
    ...overrides,
  };
}

// Helper to build a live monster
function liveFungus(overrides: Partial<Monster> = {}): Monster {
  return { id: 'fungus', name: '懒词菌', atk: 5, def: 0, hp: 30, maxHp: 30, ...overrides };
}

function liveDragon(overrides: Partial<Monster> = {}): Monster {
  return { id: 'dragon', name: '拼写巨龙', atk: 20, def: 5, hp: 100, maxHp: 100, ...overrides };
}

// ---- evaluateStageTransition tests ----

describe('evaluateStageTransition', () => {

  it('returns continue when currentMonster is alive', () => {
    const state = makeState({
      currentMonster: liveFungus({ hp: 30 }),
      status: 'fighting',
    });
    const result = evaluateStageTransition(state);
    expect(result.reason).toBe('continue');
    expect(result.nextStatus).toBe('fighting');
  });

  it('returns cleared when currentMonster is null and stageIdx < 4 (more stages remain)', () => {
    const state = makeState({
      currentMonster: null,
      stageIdx: 0,
      status: 'fighting',
    });
    const result = evaluateStageTransition(state);
    expect(result.reason).toBe('cleared');
    expect(result.nextStageIdx).toBe(1);
    expect(result.bonus).toBe(STAGES[0].reward); // 5 stars for stage 1
  });

  it('returns cleared when currentMonster is null and stageIdx = 3 (not last stage)', () => {
    const state = makeState({
      currentMonster: null,
      stageIdx: 3,
      status: 'fighting',
    });
    const result = evaluateStageTransition(state);
    expect(result.reason).toBe('cleared');
    expect(result.nextStageIdx).toBe(4);
    expect(result.bonus).toBe(STAGES[3].reward); // 12 stars for stage 4
  });

  it('returns victory when currentMonster is null and stageIdx = 4 (last stage cleared)', () => {
    const state = makeState({
      currentMonster: null,
      stageIdx: 4,
      status: 'fighting',
    });
    const result = evaluateStageTransition(state);
    expect(result.reason).toBe('victory');
    expect(result.bonus).toBe(STAGES[4].reward); // 20 stars for stage 5
  });

  it('returns continue when status is menu (not fighting)', () => {
    const state = makeState({
      currentMonster: liveFungus({ hp: 30 }),
      status: 'menu',
    });
    const result = evaluateStageTransition(state);
    expect(result.reason).toBe('continue');
  });

  it('returns continue when status is won', () => {
    const state = makeState({
      currentMonster: null,
      stageIdx: 4,
      status: 'won',
    });
    const result = evaluateStageTransition(state);
    expect(result.reason).toBe('continue');
  });

  it('returns continue when status is lost', () => {
    const state = makeState({
      currentMonster: null,
      stageIdx: 2,
      status: 'lost',
    });
    const result = evaluateStageTransition(state);
    expect(result.reason).toBe('continue');
  });

  it('includes the correct bonus amount from STAGES[i].reward', () => {
    // Stage 3 cleared (idx=2, reward=10)
    const state = makeState({
      currentMonster: null,
      stageIdx: 2,
      status: 'fighting',
    });
    const result = evaluateStageTransition(state);
    expect(result.reason).toBe('cleared');
    expect(result.bonus).toBe(10);
    expect(result.nextStageIdx).toBe(3);
  });

  it('is pure: does not mutate input state', () => {
    const state = makeState({
      currentMonster: null,
      stageIdx: 0,
      status: 'fighting',
    });
    const before = { ...state };
    evaluateStageTransition(state);
    expect(state).toEqual(before);
  });

});

// ---- advanceToNextStage tests ----

describe('advanceToNextStage', () => {

  it('awards STAGES[i].reward to sessionStars and bank', () => {
    const state = makeState({
      currentMonster: null,
      stageIdx: 0,
      sessionStars: 5,
      bank: 0,
    });
    const next = advanceToNextStage(state);
    expect(next.sessionStars).toBe(5 + STAGES[0].reward); // 5 + 5 = 10
    expect(next.bank).toBe(STAGES[0].reward);
  });

  it('increments stageIdx by 1', () => {
    const state = makeState({
      currentMonster: null,
      stageIdx: 2,
    });
    const next = advanceToNextStage(state);
    expect(next.stageIdx).toBe(3);
  });

  it('sets stageQueueRemaining to next stage count minus 1 (after spawning first monster)', () => {
    // Stage 1 has 5 fungus, Stage 2 has 8 fungus
    const state = makeState({
      currentMonster: null,
      stageIdx: 0,
      stageQueueRemaining: 0,
    });
    const next = advanceToNextStage(state);
    // First monster is spawned immediately, so remaining = total - 1
    expect(next.stageQueueRemaining).toBe(STAGES[1].monsters.length - 1); // 8 - 1 = 7
  });

  it('resets hero HP to maxHp on advance', () => {
    const state = makeState({
      currentMonster: null,
      stageIdx: 0,
      hero: { hp: 30, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: Date.now() },
    });
    const next = advanceToNextStage(state);
    expect(next.hero.hp).toBe(100);
    expect(next.hero.maxHp).toBe(100);
  });

  it('sets currentMonster to the first monster of the next stage', () => {
    // Stage 1: fungus (30 HP), Stage 2: fungus (30 HP each)
    const state = makeState({
      currentMonster: null,
      stageIdx: 0,
      stageQueueRemaining: 0,
    });
    const next = advanceToNextStage(state);
    expect(next.currentMonster).not.toBeNull();
    expect(next.currentMonster!.id).toBe('fungus');
    expect(next.currentMonster!.hp).toBe(30);
    expect(next.stageQueueRemaining).toBe(7); // 8 total - 1 spawned = 7
  });

  it('is pure: does not mutate input state', () => {
    const state = makeState({
      currentMonster: null,
      stageIdx: 1,
      sessionStars: 0,
    });
    const next = advanceToNextStage(state);
    expect(state.stageIdx).toBe(1);
    expect(state.sessionStars).toBe(0);
    expect(next).not.toBe(state);
  });

  it('advances from stage 4 (idx=4) to stage 5 dragon boss', () => {
    // Stage 4: mixed (6 fungus + 4 worm), Stage 5: dragon + 5 worm
    const state = makeState({
      currentMonster: null,
      stageIdx: 3, // advancing from stage 4 (0-indexed)
      sessionStars: 20,
      bank: 0,
    });
    const next = advanceToNextStage(state);
    expect(next.stageIdx).toBe(4); // moved to stage 5
    expect(next.sessionStars).toBe(20 + STAGES[3].reward); // 20 + 12 = 32
    // currentMonster should be dragon from stage 5 (first in queue)
    expect(next.currentMonster).not.toBeNull();
    expect(next.currentMonster!.id).toBe('dragon');
    expect(next.currentMonster!.hp).toBe(100); // dragon HP
  });

});

// ---- triggerVictory tests ----

describe('triggerVictory', () => {

  it('sets status to won', () => {
    const state = makeState({ status: 'fighting' });
    const next = triggerVictory(state);
    expect(next.status).toBe('won');
  });

  it('sets currentMonster to null', () => {
    const state = makeState({ currentMonster: liveDragon(), status: 'fighting' });
    const next = triggerVictory(state);
    expect(next.currentMonster).toBeNull();
  });

  it('preserves sessionStars (already counted into bank)', () => {
    const state = makeState({ sessionStars: 55, bank: 55, status: 'fighting' });
    const next = triggerVictory(state);
    expect(next.sessionStars).toBe(55);
    expect(next.bank).toBe(55);
  });

  it('is pure: does not mutate input state', () => {
    const state = makeState({ status: 'fighting' });
    const next = triggerVictory(state);
    expect(state.status).toBe('fighting');
    expect(next).not.toBe(state);
  });

  it('stops game loop (status not fighting)', () => {
    const state = makeState({ status: 'fighting', currentMonster: null });
    const next = triggerVictory(state);
    expect(next.status).toBe('won');
    expect(next.status).not.toBe('fighting');
  });

});

// ---- triggerDefeat tests ----

describe('triggerDefeat', () => {

  it('sets status to lost', () => {
    const state = makeState({
      status: 'fighting',
      hero: { hp: 0, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: 0 },
    });
    const next = triggerDefeat(state);
    expect(next.status).toBe('lost');
  });

  it('sets currentMonster to null', () => {
    const state = makeState({ currentMonster: liveFungus(), status: 'fighting' });
    const next = triggerDefeat(state);
    expect(next.currentMonster).toBeNull();
  });

  it('does NOT reset sessionStars (player keeps earned stars)', () => {
    const state = makeState({ sessionStars: 15, status: 'fighting' });
    const next = triggerDefeat(state);
    expect(next.sessionStars).toBe(15);
  });

  it('keeps bank intact (stars already deposited)', () => {
    const state = makeState({ sessionStars: 10, bank: 40, status: 'fighting' });
    const next = triggerDefeat(state);
    expect(next.bank).toBe(40);
  });

  it('sets hero HP to 0', () => {
    const state = makeState({
      status: 'fighting',
      hero: { hp: 5, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: 0 },
    });
    const next = triggerDefeat(state);
    expect(next.hero.hp).toBe(0);
  });

  it('is pure: does not mutate input state', () => {
    const state = makeState({ status: 'fighting', sessionStars: 5 });
    const next = triggerDefeat(state);
    expect(state.status).toBe('fighting');
    expect(state.sessionStars).toBe(5);
    expect(next).not.toBe(state);
  });

});

// ---- restartGame tests (extended for Stage 4) ----

describe('restartGame (Stage 4 extension)', () => {

  it('resets hero HP to maxHp', () => {
    const state = makeState({
      hero: { hp: 10, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: Date.now() },
      status: 'lost',
    });
    const next = restartGame(state);
    expect(next.hero.hp).toBe(100);
    expect(next.hero.maxHp).toBe(100);
  });

  it('resets stageIdx to 0', () => {
    const state = makeState({ stageIdx: 4, status: 'lost' });
    const next = restartGame(state);
    expect(next.stageIdx).toBe(0);
  });

  it('resets sessionStars to 0', () => {
    const state = makeState({ sessionStars: 42, status: 'lost' });
    const next = restartGame(state);
    expect(next.sessionStars).toBe(0);
  });

  it('resets currentMonster to null', () => {
    const state = makeState({ currentMonster: liveDragon(), status: 'lost' });
    const next = restartGame(state);
    expect(next.currentMonster).toBeNull();
  });

  it('sets status to menu', () => {
    const state = makeState({ status: 'lost' });
    const next = restartGame(state);
    expect(next.status).toBe('menu');
  });

  it('preserves bank (long-term persistence)', () => {
    const state = makeState({ bank: 100, sessionStars: 30, status: 'lost' });
    const next = restartGame(state);
    expect(next.bank).toBe(100);
  });

  it('resets stageQueueRemaining to 0', () => {
    const state = makeState({ stageQueueRemaining: 8, status: 'lost' });
    const next = restartGame(state);
    expect(next.stageQueueRemaining).toBe(0);
  });

  it('is pure: does not mutate input state', () => {
    const state = makeState({ stageIdx: 3, sessionStars: 20, bank: 50 });
    const next = restartGame(state);
    expect(state.stageIdx).toBe(3);
    expect(state.sessionStars).toBe(20);
    expect(next).not.toBe(state);
  });

  it('from won state resets to stage 0', () => {
    const state = makeState({ status: 'won', stageIdx: 4, sessionStars: 55, bank: 55 });
    const next = restartGame(state);
    expect(next.status).toBe('menu');
    expect(next.stageIdx).toBe(0);
    expect(next.sessionStars).toBe(0);
    expect(next.bank).toBe(55);
  });

  it('from defeated stage 3 resets properly', () => {
    const state = makeState({ status: 'lost', stageIdx: 2, sessionStars: 20, bank: 50 });
    const next = restartGame(state);
    expect(next.status).toBe('menu');
    expect(next.stageIdx).toBe(0);
    expect(next.sessionStars).toBe(0);
    expect(next.bank).toBe(50);
  });

});

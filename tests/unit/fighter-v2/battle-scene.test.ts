// @vitest-environment happy-dom
//
// tests/unit/fighter-v2/battle-scene.test.ts
//
// Regression tests for battle-scene.js HP readouts.
//
// BUG FIXED 2026-10-22: updateMonsterStats() refreshed only the monster HP *fill
// bar* width and never the numeric `.dk-stat-value` readout, so a 懒词菌 fought the
// whole battle showing a frozen "30/30" while its bar visibly drained (verified in a
// real browser via the e2e probe: fill 100% → 66.7% → 33.3%, text stayed "30/30").
// These tests lock in that the readout follows the bar.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  renderBattleScene,
  updateBattleScene,
} from '../../../public/fighter/v2/battle-scene.js';
import { STAGES, MONSTER_TYPES } from '../../../public/fighter/v2/stages.js';
import { HERO_DEFAULTS } from '../../../public/fighter/v2/combat.js';

function makeBattleState(overrides = {}) {
  const stage = STAGES.find((s) => s.id === '1-1')!;
  const monsters = stage.monsters.map((m) => ({
    ...MONSTER_TYPES[m.type],
    id: `${m.type}-${Math.random()}`,
    hp: MONSTER_TYPES[m.type].hp,
    maxHp: MONSTER_TYPES[m.type].hp,
  }));

  return {
    stageId: '1-1',
    hero: { ...HERO_DEFAULTS },
    monsters,
    currentMonsterIdx: 0,
    state: 'hero-turn',
    turnCount: 1,
    ...overrides,
  };
}

describe('updateMonsterStats — HP numeric readout', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  const monsterText = () =>
    container.querySelector('.dk-monster-hp .dk-stat-value')?.textContent;
  const monsterFill = () =>
    container.querySelector('.dk-monster-hp .dk-stat-fill')?.style.width;

  it('renders the initial monster HP', () => {
    renderBattleScene(container, makeBattleState(), {}, () => {});
    expect(monsterText()).toBe('30/30');
    expect(monsterFill()).toBe('100%');
  });

  it('updates BOTH the number and the fill bar when the monster takes damage', () => {
    const state = makeBattleState();
    renderBattleScene(container, state, {}, () => {});

    state.monsters[0] = { ...state.monsters[0], hp: 20 };
    updateBattleScene(state);

    expect(monsterText()).toBe('20/30');
    expect(monsterFill()).toBe(`${(20 / 30) * 100}%`);
  });

  it('keeps text and fill bar in sync across successive hits', () => {
    const state = makeBattleState();
    renderBattleScene(container, state, {}, () => {});

    for (const hp of [20, 10, 5]) {
      state.monsters[0] = { ...state.monsters[0], hp };
      updateBattleScene(state);
      expect(monsterText()).toBe(`${hp}/30`);
      expect(monsterFill()).toBe(`${(hp / 30) * 100}%`);
    }
  });

  it('shows DEFEATED when the current monster reaches 0 HP', () => {
    const state = makeBattleState();
    renderBattleScene(container, state, {}, () => {});

    state.monsters[0] = { ...state.monsters[0], hp: 0 };
    updateBattleScene(state);

    expect(container.querySelector('.dk-character-side--monster .dk-character-name')?.textContent).toBe(
      'DEFEATED'
    );
    expect(container.querySelector('.dk-defeated-placeholder')).toBeTruthy();
  });
});

describe('updateHeroStats — HP/MP readouts', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('updates hero HP and MP text on state change', () => {
    const state = makeBattleState();
    renderBattleScene(container, state, {}, () => {});

    state.hero = { ...state.hero, hp: 95, mp: 70 };
    updateBattleScene(state);

    expect(container.querySelector('#hero-hp-value')?.textContent).toBe('95/100');
    expect(container.querySelector('#hero-mp-value')?.textContent).toBe('70/100');
  });
});
// @vitest-environment happy-dom
//
// tests/unit/fighter-v2/battle-scene-monster-advance.test.ts
//
// Regression tests for the "battle stalls after the first monster dies" bug
// (nightly-2026-11-08).
//
// BUG FIXED 2026-11-08: updateMonsterStats() MUTATED the existing DOM instead of
// rebuilding the monster panel. When monster #1 died, the renderer replaced the
// monster info block with the "DEFEATED" placeholder — which contains NO
// `.dk-monster-hp` element at all. endHeroTurn() then advanced
// `currentMonsterIdx` to monster #2 (alive), but updateMonsterStats() had
// nowhere to write it: it only mutated `.dk-monster-hp .dk-stat-value`, a node
// that no longer existed.
//
// Net effect (verified in a real browser, see NIGHTLY-TODO 2026-11-08 record):
//   - monster #2 NEVER rendered (screen stuck on "DEFEATED")
//   - the VICTORY modal never appeared, even after killing all 3 monsters
//   - the ATTACK button stayed enabled but every click was rejected with
//     "Invalid action: 没有可攻击的敌人" (console.warn), because the stale
//     `currentMonsterIdx` still pointed at the dead monster
//   => a kid could never finish a stage that has >1 monster. Stages 1-1/1-2/1-3
//      have 3/4/5 monsters, so the game was literally unfinishable.
//
// The fix: rebuild the monster side of the arena whenever the current monster
// CHANGES (index or identity), so the new monster gets a full panel with its own
// HP readout; keep the cheap text/fill mutation path for plain damage ticks.
//
// These tests lock in:
//   1. advancing to the next monster renders IT (name + HP readout), not DEFEATED
//   2. the dead monster is not what is displayed any more
//   3. damage on the NEW monster updates the NEW readout (no stale node reuse)

import { describe, it, expect, beforeEach } from 'vitest';
import {
  renderBattleScene,
  updateBattleScene,
} from '../../../public/fighter/v2/battle-scene.js';
import { STAGES, MONSTER_TYPES } from '../../../public/fighter/v2/stages.js';
import { HERO_DEFAULTS } from '../../../public/fighter/v2/combat.js';

/** Build a battle state for stage 1-1 (3 x 懒词菌, 30 HP each). */
function makeBattleState(overrides = {}) {
  const stage = STAGES.find((s) => s.id === '1-1')!;
  const monsters: any[] = [];
  for (const m of stage.monsters) {
    for (let i = 0; i < m.count; i++) {
      monsters.push({
        ...MONSTER_TYPES[m.type],
        id: `${m.type}-${monsters.length}`,
        hp: MONSTER_TYPES[m.type].hp,
        maxHp: MONSTER_TYPES[m.type].hp,
      });
    }
  }

  return {
    stageId: '1-1',
    hero: { ...HERO_DEFAULTS },
    monsters,
    currentMonsterIdx: 0,
    state: 'hero-turn',
    turnCount: 1,
    ...overrides,
  } as any;
}

describe('monster advance — a new monster must actually render', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  const monsterName = () =>
    container.querySelector('.dk-character-side--monster .dk-character-name')?.textContent;
  const monsterText = () =>
    container.querySelector('.dk-monster-hp .dk-stat-value')?.textContent;
  const defeatedCount = () => container.querySelectorAll('.dk-defeated-placeholder').length;

  it('renders the FIRST monster on initial render', () => {
    const state = makeBattleState();
    renderBattleScene(container, state, {}, () => {});

    expect(monsterName()).toBe('懒词菌');
    expect(monsterText()).toBe('30/30');
    expect(defeatedCount()).toBe(0);
  });

  it('BUG: shows DEFEATED for monster #1 but keeps monster #1 HP readout', () => {
    // Sanity: killing the current monster shows the DEFEATED placeholder.
    const state = makeBattleState();
    renderBattleScene(container, state, {}, () => {});

    state.monsters[0] = { ...state.monsters[0], hp: 0 };
    updateBattleScene(state);

    expect(monsterName()).toBe('DEFEATED');
    expect(defeatedCount()).toBe(1);
  });

  it('BUG: advancing to monster #2 renders monster #2 (name + HP), NOT DEFEATED', () => {
    const state = makeBattleState();
    renderBattleScene(container, state, {}, () => {});

    // Kill monster #1, then advance the index the way endHeroTurn() does.
    state.monsters[0] = { ...state.monsters[0], hp: 0 };
    updateBattleScene(state);

    state.currentMonsterIdx = 1;
    updateBattleScene(state);

    // >>> THE REGRESSION ASSERTION <<<
    // On the buggy code the panel still shows "DEFEATED" and `.dk-monster-hp`
    // does not exist at all (the placeholder replaced it), so monsterText() is
    // undefined and monsterName() is 'DEFEATED'.
    expect(monsterName()).toBe('懒词菌');
    expect(monsterText()).toBe('30/30');
    expect(defeatedCount()).toBe(0);
  });

  it('BUG: damage on the NEW monster updates the NEW readout (no stale node)', () => {
    const state = makeBattleState();
    renderBattleScene(container, state, {}, () => {});

    state.monsters[0] = { ...state.monsters[0], hp: 0 };
    updateBattleScene(state);
    state.currentMonsterIdx = 1;
    updateBattleScene(state);

    // Monster #2 takes a hit: 30 -> 20
    state.monsters[1] = { ...state.monsters[1], hp: 20 };
    updateBattleScene(state);

    expect(monsterText()).toBe('20/30');
  });

  it('BUG: advancing across ALL monsters keeps rendering a live monster', () => {
    const state = makeBattleState();
    renderBattleScene(container, state, {}, () => {});

    // Walk every monster in the stage, killing each one in turn.
    for (let i = 0; i < state.monsters.length; i++) {
      state.monsters[i] = { ...state.monsters[i], hp: 0 };
      state.currentMonsterIdx = i;
      updateBattleScene(state);

      const nextIdx = state.monsters.findIndex((m: any) => m.hp > 0);
      if (nextIdx !== -1) {
        state.currentMonsterIdx = nextIdx;
        updateBattleScene(state);

        expect(monsterName()).toBe('懒词菌');
        expect(monsterText()).toBe('30/30');
        expect(defeatedCount()).toBe(0);
      }
    }
  });

  it('regression guard: the monster panel ALWAYS has a .dk-monster-hp readout', () => {
    const state = makeBattleState();
    renderBattleScene(container, state, {}, () => {});

    // Whatever happens, a live monster must expose an HP readout.
    state.monsters[0] = { ...state.monsters[0], hp: 0 };
    updateBattleScene(state);
    state.currentMonsterIdx = 1;
    updateBattleScene(state);

    expect(container.querySelector('.dk-monster-hp')).toBeTruthy();
    expect(container.querySelector('.dk-monster-hp .dk-stat-value')?.textContent).toBe('30/30');
  });
});

// tests/unit/fighter-v2/turn-resolver.test.ts
//
// Unit tests for Fighter V2 turn-resolver - state machine transitions
// Per spec §4 Turn Flow State Machine
// Pure unit tests - no DOM required

import { describe, it, expect, beforeEach } from 'vitest';
import {
  BATTLE_STATE,
  ACTION_TYPE,
  HERO_DEFAULTS,
  createMonster,
  buildMonsterQueue,
  initBattle,
  applyHeroAttack,
  applySkill,
  endHeroTurn,
  executeMonsterTurn,
  findNextAliveMonster,
  calculateDamage,
} from '../../../public/fighter/v2/combat.js';
import { MONSTER_TYPES } from '../../../public/fighter/v2/stages.js';

describe('Turn Resolver - State Machine', () => {

  const createTestBattleState = (monsterOverrides = []) => {
    const stage = { monsters: [{ type: 'fungus', count: 3 }] };
    const monsters = buildMonsterQueue(stage, MONSTER_TYPES);

    // Apply overrides if provided
    monsterOverrides.forEach(({ idx, hp }) => {
      if (monsters[idx]) {
        monsters[idx].hp = hp;
      }
    });

    return {
      state: BATTLE_STATE.HERO_TURN,
      turnCount: 1,
      monsters,
      currentMonsterIdx: 0,
      hero: {
        ...HERO_DEFAULTS,
        hp: 100,
        maxHp: 100,
        mp: 100,
        maxMp: 100,
        shieldBuff: 0,
        shieldBuffRounds: 0,
        skillCooldowns: { fireball: 0, heal: 0, shield: 0 },
      },
    };
  };

  const equipment = { sword: 'none', shield: 'none', potion: 'none' };

  // ==================== Hero Turn → Monster Turn ====================

  describe('Hero Turn → Monster Turn Transition', () => {

    it('hero attack reduces monster HP', () => {
      const battleState = createTestBattleState();
      const result = applyHeroAttack(battleState, equipment);

      expect(result).not.toBeNull();
      expect(result.battleState.monsters[0].hp).toBe(20); // 30 - 10 = 20
      expect(result.effect.type).toBe(ACTION_TYPE.ATTACK);
      expect(result.effect.damage).toBe(10);
    });

    it('hero attack is immutable (returns new state)', () => {
      const battleState = createTestBattleState();
      const originalHp = battleState.monsters[0].hp;
      const result = applyHeroAttack(battleState, equipment);

      expect(result.battleState).not.toBe(battleState);
      expect(battleState.monsters[0].hp).toBe(originalHp); // unchanged
    });

    it('endHeroTurn switches state to MONSTER_TURN', () => {
      const battleState = createTestBattleState();
      const result = endHeroTurn(battleState, equipment);

      expect(result.battleState.state).toBe(BATTLE_STATE.MONSTER_TURN);
    });

    it('endHeroTurn increments turn count', () => {
      const battleState = createTestBattleState();
      battleState.turnCount = 1;
      const result = endHeroTurn(battleState, equipment);

      expect(result.battleState.turnCount).toBe(2);
    });

    it('endHeroTurn decrements skill cooldowns', () => {
      const battleState = createTestBattleState();
      battleState.hero.skillCooldowns.fireball = 3;
      battleState.hero.skillCooldowns.heal = 5;
      const result = endHeroTurn(battleState, equipment);

      expect(result.battleState.hero.skillCooldowns.fireball).toBe(2);
      expect(result.battleState.hero.skillCooldowns.heal).toBe(4);
    });

    it('endHeroTurn triggers MP regen +10', () => {
      const battleState = createTestBattleState();
      battleState.hero.mp = 80;
      const result = endHeroTurn(battleState, equipment);

      expect(result.battleState.hero.mp).toBe(90);
    });

    it('endHeroTurn caps MP at maxMp', () => {
      const battleState = createTestBattleState();
      battleState.hero.mp = 95;
      const result = endHeroTurn(battleState, equipment);

      expect(result.battleState.hero.mp).toBe(100);
    });

    it('executeMonsterTurn applies damage to hero', () => {
      const battleState = createTestBattleState();
      battleState.state = BATTLE_STATE.MONSTER_TURN;
      const result = executeMonsterTurn(battleState, equipment);

      expect(result.battleState.hero.hp).toBe(95); // 100 - 5 (懒词菌 ATK 5 - DEF 0)
    });

    it('executeMonsterTurn returns state to HERO_TURN after attack', () => {
      const battleState = createTestBattleState();
      battleState.state = BATTLE_STATE.MONSTER_TURN;
      const result = executeMonsterTurn(battleState, equipment);

      expect(result.battleState.state).toBe(BATTLE_STATE.HERO_TURN);
    });

    it('monster attack formula: max(1, monster.atk - hero.def)', () => {
      // 懒词菌 ATK 5 vs hero DEF 0
      let battleState = createTestBattleState();
      battleState.state = BATTLE_STATE.MONSTER_TURN;
      let result = executeMonsterTurn(battleState, equipment);
      expect(result.battleState.hero.hp).toBe(95); // 100 - 5 = 95

      // With shield buff: hero DEF = 10
      battleState = createTestBattleState();
      battleState.state = BATTLE_STATE.MONSTER_TURN;
      battleState.hero.shieldBuff = 10;
      battleState.hero.shieldBuffRounds = 5;
      result = executeMonsterTurn(battleState, equipment);
      expect(result.battleState.hero.hp).toBe(99); // 100 - max(1, 5-10) = 100 - 1 = 99
    });

  });

  // ==================== Monster Death → Next Monster ====================

  describe('Monster Death → Next Monster', () => {

    it('killing monster advances to next monster', () => {
      // Setup: First monster at 5 HP (needs 1 more hit)
      const battleState = createTestBattleState([{ idx: 0, hp: 5 }]);
      const result = applyHeroAttack(battleState, equipment);

      // After attack, monster should be dead
      expect(result.battleState.monsters[0].hp).toBe(0);

      // End hero turn should advance to next monster
      const endResult = endHeroTurn(result.battleState, equipment);
      expect(endResult.battleState.currentMonsterIdx).toBe(1);
      expect(endResult.battleState.state).toBe(BATTLE_STATE.MONSTER_TURN);
    });

    it('findNextAliveMonster returns correct index', () => {
      const monsters = buildMonsterQueue({ monsters: [{ type: 'fungus', count: 3 }] }, MONSTER_TYPES);
      monsters[0].hp = 0;
      monsters[1].hp = 30;
      monsters[2].hp = 30;

      expect(findNextAliveMonster(monsters, 0)).toBe(1);
      expect(findNextAliveMonster(monsters, 1)).toBe(2);
      expect(findNextAliveMonster(monsters, 2)).toBe(-1);
    });

    it('findNextAliveMonster returns -1 when no more monsters', () => {
      const monsters = buildMonsterQueue({ monsters: [{ type: 'fungus', count: 2 }] }, MONSTER_TYPES);
      monsters[0].hp = 0;
      monsters[1].hp = 0;

      expect(findNextAliveMonster(monsters, 1)).toBe(-1);
    });

    it('killing all monsters triggers STAGE_CLEAR', () => {
      // Set all monsters to low HP so each dies in one hit
      let battleState = createTestBattleState([
        { idx: 0, hp: 5 },
        { idx: 1, hp: 5 },
        { idx: 2, hp: 5 },
      ]);

      // Kill monster 0
      let result = applyHeroAttack(battleState, equipment);
      let endResult = endHeroTurn(result.battleState, equipment);

      expect(endResult.battleState.currentMonsterIdx).toBe(1);
      expect(endResult.battleState.state).toBe(BATTLE_STATE.MONSTER_TURN);

      // Execute monster turn and return to hero
      battleState = executeMonsterTurn(endResult.battleState, equipment).battleState;
      expect(battleState.state).toBe(BATTLE_STATE.HERO_TURN);

      // Kill monster 1
      result = applyHeroAttack(battleState, equipment);
      endResult = endHeroTurn(result.battleState, equipment);

      expect(endResult.battleState.currentMonsterIdx).toBe(2);
      expect(endResult.battleState.state).toBe(BATTLE_STATE.MONSTER_TURN);

      // Execute monster turn
      battleState = executeMonsterTurn(endResult.battleState, equipment).battleState;
      expect(battleState.state).toBe(BATTLE_STATE.HERO_TURN);

      // Kill monster 2 (last monster)
      result = applyHeroAttack(battleState, equipment);
      endResult = endHeroTurn(result.battleState, equipment);

      // Should trigger stage clear
      expect(endResult.battleState.state).toBe(BATTLE_STATE.STAGE_CLEAR);

      // Should have stage-clear event
      const hasStageClear = endResult.events.some((e) => e.type === 'stage-clear');
      expect(hasStageClear).toBe(true);
    });

    it('stage clear event includes monster killed events', () => {
      const battleState = createTestBattleState([{ idx: 0, hp: 5 }]);
      const result = applyHeroAttack(battleState, equipment);
      const endResult = endHeroTurn(result.battleState, equipment);

      const monsterKilledEvents = endResult.events.filter((e) => e.type === 'monster-killed');
      expect(monsterKilledEvents).toHaveLength(1);
      expect(monsterKilledEvents[0].monsterName).toBe('懒词菌');
    });

  });

  // ==================== Hero Death → Defeat ====================

  describe('Hero Death → Defeat', () => {

    it('hero dies when HP reaches 0', () => {
      const battleState = createTestBattleState();
      battleState.hero.hp = 5; // Will take 5 damage
      battleState.state = BATTLE_STATE.MONSTER_TURN;

      const result = executeMonsterTurn(battleState, equipment);
      expect(result.battleState.hero.hp).toBe(0);
    });

    it('executeMonsterTurn sets DEFEAT state when hero dies', () => {
      const battleState = createTestBattleState();
      battleState.hero.hp = 5;
      battleState.state = BATTLE_STATE.MONSTER_TURN;

      const result = executeMonsterTurn(battleState, equipment);
      expect(result.battleState.state).toBe(BATTLE_STATE.DEFEAT);
    });

    it('executeMonsterTurn emits hero-defeated event on death', () => {
      const battleState = createTestBattleState();
      battleState.hero.hp = 5;
      battleState.state = BATTLE_STATE.MONSTER_TURN;

      const result = executeMonsterTurn(battleState, equipment);
      const defeatEvent = result.events.find((e) => e.type === 'hero-defeated');
      expect(defeatEvent).toBeDefined();
    });

    it('multiple monster attacks can kill hero', () => {
      // Simulate 20 turns of 懒词菌 attacking
      let battleState = createTestBattleState();
      battleState.hero.hp = 100;

      for (let i = 0; i < 20; i++) {
        if (battleState.state === BATTLE_STATE.DEFEAT) break;
        battleState.state = BATTLE_STATE.MONSTER_TURN;
        const result = executeMonsterTurn(battleState, equipment);
        battleState = result.battleState;

        if (battleState.state !== BATTLE_STATE.DEFEAT) {
          battleState.state = BATTLE_STATE.HERO_TURN;
        }
      }

      expect(battleState.state).toBe(BATTLE_STATE.DEFEAT);
    });

  });

  // ==================== Shield Buff Duration ====================

  describe('Shield Buff Duration', () => {

    it('shield buff lasts 5 rounds', () => {
      let battleState = createTestBattleState();
      battleState.hero.shieldBuff = 10;
      battleState.hero.shieldBuffRounds = 5;

      // Simulate 5 monster turns
      for (let i = 0; i < 5; i++) {
        battleState.state = BATTLE_STATE.MONSTER_TURN;
        const result = executeMonsterTurn(battleState, equipment);
        battleState = result.battleState;
        battleState.state = BATTLE_STATE.HERO_TURN;
      }

      // After 5 rounds, shield should be expired
      expect(battleState.hero.shieldBuffRounds).toBe(0);
      expect(battleState.hero.shieldBuff).toBe(0);
    });

    it('shield expired event fires when rounds reach 0', () => {
      let battleState = createTestBattleState();
      battleState.hero.shieldBuff = 10;
      battleState.hero.shieldBuffRounds = 1;
      battleState.state = BATTLE_STATE.MONSTER_TURN;

      const result = executeMonsterTurn(battleState, equipment);
      expect(result.events.some((e) => e.type === 'shield-expired')).toBe(true);
    });

    it('shield buff reduces incoming damage', () => {
      // 懒词菌 ATK 5, hero DEF 0 normally = 5 damage
      let battleState = createTestBattleState();
      battleState.state = BATTLE_STATE.MONSTER_TURN;
      let result = executeMonsterTurn(battleState, equipment);
      const damageWithoutShield = 100 - result.battleState.hero.hp;
      expect(damageWithoutShield).toBe(5);

      // With shield: ATK 5 - DEF 10 = -5 → min 1 damage
      battleState = createTestBattleState();
      battleState.hero.shieldBuff = 10;
      battleState.hero.shieldBuffRounds = 5;
      battleState.state = BATTLE_STATE.MONSTER_TURN;
      result = executeMonsterTurn(battleState, equipment);
      const damageWithShield = 100 - result.battleState.hero.hp;
      expect(damageWithShield).toBe(1);
    });

  });

  // ==================== Full Turn Cycle ====================

  describe('Full Turn Cycle', () => {

    it('complete turn cycle: hero attack → monster counter', () => {
      let battleState = createTestBattleState();

      // Hero's turn
      expect(battleState.state).toBe(BATTLE_STATE.HERO_TURN);
      const attackResult = applyHeroAttack(battleState, equipment);
      battleState = attackResult.battleState;

      // Monster HP should be reduced
      expect(battleState.monsters[0].hp).toBe(20);

      // End hero turn
      const endHeroResult = endHeroTurn(battleState, equipment);
      battleState = endHeroResult.battleState;

      // Now monster's turn
      expect(battleState.state).toBe(BATTLE_STATE.MONSTER_TURN);
      const monsterResult = executeMonsterTurn(battleState, equipment);
      battleState = monsterResult.battleState;

      // Hero HP should be reduced
      expect(battleState.hero.hp).toBe(95);

      // Should be back to hero's turn
      expect(battleState.state).toBe(BATTLE_STATE.HERO_TURN);

      // MP should have regenned twice (+10 +10 = 20)
      // Note: MP regen happens at end of both turns
      expect(battleState.hero.mp).toBe(100); // capped at 100
    });

    it('multiple full turns maintain correct state', () => {
      let battleState = createTestBattleState();

      for (let turn = 0; turn < 3; turn++) {
        // Hero attack
        const attackResult = applyHeroAttack(battleState, equipment);
        battleState = attackResult.battleState;

        // End hero turn
        const endHeroResult = endHeroTurn(battleState, equipment);
        battleState = endHeroResult.battleState;

        // Monster turn
        const monsterResult = executeMonsterTurn(battleState, equipment);
        battleState = monsterResult.battleState;

        // Should still be in HERO_TURN (not defeated, not stage clear)
        if (battleState.state === BATTLE_STATE.DEFEAT || battleState.state === BATTLE_STATE.STAGE_CLEAR) {
          break;
        }
        expect(battleState.state).toBe(BATTLE_STATE.HERO_TURN);
      }
    });

  });

  // ==================== initBattle ====================

  describe('initBattle', () => {

    it('creates battle state for Stage 1-1', () => {
      const stage = {
        worldIdx: 0,
        stageIdx: 0,
        id: '1-1',
        monsters: [{ type: 'fungus', count: 3 }],
        totalMonsters: 3,
      };

      const battleState = initBattle(stage, HERO_DEFAULTS, MONSTER_TYPES, 0);

      expect(battleState.state).toBe(BATTLE_STATE.HERO_TURN);
      expect(battleState.turnCount).toBe(1);
      expect(battleState.monsters).toHaveLength(3);
      expect(battleState.currentMonsterIdx).toBe(0);
      expect(battleState.hero.hp).toBe(100);
      expect(battleState.hero.mp).toBe(100);
    });

  });

});

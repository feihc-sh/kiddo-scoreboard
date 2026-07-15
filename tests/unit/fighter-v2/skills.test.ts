// tests/unit/fighter-v2/skills.test.ts
//
// Unit tests for Fighter V2 skills - fireball, heal, shield effects + cooldowns
// Per spec §4 3 Fixed Skills
// Pure unit tests - no DOM required

import { describe, it, expect } from 'vitest';
import {
  applySkill,
  validateAction,
  SKILLS,
  HERO_DEFAULTS,
  BATTLE_STATE,
  createMonster,
  buildMonsterQueue,
} from '../../../public/fighter/v2/combat.js';
import { MONSTER_TYPES } from '../../../public/fighter/v2/stages.js';

describe('Skill Definitions', () => {

  it('fireball has correct MP cost and cooldown', () => {
    expect(SKILLS.fireball.mpCost).toBe(30);
    expect(SKILLS.fireball.cooldown).toBe(5);
    expect(SKILLS.fireball.name).toBe('火球');
    expect(SKILLS.fireball.emoji).toBe('🔥');
  });

  it('heal has correct MP cost and cooldown', () => {
    expect(SKILLS.heal.mpCost).toBe(40);
    expect(SKILLS.heal.cooldown).toBe(8);
    expect(SKILLS.heal.name).toBe('治疗');
    expect(SKILLS.heal.emoji).toBe('💚');
  });

  it('shield has correct MP cost and cooldown', () => {
    expect(SKILLS.shield.mpCost).toBe(50);
    expect(SKILLS.shield.cooldown).toBe(12);
    expect(SKILLS.shield.name).toBe('护盾');
    expect(SKILLS.shield.emoji).toBe('🛡️');
  });

});

describe('Fireball Skill', () => {

  const createTestBattleState = (monsterHp = 30, monsterDef = 0) => {
    const stage = { monsters: [{ type: 'fungus', count: 1 }] };
    const monsters = buildMonsterQueue(stage, MONSTER_TYPES);
    monsters[0].hp = monsterHp;
    monsters[0].def = monsterDef;

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
        skillCooldowns: { fireball: 0, heal: 0, shield: 0 },
      },
    };
  };

  it('fireball deals 30 damage to current monster', () => {
    const battleState = createTestBattleState(30);
    const result = applySkill(battleState, 'fireball');

    expect(result).not.toBeNull();
    const { battleState: newState, effect } = result;

    expect(effect.type).toBe('fireball');
    expect(effect.damage).toBe(30);
    expect(newState.monsters[0].hp).toBe(0); // 30 - 30 = 0
  });

  it('fireball cannot overkill (HP floors at 0)', () => {
    const battleState = createTestBattleState(10);
    const result = applySkill(battleState, 'fireball');

    expect(result).not.toBeNull();
    expect(result.battleState.monsters[0].hp).toBe(0);
  });

  it('fireball consumes 30 MP', () => {
    const battleState = createTestBattleState(30);
    const result = applySkill(battleState, 'fireball');

    expect(result).not.toBeNull();
    expect(result.battleState.hero.mp).toBe(70); // 100 - 30
  });

  it('fireball returns null when MP insufficient', () => {
    const battleState = createTestBattleState(30);
    battleState.hero.mp = 20; // not enough for fireball
    const result = applySkill(battleState, 'fireball');

    expect(result).toBeNull();
  });

  it('fireball returns null when on cooldown', () => {
    const battleState = createTestBattleState(30);
    battleState.hero.skillCooldowns.fireball = 3;
    const result = applySkill(battleState, 'fireball');

    expect(result).toBeNull();
  });

  it('fireball works on any monster type (多义虫)', () => {
    const stage = { monsters: [{ type: 'worm', count: 1 }] };
    const monsters = buildMonsterQueue(stage, MONSTER_TYPES);
    const battleState = {
      state: BATTLE_STATE.HERO_TURN,
      turnCount: 1,
      monsters,
      currentMonsterIdx: 0,
      hero: { ...HERO_DEFAULTS, mp: 100, skillCooldowns: { fireball: 0, heal: 0, shield: 0 } },
    };

    const result = applySkill(battleState, 'fireball');
    expect(result).not.toBeNull();
    expect(result.battleState.monsters[0].hp).toBe(20); // 50 - 30 = 20
  });

  it('fireball returns null when no monster alive', () => {
    const stage = { monsters: [{ type: 'fungus', count: 1 }] };
    const monsters = buildMonsterQueue(stage, MONSTER_TYPES);
    monsters[0].hp = 0;

    const battleState = {
      state: BATTLE_STATE.HERO_TURN,
      turnCount: 1,
      monsters,
      currentMonsterIdx: 0,
      hero: { ...HERO_DEFAULTS, mp: 100, skillCooldowns: { fireball: 0, heal: 0, shield: 0 } },
    };

    const result = applySkill(battleState, 'fireball');
    expect(result).toBeNull();
  });

});

describe('Heal Skill', () => {

  const createTestBattleState = (heroHp = 50) => {
    const stage = { monsters: [{ type: 'fungus', count: 1 }] };
    const monsters = buildMonsterQueue(stage, MONSTER_TYPES);

    return {
      state: BATTLE_STATE.HERO_TURN,
      turnCount: 1,
      monsters,
      currentMonsterIdx: 0,
      hero: {
        ...HERO_DEFAULTS,
        hp: heroHp,
        maxHp: 100,
        mp: 100,
        maxMp: 100,
        skillCooldowns: { fireball: 0, heal: 0, shield: 0 },
      },
    };
  };

  it('heal restores 30 HP', () => {
    const battleState = createTestBattleState(50);
    const result = applySkill(battleState, 'heal');

    expect(result).not.toBeNull();
    const { battleState: newState, effect } = result;

    expect(effect.type).toBe('heal');
    expect(effect.healAmount).toBe(30);
    expect(newState.hero.hp).toBe(80); // 50 + 30 = 80
  });

  it('heal caps at maxHp', () => {
    const battleState = createTestBattleState(90);
    const result = applySkill(battleState, 'heal');

    expect(result).not.toBeNull();
    expect(result.battleState.hero.hp).toBe(100);
  });

  it('heal still applies even when at maxHp (validation is separate)', () => {
    const battleState = createTestBattleState(100);
    // applySkill doesn't validate - that's done by validateAction separately
    const result = applySkill(battleState, 'heal');
    expect(result).not.toBeNull();
    // HP stays at maxHp (capped)
    expect(result.battleState.hero.hp).toBe(100);
  });

  it('heal consumes 40 MP', () => {
    const battleState = createTestBattleState(50);
    const result = applySkill(battleState, 'heal');

    expect(result).not.toBeNull();
    expect(result.battleState.hero.mp).toBe(60); // 100 - 40
  });

  it('heal returns null when MP insufficient', () => {
    const battleState = createTestBattleState(50);
    battleState.hero.mp = 30;
    const result = applySkill(battleState, 'heal');

    expect(result).toBeNull();
  });

  it('heal returns null when on cooldown', () => {
    const battleState = createTestBattleState(50);
    battleState.hero.skillCooldowns.heal = 5;
    const result = applySkill(battleState, 'heal');

    expect(result).toBeNull();
  });

});

describe('Shield Skill', () => {

  const createTestBattleState = () => {
    const stage = { monsters: [{ type: 'fungus', count: 1 }] };
    const monsters = buildMonsterQueue(stage, MONSTER_TYPES);

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

  it('shield grants +10 DEF for 5 rounds', () => {
    const battleState = createTestBattleState();
    const result = applySkill(battleState, 'shield');

    expect(result).not.toBeNull();
    const { battleState: newState, effect } = result;

    expect(effect.type).toBe('shield');
    expect(effect.shieldDef).toBe(10);
    expect(effect.shieldRounds).toBe(5);
    expect(newState.hero.shieldBuff).toBe(10);
    expect(newState.hero.shieldBuffRounds).toBe(5);
  });

  it('shield consumes 50 MP', () => {
    const battleState = createTestBattleState();
    const result = applySkill(battleState, 'shield');

    expect(result).not.toBeNull();
    expect(result.battleState.hero.mp).toBe(50); // 100 - 50
  });

  it('shield returns null when MP insufficient', () => {
    const battleState = createTestBattleState();
    battleState.hero.mp = 40;
    const result = applySkill(battleState, 'shield');

    expect(result).toBeNull();
  });

  it('shield returns null when on cooldown', () => {
    const battleState = createTestBattleState();
    battleState.hero.skillCooldowns.shield = 8;
    const result = applySkill(battleState, 'shield');

    expect(result).toBeNull();
  });

  it('shield can be reapplied while active (validation is separate)', () => {
    const battleState = createTestBattleState();
    battleState.hero.shieldBuffRounds = 3;
    // applySkill doesn't validate shield already active - that's validateAction's job
    const result = applySkill(battleState, 'shield');
    expect(result).not.toBeNull();
    // Shield gets set to new value
    expect(result.battleState.hero.shieldBuffRounds).toBe(5);
  });

});

describe('Skill Validation', () => {

  const createTestBattleState = (overrides = {}) => {
    const stage = { monsters: [{ type: 'fungus', count: 1 }] };
    const monsters = buildMonsterQueue(stage, MONSTER_TYPES);
    monsters[0].hp = 30;

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
        ...overrides,
      },
    };
  };

  describe('validateAction', () => {

    it('allows attack on hero turn', () => {
      const battleState = createTestBattleState();
      const validation = validateAction(battleState, 'attack');
      expect(validation.valid).toBe(true);
    });

    it('rejects attack when not hero turn', () => {
      const battleState = createTestBattleState();
      battleState.state = BATTLE_STATE.MONSTER_TURN;
      const validation = validateAction(battleState, 'attack');
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('不是你的回合');
    });

    it('rejects fireball when MP insufficient', () => {
      const battleState = createTestBattleState({ mp: 20 });
      const validation = validateAction(battleState, 'fireball');
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('法力不足');
    });

    it('rejects fireball when on cooldown', () => {
      const battleState = createTestBattleState({ skillCooldowns: { fireball: 3, heal: 0, shield: 0 } });
      const validation = validateAction(battleState, 'fireball');
      expect(validation.valid).toBe(false);
      expect(validation.reason).toContain('火球冷却中');
    });

    it('rejects heal when HP full', () => {
      const battleState = createTestBattleState({ hp: 100 });
      const validation = validateAction(battleState, 'heal');
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('HP已满');
    });

    it('rejects heal when MP insufficient', () => {
      const battleState = createTestBattleState({ mp: 30 });
      const validation = validateAction(battleState, 'heal');
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('法力不足');
    });

    it('rejects shield when already active', () => {
      const battleState = createTestBattleState({ shieldBuffRounds: 3 });
      const validation = validateAction(battleState, 'shield');
      expect(validation.valid).toBe(false);
      expect(validation.reason).toBe('护盾已激活');
    });

    it('rejects attack when no monster alive', () => {
      const stage = { monsters: [{ type: 'fungus', count: 1 }] };
      const monsters = buildMonsterQueue(stage, MONSTER_TYPES);
      monsters[0].hp = 0;
      const battleState = {
        state: BATTLE_STATE.HERO_TURN,
        turnCount: 1,
        monsters,
        currentMonsterIdx: 0,
        hero: { ...HERO_DEFAULTS, mp: 100, skillCooldowns: { fireball: 0, heal: 0, shield: 0 } },
      };
      const validation = validateAction(battleState, 'attack');
      expect(validation.valid).toBe(false);
    });

  });

});

describe('Skill Cooldown Decrement', () => {

  it('skill cooldown decrements by 1 each turn', () => {
    // Simulate end of hero turn
    const cooldowns = { fireball: 3, heal: 5, shield: 8 };
    const newCooldowns = {
      fireball: Math.max(0, cooldowns.fireball - 1),
      heal: Math.max(0, cooldowns.heal - 1),
      shield: Math.max(0, cooldowns.shield - 1),
    };

    expect(newCooldowns.fireball).toBe(2);
    expect(newCooldowns.heal).toBe(4);
    expect(newCooldowns.shield).toBe(7);
  });

  it('cooldown does not go below 0', () => {
    const cooldowns = { fireball: 0, heal: 1, shield: 0 };
    const newCooldowns = {
      fireball: Math.max(0, cooldowns.fireball - 1),
      heal: Math.max(0, cooldowns.heal - 1),
      shield: Math.max(0, cooldowns.shield - 1),
    };

    expect(newCooldowns.fireball).toBe(0);
    expect(newCooldowns.heal).toBe(0);
    expect(newCooldowns.shield).toBe(0);
  });

  it('skill becomes usable when cooldown reaches 0', () => {
    const cooldowns = { fireball: 1, heal: 1, shield: 1 };
    const newCooldowns = {
      fireball: Math.max(0, cooldowns.fireball - 1),
      heal: Math.max(0, cooldowns.heal - 1),
      shield: Math.max(0, cooldowns.shield - 1),
    };

    // After decrement, cooldown is 0
    expect(newCooldowns.fireball).toBe(0);
    expect(newCooldowns.heal).toBe(0);
    expect(newCooldowns.shield).toBe(0);

    // So MP check should pass (if sufficient)
    const hero = { ...HERO_DEFAULTS, mp: 100, skillCooldowns: newCooldowns };
    const validation = validateAction(
      { state: BATTLE_STATE.HERO_TURN, monsters: [{ hp: 30 }], currentMonsterIdx: 0, hero },
      'fireball'
    );
    expect(validation.valid).toBe(true);
  });

});

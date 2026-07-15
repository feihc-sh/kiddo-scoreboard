/**
 * Fighter V2 Combat Logic
 * Pure functions for turn-based combat
 * Per spec §4 Combat Math + §4 Turn Flow
 *
 * All functions are PURE - input state → output new state
 * No DOM access, no side effects
 */

// ==================== Constants ====================

export const BATTLE_STATE = {
  IDLE: 'idle',
  HERO_TURN: 'hero-turn',
  MONSTER_TURN: 'monster-turn',
  STAGE_CLEAR: 'stage-clear',
  DEFEAT: 'defeat',
  VICTORY: 'victory',
};

export const ACTION_TYPE = {
  ATTACK: 'attack',
  FIREBALL: 'fireball',
  HEAL: 'heal',
  SHIELD: 'shield',
};

// ==================== Hero Defaults ====================

export const HERO_DEFAULTS = {
  hp: 100,
  maxHp: 100,
  mp: 100,
  maxMp: 100,
  atk: 10,
  def: 0,
  shieldBuff: 0,
  shieldBuffRounds: 0,
  skillCooldowns: { fireball: 0, heal: 0, shield: 0 },
};

// ==================== Skill Definitions ====================

export const SKILLS = {
  fireball: {
    id: 'fireball',
    name: '火球',
    emoji: '🔥',
    mpCost: 30,
    cooldown: 5,
    description: '造成 30 点伤害',
  },
  heal: {
    id: 'heal',
    name: '治疗',
    emoji: '💚',
    mpCost: 40,
    cooldown: 8,
    description: '恢复 30 HP',
  },
  shield: {
    id: 'shield',
    name: '护盾',
    emoji: '🛡️',
    mpCost: 50,
    cooldown: 12,
    description: '防御 +10 持续 5 回合',
  },
};

// ==================== Monster Factory ====================

/**
 * Create a monster instance from a monster type
 * @param {string} type - 'fungus' | 'worm' | 'dragon'
 * @param {number} instanceId - unique ID for this instance
 * @returns {object} monster instance
 */
export function createMonster(type, instanceId, monsterTypes) {
  const def = monsterTypes[type];
  return {
    id: `${type}-${instanceId}`,
    type,
    name: def.name,
    emoji: def.emoji,
    hp: def.hp,
    maxHp: def.hp,
    atk: def.atk,
    def: def.def,
  };
}

/**
 * Build the monster queue for a stage
 * @param {object} stage - stage definition with monsters array
 * @param {object} monsterTypes - MONSTER_TYPES from stages.js
 * @returns {Array} flat array of monster instances
 */
export function buildMonsterQueue(stage, monsterTypes) {
  const queue = [];
  let instanceId = 0;

  for (const { type, count } of stage.monsters) {
    for (let i = 0; i < count; i++) {
      queue.push(createMonster(type, instanceId++, monsterTypes));
    }
  }

  return queue;
}

// ==================== Damage Calculation ====================

/**
 * Calculate damage from attacker to defender
 * @param {number} atk - attacker's ATK
 * @param {number} def - defender's DEF (includes shield buff)
 * @returns {number} damage dealt (minimum 1)
 */
export function calculateDamage(atk, def) {
  return Math.max(1, atk - def);
}

/**
 * Apply damage to a target
 * @param {object} target - { hp, maxHp }
 * @param {number} damage - damage to apply
 * @returns {object} new target with updated hp (min 0)
 */
export function applyDamage(target, damage) {
  return {
    ...target,
    hp: Math.max(0, target.hp - damage),
  };
}

/**
 * Apply healing to a target
 * @param {object} target - { hp, maxHp }
 * @param {number} healAmount - amount to heal
 * @returns {object} new target with updated hp (capped at maxHp)
 */
export function applyHealing(target, healAmount) {
  return {
    ...target,
    hp: Math.min(target.hp + healAmount, target.maxHp),
  };
}

// ==================== Skill Application ====================

/**
 * Apply a skill to the battle state
 * @param {object} battleState - current battle state
 * @param {string} skillId - 'fireball' | 'heal' | 'shield'
 * @returns {object} { battleState, effect } or null if invalid
 */
export function applySkill(battleState, skillId) {
  const skill = SKILLS[skillId];
  if (!skill) return null;

  // Validate MP
  if (battleState.hero.mp < skill.mpCost) {
    return null;
  }

  // Validate cooldown
  if (battleState.hero.skillCooldowns[skillId] > 0) {
    return null;
  }

  const currentMonster = battleState.monsters[battleState.currentMonsterIdx];
  if (!currentMonster || currentMonster.hp <= 0) {
    // Can't use fireball if no valid target
    if (skillId === 'fireball') return null;
  }

  let newBattleState = { ...battleState };
  let effect = { type: skillId, skillName: skill.name, emoji: skill.emoji };

  // Consume MP
  newBattleState.hero = {
    ...newBattleState.hero,
    mp: newBattleState.hero.mp - skill.mpCost,
  };

  switch (skillId) {
    case 'fireball': {
      const FIREBALL_DAMAGE = 30;
      const newMonster = applyDamage(currentMonster, FIREBALL_DAMAGE);
      effect.damage = FIREBALL_DAMAGE;
      effect.targetId = currentMonster.id;
      effect.targetName = currentMonster.name;

      // Update monster in array
      const newMonsters = [...newBattleState.monsters];
      newMonsters[newBattleState.currentMonsterIdx] = newMonster;
      newBattleState.monsters = newMonsters;
      break;
    }

    case 'heal': {
      const HEAL_AMOUNT = 30;
      newBattleState.hero = applyHealing(newBattleState.hero, HEAL_AMOUNT);
      effect.healAmount = HEAL_AMOUNT;
      break;
    }

    case 'shield': {
      const SHIELD_DEF = 10;
      const SHIELD_ROUNDS = 5;
      newBattleState.hero = {
        ...newBattleState.hero,
        shieldBuff: SHIELD_DEF,
        shieldBuffRounds: SHIELD_ROUNDS,
      };
      effect.shieldDef = SHIELD_DEF;
      effect.shieldRounds = SHIELD_ROUNDS;
      break;
    }
  }

  // Set cooldown (applied at end of hero turn)
  // Note: cooldown set in endHeroTurn

  return { battleState: newBattleState, effect };
}

// ==================== Turn Resolution ====================

/**
 * Get total hero DEF (base + equipment + shield buff)
 * @param {object} hero - hero object
 * @param {object} equipment - equipment bonuses
 * @returns {number} total DEF
 */
export function getHeroDef(hero, equipment) {
  let totalDef = hero.def;

  // Shield buff
  if (hero.shieldBuffRounds > 0) {
    totalDef += hero.shieldBuff;
  }

  // Equipment bonus (P4 - P3 equipment is always 'none')
  const SHIELD_BONUS = { none: 0, bronze: 3, silver: 8, gold: 15 };
  totalDef += SHIELD_BONUS[equipment.shield] || 0;

  return totalDef;
}

/**
 * Get hero ATK with equipment bonus
 * @param {object} hero - hero object
 * @param {object} equipment - equipment bonuses
 * @returns {number} total ATK
 */
export function getHeroAtk(hero, equipment) {
  // Equipment bonus (P4 - P3 equipment is always 'none')
  const SWORD_BONUS = { none: 0, bronze: 5, silver: 12, gold: 25 };
  return hero.atk + (SWORD_BONUS[equipment.sword] || 0);
}

/**
 * End hero's turn - decrement cooldowns, regen MP, check monster death
 * @param {object} battleState - current battle state
 * @param {object} equipment - equipment bonuses
 * @returns {object} { battleState, events[] }
 */
export function endHeroTurn(battleState, equipment) {
  let newBattleState = { ...battleState };
  const events = [];

  // 1. Decrement skill cooldowns
  newBattleState.hero = {
    ...newBattleState.hero,
    skillCooldowns: {
      fireball: Math.max(0, newBattleState.hero.skillCooldowns.fireball - 1),
      heal: Math.max(0, newBattleState.hero.skillCooldowns.heal - 1),
      shield: Math.max(0, newBattleState.hero.skillCooldowns.shield - 1),
    },
  };

  // 2. MP Regen +10 (capped at maxMp)
  newBattleState.hero = {
    ...newBattleState.hero,
    mp: Math.min(newBattleState.hero.mp + 10, newBattleState.hero.maxMp),
  };

  // 3. Check if current monster is dead
  const currentMonster = newBattleState.monsters[newBattleState.currentMonsterIdx];
  if (currentMonster && currentMonster.hp <= 0) {
    events.push({ type: 'monster-killed', monsterId: currentMonster.id, monsterName: currentMonster.name });

    // Move to next monster
    const nextIdx = findNextAliveMonster(newBattleState.monsters, newBattleState.currentMonsterIdx);
    if (nextIdx !== -1) {
      newBattleState.currentMonsterIdx = nextIdx;
    } else {
      // All monsters dead - stage clear
      newBattleState.state = BATTLE_STATE.STAGE_CLEAR;
      events.push({ type: 'stage-clear' });
      return { battleState: newBattleState, events };
    }
  }

  // 4. Switch to monster turn
  newBattleState.state = BATTLE_STATE.MONSTER_TURN;
  newBattleState.turnCount = (newBattleState.turnCount || 0) + 1;

  return { battleState: newBattleState, events };
}

/**
 * Find next alive monster index after given index
 * @param {Array} monsters
 * @param {number} currentIdx
 * @returns {number} next alive index or -1
 */
export function findNextAliveMonster(monsters, currentIdx) {
  for (let i = currentIdx + 1; i < monsters.length; i++) {
    if (monsters[i].hp > 0) return i;
  }
  return -1;
}

/**
 * Execute monster's turn
 * @param {object} battleState - current battle state
 * @param {object} equipment - equipment bonuses
 * @returns {object} { battleState, events[] }
 */
export function executeMonsterTurn(battleState, equipment) {
  let newBattleState = { ...battleState };
  const events = [];

  // Get current monster
  const monster = newBattleState.monsters[newBattleState.currentMonsterIdx];
  if (!monster || monster.hp <= 0) {
    // No monster to attack with - skip to hero turn
    newBattleState.state = BATTLE_STATE.HERO_TURN;
    return { battleState: newBattleState, events };
  }

  // Calculate damage
  const heroDef = getHeroDef(newBattleState.hero, equipment);
  const damage = calculateDamage(monster.atk, heroDef);

  // Apply damage to hero
  newBattleState.hero = applyDamage(newBattleState.hero, damage);
  events.push({ type: 'monster-attack', damage, monsterName: monster.name });

  // Check if hero died
  if (newBattleState.hero.hp <= 0) {
    newBattleState.state = BATTLE_STATE.DEFEAT;
    events.push({ type: 'hero-defeated' });
    return { battleState: newBattleState, events };
  }

  // Decrement shield buff rounds (at end of monster turn, shield was applied at start)
  // Shield buff expires at the END of hero's NEXT turn (5 rounds from when it was applied)
  // Actually per spec: "hero.def += 10 for 5 回合" - rounds decrement at end of each FULL turn
  // Shield is applied at end of hero's turn that casts it
  // Decrement at end of monster's turn
  if (newBattleState.hero.shieldBuffRounds > 0) {
    newBattleState.hero = {
      ...newBattleState.hero,
      shieldBuffRounds: newBattleState.hero.shieldBuffRounds - 1,
    };
    if (newBattleState.hero.shieldBuffRounds === 0) {
      newBattleState.hero = {
        ...newBattleState.hero,
        shieldBuff: 0,
      };
      events.push({ type: 'shield-expired' });
    }
  }

  // MP Regen +10 (end of monster turn)
  newBattleState.hero = {
    ...newBattleState.hero,
    mp: Math.min(newBattleState.hero.mp + 10, newBattleState.hero.maxMp),
  };

  // Switch to hero turn
  newBattleState.state = BATTLE_STATE.HERO_TURN;

  return { battleState: newBattleState, events };
}

/**
 * Apply hero attack to current monster
 * @param {object} battleState - current battle state
 * @param {object} equipment - equipment bonuses
 * @returns {object} { battleState, effect } or null if no valid target
 */
export function applyHeroAttack(battleState, equipment) {
  const currentMonster = battleState.monsters[battleState.currentMonsterIdx];
  if (!currentMonster || currentMonster.hp <= 0) {
    return null;
  }

  const heroAtk = getHeroAtk(battleState.hero, equipment);
  const damage = calculateDamage(heroAtk, currentMonster.def);

  const newMonster = applyDamage(currentMonster, damage);

  const newMonsters = [...battleState.monsters];
  newMonsters[battleState.currentMonsterIdx] = newMonster;

  return {
    battleState: {
      ...battleState,
      monsters: newMonsters,
    },
    effect: {
      type: ACTION_TYPE.ATTACK,
      damage,
      targetId: currentMonster.id,
      targetName: currentMonster.name,
    },
  };
}

// ==================== Battle Init ====================

/**
 * Initialize battle state for a stage
 * @param {object} stage - stage definition
 * @param {object} heroDefaults - HERO_DEFAULTS
 * @param {object} monsterTypes - MONSTER_TYPES
 * @param {number} sessionStars - current session stars
 * @returns {object} initial battle state
 */
export function initBattle(stage, heroDefaults, monsterTypes, sessionStars) {
  const monsters = buildMonsterQueue(stage, monsterTypes);

  return {
    state: BATTLE_STATE.HERO_TURN,
    turnCount: 1,
    worldIdx: stage.worldIdx,
    stageIdx: stage.stageIdx,
    stageId: stage.id,
    totalMonsters: stage.totalMonsters,
    monstersKilled: 0,
    sessionStarsEarned: sessionStars,
    currentMonsterIdx: 0,
    hero: { ...heroDefaults },
    monsters,
  };
}

/**
 * Calculate stage clear rewards
 * @param {number} sessionStars - stars earned this session
 * @returns {number} stage bonus
 */
export function getStageBonus() {
  return 5; // per spec §4 Stage clear bonus
}

// ==================== State Validation ====================

/**
 * Check if hero can perform an action
 * @param {object} battleState
 * @param {string} actionType
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateAction(battleState, actionType) {
  if (battleState.state !== BATTLE_STATE.HERO_TURN) {
    return { valid: false, reason: '不是你的回合' };
  }

  const currentMonster = battleState.monsters[battleState.currentMonsterIdx];
  if (actionType === ACTION_TYPE.ATTACK || actionType === ACTION_TYPE.FIREBALL) {
    if (!currentMonster || currentMonster.hp <= 0) {
      return { valid: false, reason: '没有可攻击的敌人' };
    }
  }

  if (actionType === ACTION_TYPE.FIREBALL) {
    if (battleState.hero.mp < SKILLS.fireball.mpCost) {
      return { valid: false, reason: '法力不足' };
    }
    if (battleState.hero.skillCooldowns.fireball > 0) {
      return { valid: false, reason: `火球冷却中 (${battleState.hero.skillCooldowns.fireball}回合)` };
    }
  }

  if (actionType === ACTION_TYPE.HEAL) {
    if (battleState.hero.mp < SKILLS.heal.mpCost) {
      return { valid: false, reason: '法力不足' };
    }
    if (battleState.hero.skillCooldowns.heal > 0) {
      return { valid: false, reason: `治疗冷却中 (${battleState.hero.skillCooldowns.heal}回合)` };
    }
    if (battleState.hero.hp >= battleState.hero.maxHp) {
      return { valid: false, reason: 'HP已满' };
    }
  }

  if (actionType === ACTION_TYPE.SHIELD) {
    if (battleState.hero.mp < SKILLS.shield.mpCost) {
      return { valid: false, reason: '法力不足' };
    }
    if (battleState.hero.skillCooldowns.shield > 0) {
      return { valid: false, reason: `护盾冷却中 (${battleState.hero.skillCooldowns.shield}回合)` };
    }
    if (battleState.hero.shieldBuffRounds > 0) {
      return { valid: false, reason: '护盾已激活' };
    }
  }

  return { valid: true };
}

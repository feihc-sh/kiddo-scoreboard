// src/games/fighter/logic.ts
// Fighter game pure logic functions.
//
// Stage 1 (Foundation): damage() only.
// Stage 2 (Combat Core): combat functions below.
// Stage 3 (HP + Counter-Attack): hero HP, monster variants, counter-attack.

import type { GameState, Monster, MonsterId, StageTransition } from './state.ts';
import { STAGES, monsterHpFor, MONSTER_VARIANTS, heroTakeDamage, initialState } from './state.ts';

/**
 * Calculate damage dealt by an attacker to a defender.
 *
 * Formula: max(1, attackerAtk - defenderDef)
 * - Minimum 1 damage so defenders can never be completely unhittable.
 * - Negative defenderDef acts as a buff (attackerAtk + abs(negativeDef)).
 * - Pure function: no side effects, no dependencies.
 *
 * @param attackerAtk  Attacker's attack power (non-negative integer expected)
 * @param defenderDef  Defender's defense value (integer, may be negative)
 * @returns           Guaranteed minimum 1 damage
 */
export function damage(attackerAtk: number, defenderDef: number): number {
  return Math.max(1, attackerAtk - defenderDef);
}

// ---- Stage 2: Combat Core ----

/** Returns true if monster HP <= 0. */
export function isMonsterDead(monster: Monster | null): boolean {
  if (monster === null) return true;
  return monster.hp <= 0;
}

/** Returns new state with monster HP reduced by hero.atk (clamped to 0). Pure. */
export function attackMonster(state: GameState): GameState {
  if (state.currentMonster === null) {
    return state;
  }
  const newHp = Math.max(0, state.currentMonster.hp - state.hero.atk);
  return {
    ...state,
    currentMonster: { ...state.currentMonster, hp: newHp },
  };
}

/** Award stars to sessionStars (and bank). Pure. */
export function gainStars(state: GameState, amount: number): GameState {
  return {
    ...state,
    sessionStars: state.sessionStars + amount,
    bank: state.bank + amount,
  };
}

/** Spawn next monster from current stage queue (consumed FIFO). Returns updated state.
 *  If queue empty, returns state with currentMonster=null (stage complete — Stage 4 will load next stage). */
export function spawnNextMonster(state: GameState): GameState {
  if (state.stageQueueRemaining <= 0) {
    return { ...state, currentMonster: null };
  }

  const stage = STAGES[state.stageIdx];
  if (!stage || stage.monsters.length === 0) {
    return { ...state, currentMonster: null };
  }

  const monsterIndex = stage.monsters.length - state.stageQueueRemaining;
  if (monsterIndex < 0 || monsterIndex >= stage.monsters.length) {
    return { ...state, currentMonster: null };
  }

  const template = stage.monsters[monsterIndex];

  const hp = monsterHpFor(template);
  const newMonster: Monster = {
    ...template,
    hp,
    maxHp: hp,
  };

  return {
    ...state,
    currentMonster: newMonster,
    stageQueueRemaining: state.stageQueueRemaining - 1,
  };
}

/** Kill current monster: award 1⭐, then spawn next (or null if queue empty). Pure. */
export function killCurrentMonster(state: GameState): GameState {
  const withStar = gainStars(state, 1);
  return spawnNextMonster(withStar);
}

/** Start the game: load stage 1 monsters and spawn the first one. Pure. */
export function startGame(state: GameState): GameState {
  const stage = STAGES[0];
  const spawned = spawnNextMonster({
    ...state,
    status: 'fighting',
    stageQueueRemaining: stage.monsters.length,
  });
  return spawned;
}

// ---- Stage 3: Hero HP + Counter-Attack + Monster Variants ----

/** Build a Monster instance from a variant template. */
export function makeMonster(variantId: MonsterId): Monster {
  const v = MONSTER_VARIANTS[variantId];
  return {
    id: v.id,
    name: v.name,
    hp: v.baseHp,
    maxHp: v.baseHp,
    atk: v.atk,
    def: v.def,
  };
}

/**
 * Counter-attack tick: monster damages hero.
 *
 * @param state - Current game state
 * @param nowMs - Current timestamp in milliseconds
 * @returns New state with updated hero HP (or lost status if HP <= 0)
 */
export function monsterCounterAttack(state: GameState, nowMs: number): GameState {
  // Only process counter-attack when fighting and monster exists
  if (state.status !== 'fighting' || state.currentMonster === null) {
    return state;
  }

  // Check if enough time has passed since last hit
  const counterIntervalMs = MONSTER_VARIANTS[state.currentMonster.id as MonsterId].counterIntervalMs;
  const timeSinceLastHit = nowMs - state.hero.lastHitAt;

  if (timeSinceLastHit < counterIntervalMs) {
    return state;  // Not enough time elapsed, no damage
  }

  // Calculate damage after shield reduction
  const damageTaken = heroTakeDamage(state.currentMonster, state.hero);
  const newHp = Math.max(0, state.hero.hp - damageTaken);

  // Check for game over
  if (newHp <= 0) {
    return {
      ...state,
      hero: { ...state.hero, hp: 0, lastHitAt: nowMs },
      currentMonster: null,
      status: 'lost',
    };
  }

  // Return state with reduced HP and updated lastHitAt
  return {
    ...state,
    hero: { ...state.hero, hp: newHp, lastHitAt: nowMs },
  };
}

/** Tick driver: called by setInterval in fighter.js. Just delegates to monsterCounterAttack. */
export function tickGame(state: GameState, nowMs: number): GameState {
  return monsterCounterAttack(state, nowMs);
}

/** Game over detected when hero.hp <= 0. */
export function isGameOver(state: GameState): boolean {
  return state.status === 'lost';
}

/** Restart game: reset hero to full HP, stars to 0, status to 'menu'. Pure. */
export function restartGame(state: GameState): GameState {
  const fresh = initialState();
  return {
    ...fresh,
    bank: state.bank,  // Keep persistent bank across restarts
  };
}

// ---- Stage 4: Stage Progression + Win/Lose ----

/** Decide what happens after currentMonster becomes null.
 *  Returns 'cleared' if more stages remain (advance to next stage).
 *  Returns 'victory' if last stage cleared.
 *  Returns 'defeat' if hero.hp <= 0 (handle separately — see triggerDefeat).
 *  Returns 'continue' if currentMonster is still alive (no transition).
 */
export function evaluateStageTransition(state: GameState): StageTransition {
  // Only evaluate when actively fighting
  if (state.status !== 'fighting') {
    return { nextStatus: state.status, reason: 'continue' };
  }

  // If there's still a monster alive, no transition needed
  if (state.currentMonster !== null) {
    return { nextStatus: 'fighting', reason: 'continue' };
  }

  // currentMonster is null — stage is complete
  const stageReward = STAGES[state.stageIdx]?.reward ?? 0;

  if (state.stageIdx === STAGES.length - 1) {
    // Last stage (idx=4) cleared → victory
    return {
      nextStatus: 'won',
      bonus: stageReward,
      reason: 'victory',
    };
  }

  // More stages remain → advance
  return {
    nextStatus: 'fighting',
    nextStageIdx: state.stageIdx + 1,
    bonus: stageReward,
    reason: 'cleared',
  };
}

/** Award stage-clear bonus stars (from STAGES[i].reward) and advance to next stage. Pure. */
export function advanceToNextStage(state: GameState): GameState {
  const stageReward = STAGES[state.stageIdx]?.reward ?? 0;
  const nextStageIdx = state.stageIdx + 1;
  const nextStage = STAGES[nextStageIdx];

  // Award stage bonus stars
  const withBonus = {
    ...state,
    sessionStars: state.sessionStars + stageReward,
    bank: state.bank + stageReward,
  };

  // Advance to next stage
  const afterAdvance = {
    ...withBonus,
    stageIdx: nextStageIdx,
    hero: {
      ...withBonus.hero,
      hp: withBonus.hero.maxHp,         // Reset hero HP between stages
      lastHitAt: Date.now() + 30000,   // Set 30s ahead so first tick won't deal damage
    },
  };

  // Spawn first monster of next stage
  if (nextStage) {
    return spawnNextStageMonster(afterAdvance, nextStage);
  }

  // No next stage (shouldn't happen if called correctly)
  return { ...afterAdvance, currentMonster: null, stageQueueRemaining: 0 };
}

/** Spawn first monster of the given stage. Used by advanceToNextStage. */
function spawnNextStageMonster(state: GameState, stage: { monsters: Omit<Monster, 'hp' | 'maxHp'>[] }): GameState {
  if (stage.monsters.length === 0) {
    return { ...state, currentMonster: null, stageQueueRemaining: 0 };
  }

  const template = stage.monsters[0];
  const hp = monsterHpFor(template);
  const newMonster: Monster = {
    ...template,
    hp,
    maxHp: hp,
  };

  return {
    ...state,
    currentMonster: newMonster,
    stageQueueRemaining: stage.monsters.length - 1,
  };
}

/** Mark the game as won (all 5 stages cleared). Hero HP unchanged. */
export function triggerVictory(state: GameState): GameState {
  return {
    ...state,
    status: 'won',
    currentMonster: null,
  };
}

/** Mark the game as lost (hero HP <= 0). Award no more stars. */
export function triggerDefeat(state: GameState): GameState {
  return {
    ...state,
    status: 'lost',
    currentMonster: null,
    hero: {
      ...state.hero,
      hp: 0,
    },
  };
}

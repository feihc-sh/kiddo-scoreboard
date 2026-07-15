/**
 * Fighter V2 Battle Controller
 * Orchestrates the turn-based combat flow
 * Per spec §4 Turn Flow State Machine
 */

import { $ } from './utils.js';
import { loadState, saveState } from './utils.js';
import {
  BATTLE_STATE,
  ACTION_TYPE,
  HERO_DEFAULTS,
  SKILLS,
  initBattle,
  applyHeroAttack,
  applySkill,
  endHeroTurn,
  executeMonsterTurn,
  validateAction,
  getHeroDef,
  getStageBonus,
} from './combat.js';
import { getStage, MONSTER_TYPES } from './stages.js';
import {
  renderBattleScene,
  updateBattleScene,
  showHeroTurnBanner,
  showMonsterTurnBanner,
  showBattleFloatingText,
  showBattleSkillEffect,
  showVictoryModal,
  showDefeatModal,
  clearBattleTimer,
} from './battle-scene.js';
import {
  showShopModal,
  hideShopModal,
  isWorldCleared,
  awardWorldClearBonus,
} from './shop-modal.js';

/** @type {object | null} */
let battleState = null;

/** @type {object | null} */
let equipment = null;

/** @type {Function | null} */
let onBattleEndCallback = null;

/** @type {number | null} */
let _turnTimer = null;

// ==================== Public API ====================

/**
 * Start a battle for a stage
 * @param {object} gameState - from fighter.js gameState
 * @param {Function} onEnd - callback(result: { type, state })
 */
export function showBattleView(gameState, onEnd) {
  onBattleEndCallback = onEnd;

  // Initialize equipment from gameState
  equipment = gameState.equipment;

  // Get stage
  const stage = getStage(gameState.session.worldIdx, gameState.session.stageIdx);
  if (!stage) {
    console.error('Stage not found:', gameState.session.worldIdx, gameState.session.stageIdx);
    onBattleEndCallback?.({ type: 'error', state: gameState });
    return;
  }

  // Reset hero to defaults for this battle
  const heroForBattle = {
    ...HERO_DEFAULTS,
  };

  // Initialize battle state
  battleState = initBattle(stage, heroForBattle, MONSTER_TYPES, gameState.session.stars);

  // Show battle view
  const battleView = $('view-battle');
  if (!battleView) {
    console.error('Battle view not found');
    return;
  }

  // Show the battle view (switch from stage-intro to battle)
  const worldMapView = $('view-world-map');
  const stageIntroView = $('view-stage-intro');
  worldMapView?.classList.remove('active');
  stageIntroView?.classList.remove('active');
  battleView.classList.add('active');

  // Render battle scene
  renderBattleScene(battleView, battleState, equipment, handleAction);

  // Show initial hero turn banner
  showHeroTurnBanner(battleState.turnCount);
}

// Called by fighter.js after showing the battle view
export function initBattleScene() {
  if (!battleState || !$('view-battle')) return;
  renderBattleScene($('view-battle'), battleState, equipment, handleAction);
  showHeroTurnBanner(battleState.turnCount);
}

/**
 * Handle player action
 * @param {string} actionType - 'attack' | 'skill'
 * @param {string} [skillId] - 'fireball' | 'heal' | 'shield'
 */
function handleAction(actionType, skillId) {
  if (!battleState) return;

  // Validate action
  const actionForValidate = actionType === 'skill' ? skillId : actionType;
  const validation = validateAction(battleState, actionForValidate);
  if (!validation.valid) {
    console.warn('Invalid action:', validation.reason);
    return;
  }

  // Clear any existing timers
  clearTimeout(_turnTimer);

  let effect = null;
  let effectTarget = null;

  // Apply action
  if (actionType === 'attack') {
    const result = applyHeroAttack(battleState, equipment);
    if (!result) return;
    battleState = result.battleState;
    effect = result.effect;
    effectTarget = 'monster';
  } else if (actionType === 'skill') {
    const result = applySkill(battleState, skillId);
    if (!result) return;
    battleState = result.battleState;
    effect = result.effect;
    effectTarget = skillId === 'fireball' ? 'monster' : 'hero';
  }

  // Show skill effects
  const battleView = $('view-battle');
  if (battleView && effect) {
    if (effect.type === 'fireball') {
      const monsterSprite = battleView.querySelector('#monster-sprite');
      showBattleSkillEffect(monsterSprite, 'fireball');
      showBattleFloatingText(monsterSprite, 30, 'damage');
    } else if (effect.type === 'heal') {
      const heroSprite = battleView.querySelector('.battle-sprite--hero');
      showBattleSkillEffect(heroSprite, 'heal');
      showBattleFloatingText(heroSprite, 30, 'heal');
    } else if (effect.type === 'shield') {
      const heroSprite = battleView.querySelector('.battle-sprite--hero');
      showBattleSkillEffect(heroSprite, 'shield');
      showBattleFloatingText(heroSprite, 10, 'shield');
    } else if (effect.type === 'attack') {
      const monsterSprite = battleView.querySelector('#monster-sprite');
      if (monsterSprite) {
        showBattleFloatingText(monsterSprite, effect.damage, 'damage');
        monsterSprite.classList.add('flash-damage');
        setTimeout(() => monsterSprite.classList.remove('flash-damage'), 300);
      }
    }
  }

  // Update UI immediately
  updateBattleScene(battleState);

  // Check for stage clear (all monsters dead)
  if (battleState.state === BATTLE_STATE.STAGE_CLEAR) {
    _turnTimer = setTimeout(() => {
      handleStageClear();
    }, 500);
    return;
  }

  // End hero turn and start monster turn
  _turnTimer = setTimeout(() => {
    processHeroTurnEnd();
  }, 500);
}

/**
 * End hero's turn - process cooldowns, regen, check monster death
 */
function processHeroTurnEnd() {
  if (!battleState) return;

  // Apply end of hero turn effects
  const result = endHeroTurn(battleState, equipment);
  battleState = result.battleState;

  // Check for events
  for (const event of result.events) {
    if (event.type === 'stage-clear') {
      updateBattleScene(battleState);
      _turnTimer = setTimeout(() => handleStageClear(), 500);
      return;
    }
  }

  // Update UI
  updateBattleScene(battleState);

  // Start monster turn
  _turnTimer = setTimeout(() => {
    processMonsterTurn();
  }, 500);
}

/**
 * Process monster's turn
 */
function processMonsterTurn() {
  if (!battleState) return;

  // Show monster turn banner
  showMonsterTurnBanner(() => {
    if (!battleState) return;

    // Execute monster attack
    const result = executeMonsterTurn(battleState, equipment);
    battleState = result.battleState;

    // Show damage effect
    const battleView = $('view-battle');
    if (battleView) {
      for (const event of result.events) {
        if (event.type === 'monster-attack') {
          const heroSprite = battleView.querySelector('.battle-sprite--hero');
          if (heroSprite) {
            showBattleFloatingText(heroSprite, event.damage, 'damage');
            heroSprite.classList.add('flash-damage');
            setTimeout(() => heroSprite.classList.remove('flash-damage'), 300);
          }
        }
      }
    }

    // Check for defeat
    if (battleState.state === BATTLE_STATE.DEFEAT) {
      updateBattleScene(battleState);
      _turnTimer = setTimeout(() => handleDefeat(), 500);
      return;
    }

    // Update UI and show hero turn
    updateBattleScene(battleState);
    _turnTimer = setTimeout(() => {
      showHeroTurnBanner(battleState.turnCount);
    }, 300);
  });
}

/**
 * Handle stage clear - show victory modal
 */
function handleStageClear() {
  if (!battleState) return;

  // Award stage bonus
  const stageBonus = getStageBonus();

  // Update session stars
  battleState.sessionStarsEarned += stageBonus;

  // Update game state
  const gameState = loadState();
  const updatedState = {
    ...gameState,
    session: {
      ...gameState.session,
      stars: battleState.sessionStarsEarned,
    },
    bank: {
      ...gameState.bank,
      stars: gameState.bank.stars + stageBonus,
    },
  };
  saveState(updatedState);

  // Show victory modal
  const battleView = $('view-battle');
  if (battleView) {
    showVictoryModal(
      battleState,
      () => {
        // Next stage
        clearBattleState();
        goToNextStage();
      },
      () => {
        // Back to map
        clearBattleState();
        onBattleEndCallback?.({ type: 'victory', state: updatedState });
      }
    );
  }
}

/**
 * Handle defeat - show defeat modal
 */
function handleDefeat() {
  if (!battleState) return;

  // Reset session stars (整局 reset per spec)
  const gameState = loadState();
  const updatedState = {
    ...gameState,
    session: {
      ...gameState.session,
      stars: 0, // Reset to bank balance only
    },
  };
  saveState(updatedState);

  // Show defeat modal
  const battleView = $('view-battle');
  if (battleView) {
    showDefeatModal(
      battleState,
      () => {
        // Retry current stage
        clearBattleState();
        retryStage();
      },
      () => {
        // Back to map
        clearBattleState();
        onBattleEndCallback?.({ type: 'defeat', state: updatedState });
      }
    );
  }
}

/**
 * Go to next stage
 */
function goToNextStage() {
  const gameState = loadState();
  const nextStageIdx = gameState.session.stageIdx + 1;
  const currentWorldIdx = gameState.session.worldIdx;

  // Check if there are more stages in this world
  const stage = getStage(currentWorldIdx, nextStageIdx);
  if (stage && stage.monsters.length > 0) {
    // Start next stage
    const newState = {
      ...gameState,
      session: {
        ...gameState.session,
        stageIdx: nextStageIdx,
        currentMonsterIdx: 0,
      },
    };
    saveState(newState);
    showBattleView(newState, onBattleEndCallback);
  } else {
    // World complete - award bonus and show shop
    let updatedState = awardWorldClearBonus(gameState);

    // Mark world as cleared
    const cleared = [...(updatedState.progress?.worldsCleared || [])];
    if (!cleared.includes(currentWorldIdx)) {
      cleared.push(currentWorldIdx);
    }
    updatedState = {
      ...updatedState,
      progress: {
        ...updatedState.progress,
        worldsCleared: cleared,
      },
    };
    saveState(updatedState);

    // Show shop modal before returning to map
    showShopModal(updatedState, handleShopClose);
  }
}

/**
 * Handle shop close - return to world map
 * @param {object} state - potentially updated state from shop purchases
 */
function handleShopClose(state) {
  clearBattleState();
  // Return to world map with potentially updated state
  onBattleEndCallback?.({ type: 'world-clear', state });
}

/**
 * Retry current stage
 */
function retryStage() {
  const gameState = loadState();
  showBattleView(gameState, onBattleEndCallback);
}

/**
 * Clear battle state and timers
 */
function clearBattleState() {
  battleState = null;
  clearTimeout(_turnTimer);
  _turnTimer = null;
  clearBattleTimer();
}

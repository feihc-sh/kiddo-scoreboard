/**
 * Fighter V2 Entry Point
 * Main app initialization + view router (world-map ↔ stage-select)
 * Per spec §5 World Map Scene + §5.2 Stage Select Scene
 */

import { loadState, saveState, $, setText } from './utils.js';
import { renderMainMenu } from './world-map.js';
import { renderStageIntro } from './stage-intro.js';
import { showBattleView } from './battle-controller.js';

// View names
const VIEW_MAIN_MENU = 'main-menu';
const VIEW_STAGE_INTRO = 'stage-intro';
const VIEW_BATTLE = 'battle';

/** @type {object | null} */
let gameState = null;

/**
 * Initialize the Fighter V2 app
 */
export function initFighter() {
  // Load game state
  gameState = loadState();

  // Render HUD
  renderHUD();

  // Render main menu by default
  showView(VIEW_MAIN_MENU);
}

/**
 * Render the top HUD (stars count)
 */
function renderHUD() {
  const starsEl = $('hud-stars');
  if (starsEl && gameState) {
    setText(starsEl, gameState.bank.stars);
  }
}

/**
 * Show a specific view and render it
 * @param {string} viewName
 * @param {object} [viewData] - optional data to pass to view
 */
function showView(viewName, viewData = {}) {
  const mainMenuView = $('view-main-menu');
  const stageIntroView = $('view-stage-intro');
  const battleView = $('view-battle');

  // Hide all views
  mainMenuView?.classList.remove('active');
  stageIntroView?.classList.remove('active');
  battleView?.classList.remove('active');

  // Show requested view
  switch (viewName) {
    case VIEW_MAIN_MENU:
      if (mainMenuView) {
        mainMenuView.classList.add('active');
        renderMainMenu(mainMenuView, gameState, {
          onStartGame: handleStartGame,
          onLevels: handleLevels,
          onOptions: handleOptions,
          onQuit: handleQuit,
        });
      }
      break;

    case VIEW_STAGE_INTRO:
      if (stageIntroView) {
        stageIntroView.classList.add('active');
        const worldIdx = viewData.worldIdx ?? 0; // Default to world 0
        renderStageIntro(stageIntroView, worldIdx, gameState.progress.worldsCleared, {
          onStageClick: handleStageClick,
          onBack: handleBackToMainMenu,
        });
      }
      break;

    case VIEW_BATTLE:
      if (battleView) {
        battleView.classList.add('active');
      }
      break;

    default:
      console.error(`Unknown view: ${viewName}`);
  }
}

/**
 * Handle START GAME button click
 */
function handleStartGame() {
  // Start from the first unlocked world (world 0)
  showView(VIEW_STAGE_INTRO, { worldIdx: 0 });
}

/**
 * Handle LEVELS button click
 */
function handleLevels() {
  // Show level selection starting from world 0
  showView(VIEW_STAGE_INTRO, { worldIdx: 0 });
}

/**
 * Handle OPTIONS button click (placeholder)
 */
function handleOptions() {
  // Options not implemented yet - handled in world-map.js with toast
}

/**
 * Handle QUIT button click
 */
function handleQuit() {
  window.location.href = '/app';
}

/**
 * Handle click on a world node (legacy - for stage intro)
 * @param {number} worldIdx
 */
function handleWorldClick(worldIdx) {
  // Update session with current world
  gameState = {
    ...gameState,
    session: {
      ...gameState.session,
      worldIdx,
      stageIdx: 0,
      currentMonsterIdx: 0,
    },
  };
  saveState(gameState);

  // Navigate to stage intro
  showView(VIEW_STAGE_INTRO, { worldIdx });
}

/**
 * Handle click on a stage item
 * @param {number} stageIdx
 */
function handleStageClick(stageIdx) {
  const worldIdx = gameState.session.worldIdx;

  // Update session with current stage
  gameState = {
    ...gameState,
    session: {
      ...gameState.session,
      stageIdx,
      currentMonsterIdx: 0,
    },
  };
  saveState(gameState);

  // Start combat (P3: launch battle controller)
  showBattleView(gameState, handleBattleEnd);
}

/**
 * Handle battle end
 * @param {object} result - { type: 'victory'|'defeat', state: updatedGameState }
 */
function handleBattleEnd(result) {
  // Update game state from battle result
  gameState = result.state;
  saveState(gameState);
  renderHUD();

  // Return to main menu
  showView(VIEW_MAIN_MENU);
}

/**
 * Handle back button - return to main menu
 */
function handleBackToMainMenu() {
  showView(VIEW_MAIN_MENU);
}

/**
 * Get current game state (for external use)
 * @returns {object}
 */
export function getGameState() {
  return gameState;
}

/**
 * Update game state (for external use)
 * @param {object} newState
 */
export function setGameState(newState) {
  gameState = newState;
  saveState(gameState);
  renderHUD();
}

// Auto-init when DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFighter);
  } else {
    initFighter();
  }
}

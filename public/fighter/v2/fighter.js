/**
 * Fighter V2 Entry Point
 * Main app initialization + view router (world-map ↔ stage-select)
 * Per spec §5 World Map Scene + §5.2 Stage Select Scene
 */

import { loadState, saveState, $, setText } from './utils.js';
import { renderWorldMap } from './world-map.js';
import { renderStageIntro, startCombat } from './stage-intro.js';

// View names
const VIEW_WORLD_MAP = 'world-map';
const VIEW_STAGE_INTRO = 'stage-intro';

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

  // Render world map by default
  showView(VIEW_WORLD_MAP);
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
  const worldMapView = $('view-world-map');
  const stageIntroView = $('view-stage-intro');

  // Hide all views
  worldMapView?.classList.remove('active');
  stageIntroView?.classList.remove('active');

  // Show requested view
  switch (viewName) {
    case VIEW_WORLD_MAP:
      if (worldMapView) {
        worldMapView.classList.add('active');
        renderWorldMap(worldMapView, gameState, handleWorldClick);
      }
      break;

    case VIEW_STAGE_INTRO:
      if (stageIntroView) {
        stageIntroView.classList.add('active');
        const worldIdx = viewData.worldIdx ?? gameState.session.worldIdx;
        renderStageIntro(stageIntroView, worldIdx, gameState.progress.worldsCleared, {
          onStageClick: handleStageClick,
          onBack: handleBackToWorldMap,
        });
      }
      break;

    default:
      console.error(`Unknown view: ${viewName}`);
  }
}

/**
 * Handle click on a world node
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

  // Start combat (P2: shows alert, P3: will hook actual combat)
  startCombat(worldIdx, stageIdx);
}

/**
 * Handle back button - return to world map
 */
function handleBackToWorldMap() {
  showView(VIEW_WORLD_MAP);
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

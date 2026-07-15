/**
 * Fighter V2 World Map Renderer
 * Renders 5-node path map with locked/current/cleared states
 * Per spec §5.1 World Map Scene
 */

import { WORLDS } from './stages.js';
import { createElement, show, hide, clearChildren } from './utils.js';

/**
 * Render world map into container element
 * @param {HTMLElement} container
 * @param {object} state - game state from localStorage
 * @param {Function} onWorldClick - callback(worldIdx) when current world clicked
 */
export function renderWorldMap(container, state, onWorldClick) {
  clearChildren(container);

  // Title
  const title = createElement('h1', { className: 'world-map__title' }, '🗺️ 世界地图');
  container.appendChild(title);

  // Nodes container
  const nodesContainer = createElement('div', { className: 'world-map__nodes' });
  container.appendChild(nodesContainer);

  const { worldIdx: sessionWorldIdx } = state.session;
  const { worldsCleared } = state.progress;

  WORLDS.forEach((world, idx) => {
    // Add path connector (except before first world)
    if (idx > 0) {
      const pathUnlocked = isWorldUnlocked(idx, worldsCleared);
      const path = createElement('div', {
        className: `world-path ${pathUnlocked ? 'unlocked' : ''}`,
      });
      nodesContainer.appendChild(path);
    }

    // Determine world state - use session.worldIdx for current world
    const isCleared = worldsCleared.includes(idx);
    const isUnlocked = isWorldUnlocked(idx, worldsCleared);
    const isCurrent = idx === sessionWorldIdx;

    // Determine state class
    let stateClass = '';
    if (isCleared) stateClass = 'cleared';
    else if (!isUnlocked) stateClass = 'locked';
    else if (isCurrent) stateClass = 'current';

    // Build status indicator
    let statusText = '';
    let statusClass = '';
    if (isCleared) {
      statusText = '✓ 已通关';
      statusClass = 'world-node__status--cleared';
    } else if (!isUnlocked) {
      statusText = '🔒 未解锁';
    } else {
      statusText = '⭐ 当前';
      statusClass = 'world-node__status--current';
    }

    // Create node element
    const node = createElement(
      'div',
      {
        className: `world-node ${stateClass}`,
        'data-world': idx,
      },
      // Icon
      createElement(
        'div',
        { className: 'world-node__icon' },
        !isUnlocked ? '🔒' : world.emoji
      ),
      // Name
      createElement('div', { className: 'world-node__name' }, world.name),
      // Status
      createElement(
        'div',
        { className: `world-node__status ${statusClass}` },
        statusText
      )
    );

    // Click handler - only current world is clickable
    if (isCurrent) {
      node.addEventListener('click', () => {
        onWorldClick(idx);
      });
    }

    nodesContainer.appendChild(node);
  });
}

/**
 * Check if a world is unlocked
 * @param {number} worldIdx
 * @param {Array<number>} worldsCleared
 * @returns {boolean}
 */
export function isWorldUnlocked(worldIdx, worldsCleared) {
  if (worldIdx === 0) return true; // World 1 always unlocked
  const world = WORLDS[worldIdx];
  if (world.unlockedBy === null) return false;
  return worldsCleared.includes(world.unlockedBy);
}

/**
 * Get the first unlocked but not cleared world
 * @param {Array<number>} worldsCleared
 * @returns {number} worldIdx or -1 if all cleared
 */
export function getCurrentWorldIdx(worldsCleared) {
  for (let i = 0; i < WORLDS.length; i++) {
    if (!worldsCleared.includes(i) && isWorldUnlocked(i, worldsCleared)) {
      return i;
    }
  }
  return -1; // All worlds cleared
}

/**
 * Check if all worlds are cleared
 * @param {Array<number>} worldsCleared
 * @returns {boolean}
 */
export function allWorldsCleared(worldsCleared) {
  return worldsCleared.length >= WORLDS.length;
}

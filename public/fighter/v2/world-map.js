/**
 * Fighter V2 Main Menu Renderer
 * Dragon's Keep Quest style: castle background, knight vs dragon, 4 wood plank buttons
 * Replaces the world map with a main menu entry point
 */

import { clearChildren } from './utils.js';

// Asset image tags — per ASSET-CATALOG.md asset-swap wiring pattern
// knight.png = a tight, transparent-background crop of the hero idle sprite
// dragon.png = a crop of monster-worm.png (the "dragon" asset is actually a
//              hero, so the worm sprite stands in for it — see catalog notes)
// NOTE: the source assets under public/assets/fighter/v2/ are SINGLE sprites on
// a large white canvas, not animation sheets — crop by content bbox, never by
// a fixed frame coordinate. See tests/unit/fighter-v2/asset-sheet-guard.test.ts.
const KNIGHT_IMG = `<img class="dk-knight" src="/fighter/v2/knight.png" alt="骑士" onerror="this.outerHTML='<div class=&quot;dk-knight-fallback&quot;>🦸</div>'" />`;
const DRAGON_IMG = `<img class="dk-dragon" src="/fighter/v2/dragon.png" alt="红龙" onerror="this.outerHTML='<div class=&quot;dk-dragon-fallback&quot;>🐉</div>'" />`;

// Castle PNG (PM-direct pollinations-flux, 400x200, 16-bit RPG castle with 2 towers + flag + sky + grass)
const CASTLE_IMG = `<img class="dk-castle-bg" src="/fighter/v2/castle.png" alt="城堡" style="image-rendering: pixelated; width: 100%; height: auto; image-rendering: crisp-edges;" onerror="this.outerHTML='<div class=&quot;dk-castle-bg-fallback&quot;>🏰</div>'" />`;

// Grass foreground PNG (PM-direct pollinations-flux, 400x60, 16-bit RPG grass with flowers)
const GRASS_IMG = `<img class="dk-grass-bg" src="/fighter/v2/grass.png" alt="草地" style="image-rendering: pixelated; width: 100%; height: auto; image-rendering: crisp-edges;" onerror="this.outerHTML='<div class=&quot;dk-grass-bg-fallback&quot;>🌿</div>'" />`;

/**
 * Render main menu into container element
 * @param {HTMLElement} container
 * @param {object} gameState - game state from localStorage
 * @param {object} callbacks - { onStartGame, onLevels, onOptions, onQuit }
 */
export function renderMainMenu(container, gameState, callbacks) {
  clearChildren(container);

  // Create main menu structure
  const menuWrapper = document.createElement('div');
  menuWrapper.className = 'dk-menu-wrapper';

  // Title
  const title = document.createElement('h1');
  title.className = 'dk-menu-title';
  title.textContent = "DRAGON'S KEEP QUEST";
  menuWrapper.appendChild(title);

  // Background scene container
  const sceneContainer = document.createElement('div');
  sceneContainer.className = 'dk-menu-scene';

  // Castle background (real PNG sprite, per ASSET-CATALOG.md asset-swap pattern)
  sceneContainer.innerHTML += CASTLE_IMG;

  // Characters container
  const charactersContainer = document.createElement('div');
  charactersContainer.className = 'dk-menu-characters';

  // Knight character (real sprite, per ASSET-CATALOG.md)
  const knightWrapper = document.createElement('div');
  knightWrapper.className = 'dk-character dk-character--knight';
  knightWrapper.innerHTML = KNIGHT_IMG;
  charactersContainer.appendChild(knightWrapper);

  // Dragon character (real sprite, per ASSET-CATALOG.md)
  const dragonWrapper = document.createElement('div');
  dragonWrapper.className = 'dk-character dk-character--dragon';
  dragonWrapper.innerHTML = DRAGON_IMG;
  charactersContainer.appendChild(dragonWrapper);

  sceneContainer.appendChild(charactersContainer);

  // Grass foreground (real PNG sprite, per ASSET-CATALOG.md asset-swap pattern)
  sceneContainer.innerHTML += GRASS_IMG;

  menuWrapper.appendChild(sceneContainer);

  // Buttons container
  const buttonsContainer = document.createElement('div');
  buttonsContainer.className = 'dk-menu-buttons';

  // START GAME button
  const startBtn = document.createElement('button');
  startBtn.className = 'dk-menu-button dk-menu-button--start';
  startBtn.textContent = 'START GAME';
  startBtn.addEventListener('click', () => {
    callbacks.onStartGame?.();
  });
  buttonsContainer.appendChild(startBtn);

  // LEVELS button
  const levelsBtn = document.createElement('button');
  levelsBtn.className = 'dk-menu-button dk-menu-button--levels';
  levelsBtn.textContent = 'LEVELS';
  levelsBtn.addEventListener('click', () => {
    callbacks.onLevels?.();
  });
  buttonsContainer.appendChild(levelsBtn);

  // OPTIONS button
  const optionsBtn = document.createElement('button');
  optionsBtn.className = 'dk-menu-button dk-menu-button--options';
  optionsBtn.textContent = 'OPTIONS';
  optionsBtn.addEventListener('click', () => {
    showToast('即将开放');
    callbacks.onOptions?.();
  });
  buttonsContainer.appendChild(optionsBtn);

  // QUIT button
  const quitBtn = document.createElement('button');
  quitBtn.className = 'dk-menu-button dk-menu-button--quit';
  quitBtn.textContent = 'QUIT';
  quitBtn.addEventListener('click', () => {
    callbacks.onQuit?.();
  });
  buttonsContainer.appendChild(quitBtn);

  menuWrapper.appendChild(buttonsContainer);

  container.appendChild(menuWrapper);
}

/**
 * Show a toast notification
 * @param {string} message
 */
function showToast(message) {
  // Remove existing toast
  const existingToast = document.querySelector('.dk-toast');
  if (existingToast) {
    existingToast.remove();
  }

  const toast = document.createElement('div');
  toast.className = 'dk-toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.add('dk-toast--visible');
  });

  // Remove after 2 seconds
  setTimeout(() => {
    toast.classList.remove('dk-toast--visible');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}


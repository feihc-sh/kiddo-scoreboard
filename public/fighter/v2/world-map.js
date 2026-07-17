/**
 * Fighter V2 Main Menu Renderer
 * Dragon's Keep Quest style: castle background, knight vs dragon, 4 wood plank buttons
 * Replaces the world map with a main menu entry point
 */

import { clearChildren } from './utils.js';

// Asset image tags — per ASSET-CATALOG.md asset-swap wiring pattern
// knight.png = hero-idle.png first frame (256x328, cropped by PM)
// dragon.png = monster-dragon.png first frame (naming mismatch per catalog, but file exists)
const KNIGHT_IMG = `<img class="dk-knight" src="/fighter/v2/knight.png" alt="骑士" onerror="this.outerHTML='<div class=&quot;dk-knight-fallback&quot;>🦸</div>'" />`;
const DRAGON_IMG = `<img class="dk-dragon" src="/fighter/v2/dragon.png" alt="红龙" onerror="this.outerHTML='<div class=&quot;dk-dragon-fallback&quot;>🐉</div>'" />`;

// Castle SVG
const CASTLE_SVG = `
<svg class="dk-castle-bg" viewBox="0 0 400 200" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">
  <!-- Sky gradient -->
  <defs>
    <linearGradient id="skyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#1e3a5f"/>
      <stop offset="100%" style="stop-color:#3b82f6"/>
    </linearGradient>
    <linearGradient id="grassGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#4ade80"/>
      <stop offset="100%" style="stop-color:#22c55e"/>
    </linearGradient>
  </defs>
  <!-- Background -->
  <rect x="0" y="0" width="400" height="200" fill="url(#skyGrad)"/>
  <!-- Clouds -->
  <ellipse cx="80" cy="40" rx="30" ry="15" fill="rgba(255,255,255,0.3)"/>
  <ellipse cx="100" cy="35" rx="25" ry="12" fill="rgba(255,255,255,0.3)"/>
  <ellipse cx="300" cy="50" rx="35" ry="15" fill="rgba(255,255,255,0.2)"/>
  <ellipse cx="330" cy="45" rx="25" ry="10" fill="rgba(255,255,255,0.2)"/>
  <!-- Castle Main -->
  <rect x="120" y="60" width="160" height="100" fill="#6b7280"/>
  <rect x="125" y="65" width="150" height="90" fill="#9ca3af"/>
  <!-- Castle Towers -->
  <rect x="100" y="40" width="40" height="120" fill="#6b7280"/>
  <rect x="260" y="40" width="40" height="120" fill="#6b7280"/>
  <!-- Tower Tops -->
  <polygon points="100,40 120,10 140,40" fill="#4b5563"/>
  <polygon points="260,40 280,10 300,40" fill="#4b5563"/>
  <!-- Center Tower -->
  <rect x="170" y="30" width="60" height="130" fill="#6b7280"/>
  <polygon points="170,30 200,0 230,30" fill="#4b5563"/>
  <!-- Windows -->
  <rect x="140" y="90" width="20" height="30" rx="10" fill="#1f2937"/>
  <rect x="240" y="90" width="20" height="30" rx="10" fill="#1f2937"/>
  <rect x="185" y="80" width="30" height="40" rx="15" fill="#1f2937"/>
  <!-- Gate -->
  <rect x="175" y="120" width="50" height="40" fill="#1f2937"/>
  <rect x="175" y="120" width="25" height="40" fill="#374151"/>
  <!-- Flag -->
  <line x1="200" y1="0" x2="200" y2="-25" stroke="#92400e" stroke-width="2"/>
  <polygon points="200,-25 200,-10 220,-17.5" fill="#dc2626"/>
  <!-- Ground/Grass -->
  <rect x="0" y="160" width="400" height="40" fill="url(#grassGrad)"/>
  <!-- Grass texture -->
  <ellipse cx="30" cy="165" rx="8" ry="4" fill="#22c55e"/>
  <ellipse cx="80" cy="162" rx="6" ry="3" fill="#22c55e"/>
  <ellipse cx="150" cy="166" rx="7" ry="3" fill="#22c55e"/>
  <ellipse cx="250" cy="163" rx="8" ry="4" fill="#22c55e"/>
  <ellipse cx="320" cy="165" rx="6" ry="3" fill="#22c55e"/>
  <ellipse cx="370" cy="162" rx="7" ry="3" fill="#22c55e"/>
</svg>
`;

// Grass foreground SVG
const GRASS_SVG = `
<svg class="dk-grass-bg" viewBox="0 0 400 60" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grassFade" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#4ade80;stop-opacity:0.8"/>
      <stop offset="100%" style="stop-color:#22c55e;stop-opacity:1"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="400" height="60" fill="url(#grassFade)"/>
  <!-- Grass blades -->
  <path d="M10 60 Q12 40 10 30 Q14 40 16 60" fill="#16a34a"/>
  <path d="M30 60 Q33 35 28 25 Q36 35 38 60" fill="#22c55e"/>
  <path d="M60 60 Q63 42 58 32 Q66 42 68 60" fill="#16a34a"/>
  <path d="M100 60 Q103 38 98 28 Q106 38 108 60" fill="#22c55e"/>
  <path d="M150 60 Q153 40 148 30 Q156 40 158 60" fill="#16a34a"/>
  <path d="M200 60 Q203 35 198 25 Q206 35 208 60" fill="#22c55e"/>
  <path d="M250 60 Q253 42 248 32 Q256 42 258 60" fill="#16a34a"/>
  <path d="M300 60 Q303 38 298 28 Q306 38 308 60" fill="#22c55e"/>
  <path d="M350 60 Q353 40 348 30 Q356 40 358 60" fill="#16a34a"/>
  <path d="M380 60 Q383 35 378 25 Q386 35 388 60" fill="#22c55e"/>
</svg>
`;

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

  // Castle background
  sceneContainer.innerHTML += CASTLE_SVG;

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

  // Grass foreground
  sceneContainer.innerHTML += GRASS_SVG;

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


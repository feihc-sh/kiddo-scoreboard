/**
 * Fighter V2 Main Menu Renderer
 * Dragon's Keep Quest style: castle background, knight vs dragon, 4 wood plank buttons
 * Replaces the world map with a main menu entry point
 */

import { clearChildren } from './utils.js';
const KNIGHT_SVG = `
<svg class="dk-knight" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
  <!-- Body/Armor -->
  <rect x="25" y="30" width="30" height="35" rx="4" fill="#cbd5e1"/>
  <rect x="28" y="33" width="24" height="29" rx="2" fill="#94a3b8"/>
  <!-- Helmet -->
  <ellipse cx="40" cy="22" rx="14" ry="16" fill="#cbd5e1"/>
  <rect x="28" y="18" width="24" height="8" fill="#94a3b8"/>
  <rect x="36" y="22" width="8" height="12" fill="#475569"/>
  <!-- Shield -->
  <path d="M12 35 L12 60 Q12 68 20 68 L24 68 Q28 68 28 60 L28 35 Z" fill="#64748b"/>
  <path d="M14 38 L14 58 Q14 64 20 64 L23 64 Q26 64 26 58 L26 38 Z" fill="#94a3b8"/>
  <path d="M18 42 L18 56 L20 56 L20 42 Z" fill="#fbbf24"/>
  <!-- Sword -->
  <rect x="55" y="15" width="4" height="40" fill="#9ca3af"/>
  <rect x="50" y="50" width="14" height="4" rx="1" fill="#92400e"/>
  <rect x="55" y="8" width="4" height="10" fill="#d1d5db"/>
  <!-- Legs -->
  <rect x="28" y="65" width="10" height="12" rx="2" fill="#64748b"/>
  <rect x="42" y="65" width="10" height="12" rx="2" fill="#64748b"/>
  <!-- Feet -->
  <rect x="26" y="75" width="14" height="5" rx="2" fill="#475569"/>
  <rect x="40" y="75" width="14" height="5" rx="2" fill="#475569"/>
</svg>
`;

// SVG Assets - Red Dragon
const DRAGON_SVG = `
<svg class="dk-dragon" viewBox="0 0 100 80" xmlns="http://www.w3.org/2000/svg">
  <!-- Body -->
  <ellipse cx="50" cy="50" rx="28" ry="22" fill="#dc2626"/>
  <ellipse cx="50" cy="50" rx="22" ry="17" fill="#b91c1c"/>
  <!-- Head -->
  <ellipse cx="75" cy="35" rx="18" ry="14" fill="#dc2626"/>
  <ellipse cx="85" cy="32" rx="8" ry="6" fill="#b91c1c"/>
  <!-- Eye -->
  <ellipse cx="80" cy="32" rx="4" ry="4" fill="#fbbf24"/>
  <ellipse cx="81" cy="32" rx="2" ry="2" fill="#1f2937"/>
  <!-- Horns -->
  <path d="M70 25 L65 15 L72 22 Z" fill="#7f1d1d"/>
  <path d="M78 22 L76 12 L80 20 Z" fill="#7f1d1d"/>
  <!-- Wings -->
  <path d="M30 40 Q10 25 5 35 Q15 35 25 45 Z" fill="#991b1b"/>
  <path d="M28 45 Q8 30 3 40 Q13 40 23 50 Z" fill="#7f1d1d"/>
  <path d="M70 40 Q90 25 95 35 Q85 35 75 45 Z" fill="#991b1b"/>
  <!-- Tail -->
  <path d="M22 55 Q5 60 10 70 Q15 65 22 60 Z" fill="#dc2626"/>
  <!-- Legs -->
  <rect x="35" y="65" width="8" height="12" rx="2" fill="#b91c1c"/>
  <rect x="55" y="65" width="8" height="12" rx="2" fill="#b91c1c"/>
  <!-- Claws -->
  <path d="M33 75 L30 80 L36 80 Z" fill="#fbbf24"/>
  <path d="M39 75 L36 80 L42 80 Z" fill="#fbbf24"/>
  <path d="M53 75 L50 80 L56 80 Z" fill="#fbbf24"/>
  <path d="M59 75 L56 80 L62 80 Z" fill="#fbbf24"/>
  <!-- Fire breath hint -->
  <ellipse cx="92" cy="38" rx="4" ry="3" fill="#f97316" opacity="0.7"/>
</svg>
`;

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

  // Knight character
  const knightWrapper = document.createElement('div');
  knightWrapper.className = 'dk-character dk-character--knight';
  knightWrapper.innerHTML = KNIGHT_SVG;
  charactersContainer.appendChild(knightWrapper);

  // Dragon character
  const dragonWrapper = document.createElement('div');
  dragonWrapper.className = 'dk-character dk-character--dragon';
  dragonWrapper.innerHTML = DRAGON_SVG;
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


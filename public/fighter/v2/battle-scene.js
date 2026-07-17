/**
 * Fighter V2 Battle Scene UI
 * Dragon's Keep Quest style: HP/MP bars at top, knight vs dragon, 3 action buttons
 * Preserves public API for battle-controller.js integration
 */

import { BATTLE_STATE, SKILLS, getHeroDef, getHeroAtk } from './combat.js';
import { showFloatingText, showSkillEffect } from './skill-effects.js';

/** @type {HTMLElement | null} */
let battleContainer = null;

/** @type {object | null} */
let currentBattleState = null;

/** @type {object | null} */
let currentEquipment = null;

/** @type {Function | null} */
let onActionCallback = null;

/** @type {number | null} */
let _turnTimer = null;

// ==================== SVG Assets ====================

// Knight SVG (inline)
const KNIGHT_SVG = `
<svg class="dk-battle-knight" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
  <rect x="25" y="30" width="30" height="35" rx="4" fill="#cbd5e1"/>
  <rect x="28" y="33" width="24" height="29" rx="2" fill="#94a3b8"/>
  <ellipse cx="40" cy="22" rx="14" ry="16" fill="#cbd5e1"/>
  <rect x="28" y="18" width="24" height="8" fill="#94a3b8"/>
  <rect x="36" y="22" width="8" height="12" fill="#475569"/>
  <path d="M12 35 L12 60 Q12 68 20 68 L24 68 Q28 68 28 60 L28 35 Z" fill="#64748b"/>
  <path d="M14 38 L14 58 Q14 64 20 64 L23 64 Q26 64 26 58 L26 38 Z" fill="#94a3b8"/>
  <path d="M18 42 L18 56 L20 56 L20 42 Z" fill="#fbbf24"/>
  <rect x="55" y="15" width="4" height="40" fill="#9ca3af"/>
  <rect x="50" y="50" width="14" height="4" rx="1" fill="#92400e"/>
  <rect x="55" y="8" width="4" height="10" fill="#d1d5db"/>
  <rect x="28" y="65" width="10" height="12" rx="2" fill="#64748b"/>
  <rect x="42" y="65" width="10" height="12" rx="2" fill="#64748b"/>
  <rect x="26" y="75" width="14" height="5" rx="2" fill="#475569"/>
  <rect x="40" y="75" width="14" height="5" rx="2" fill="#475569"/>
</svg>
`;

// Dragon SVG (inline)
const DRAGON_SVG = `
<svg class="dk-battle-dragon" viewBox="0 0 100 80" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="50" cy="50" rx="28" ry="22" fill="#dc2626"/>
  <ellipse cx="50" cy="50" rx="22" ry="17" fill="#b91c1c"/>
  <ellipse cx="75" cy="35" rx="18" ry="14" fill="#dc2626"/>
  <ellipse cx="85" cy="32" rx="8" ry="6" fill="#b91c1c"/>
  <ellipse cx="80" cy="32" rx="4" ry="4" fill="#fbbf24"/>
  <ellipse cx="81" cy="32" rx="2" ry="2" fill="#1f2937"/>
  <path d="M70 25 L65 15 L72 22 Z" fill="#7f1d1d"/>
  <path d="M78 22 L76 12 L80 20 Z" fill="#7f1d1d"/>
  <path d="M30 40 Q10 25 5 35 Q15 35 25 45 Z" fill="#991b1b"/>
  <path d="M28 45 Q8 30 3 40 Q13 40 23 50 Z" fill="#7f1d1d"/>
  <path d="M70 40 Q90 25 95 35 Q85 35 75 45 Z" fill="#991b1b"/>
  <path d="M22 55 Q5 60 10 70 Q15 65 22 60 Z" fill="#dc2626"/>
  <rect x="35" y="65" width="8" height="12" rx="2" fill="#b91c1c"/>
  <rect x="55" y="65" width="8" height="12" rx="2" fill="#b91c1c"/>
  <path d="M33 75 L30 80 L36 80 Z" fill="#fbbf24"/>
  <path d="M39 75 L36 80 L42 80 Z" fill="#fbbf24"/>
  <path d="M53 75 L50 80 L56 80 Z" fill="#fbbf24"/>
  <path d="M59 75 L56 80 L62 80 Z" fill="#fbbf24"/>
</svg>
`;

// Castle Background SVG
const CASTLE_BG_SVG = `
<svg class="dk-castle-battle-bg" viewBox="0 0 400 150" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="battleSkyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:#1e3a5f"/>
      <stop offset="100%" style="stop-color:#7c3aed"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="400" height="150" fill="url(#battleSkyGrad)"/>
  <ellipse cx="80" cy="30" rx="30" ry="12" fill="rgba(255,255,255,0.15)"/>
  <ellipse cx="320" cy="40" rx="25" ry="10" fill="rgba(255,255,255,0.1)"/>
  <rect x="120" y="60" width="160" height="90" fill="#4b5563"/>
  <rect x="125" y="65" width="150" height="85" fill="#6b7280"/>
  <rect x="100" y="50" width="40" height="100" fill="#4b5563"/>
  <rect x="260" y="50" width="40" height="100" fill="#4b5563"/>
  <polygon points="100,50 120,25 140,50" fill="#374151"/>
  <polygon points="260,50 280,25 300,50" fill="#374151"/>
  <rect x="170" y="40" width="60" height="110" fill="#4b5563"/>
  <polygon points="170,40 200,15 230,40" fill="#374151"/>
  <rect x="140" y="80" width="15" height="25" rx="7" fill="#1f2937"/>
  <rect x="245" y="80" width="15" height="25" rx="7" fill="#1f2937"/>
  <rect x="185" y="70" width="30" height="35" rx="15" fill="#1f2937"/>
  <rect x="175" y="110" width="50" height="40" fill="#1f2937"/>
</svg>
`;

// Sword Icon SVG
const SWORD_ICON_SVG = `
<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M6.92 5L5 7.94L8.35 10.8L3.27 15.88L4.73 17.34L9.81 12.26L12.66 15.6L15.6 12.66L10.52 7.58L15.6 2.5L17.06 4L12 9.06L15.94 13L19.88 9.06L21 10.18L6.92 5Z"/>
</svg>
`;

// Fire Icon SVG
const FIRE_ICON_SVG = `
<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 23C7.58 23 4 19.42 4 15C4 11.83 5.67 9.17 8 7.46C8.44 7.73 8.67 8.25 8.5 8.75C8.17 9.75 8 10.83 8 12C8 15.33 10.67 18 14 18C16.07 18 17.94 16.92 19 15.21C19.05 15.33 19.06 15.46 19.1 15.58C19.28 16.12 18.89 16.67 18.35 16.67H14C13.45 16.67 13 17.12 13 17.67C13 18.22 13.45 18.67 14 18.67H17C17.55 18.67 18 19.12 18 19.67C18 20.22 17.55 20.67 17 20.67H12.67C12.29 21.04 11.69 21.04 11.33 20.67C10.56 19.89 10 18.74 10 17.5C10 14.46 12.46 12 15.5 12C18.54 12 21 14.46 21 17.5C21 19.99 19.22 22 17 22C15.89 22 14.87 21.5 14.12 20.74C13.55 20.17 12.87 19.49 12.37 18.82C12.14 18.49 11.98 18.14 11.86 17.77C11.67 17.22 12.06 16.67 12.61 16.67H15C15.55 16.67 16 16.22 16 15.67C16 15.12 15.55 14.67 15 14.67H12.08C11.67 13.89 11.33 13.08 11.1 12.25C10.81 11.19 10.69 10.08 10.75 9C10.82 7.75 11.29 6.67 12.17 5.79C12.56 5.4 12.94 5.04 13.31 4.71C13.59 4.46 13.85 4.23 14.08 4.02C14.38 3.75 14.69 3.5 15 3.25C15.25 3.04 15.5 2.84 15.75 2.65C16.06 2.41 16.38 2.17 16.69 1.94C17.06 1.67 17.44 1.4 17.81 1.13C18.25 0.81 18.69 0.5 19.12 0.17C19.37 0 19.63 0 19.88 0.17C20.13 0.33 20.25 0.58 20.25 0.83C20.25 1.08 20.13 1.33 19.88 1.5C18.63 2.33 17.44 3.25 16.38 4.29C15.75 4.92 15.19 5.58 14.69 6.27C13.92 7.35 13.33 8.58 13 9.92C12.78 10.83 12.69 11.75 12.72 12.67C12.86 15.83 14.79 18.58 17.5 20.25C19.03 21.17 20.83 21.67 22.67 21.67C22.92 21.67 23.08 21.83 23.08 22.08C23.08 22.33 22.92 22.5 22.67 22.5C20.69 22.5 18.83 22 17.17 21C15.75 20.17 14.5 19.08 13.5 17.79C13.17 17.42 12.86 17 12.57 16.57C12.29 16.15 12.07 15.67 12.17 15.17C12.27 14.67 12.83 14.25 13.33 14.25H15C15.28 14.25 15.5 14.03 15.5 13.75C15.5 13.47 15.28 13.25 15 13.25H12.67C12.39 13.25 12.17 13.03 12.17 12.75C12.17 12.47 12.39 12.25 12.67 12.25H15C15.28 12.25 15.5 12.03 15.5 11.75C15.5 11.47 15.28 11.25 15 11.25H12.83C12.61 10.25 12.72 9.25 13.08 8.33C13.39 7.56 13.83 6.83 14.39 6.17C15.17 5.25 16.08 4.42 17.08 3.67C17.58 3.29 18.08 2.92 18.58 2.54C19.13 2.13 19.69 1.71 20.25 1.29C20.44 1.15 20.63 1 20.81 0.85C21.06 0.65 21.31 0.44 21.56 0.25C21.75 0.11 21.94 0 22.12 0C22.31 0 22.5 0.11 22.69 0.25C23.19 0.69 23.69 1.15 24 1.75C24 1.94 23.94 2.13 23.81 2.25C23.69 2.38 23.5 2.44 23.31 2.44C22.94 2.44 22.56 2.38 22.19 2.31C21.81 2.25 21.44 2.19 21.06 2.13C20.69 2.06 20.31 2 19.94 1.94C19.56 1.88 19.19 1.81 18.81 1.75C18.44 1.69 18.06 1.63 17.69 1.56C17.31 1.5 16.94 1.44 16.56 1.38C16.19 1.31 15.81 1.25 15.44 1.19C15.06 1.13 14.69 1.06 14.31 1C13.94 0.94 13.56 0.88 13.19 0.81C12.81 0.75 12.44 0.69 12.06 0.63C11.69 0.56 11.31 0.5 10.94 0.44C10.56 0.38 10.19 0.31 9.81 0.25C9.44 0.19 9.06 0.13 8.69 0.06C8.31 0 7.94 0 7.56 0C6.81 0 6.06 0.06 5.31 0.19C4.56 0.31 3.81 0.5 3.06 0.75C2.31 1 1.56 1.31 0.81 1.69C0.44 1.88 0.19 2.19 0.19 2.5C0.19 2.81 0.44 3.13 0.81 3.31C1.56 3.69 2.31 4 3.06 4.25C3.81 4.5 4.56 4.69 5.31 4.81C6.06 4.94 6.81 5 7.56 5C7.81 5 8.06 5 8.31 5C8.56 5 8.81 5 9.06 5C9.31 5 9.56 5 9.81 5C10.06 5 10.31 5 10.56 5C10.81 5 11.06 5 11.31 5C11.56 5 11.81 5 12.06 5C12.31 5 12.56 5 12.81 5C13.06 5 13.31 5 13.56 5C13.81 5 14.06 5 14.31 5C14.56 5 14.81 5 15.06 5C15.31 5 15.56 5 15.81 5C16.06 5 16.31 5 16.56 5C16.81 5 17.06 5 17.31 5C17.56 5 17.81 5 18.06 5C18.31 5 18.56 5 18.81 5C19.06 5 19.31 5 19.56 5C19.81 5 20.06 5 20.31 5C20.56 5 20.81 5 21.06 5C21.31 5 21.56 5 21.81 5C22.06 5 22.31 5 22.56 5C22.81 5 23.06 5 23.31 5C23.56 5 23.81 5 24 5.17C24 5.31 23.94 5.44 23.81 5.5C22.94 5.94 22 6.5 21 7.17C20 7.83 19 8.58 18 9.42C17 10.25 16 11.17 15 12.17C14 13.17 13 14.25 12 15.42C11 16.58 10 17.83 9 19.17C8.56 19.69 8.19 20.17 7.88 20.67C7.56 21.17 7.25 21.69 6.94 22.21C6.69 22.63 6.5 23 6.25 23.5C6.13 23.75 6 24 6 24.25C6 24.5 6.13 24.69 6.25 24.81C6.38 24.94 6.56 25 6.75 25C7 25 7.25 24.94 7.5 24.81C7.75 24.69 8 24.56 8.25 24.44C8.5 24.31 8.75 24.19 9 24.06C9.25 23.94 9.5 23.81 9.75 23.69C10 23.56 10.25 23.44 10.5 23.31C10.75 23.19 11 23.06 11.25 22.94C11.5 22.81 11.75 22.69 12 22.56C12.25 22.44 12.5 22.31 12.75 22.19C13 22.06 13.25 21.94 13.5 21.81C13.75 21.69 14 21.56 14.25 21.44C14.5 21.31 14.75 21.19 15 21.06C15.25 20.94 15.5 20.81 15.75 20.69C16 20.56 16.25 20.44 16.5 20.31C16.75 20.19 17 20.06 17.25 19.94C17.5 19.81 17.75 19.69 18 19.56C18.25 19.44 18.5 19.31 18.75 19.19C19 19.06 19.25 18.94 19.5 18.81C19.75 18.69 20 18.56 20.25 18.44C20.5 18.31 20.75 18.19 21 18.06C21.25 17.94 21.5 17.81 21.75 17.69C22 17.56 22.25 17.44 22.5 17.31C22.75 17.19 23 17.06 23.25 16.94C23.5 16.81 23.75 16.69 24 16.56C24 16.75 23.94 16.94 23.81 17.06C23.69 17.19 23.5 17.25 23.31 17.25C22.94 17.25 22.56 17.19 22.19 17.13C21.81 17.06 21.44 17 21.06 16.94C20.69 16.88 20.31 16.81 19.94 16.75C19.56 16.69 19.19 16.63 18.81 16.56C18.44 16.5 18.06 16.44 17.69 16.38C17.31 16.31 16.94 16.25 16.56 16.19C16.19 16.13 15.81 16.06 15.44 16C15.06 15.94 14.69 15.88 14.31 15.81C13.94 15.75 13.56 15.69 13.19 15.63C12.81 15.56 12.44 15.5 12.06 15.44C11.69 15.38 11.31 15.31 10.94 15.25C10.56 15.19 10.19 15.13 9.81 15.06C9.44 15 9.06 14.94 8.69 14.88C8.31 14.81 7.94 14.75 7.56 14.69C7.19 14.63 6.81 14.56 6.44 14.5C6.06 14.44 5.69 14.38 5.31 14.31C4.94 14.25 4.56 14.19 4.19 14.13C3.81 14.06 3.44 14 3.06 13.94C2.69 13.88 2.31 13.81 1.94 13.75C1.56 13.69 1.19 13.63 0.81 13.56C0.44 13.5 0.06 13.44 0 13.38C0 13.19 0.06 13 0.19 12.88C0.31 12.75 0.5 12.69 0.69 12.69C1.06 12.69 1.44 12.75 1.81 12.81C2.19 12.88 2.56 12.94 2.94 13C3.31 13.06 3.69 13.13 4.06 13.19C4.44 13.25 4.81 13.31 5.19 13.38C5.56 13.44 5.94 13.5 6.31 13.56C6.69 13.63 7.06 13.69 7.44 13.75C7.81 13.81 8.19 13.88 8.56 13.94C8.94 14 9.31 14.06 9.69 14.13C10.06 14.19 10.44 14.25 10.81 14.31C11.19 14.38 11.56 14.44 11.94 14.5C12.31 14.56 12.69 14.63 13.06 14.69C13.44 14.75 13.81 14.81 14.19 14.88C14.56 14.94 14.94 15 15.31 15.06C15.69 15.13 16.06 15.19 16.44 15.25C16.81 15.31 17.19 15.38 17.56 15.44C17.94 15.5 18.31 15.56 18.69 15.63C19.06 15.69 19.44 15.75 19.81 15.81C20.19 15.88 20.56 15.94 20.94 16C21.31 16.06 21.69 16.13 22.06 16.19C22.44 16.25 22.81 16.31 23.19 16.38C23.56 16.44 23.94 16.5 24 16.56Z" transform="scale(0.15) translate(0,0)"/>
</svg>
`;

// Potion Icon SVG
const POTION_ICON_SVG = `
<svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
  <path d="M6 22C5.45 22 5 21.55 5 21V13H4C3.45 13 3 12.55 3 12V10C3 9.45 3.45 9 4 9H5V6C5 5.45 5.45 5 6 5H7V3C7 2.45 7.45 2 8 2H16C16.55 2 17 2.45 17 3V5H18C18.55 5 19 5.45 19 6V9H20C20.55 9 21 9.45 21 10V12C21 12.55 20.55 13 20 13H19V21C19 21.55 18.55 22 18 22H6ZM9 9H15V21H9V9Z"/>
</svg>
`;

// ==================== Public API ====================

/**
 * Render the battle scene into a container element
 * @param {HTMLElement} container
 * @param {object} battleState - from combat.js initBattle()
 * @param {object} equipment - { sword, shield, potion }
 * @param {Function} onAction - callback(actionType, skillId?)
 */
export function renderBattleScene(container, battleState, equipment, onAction) {
  battleContainer = container;
  currentBattleState = battleState;
  currentEquipment = equipment;
  onActionCallback = onAction;

  battleContainer.innerHTML = '';

  const scene = buildBattleScene(battleState, equipment);
  battleContainer.appendChild(scene);

  attachBattleListeners(battleState);
}

/**
 * Update the battle scene with new state (after each action)
 * @param {object} battleState
 */
export function updateBattleScene(battleState) {
  currentBattleState = battleState;

  if (!battleContainer) return;

  updateHeroStats(battleState, currentEquipment);
  updateMonsterStats(battleState);
  updateActionButtons(battleState);
}

/**
 * Show the hero's turn banner
 * @param {number} turnCount
 */
export function showHeroTurnBanner(turnCount) {
  if (!battleContainer) return;
  const banner = battleContainer.querySelector('.dk-battle-banner');
  if (banner) {
    banner.textContent = "HERO'S TURN!";
    banner.className = 'dk-battle-banner dk-battle-banner--hero';
    banner.style.display = '';
    clearTimeout(_turnTimer);
    _turnTimer = setTimeout(() => {
      banner.style.display = 'none';
    }, 1500);
  }
}

/**
 * Show the monster's turn banner
 * @param {Function} onDone - callback when banner done
 */
export function showMonsterTurnBanner(onDone) {
  if (!battleContainer) {
    onDone?.();
    return;
  }
  const banner = battleContainer.querySelector('.dk-battle-banner');
  if (banner) {
    banner.textContent = "DRAGON PREPARES FIRE!";
    banner.className = 'dk-battle-banner dk-battle-banner--monster';
    banner.style.display = '';
    clearTimeout(_turnTimer);
    _turnTimer = setTimeout(() => {
      banner.style.display = 'none';
      onDone?.();
    }, 1500);
  }
}

/**
 * Show floating damage/heal text on target element
 * @param {HTMLElement} targetEl
 * @param {number} value
 * @param {'damage' | 'heal' | 'shield'} type
 */
export function showBattleFloatingText(targetEl, value, type) {
  showFloatingText(targetEl, value, type);
}

/**
 * Show skill VFX animation
 * @param {HTMLElement} targetEl
 * @param {string} skillId
 */
export function showBattleSkillEffect(targetEl, skillId) {
  showSkillEffect(targetEl, skillId);
}

/**
 * Show victory modal
 * @param {object} battleState
 * @param {Function} onNextStage
 * @param {Function} onBackToMap
 */
export function showVictoryModal(battleState, onNextStage, onBackToMap) {
  if (!battleContainer) return;

  const stageBonus = 5;
  const modal = document.createElement('div');
  modal.className = 'dk-battle-modal-overlay';
  modal.innerHTML = `
    <div class="dk-battle-modal dk-battle-modal--victory">
      <div class="dk-battle-modal__icon">🎉</div>
      <div class="dk-battle-modal__title">VICTORY!</div>
      <div class="dk-battle-modal__body">
        <p>${battleState.stageId} 通关！</p>
        <p class="dk-battle-modal__stars">+${stageBonus} ⭐</p>
      </div>
      <div class="dk-battle-modal__actions">
        <button class="dk-menu-button dk-menu-button--modal" id="modal-back-to-map">返回</button>
        <button class="dk-menu-button dk-menu-button--modal dk-menu-button--primary" id="modal-next-stage">下一关</button>
      </div>
    </div>
  `;

  battleContainer.appendChild(modal);

  modal.querySelector('#modal-back-to-map').addEventListener('click', () => {
    modal.remove();
    onBackToMap?.();
  });

  modal.querySelector('#modal-next-stage').addEventListener('click', () => {
    modal.remove();
    onNextStage?.();
  });
}

/**
 * Show defeat modal
 * @param {object} battleState
 * @param {Function} onRetry - retry current stage
 * @param {Function} onBackToMap
 */
export function showDefeatModal(battleState, onRetry, onBackToMap) {
  if (!battleContainer) return;

  const modal = document.createElement('div');
  modal.className = 'dk-battle-modal-overlay';
  modal.innerHTML = `
    <div class="dk-battle-modal dk-battle-modal--defeat">
      <div class="dk-battle-modal__icon">💀</div>
      <div class="dk-battle-modal__title">DEFEATED!</div>
      <div class="dk-battle-modal__body">
        <p>你的 HP 归零了</p>
        <p class="dk-battle-modal__stars">本局获得 0 ⭐</p>
      </div>
      <div class="dk-battle-modal__actions">
        <button class="dk-menu-button dk-menu-button--modal" id="modal-back-to-map">返回</button>
        <button class="dk-menu-button dk-menu-button--modal dk-menu-button--primary" id="modal-retry">重试</button>
      </div>
    </div>
  `;

  battleContainer.appendChild(modal);

  // PM fix (Stage 3): disable attack buttons so user can't bypass defeat modal
  const actionButtons = battleContainer.querySelectorAll('.dk-battle-button');
  actionButtons.forEach(btn => {
    btn.disabled = true;
    btn.classList.add('dk-battle-button--disabled');
  });

  modal.querySelector('#modal-back-to-map').addEventListener('click', () => {
    modal.remove();
    onBackToMap?.();
  });

  modal.querySelector('#modal-retry').addEventListener('click', () => {
    modal.remove();
    onRetry?.();
  });
}

/**
 * Hide battle scene
 */
export function hideBattleScene() {
  if (battleContainer) {
    battleContainer.innerHTML = '';
  }
  clearTimeout(_turnTimer);
  _turnTimer = null;
}

/**
 * Clear turn timer (for cleanup on stage transition)
 */
export function clearBattleTimer() {
  clearTimeout(_turnTimer);
  _turnTimer = null;
}

// ==================== Build Scene HTML ====================

function buildBattleScene(battleState, equipment) {
  const fragment = document.createDocumentFragment();

  // Castle background
  const bgWrapper = document.createElement('div');
  bgWrapper.className = 'dk-battle-bg-wrapper';
  bgWrapper.innerHTML = CASTLE_BG_SVG;
  fragment.appendChild(bgWrapper);

  // Top HUD
  const hud = buildBattleHUD(battleState);
  fragment.appendChild(hud);

  // Banner (hidden by default)
  const banner = document.createElement('div');
  banner.className = 'dk-battle-banner';
  banner.style.display = 'none';
  fragment.appendChild(banner);

  // Characters section
  const charactersSection = buildCharactersSection(battleState);
  fragment.appendChild(charactersSection);

  // Action buttons section
  const actionsSection = buildActionsSection(battleState);
  fragment.appendChild(actionsSection);

  return fragment;
}

function buildBattleHUD(battleState) {
  const hero = battleState.hero;
  const hpPercent = (hero.hp / hero.maxHp) * 100;
  const mpPercent = (hero.mp / hero.maxMp) * 100;

  const stageId = battleState.stageId || '1-1';
  const [worldIdx, stageIdx] = stageId.split('-').map(Number);
  const levelText = `LEVEL ${worldIdx}-${stageIdx}`;

  const hud = document.createElement('div');
  hud.className = 'dk-battle-hud';
  hud.innerHTML = `
    <div class="dk-hud-left">
      <span class="dk-level-badge">${levelText}</span>
    </div>
    <div class="dk-hud-right">
      <div class="dk-stat-bar">
        <span class="dk-stat-label dk-stat-label--hp">HP</span>
        <div class="dk-stat-track">
          <div class="dk-stat-fill dk-stat-fill--hp" id="hero-hp-fill" style="width: ${hpPercent}%"></div>
        </div>
        <span class="dk-stat-value" id="hero-hp-value">${hero.hp}/${hero.maxHp}</span>
      </div>
      <div class="dk-stat-bar">
        <span class="dk-stat-label dk-stat-label--mp">MP</span>
        <div class="dk-stat-track">
          <div class="dk-stat-fill dk-stat-fill--mp" id="hero-mp-fill" style="width: ${mpPercent}%"></div>
        </div>
        <span class="dk-stat-value" id="hero-mp-value">${hero.mp}/${hero.maxMp}</span>
      </div>
    </div>
  `;
  return hud;
}

function buildCharactersSection(battleState) {
  const hero = battleState.hero;
  const monster = battleState.monsters[battleState.currentMonsterIdx];
  const totalDef = getHeroDef(hero, currentEquipment);
  const totalAtk = getHeroAtk(hero, currentEquipment);

  const section = document.createElement('div');
  section.className = 'dk-battle-arena';

  // Hero side
  const heroSide = document.createElement('div');
  heroSide.className = 'dk-character-side dk-character-side--hero';
  heroSide.innerHTML = `
    <div class="dk-character-sprite">${KNIGHT_SVG}</div>
    <div class="dk-character-info">
      <span class="dk-character-name">KNIGHT</span>
      <div class="dk-character-stats">
        <span>ATK ${totalAtk}</span>
        <span>DEF ${totalDef}</span>
        ${hero.shieldBuffRounds > 0 ? `<span class="dk-shield-active">SHIELD ${hero.shieldBuffRounds}</span>` : ''}
      </div>
    </div>
  `;
  section.appendChild(heroSide);

  // VS indicator
  const vsIndicator = document.createElement('div');
  vsIndicator.className = 'dk-battle-vs';
  vsIndicator.textContent = 'VS';
  section.appendChild(vsIndicator);

  // Monster side
  const monsterSide = document.createElement('div');
  monsterSide.className = 'dk-character-side dk-character-side--monster';

  if (!monster || monster.hp <= 0) {
    monsterSide.innerHTML = `
      <div class="dk-character-sprite">
        <div class="dk-defeated-placeholder">✨</div>
      </div>
      <div class="dk-character-info">
        <span class="dk-character-name">DEFEATED</span>
      </div>
    `;
  } else {
    const hpPercent = (monster.hp / monster.maxHp) * 100;
    monsterSide.innerHTML = `
      <div class="dk-character-sprite">${DRAGON_SVG}</div>
      <div class="dk-monster-info">
        <span class="dk-character-name">${monster.name}</span>
        <div class="dk-monster-hp">
          <div class="dk-stat-track dk-monster-hp__track">
            <div class="dk-stat-fill dk-stat-fill--hp" style="width: ${hpPercent}%"></div>
          </div>
          <span class="dk-stat-value">${monster.hp}/${monster.maxHp}</span>
        </div>
        <div class="dk-character-stats">
          <span>ATK ${monster.atk}</span>
          <span>DEF ${monster.def}</span>
        </div>
      </div>
    `;
  }
  section.appendChild(monsterSide);

  return section;
}

function buildActionsSection(battleState) {
  const isHeroTurn = battleState.state === BATTLE_STATE.HERO_TURN;
  const hero = battleState.hero;

  const section = document.createElement('div');
  section.className = 'dk-battle-actions';

  // Attack button
  const attackBtn = document.createElement('button');
  attackBtn.className = `dk-battle-button dk-battle-button--attack ${!isHeroTurn ? 'dk-battle-button--disabled' : ''}`;
  attackBtn.id = 'btn-attack';
  attackBtn.disabled = !isHeroTurn;
  attackBtn.innerHTML = `
    <span class="dk-battle-button__icon">${SWORD_ICON_SVG}</span>
    <span class="dk-battle-button__label">ATTACK</span>
  `;
  section.appendChild(attackBtn);

  // Skill button
  const skillBtn = document.createElement('button');
  skillBtn.className = `dk-battle-button dk-battle-button--skill ${!isHeroTurn ? 'dk-battle-button--disabled' : ''}`;
  skillBtn.id = 'btn-skill';
  skillBtn.disabled = !isHeroTurn;
  skillBtn.innerHTML = `
    <span class="dk-battle-button__icon">${FIRE_ICON_SVG}</span>
    <span class="dk-battle-button__label">SKILL</span>
  `;
  section.appendChild(skillBtn);

  // Item button
  const itemBtn = document.createElement('button');
  itemBtn.className = `dk-battle-button dk-battle-button--item ${!isHeroTurn ? 'dk-battle-button--disabled' : ''}`;
  itemBtn.id = 'btn-item';
  itemBtn.disabled = !isHeroTurn;
  itemBtn.innerHTML = `
    <span class="dk-battle-button__icon">${POTION_ICON_SVG}</span>
    <span class="dk-battle-button__label">ITEM</span>
  `;
  section.appendChild(itemBtn);

  return section;
}

// ==================== Update Functions ====================

function updateHeroStats(battleState, equipment) {
  if (!battleContainer) return;

  const hero = battleState.hero;

  const hpFill = battleContainer.querySelector('#hero-hp-fill');
  const hpValue = battleContainer.querySelector('#hero-hp-value');
  if (hpFill) hpFill.style.width = `${(hero.hp / hero.maxHp) * 100}%`;
  if (hpValue) hpValue.textContent = `${hero.hp}/${hero.maxHp}`;

  const mpFill = battleContainer.querySelector('#hero-mp-fill');
  const mpValue = battleContainer.querySelector('#hero-mp-value');
  if (mpFill) mpFill.style.width = `${(hero.mp / hero.maxMp) * 100}%`;
  if (mpValue) mpValue.textContent = `${hero.mp}/${hero.maxMp}`;
}

function updateMonsterStats(battleState) {
  if (!battleContainer) return;

  const monsterSide = battleContainer.querySelector('.dk-character-side--monster');
  if (!monsterSide) return;

  const monster = battleState.monsters[battleState.currentMonsterIdx];

  if (!monster || monster.hp <= 0) {
    const spriteEl = monsterSide.querySelector('.dk-character-sprite');
    if (spriteEl) {
      spriteEl.innerHTML = '<div class="dk-defeated-placeholder">✨</div>';
    }
    const nameEl = monsterSide.querySelector('.dk-character-name');
    if (nameEl) nameEl.textContent = 'DEFEATED';
    const infoEl = monsterSide.querySelector('.dk-monster-info');
    if (infoEl) infoEl.innerHTML = '<span class="dk-character-name">DEFEATED</span>';
  } else {
    const hpFill = monsterSide.querySelector('.dk-stat-fill');
    if (hpFill) hpFill.style.width = `${(monster.hp / monster.maxHp) * 100}%`;
  }
}

function updateActionButtons(battleState) {
  if (!battleContainer) return;

  const isHeroTurn = battleState.state === BATTLE_STATE.HERO_TURN;

  const attackBtn = battleContainer.querySelector('#btn-attack');
  if (attackBtn) {
    attackBtn.disabled = !isHeroTurn;
    attackBtn.classList.toggle('dk-battle-button--disabled', !isHeroTurn);
  }

  const skillBtn = battleContainer.querySelector('#btn-skill');
  if (skillBtn) {
    skillBtn.disabled = !isHeroTurn;
    skillBtn.classList.toggle('dk-battle-button--disabled', !isHeroTurn);
  }

  const itemBtn = battleContainer.querySelector('#btn-item');
  if (itemBtn) {
    itemBtn.disabled = !isHeroTurn;
    itemBtn.classList.toggle('dk-battle-button--disabled', !isHeroTurn);
  }
}

// ==================== Event Listeners ====================

function attachBattleListeners(battleState) {
  if (!battleContainer) return;

  const attackBtn = battleContainer.querySelector('#btn-attack');
  if (attackBtn) {
    attackBtn.addEventListener('click', () => {
      onActionCallback?.('attack');
    });
  }

  const skillBtn = battleContainer.querySelector('#btn-skill');
  if (skillBtn) {
    skillBtn.addEventListener('click', () => {
      onActionCallback?.('skill', 'fireball');
    });
  }

  const itemBtn = battleContainer.querySelector('#btn-item');
  if (itemBtn) {
    itemBtn.addEventListener('click', () => {
      onActionCallback?.('item');
    });
  }
}

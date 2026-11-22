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

/**
 * Identity of the monster currently rendered in the arena.
 *
 * BUG FIXED 2026-11-08: updateMonsterStats() used to MUTATE the monster panel
 * in place. When a monster died, the renderer replaced the monster info block
 * with the "DEFEATED" placeholder — which contains no `.dk-monster-hp` element
 * at all. endHeroTurn() then advanced `currentMonsterIdx` to the next alive
 * monster, but updateMonsterStats() had nowhere to write it (it only mutated
 * `.dk-monster-hp .dk-stat-value`, a node that no longer existed).
 *
 * Effect: monster #2 was never rendered, the VICTORY modal never appeared, and
 * a stage with more than one monster was literally unfinishable.
 *
 * The renderer now tracks WHICH monster is on screen and REBUILDS the monster
 * side whenever that monster changes. Plain damage ticks on the same monster
 * still take the cheap mutation path.
 *
 * @type {number | null} - the monster index currently rendered, or null
 */
let _renderedMonsterIdx = null;

/** @type {string | null} - id of the monster currently rendered (guards re-order) */
let _renderedMonsterId = null;

// ==================== Sprite Assets ====================
// These PNGs are SINGLE sprites painted on a large white canvas — they are NOT
// sprite sheets and have no animation frames to crop.
//   (measured 2026-11-20: content bbox covers 72-92% of the canvas width and
//    81-95% of its height; the top-left 256x328 cell is empty for 7 of the 8
//    assets and, for the 8th, the content bleeds past the cell border)
//   Ground truth: public/assets/fighter/v2/ASSET-CATALOG.md §「真实画布布局」
//   Guard:        tests/unit/fighter-v2/asset-sheet-guard.test.ts
//
// Hero:    hero-attack.png (a full-body chibi hero, whole image)
// Monster: monster-fungus.png (Stage 1-2) or monster-worm.png (Stage 3+)

// Knight sprite — the whole hero-attack.png image. Do NOT try to crop a
// "first frame" out of it: there are no frames, only one sprite on a canvas.
const KNIGHT_IMG = `<img class="dk-battle-knight" src="/assets/fighter/v2/hero-attack.png" alt="骑士"
  style="image-rendering: pixelated; width: 100px; height: auto; image-rendering: crisp-edges;"
  onerror="this.outerHTML='<div class=&quot;dk-battle-knight-fallback&quot;>⚔️</div>'"
/>`;

// Monster sprite — real PNG (default: fungus, Stage 1-2)
const MONSTER_FUNGUS_IMG = `<img class="dk-battle-monster" src="/assets/fighter/v2/monster-fungus.png" alt="懒词菌"
  style="image-rendering: pixelated; width: 100px; height: auto; image-rendering: crisp-edges;"
  onerror="this.outerHTML='<div class=&quot;dk-battle-monster-fallback&quot;>🍄</div>'"
/>`;

const MONSTER_WORM_IMG = `<img class="dk-battle-monster" src="/assets/fighter/v2/monster-worm.png" alt="多义虫"
  style="image-rendering: pixelated; width: 100px; height: auto; image-rendering: crisp-edges;"
  onerror="this.outerHTML='<div class=&quot;dk-battle-monster-fallback&quot;>🐛</div>'"
/>`;

// Castle Background — reuse main menu castle.png (no separate battle BG PNG yet)
const CASTLE_BG_IMG = `<img class="dk-castle-battle-bg" src="/fighter/v2/castle.png" alt="城堡"
  style="image-rendering: pixelated; width: 100%; height: auto; image-rendering: crisp-edges;"
  onerror="this.outerHTML='<div class=&quot;dk-castle-battle-bg-fallback&quot;>🏰</div>'"
/>`;

// Button icons — real PNG sprites (per ASSET-CATALOG.md naming mismatch note:
// equip-sword-bronze.png is actually a potion, not a sword; equip-potion-small.png is the real potion)
const ATTACK_ICON_IMG = `<img class="dk-btn-icon" src="/assets/fighter/v2/equip-potion-small.png" alt="攻击"
  style="image-rendering: pixelated; width: 32px; height: auto; image-rendering: crisp-edges;"
  onerror="this.outerHTML='<span class=&quot;dk-btn-icon-fallback&quot;>⚔️</span>'"
/>`;

const SKILL_ICON_IMG = `<span class="dk-btn-icon-fallback">🔥</span>`;

const ITEM_ICON_IMG = `<img class="dk-btn-icon" src="/assets/fighter/v2/equip-potion-small.png" alt="道具"
  style="image-rendering: pixelated; width: 32px; height: auto; image-rendering: crisp-edges;"
  onerror="this.outerHTML='<span class=&quot;dk-btn-icon-fallback&quot;>🧪</span>'"
/>`;

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

  // The scene was just rebuilt from scratch, so the monster tracker must be
  // re-synced to whatever monster is on screen. Otherwise the first
  // updateBattleScene() call would think "the monster changed" and rebuild
  // the panel a second time (harmless but wasteful), or worse, think "same
  // monster" while the DOM actually shows a different one.
  _renderedMonsterIdx = battleState.currentMonsterIdx;
  _renderedMonsterId = battleState.monsters[battleState.currentMonsterIdx]?.id ?? null;

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

  // Castle background (real PNG sprite)
  const bgWrapper = document.createElement('div');
  bgWrapper.className = 'dk-battle-bg-wrapper';
  bgWrapper.innerHTML = CASTLE_BG_IMG;
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
    <div class="dk-character-sprite">${KNIGHT_IMG}</div>
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
    // Pick monster sprite based on name: worm sprite for 多义虫, fungus for 懒词菌
    const monsterSprite = (monster.name && monster.name.includes('worm'))
      ? MONSTER_WORM_IMG
      : MONSTER_FUNGUS_IMG;
    monsterSide.innerHTML = `
      <div class="dk-character-sprite">${monsterSprite}</div>
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
    <span class="dk-battle-button__icon">${ATTACK_ICON_IMG}</span>
    <span class="dk-battle-button__label">ATTACK</span>
  `;
  section.appendChild(attackBtn);

  // Skill button
  const skillBtn = document.createElement('button');
  skillBtn.className = `dk-battle-button dk-battle-button--skill ${!isHeroTurn ? 'dk-battle-button--disabled' : ''}`;
  skillBtn.id = 'btn-skill';
  skillBtn.disabled = !isHeroTurn;
  skillBtn.innerHTML = `
    <span class="dk-battle-button__icon">${SKILL_ICON_IMG}</span>
    <span class="dk-battle-button__label">SKILL</span>
  `;
  section.appendChild(skillBtn);

  // Item button
  const itemBtn = document.createElement('button');
  itemBtn.className = `dk-battle-button dk-battle-button--item ${!isHeroTurn ? 'dk-battle-button--disabled' : ''}`;
  itemBtn.id = 'btn-item';
  itemBtn.disabled = !isHeroTurn;
  itemBtn.innerHTML = `
    <span class="dk-battle-button__icon">${ITEM_ICON_IMG}</span>
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
  const monsterId = monster?.id ?? null;

  // BUG FIXED 2026-11-08: the monster on screen CHANGED (a monster died and
  // endHeroTurn() advanced currentMonsterIdx, or the stage was rebuilt).
  // The old code only mutated .dk-monster-hp inside the existing panel, but
  // after a death that panel had been REPLACED by the "DEFEATED" placeholder,
  // which has no .dk-monster-hp element — so the new monster was never
  // rendered and the battle appeared to hang forever.
  //
  // Fix: rebuild the monster side from scratch when the monster identity
  // changes. Same monster => keep the cheap mutation path (no DOM churn on
  // every damage tick).
  if (_renderedMonsterIdx !== battleState.currentMonsterIdx || _renderedMonsterId !== monsterId) {
    rebuildMonsterSide(battleState, monsterSide);
    _renderedMonsterIdx = battleState.currentMonsterIdx;
    _renderedMonsterId = monsterId;
    return;
  }

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
    // PM fix (2026-10-22): the HP bar width was updated but the numeric readout was
    // never refreshed, so the monster showed "30/30" for the whole fight while the
    // bar visibly drained. Mirrors updateHeroStats(), which updates text + fill.
    const hpValue = monsterSide.querySelector('.dk-monster-hp .dk-stat-value');
    if (hpValue) hpValue.textContent = `${monster.hp}/${monster.maxHp}`;
  }
}

/**
 * Rebuild the monster side of the arena for a (possibly new) monster.
 *
 * BUG FIXED 2026-11-08 — see updateMonsterStats(). The monster panel is
 * re-created from the same markup the initial render uses, so a new monster
 * always gets a full panel (sprite + name + HP readout + stats).
 *
 * @param {object} battleState
 * @param {HTMLElement} monsterSide - the .dk-character-side--monster element
 */
function rebuildMonsterSide(battleState, monsterSide) {
  const monster = battleState.monsters[battleState.currentMonsterIdx];

  if (!monster || monster.hp <= 0) {
    monsterSide.innerHTML = `
      <div class="dk-character-sprite">
        <div class="dk-defeated-placeholder">✨</div>
      </div>
      <div class="dk-character-info">
        <span class="dk-character-name">DEFEATED</span>
      </div>
    `;
    return;
  }

  const hpPercent = (monster.hp / monster.maxHp) * 100;
  // Pick monster sprite based on name: worm sprite for 多义虫, fungus for 懒词菌
  const monsterSprite = (monster.name && monster.name.includes('worm'))
    ? MONSTER_WORM_IMG
    : MONSTER_FUNGUS_IMG;

  monsterSide.innerHTML = `
    <div class="dk-character-sprite">${monsterSprite}</div>
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

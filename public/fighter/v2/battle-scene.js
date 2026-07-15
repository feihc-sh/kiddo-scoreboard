/**
 * Fighter V2 Battle Scene UI
 * Renders battle scene: HP/MP bars, monster sprite, action buttons, turn banner
 * Per spec §5.3 Battle Scene Layout
 *
 * Imports combat.js for pure logic + skill-effects.js for VFX
 */

import {
  BATTLE_STATE,
  SKILLS,
  getHeroDef,
  getHeroAtk,
} from './combat.js';
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

  // Clear container
  battleContainer.innerHTML = '';

  // Build battle scene HTML
  const scene = buildBattleScene(battleState, equipment);
  battleContainer.appendChild(scene);

  // Attach event listeners
  attachBattleListeners(battleState);
}

/**
 * Update the battle scene with new state (after each action)
 * @param {object} battleState
 */
export function updateBattleScene(battleState) {
  currentBattleState = battleState;

  if (!battleContainer) return;

  // Update all dynamic elements
  updateHeroStats(battleState, currentEquipment);
  updateMonsterStats(battleState);
  updateActionButtons(battleState);
  updateTurnBanner(battleState.state);
}

/**
 * Show the hero's turn banner
 * @param {number} turnCount
 */
export function showHeroTurnBanner(turnCount) {
  if (!battleContainer) return;
  const banner = battleContainer.querySelector('.battle-banner');
  if (banner) {
    banner.textContent = `⚔️ 你的回合 (回合 ${turnCount})`;
    banner.className = 'battle-banner battle-banner--hero';
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
  const banner = battleContainer.querySelector('.battle-banner');
  if (banner) {
    banner.textContent = '👾 敌人回合';
    banner.className = 'battle-banner battle-banner--monster';
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

  const stageBonus = 5; // per spec
  const modal = document.createElement('div');
  modal.className = 'battle-modal-overlay';
  modal.innerHTML = `
    <div class="battle-modal">
      <div class="battle-modal__icon">🎉</div>
      <div class="battle-modal__title">${battleState.stageId} 通关！</div>
      <div class="battle-modal__body">
        <p>击败 ${battleState.totalMonsters} 个怪物</p>
        <p class="battle-modal__stars">+${stageBonus} ⭐</p>
      </div>
      <div class="battle-modal__actions">
        <button class="btn btn--secondary btn--modal" id="modal-back-to-map">返回地图</button>
        <button class="btn btn--primary btn--modal" id="modal-next-stage">下一关 →</button>
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
  modal.className = 'battle-modal-overlay';
  modal.innerHTML = `
    <div class="battle-modal battle-modal--defeat">
      <div class="battle-modal__icon">💀</div>
      <div class="battle-modal__title">失败了</div>
      <div class="battle-modal__body">
        <p>你的 HP 归零了</p>
        <p class="battle-modal__stars">本局获得 0 ⭐</p>
      </div>
      <div class="battle-modal__actions">
        <button class="btn btn--secondary btn--modal" id="modal-back-to-map">返回地图</button>
        <button class="btn btn--primary btn--modal" id="modal-retry">重新开始</button>
      </div>
    </div>
  `;

  battleContainer.appendChild(modal);

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

  // Banner (hidden by default, shown on turn start)
  const banner = document.createElement('div');
  banner.className = 'battle-banner';
  banner.style.display = 'none';
  fragment.appendChild(banner);

  // Hero section
  const heroSection = buildHeroSection(battleState, equipment);
  fragment.appendChild(heroSection);

  // Divider
  const divider = document.createElement('div');
  divider.className = 'battle-divider';
  fragment.appendChild(divider);

  // Monster section
  const monsterSection = buildMonsterSection(battleState);
  fragment.appendChild(monsterSection);

  // Action section
  const actionSection = buildActionSection(battleState);
  fragment.appendChild(actionSection);

  return fragment;
}

function buildHeroSection(battleState, equipment) {
  const hero = battleState.hero;
  const totalDef = getHeroDef(hero, equipment);
  const totalAtk = getHeroAtk(hero, equipment);

  const section = document.createElement('div');
  section.className = 'battle-hero';

  section.innerHTML = `
    <div class="battle-hero__header">
      <span class="battle-hero__name">🦸 单词战士</span>
      <span class="battle-hero__turn">回合 ${battleState.turnCount || 1}</span>
    </div>
    <div class="battle-hero__sprite">
      <div class="battle-sprite battle-sprite--hero">🦸</div>
    </div>
    <div class="battle-hero__stats">
      <div class="battle-stat">
        <span class="battle-stat__label">❤️ HP</span>
        <div class="battle-bar battle-bar--hp">
          <div class="battle-bar__fill" id="hero-hp-fill" style="width: ${(hero.hp / hero.maxHp) * 100}%"></div>
        </div>
        <span class="battle-stat__value" id="hero-hp-value">${hero.hp}/${hero.maxHp}</span>
      </div>
      <div class="battle-stat">
        <span class="battle-stat__label">💎 MP</span>
        <div class="battle-bar battle-bar--mp">
          <div class="battle-bar__fill" id="hero-mp-fill" style="width: ${(hero.mp / hero.maxMp) * 100}%"></div>
        </div>
        <span class="battle-stat__value" id="hero-mp-value">${hero.mp}/${hero.maxMp}</span>
      </div>
      <div class="battle-hero__meta">
        <span class="battle-meta-item">🗡️ ATK ${totalAtk}</span>
        <span class="battle-meta-item">🛡️ DEF ${totalDef}</span>
        ${hero.shieldBuffRounds > 0 ? `<span class="battle-meta-item battle-meta-item--shield">🛡️ 护盾 ${hero.shieldBuffRounds}回合</span>` : ''}
      </div>
    </div>
  `;

  return section;
}

function buildMonsterSection(battleState) {
  const monster = battleState.monsters[battleState.currentMonsterIdx];
  const monstersKilled = battleState.monsters.filter((m) => m.hp <= 0).length;
  const total = battleState.totalMonsters;

  const section = document.createElement('div');
  section.className = 'battle-monster';

  if (!monster || monster.hp <= 0) {
    section.innerHTML = `
      <div class="battle-monster__header">
        <span class="battle-monster__title">当前敌人: ---</span>
        <span class="battle-monster__progress">${monstersKilled}/${total}</span>
      </div>
      <div class="battle-monster__body battle-monster__body--empty">
        <div class="battle-sprite battle-sprite--empty">✨</div>
        <p class="battle-monster__defeated">敌人已被击败！</p>
      </div>
    `;
  } else {
    const spriteClass = getMonsterSpriteClass(monster.type);

    section.innerHTML = `
      <div class="battle-monster__header">
        <span class="battle-monster__title">当前敌人: ${monster.name}</span>
        <span class="battle-monster__progress">${monstersKilled + 1}/${total}</span>
      </div>
      <div class="battle-monster__body">
        <div class="battle-sprite ${spriteClass}" id="monster-sprite">${monster.emoji}</div>
        <div class="battle-monster__info">
          <div class="battle-stat">
            <span class="battle-stat__label">❤️ HP</span>
            <div class="battle-bar battle-bar--hp battle-bar--monster">
              <div class="battle-bar__fill" id="monster-hp-fill" style="width: ${(monster.hp / monster.maxHp) * 100}%"></div>
            </div>
            <span class="battle-stat__value" id="monster-hp-value">${monster.hp}/${monster.maxHp}</span>
          </div>
          <div class="battle-monster__stats">
            <span class="battle-meta-item">⚔️ ATK ${monster.atk}</span>
            <span class="battle-meta-item">🛡️ DEF ${monster.def}</span>
          </div>
        </div>
      </div>
    `;
  }

  return section;
}

function buildActionSection(battleState) {
  const isHeroTurn = battleState.state === BATTLE_STATE.HERO_TURN;
  const hero = battleState.hero;

  const section = document.createElement('div');
  section.className = 'battle-actions';

  const fireballCd = hero.skillCooldowns.fireball;
  const healCd = hero.skillCooldowns.heal;
  const shieldCd = hero.skillCooldowns.shield;

  const canFireball = isHeroTurn && hero.mp >= SKILLS.fireball.mpCost && fireballCd === 0;
  const canHeal = isHeroTurn && hero.mp >= SKILLS.heal.mpCost && healCd === 0 && hero.hp < hero.maxHp;
  const canShield = isHeroTurn && hero.mp >= SKILLS.shield.mpCost && shieldCd === 0 && hero.shieldBuffRounds === 0;

  section.innerHTML = `
    <div class="battle-actions__row">
      <button
        class="btn btn--action btn--attack ${!isHeroTurn ? 'btn--disabled' : ''}"
        id="btn-attack"
        ${!isHeroTurn ? 'disabled' : ''}
      >
        ⚔️ 攻击
      </button>
    </div>
    <div class="battle-actions__row battle-actions__row--skills">
      <button
        class="btn btn--action btn--skill ${!canFireball ? 'btn--disabled' : ''}"
        id="btn-fireball"
        ${!canFireball ? 'disabled' : ''}
        title="MP ${SKILLS.fireball.mpCost} | 冷却 ${SKILLS.fireball.cooldown}回合"
      >
        ${SKILLS.fireball.emoji} ${SKILLS.fireball.name} ${SKILLS.fireball.mpCost}💎
        ${fireballCd > 0 ? `<span class="cooldown-badge">${fireballCd}</span>` : ''}
      </button>
      <button
        class="btn btn--action btn--skill ${!canHeal ? 'btn--disabled' : ''}"
        id="btn-heal"
        ${!canHeal ? 'disabled' : ''}
        title="MP ${SKILLS.heal.mpCost} | 冷却 ${SKILLS.heal.cooldown}回合"
      >
        ${SKILLS.heal.emoji} ${SKILLS.heal.name} ${SKILLS.heal.mpCost}💎
        ${healCd > 0 ? `<span class="cooldown-badge">${healCd}</span>` : ''}
      </button>
      <button
        class="btn btn--action btn--skill ${!canShield ? 'btn--disabled' : ''}"
        id="btn-shield"
        ${!canShield ? 'disabled' : ''}
        title="MP ${SKILLS.shield.mpCost} | 冷却 ${SKILLS.shield.cooldown}回合"
      >
        ${SKILLS.shield.emoji} ${SKILLS.shield.name} ${SKILLS.shield.mpCost}💎
        ${shieldCd > 0 ? `<span class="cooldown-badge">${shieldCd}</span>` : ''}
      </button>
    </div>
  `;

  return section;
}

// ==================== Update Functions ====================

function updateHeroStats(battleState, equipment) {
  if (!battleContainer) return;

  const hero = battleState.hero;

  // HP bar
  const hpFill = battleContainer.querySelector('#hero-hp-fill');
  const hpValue = battleContainer.querySelector('#hero-hp-value');
  if (hpFill) hpFill.style.width = `${(hero.hp / hero.maxHp) * 100}%`;
  if (hpValue) hpValue.textContent = `${hero.hp}/${hero.maxHp}`;

  // MP bar
  const mpFill = battleContainer.querySelector('#hero-mp-fill');
  const mpValue = battleContainer.querySelector('#hero-mp-value');
  if (mpFill) mpFill.style.width = `${(hero.mp / hero.maxMp) * 100}%`;
  if (mpValue) mpValue.textContent = `${hero.mp}/${hero.maxMp}`;

  // Turn counter
  const turnEl = battleContainer.querySelector('.battle-hero__turn');
  if (turnEl) turnEl.textContent = `回合 ${battleState.turnCount || 1}`;

  // Shield indicator
  const metaEl = battleContainer.querySelector('.battle-hero__meta');
  if (metaEl) {
    const totalDef = getHeroDef(hero, equipment);
    metaEl.innerHTML = `
      <span class="battle-meta-item">🗡️ ATK ${getHeroAtk(hero, equipment)}</span>
      <span class="battle-meta-item">🛡️ DEF ${totalDef}</span>
      ${hero.shieldBuffRounds > 0 ? `<span class="battle-meta-item battle-meta-item--shield">🛡️ 护盾 ${hero.shieldBuffRounds}回合</span>` : ''}
    `;
  }
}

function updateMonsterStats(battleState) {
  if (!battleContainer) return;

  const monster = battleState.monsters[battleState.currentMonsterIdx];
  const monstersKilled = battleState.monsters.filter((m) => m.hp <= 0).length;
  const total = battleState.totalMonsters;

  const monsterSection = battleContainer.querySelector('.battle-monster');
  if (!monsterSection) return;

  if (!monster || monster.hp <= 0) {
    // Monster defeated - update progress
    const progressEl = monsterSection.querySelector('.battle-monster__progress');
    if (progressEl) progressEl.textContent = `${monstersKilled}/${total}`;

    const bodyEl = monsterSection.querySelector('.battle-monster__body');
    if (bodyEl) {
      bodyEl.classList.add('battle-monster__body--empty');
      const sprite = bodyEl.querySelector('.battle-sprite');
      if (sprite) sprite.className = 'battle-sprite battle-sprite--empty';
      const defeatedText = bodyEl.querySelector('.battle-monster__defeated');
      if (defeatedText) defeatedText.style.display = '';
    }
  } else {
    const hpFill = monsterSection.querySelector('#monster-hp-fill');
    const hpValue = monsterSection.querySelector('#monster-hp-value');
    if (hpFill) hpFill.style.width = `${(monster.hp / monster.maxHp) * 100}%`;
    if (hpValue) hpValue.textContent = `${monster.hp}/${monster.maxHp}`;
  }
}

function updateActionButtons(battleState) {
  if (!battleContainer) return;

  const isHeroTurn = battleState.state === BATTLE_STATE.HERO_TURN;
  const hero = battleState.hero;

  const fireballCd = hero.skillCooldowns.fireball;
  const healCd = hero.skillCooldowns.heal;
  const shieldCd = hero.skillCooldowns.shield;

  const canFireball = isHeroTurn && hero.mp >= SKILLS.fireball.mpCost && fireballCd === 0;
  const canHeal = isHeroTurn && hero.mp >= SKILLS.heal.mpCost && healCd === 0 && hero.hp < hero.maxHp;
  const canShield = isHeroTurn && hero.mp >= SKILLS.shield.mpCost && shieldCd === 0 && hero.shieldBuffRounds === 0;

  // Attack button
  const attackBtn = battleContainer.querySelector('#btn-attack');
  if (attackBtn) {
    attackBtn.disabled = !isHeroTurn;
    attackBtn.classList.toggle('btn--disabled', !isHeroTurn);
  }

  // Fireball button
  const fireballBtn = battleContainer.querySelector('#btn-fireball');
  if (fireballBtn) {
    fireballBtn.disabled = !canFireball;
    fireballBtn.classList.toggle('btn--disabled', !canFireball);
    const badge = fireballBtn.querySelector('.cooldown-badge');
    if (badge) {
      badge.textContent = fireballCd;
      badge.style.display = fireballCd > 0 ? '' : 'none';
    }
  }

  // Heal button
  const healBtn = battleContainer.querySelector('#btn-heal');
  if (healBtn) {
    healBtn.disabled = !canHeal;
    healBtn.classList.toggle('btn--disabled', !canHeal);
    const badge = healBtn.querySelector('.cooldown-badge');
    if (badge) {
      badge.textContent = healCd;
      badge.style.display = healCd > 0 ? '' : 'none';
    }
  }

  // Shield button
  const shieldBtn = battleContainer.querySelector('#btn-shield');
  if (shieldBtn) {
    shieldBtn.disabled = !canShield;
    shieldBtn.classList.toggle('btn--disabled', !canShield);
    const badge = shieldBtn.querySelector('.cooldown-badge');
    if (badge) {
      badge.textContent = shieldCd;
      badge.style.display = shieldCd > 0 ? '' : 'none';
    }
  }
}

function updateTurnBanner(state) {
  if (!battleContainer) return;
  const banner = battleContainer.querySelector('.battle-banner');
  if (!banner) return;

  switch (state) {
    case BATTLE_STATE.HERO_TURN:
      banner.textContent = '⚔️ 你的回合';
      banner.className = 'battle-banner battle-banner--hero';
      break;
    case BATTLE_STATE.MONSTER_TURN:
      banner.textContent = '👾 敌人回合';
      banner.className = 'battle-banner battle-banner--monster';
      break;
    case BATTLE_STATE.STAGE_CLEAR:
      banner.textContent = '🎉 关卡通关！';
      banner.className = 'battle-banner battle-banner--victory';
      break;
    case BATTLE_STATE.DEFEAT:
      banner.textContent = '💀 失败了';
      banner.className = 'battle-banner battle-banner--defeat';
      break;
  }
}

// ==================== Event Listeners ====================

function attachBattleListeners(battleState) {
  if (!battleContainer) return;

  // Attack button
  const attackBtn = battleContainer.querySelector('#btn-attack');
  if (attackBtn) {
    attackBtn.addEventListener('click', () => {
      onActionCallback?.('attack');
    });
  }

  // Fireball button
  const fireballBtn = battleContainer.querySelector('#btn-fireball');
  if (fireballBtn) {
    fireballBtn.addEventListener('click', () => {
      onActionCallback?.('skill', 'fireball');
    });
  }

  // Heal button
  const healBtn = battleContainer.querySelector('#btn-heal');
  if (healBtn) {
    healBtn.addEventListener('click', () => {
      onActionCallback?.('skill', 'heal');
    });
  }

  // Shield button
  const shieldBtn = battleContainer.querySelector('#btn-shield');
  if (shieldBtn) {
    shieldBtn.addEventListener('click', () => {
      onActionCallback?.('skill', 'shield');
    });
  }
}

// ==================== Helpers ====================

function getMonsterSpriteClass(type) {
  switch (type) {
    case 'fungus':
      return 'battle-sprite--fungus';
    case 'worm':
      return 'battle-sprite--worm';
    case 'dragon':
      return 'battle-sprite--dragon';
    default:
      return 'battle-sprite--monster';
  }
}

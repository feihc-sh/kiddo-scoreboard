/**
 * Fighter V2 Shop Modal
 * Equipment shop UI triggered after World clear
 * Per spec §5.6 Equipment Shop Modal
 */

import { $, $$ } from './utils.js';
import {
  EQUIPMENT,
  getEquipmentItem,
  getEquipmentTypes,
  getTierNames,
  isTierUnlocked,
  buyEquipment,
  canBuy,
  getEquipmentBonus,
} from './equipment.js';

/** @type {HTMLElement | null} */
let shopOverlay = null;

/** @type {object | null} */
let currentState = null;

/** @type {Function | null} */
let onShopClose = null;

/** @type {Function | null} */
let onPurchaseComplete = null;

// ==================== Public API ====================

/**
 * Show the shop modal
 * @param {object} gameState - current game state
 * @param {Function} onClose - callback when shop closes (returns new state)
 * @param {Function} [onPurchase] - optional callback when purchase made (state)
 */
export function showShopModal(gameState, onClose, onPurchase) {
  currentState = gameState;
  onShopClose = onClose;
  onPurchaseComplete = onPurchase;

  // Remove existing modal if any
  hideShopModal();

  // Create overlay
  shopOverlay = document.createElement('div');
  shopOverlay.className = 'battle-modal-overlay';
  shopOverlay.id = 'shop-modal-overlay';

  // Render shop content
  shopOverlay.innerHTML = buildShopHTML(currentState);

  // Append to body (above all views)
  document.body.appendChild(shopOverlay);

  // Attach event listeners
  attachShopListeners();

  // Expose globally for E2E testing
  window._shopModal = { refreshUI };
}

/**
 * Hide the shop modal
 */
export function hideShopModal() {
  if (shopOverlay) {
    shopOverlay.remove();
    shopOverlay = null;
  }
  window._shopModal = null;
}

/**
 * Refresh the shop UI with updated state
 */
export function refreshShopUI(gameState) {
  currentState = gameState;
  refreshUI();
}

// ==================== Build HTML ====================

function buildShopHTML(state) {
  const stars = state.session?.stars ?? state.bank?.stars ?? 0;
  const worldCleared = getCurrentWorldName(state);

  return `
    <div class="battle-modal shop-modal" id="shop-modal">
      <div class="shop-modal__header">
        <div class="shop-modal__icon">⚔️</div>
        <div class="shop-modal__title">装备店</div>
        <div class="shop-modal__subtitle">${worldCleared}</div>
        <div class="shop-modal__stars">⭐ 当前: <span id="shop-stars">${stars}</span></div>
      </div>
      <div class="shop-modal__items" id="shop-items">
        ${buildEquipmentSections(state)}
      </div>
      <div class="shop-modal__footer">
        <button class="btn btn--secondary btn--modal" id="shop-close">关闭</button>
      </div>
    </div>
  `;
}

function buildEquipmentSections(state) {
  let html = '';

  for (const type of getEquipmentTypes()) {
    const equip = EQUIPMENT[type];
    html += buildEquipmentTypeSection(type, equip, state);
  }

  return html;
}

function buildEquipmentTypeSection(type, equip, state) {
  const icon = equip.icon;
  const name = equip.name;
  const currentTier = state.equipment?.[type] || 'none';

  let rows = '';
  for (const tierDef of equip.tiers) {
    rows += buildTierRow(type, tierDef, currentTier, state);
  }

  return `
    <div class="shop-section" data-type="${type}">
      <div class="shop-section__header">
        <span class="shop-section__icon">${icon}</span>
        <span class="shop-section__name">${name}</span>
      </div>
      <div class="shop-section__rows">
        ${rows}
      </div>
    </div>
  `;
}

function buildTierRow(type, tierDef, currentTier, state) {
  const { tier, name, cost, atk, def, heal } = tierDef;
  const isUnlocked = isTierUnlocked(tierDef, state);
  const isOwned = currentTier === tier;
  const check = canBuy(state, type, tier);
  const isAffordable = check.ok;
  const isBetter = isBetterTier(type, currentTier, tier);

  // Build stat display
  let statText = '';
  if (atk) statText = `+${atk}ATK`;
  else if (def) statText = `+${def}DEF`;
  else if (heal) statText = `+${heal}HP`;

  const tierLabel = getTierLabel(tier);

  let statusText = '';
  let buttonHtml = '';
  let rowClass = 'shop-row';

  if (!isUnlocked) {
    // Locked
    statusText = `🔒 ${getUnlockHint(tierDef.unlockAt)}`;
    rowClass += ' shop-row--locked';
    buttonHtml = `<button class="btn btn--disabled btn--small" disabled>锁定</button>`;
  } else if (isOwned) {
    // Already owned
    statusText = '✅ 已拥有';
    rowClass += ' shop-row--owned';
    buttonHtml = `<span class="shop-owned-badge">✓</span>`;
  } else if (isBetter) {
    // Already have better
    rowClass += ' shop-row--owned';
    statusText = '已拥有更高级';
    buttonHtml = `<span class="shop-owned-badge">✓</span>`;
  } else if (cost === 0) {
    // Free (bronze auto-owned)
    statusText = '免费';
    buttonHtml = `<button class="btn btn--disabled btn--small" disabled>已拥有</button>`;
  } else if (!isAffordable) {
    // Can't afford
    rowClass += ' shop-row--unaffordable';
    statusText = `⭐ ${cost}`;
    buttonHtml = `<button class="btn btn--disabled btn--small" disabled>⭐不足</button>`;
  } else {
    // Can buy
    statusText = `⭐ ${cost}`;
    buttonHtml = `<button class="btn btn--primary btn--small shop-buy-btn" data-type="${type}" data-tier="${tier}">购买</button>`;
  }

  return `
    <div class="${rowClass}" data-type="${type}" data-tier="${tier}">
      <span class="shop-row__tier">${tierLabel}</span>
      <span class="shop-row__name">${name}</span>
      <span class="shop-row__stat">${statText}</span>
      <span class="shop-row__status">${statusText}</span>
      ${buttonHtml}
    </div>
  `;
}

// ==================== Event Handlers ====================

function attachShopListeners() {
  if (!shopOverlay) return;

  // Close button
  const closeBtn = shopOverlay.querySelector('#shop-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      hideShopModal();
      onShopClose?.(currentState);
    });
  }

  // Buy buttons
  const buyBtns = shopOverlay.querySelectorAll('.shop-buy-btn');
  buyBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      const tier = btn.dataset.tier;
      handlePurchase(type, tier);
    });
  });

  // Click outside modal to close
  shopOverlay.addEventListener('click', (e) => {
    if (e.target === shopOverlay) {
      hideShopModal();
      onShopClose?.(currentState);
    }
  });

  // Escape key to close
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      hideShopModal();
      onShopClose?.(currentState);
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

function handlePurchase(type, tier) {
  if (!currentState) return;

  const result = buyEquipment(currentState, type, tier);

  if (!result.ok) {
    // Show error feedback
    showPurchaseError(result.error);
    return;
  }

  // Update state
  currentState = result.newState;

  // Refresh UI
  refreshUI();

  // Notify
  onPurchaseComplete?.(currentState);
}

function showPurchaseError(error) {
  // Simple visual feedback - flash the button
  // In production, could show a toast message
  console.warn('Purchase error:', error);
}

// ==================== UI Refresh ====================

function refreshUI() {
  if (!shopOverlay || !currentState) return;

  // Update stars display
  const starsEl = shopOverlay.querySelector('#shop-stars');
  if (starsEl) {
    starsEl.textContent = currentState.session?.stars ?? currentState.bank?.stars ?? 0;
  }

  // Update equipment rows
  for (const type of getEquipmentTypes()) {
    const equip = EQUIPMENT[type];
    const currentTier = currentState.equipment?.[type] || 'none';

    for (const tierDef of equip.tiers) {
      const row = shopOverlay.querySelector(
        `.shop-row[data-type="${type}"][data-tier="${tierDef.tier}"]`
      );
      if (!row) continue;

      // Rebuild the row content
      const newRowHtml = buildTierRowHtml(type, tierDef, currentTier, currentState);
      row.outerHTML = newRowHtml;
    }
  }

  // Re-attach buy button listeners
  const buyBtns = shopOverlay.querySelectorAll('.shop-buy-btn');
  buyBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      const tier = btn.dataset.tier;
      handlePurchase(type, tier);
    });
  });
}

function buildTierRowHtml(type, tierDef, currentTier, state) {
  return buildTierRow(type, tierDef, currentTier, state);
}

// ==================== Helpers ====================

export function getTierLabel(tier) {
  const labels = {
    bronze: '青铜',
    silver: '白银',
    gold: '黄金',
  };
  return labels[tier] || tier;
}

export function getUnlockHint(unlockAt) {
  if (!unlockAt) return '';
  if (unlockAt === 'world-1-clear') return 'World 2通关解锁';
  if (unlockAt === 'world-2-clear') return 'World 3通关解锁';
  return '未解锁';
}

export function getCurrentWorldName(state) {
  const worldIdx = state.session?.worldIdx ?? 0;
  const worldNames = ['菌绿森林', '多义虫巢穴', '拼写巨龙洞穴', '法师高塔', '终极城堡'];
  return worldNames[worldIdx] || '';
}

function isBetterTier(type, currentTier, targetTier) {
  if (currentTier === 'none') return false;
  const tierOrder = getTierNames();
  const currentIdx = tierOrder.indexOf(currentTier);
  const targetIdx = tierOrder.indexOf(targetTier);
  return targetIdx <= currentIdx;
}

// ==================== World Clear Shop Trigger ====================

/**
 * Check if a world is fully cleared (all 3 stages done)
 * @param {object} gameState
 * @returns {boolean}
 */
export function isWorldCleared(gameState) {
  const worldIdx = gameState.session?.worldIdx ?? 0;
  const worldsCleared = gameState.progress?.worldsCleared ?? [];
  return worldsCleared.includes(worldIdx);
}

/**
 * Award world clear bonus
 * @param {object} state
 * @returns {object} new state
 */
export function awardWorldClearBonus(state) {
  const WORLD_BONUS = 15;
  return {
    ...state,
    session: {
      ...state.session,
      stars: (state.session?.stars ?? 0) + WORLD_BONUS,
    },
    bank: {
      ...state.bank,
      stars: (state.bank?.stars ?? 0) + WORLD_BONUS,
    },
  };
}

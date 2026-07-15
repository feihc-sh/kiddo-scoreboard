/**
 * Fighter V2 Utility Functions
 * localStorage helpers + DOM helpers
 */

export const STORAGE_KEY = 'fighterV2Bank';

/**
 * Default V2 state per spec §4 localStorage V2 Schema
 * @returns {object}
 */
export function getDefaultState() {
  return {
    v: 2,
    bank: { stars: 0 },
    session: { stars: 0, worldIdx: 0, stageIdx: 0, currentMonsterIdx: 0 },
    hero: {
      hp: 100,
      maxHp: 100,
      mp: 100,
      maxMp: 100,
      atk: 10,
      def: 0,
      shieldBuff: 0,
      shieldBuffRounds: 0,
      skillCooldowns: { fireball: 0, heal: 0, shield: 0 },
    },
    equipment: { sword: 'none', shield: 'none', potion: 'none' },
    progress: { worldsCleared: [] },
  };
}

/**
 * Load game state from localStorage
 * If missing, initializes with defaults
 * @returns {object}
 */
export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const defaultState = getDefaultState();
      saveState(defaultState);
      return defaultState;
    }
    const parsed = JSON.parse(raw);
    // Ensure V2 schema
    if (parsed.v !== 2) {
      const defaultState = getDefaultState();
      saveState(defaultState);
      return defaultState;
    }
    return parsed;
  } catch (e) {
    console.error('Failed to load game state:', e);
    return getDefaultState();
  }
}

/**
 * Save game state to localStorage
 * @param {object} state
 */
export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Failed to save game state:', e);
  }
}

/**
 * Update session world/stage indices
 * @param {object} state
 * @param {number} worldIdx
 * @param {number} stageIdx
 * @returns {object} new state (immutable)
 */
export function setCurrentStage(state, worldIdx, stageIdx) {
  return {
    ...state,
    session: {
      ...state.session,
      worldIdx,
      stageIdx,
      currentMonsterIdx: 0,
    },
  };
}

/**
 * Mark a world as cleared
 * @param {object} state
 * @param {number} worldIdx
 * @returns {object} new state (immutable)
 */
export function markWorldCleared(state, worldIdx) {
  const cleared = [...state.progress.worldsCleared];
  if (!cleared.includes(worldIdx)) {
    cleared.push(worldIdx);
  }
  return {
    ...state,
    progress: {
      ...state.progress,
      worldsCleared: cleared,
    },
  };
}

/**
 * Add stars to bank
 * @param {object} state
 * @param {number} amount
 * @returns {object} new state (immutable)
 */
export function addStars(state, amount) {
  return {
    ...state,
    bank: {
      ...state.bank,
      stars: state.bank.stars + amount,
    },
    session: {
      ...state.session,
      stars: state.session.stars + amount,
    },
  };
}

// ==================== DOM Helpers ====================

/**
 * Create element with classes and children
 * @param {string} tag
 * @param {object} attrs - { className, id, textContent, onclick, ... }
 * @param  {...any} children
 * @returns {HTMLElement}
 */
export function createElement(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);

  Object.entries(attrs).forEach(([key, value]) => {
    if (key === 'className') {
      el.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      const eventName = key.slice(2).toLowerCase();
      el.addEventListener(eventName, value);
    } else if (key === 'dataset') {
      Object.entries(value).forEach(([dataKey, dataVal]) => {
        el.dataset[dataKey] = dataVal;
      });
    } else {
      el.setAttribute(key, value);
    }
  });

  children.forEach((child) => {
    if (typeof child === 'string') {
      el.appendChild(document.createTextNode(child));
    } else if (child instanceof Node) {
      el.appendChild(child);
    }
  });

  return el;
}

/**
 * Show an element
 * @param {HTMLElement} el
 */
export function show(el) {
  if (el) el.style.display = '';
}

/**
 * Hide an element
 * @param {HTMLElement} el
 */
export function hide(el) {
  if (el) el.style.display = 'none';
}

/**
 * Clear all children from element
 * @param {HTMLElement} el
 */
export function clearChildren(el) {
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
}

/**
 * Set text content safely
 * @param {HTMLElement} el
 * @param {string} text
 */
export function setText(el, text) {
  if (el) el.textContent = text;
}

/**
 * Get element by ID shortcut
 * @param {string} id
 * @returns {HTMLElement | null}
 */
export function $(id) {
  return document.getElementById(id);
}

/**
 * Query selector shortcut
 * @param {string} selector
 * @param {HTMLElement} parent
 * @returns {HTMLElement | null}
 */
export function $$(selector, parent = document) {
  return parent.querySelector(selector);
}

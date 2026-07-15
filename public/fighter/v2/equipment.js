/**
 * Fighter V2 Equipment System
 * 3-tier equipment RPG (bronze/silver/gold) for sword, shield, potion
 * Per spec §4 Equipment RPG + §5.6 Shop Modal
 *
 * Pure functions - no DOM access, no side effects
 */

/**
 * Equipment definition
 * 9 total items: 3 types × 3 tiers
 */
export const EQUIPMENT = {
  sword: {
    name: '剑',
    icon: '🗡️',
    slot: 'weapon',
    tiers: [
      { tier: 'bronze', name: '青铜剑', atk: 5,  cost: 0,  unlockAt: null },
      { tier: 'silver', name: '白银剑', atk: 12, cost: 30, unlockAt: 'world-1-clear' },
      { tier: 'gold',   name: '黄金剑', atk: 25, cost: 80, unlockAt: 'world-2-clear' },
    ],
  },
  shield: {
    name: '盾',
    icon: '🛡️',
    slot: 'armor',
    tiers: [
      { tier: 'bronze', name: '木盾',    def: 3,  cost: 0,  unlockAt: null },
      { tier: 'silver', name: '铁盾',    def: 8,  cost: 25, unlockAt: 'world-1-clear' },
      { tier: 'gold',   name: '钻石盾', def: 15, cost: 70, unlockAt: 'world-2-clear' },
    ],
  },
  potion: {
    name: '药水',
    icon: '💊',
    slot: 'consumable',
    tiers: [
      { tier: 'bronze', name: '小药水', heal: 20,  cost: 0,  unlockAt: null },
      { tier: 'silver', name: '中药水', heal: 50,  cost: 20, unlockAt: 'world-1-clear' },
      { tier: 'gold',   name: '大药水', heal: 100, cost: 60, unlockAt: 'world-2-clear' },
    ],
  },
};

// Unlock requirements mapping
const UNLOCK_MAP = {
  'world-1-clear': (state) => state.progress.worldsCleared.includes(0),
  'world-2-clear': (state) => state.progress.worldsCleared.includes(1),
};

/**
 * Check if a tier is unlocked for a given game state
 * @param {object} tierDef - tier definition with unlockAt
 * @param {object} state - game state
 * @returns {boolean}
 */
export function isTierUnlocked(tierDef, state) {
  if (!tierDef.unlockAt) return true; // Bronze always unlocked
  const checkFn = UNLOCK_MAP[tierDef.unlockAt];
  return checkFn ? checkFn(state) : false;
}

/**
 * Get equipment tier definition by type and tier name
 * @param {string} equipmentType - 'sword' | 'shield' | 'potion'
 * @param {string} tier - 'bronze' | 'silver' | 'gold'
 * @returns {object | null}
 */
export function getEquipmentTier(equipmentType, tier) {
  const equip = EQUIPMENT[equipmentType];
  if (!equip) return null;
  return equip.tiers.find((t) => t.tier === tier) || null;
}

/**
 * Get equipment item by type and tier
 * @param {string} equipmentType - 'sword' | 'shield' | 'potion'
 * @param {string} tier - 'bronze' | 'silver' | 'gold'
 * @returns {object | null}
 */
export function getEquipmentItem(equipmentType, tier) {
  const equip = EQUIPMENT[equipmentType];
  if (!equip) return null;
  const tierDef = equip.tiers.find((t) => t.tier === tier);
  if (!tierDef) return null;
  return { type: equipmentType, ...tierDef };
}

/**
 * Get all equipment types
 * @returns {string[]}
 */
export function getEquipmentTypes() {
  return ['sword', 'shield', 'potion'];
}

/**
 * Get all tier names in order
 * @returns {string[]}
 */
export function getTierNames() {
  return ['bronze', 'silver', 'gold'];
}

/**
 * Check if equipment is affordable and not owned
 * @param {object} state - game state with session.stars and equipment
 * @param {string} equipmentType - 'sword' | 'shield' | 'potion'
 * @param {string} tier - 'bronze' | 'silver' | 'gold'
 * @returns {{ ok: boolean, error?: string }}
 */
export function canBuy(state, equipmentType, tier) {
  const item = getEquipmentItem(equipmentType, tier);
  if (!item) return { ok: false, error: 'item-not-found' };

  if (state.session.stars < item.cost) return { ok: false, error: 'insufficient-stars' };

  const currentTier = state.equipment[equipmentType];
  if (currentTier === tier) return { ok: false, error: 'already-owned' };

  // Check if already have a better tier
  const tierOrder = getTierNames();
  const currentIdx = tierOrder.indexOf(currentTier);
  const targetIdx = tierOrder.indexOf(tier);
  if (targetIdx <= currentIdx && currentTier !== 'none') {
    return { ok: false, error: 'already-owned' };
  }

  return { ok: true };
}

/**
 * Buy equipment - returns new state or error
 * @param {object} state - game state
 * @param {string} equipmentType - 'sword' | 'shield' | 'potion'
 * @param {string} tier - 'bronze' | 'silver' | 'gold'
 * @returns {{ ok: boolean, error?: string, newState?: object }}
 */
export function buyEquipment(state, equipmentType, tier) {
  const item = getEquipmentItem(equipmentType, tier);
  if (!item) return { ok: false, error: 'item-not-found' };

  if (state.session.stars < item.cost) return { ok: false, error: 'insufficient-stars' };

  const currentTier = state.equipment[equipmentType];
  if (currentTier === tier) return { ok: false, error: 'already-owned' };

  // Check if already have a better tier
  const tierOrder = getTierNames();
  const currentIdx = currentTier === 'none' ? -1 : tierOrder.indexOf(currentTier);
  const targetIdx = tierOrder.indexOf(tier);
  if (targetIdx <= currentIdx) return { ok: false, error: 'already-owned' };

  return {
    ok: true,
    newState: {
      ...state,
      session: {
        ...state.session,
        stars: state.session.stars - item.cost,
      },
      equipment: {
        ...state.equipment,
        [equipmentType]: tier,
      },
    },
  };
}

/**
 * Apply equipment stats to hero at battle start
 * Sword → ATK bonus
 * Shield → DEF bonus
 * @param {object} hero - hero object with base stats
 * @param {object} equipment - { sword, shield, potion } with tier values
 * @returns {object} new hero with equipment bonuses applied
 */
export function applyEquipmentToHero(hero, equipment) {
  let newHero = { ...hero };

  // Sword: base 10 + bonus
  if (equipment.sword && equipment.sword !== 'none') {
    const swordTier = EQUIPMENT.sword.tiers.find((t) => t.tier === equipment.sword);
    if (swordTier && swordTier.atk) {
      newHero = { ...newHero, atk: swordTier.atk };
    }
  }

  // Shield: def bonus only (base def is 0)
  if (equipment.shield && equipment.shield !== 'none') {
    const shieldTier = EQUIPMENT.shield.tiers.find((t) => t.tier === equipment.shield);
    if (shieldTier && shieldTier.def) {
      newHero = { ...newHero, def: shieldTier.def };
    }
  }

  return newHero;
}

/**
 * Get total equipment bonus for display
 * @param {object} equipment - { sword, shield, potion }
 * @returns {{ atk: number, def: number, heal: number }}
 */
export function getEquipmentBonus(equipment) {
  let atk = 0;
  let def = 0;
  let heal = 0;

  if (equipment.sword && equipment.sword !== 'none') {
    const tier = EQUIPMENT.sword.tiers.find((t) => t.tier === equipment.sword);
    if (tier) atk = tier.atk;
  }

  if (equipment.shield && equipment.shield !== 'none') {
    const tier = EQUIPMENT.shield.tiers.find((t) => t.tier === equipment.shield);
    if (tier) def = tier.def;
  }

  if (equipment.potion && equipment.potion !== 'none') {
    const tier = EQUIPMENT.potion.tiers.find((t) => t.tier === equipment.potion);
    if (tier) heal = tier.heal;
  }

  return { atk, def, heal };
}

/**
 * Get default equipment state
 * @returns {{ sword: string, shield: string, potion: string }}
 */
export function getDefaultEquipment() {
  return { sword: 'none', shield: 'none', potion: 'none' };
}

/**
 * Auto-apply bronze tier on first shop visit (free)
 * @param {object} state - game state
 * @returns {object} new state with bronze equipped if none
 */
export function autoEquipBronze(state) {
  let newState = { ...state };
  let changed = false;

  for (const type of getEquipmentTypes()) {
    if (newState.equipment[type] === 'none') {
      newState = {
        ...newState,
        equipment: { ...newState.equipment, [type]: 'bronze' },
      };
      changed = true;
    }
  }

  return changed ? newState : state;
}

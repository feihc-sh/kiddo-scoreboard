/**
 * Fighter V2 Stage Script Table
 * 5 World × 3 Stage = 15 stages total
 * Per spec §4 Stage Script
 */

/** @type {Array<{worldIdx: number, worldName: string, stageIdx: number, id: string, monsters: Array<{type: string, count: number}>, totalMonsters: number, difficulty: string}>} */
export const STAGES = [
  // World 1: 菌绿森林 (Fungus Green Forest)
  {
    worldIdx: 0,
    worldName: '菌绿森林',
    stageIdx: 0,
    id: '1-1',
    monsters: [{ type: 'fungus', count: 3 }],
    totalMonsters: 3,
    difficulty: 1,
  },
  {
    worldIdx: 0,
    worldName: '菌绿森林',
    stageIdx: 1,
    id: '1-2',
    monsters: [{ type: 'fungus', count: 4 }],
    totalMonsters: 4,
    difficulty: 1,
  },
  {
    worldIdx: 0,
    worldName: '菌绿森林',
    stageIdx: 2,
    id: '1-3',
    monsters: [{ type: 'fungus', count: 5 }],
    totalMonsters: 5,
    difficulty: 1,
  },

  // World 2: 多义虫巢穴 (Polysemy Worm Lair)
  {
    worldIdx: 1,
    worldName: '多义虫巢穴',
    stageIdx: 0,
    id: '2-1',
    monsters: [{ type: 'worm', count: 3 }],
    totalMonsters: 3,
    difficulty: 1,
  },
  {
    worldIdx: 1,
    worldName: '多义虫巢穴',
    stageIdx: 1,
    id: '2-2',
    monsters: [{ type: 'worm', count: 4 }],
    totalMonsters: 4,
    difficulty: 1,
  },
  {
    worldIdx: 1,
    worldName: '多义虫巢穴',
    stageIdx: 2,
    id: '2-3',
    monsters: [{ type: 'worm', count: 5 }, { type: 'fungus', count: 2 }],
    totalMonsters: 7,
    difficulty: 2,
  },

  // World 3: 拼写巨龙洞穴 (Spelling Dragon Cave)
  {
    worldIdx: 2,
    worldName: '拼写巨龙洞穴',
    stageIdx: 0,
    id: '3-1',
    monsters: [{ type: 'worm', count: 4 }, { type: 'fungus', count: 2 }],
    totalMonsters: 6,
    difficulty: 2,
  },
  {
    worldIdx: 2,
    worldName: '拼写巨龙洞穴',
    stageIdx: 1,
    id: '3-2',
    monsters: [{ type: 'worm', count: 6 }],
    totalMonsters: 6,
    difficulty: 2,
  },
  {
    worldIdx: 2,
    worldName: '拼写巨龙洞穴',
    stageIdx: 2,
    id: '3-3',
    monsters: [{ type: 'dragon', count: 1 }, { type: 'worm', count: 3 }],
    totalMonsters: 4,
    difficulty: 3,
  },

  // World 4: 法师高塔 (Wizard Tower) - deferred
  {
    worldIdx: 3,
    worldName: '法师高塔',
    stageIdx: 0,
    id: '4-1',
    monsters: [],
    totalMonsters: 0,
    difficulty: 2,
  },
  {
    worldIdx: 3,
    worldName: '法师高塔',
    stageIdx: 1,
    id: '4-2',
    monsters: [],
    totalMonsters: 0,
    difficulty: 2,
  },
  {
    worldIdx: 3,
    worldName: '法师高塔',
    stageIdx: 2,
    id: '4-3',
    monsters: [],
    totalMonsters: 0,
    difficulty: 3,
  },

  // World 5: 终极城堡 (Ultimate Castle) - deferred
  {
    worldIdx: 4,
    worldName: '终极城堡',
    stageIdx: 0,
    id: '5-1',
    monsters: [],
    totalMonsters: 0,
    difficulty: 2,
  },
  {
    worldIdx: 4,
    worldName: '终极城堡',
    stageIdx: 1,
    id: '5-2',
    monsters: [],
    totalMonsters: 0,
    difficulty: 3,
  },
  {
    worldIdx: 4,
    worldName: '终极城堡',
    stageIdx: 2,
    id: '5-3',
    monsters: [],
    totalMonsters: 0,
    difficulty: 3,
  },
];

/**
 * World metadata per spec §4 World Design Table
 * @type {Array<{idx: number, name: string, emoji: string, unlockedBy: number | null, cleared: boolean}>}
 */
export const WORLDS = [
  { idx: 0, name: '菌绿森林', emoji: '🌲', unlockedBy: null },
  { idx: 1, name: '多义虫巢穴', emoji: '🐛', unlockedBy: 0 },
  { idx: 2, name: '拼写巨龙洞穴', emoji: '🐉', unlockedBy: 1 },
  { idx: 3, name: '法师高塔', emoji: '🏰', unlockedBy: 2 },
  { idx: 4, name: '终极城堡', emoji: '🏰', unlockedBy: 3 },
];

/**
 * Monster type definitions
 * @type {Record<string, {name: string, emoji: string, hp: number, atk: number, def: number}>}
 */
export const MONSTER_TYPES = {
  fungus: { name: '懒词菌', emoji: '🍄', hp: 30, atk: 5, def: 0 },
  worm: { name: '多义虫', emoji: '🐛', hp: 50, atk: 8, def: 2 },
  dragon: { name: '拼写巨龙', emoji: '🐲', hp: 100, atk: 20, def: 5 },
};

/**
 * Get stage by worldIdx and stageIdx
 * @param {number} worldIdx
 * @param {number} stageIdx
 * @returns {object | undefined}
 */
export function getStage(worldIdx, stageIdx) {
  return STAGES.find((s) => s.worldIdx === worldIdx && s.stageIdx === stageIdx);
}

/**
 * Get all stages for a specific world
 * @param {number} worldIdx
 * @returns {Array}
 */
export function getWorldStages(worldIdx) {
  return STAGES.filter((s) => s.worldIdx === worldIdx);
}

/**
 * Get world by index
 * @param {number} worldIdx
 * @returns {object | undefined}
 */
export function getWorld(worldIdx) {
  return WORLDS.find((w) => w.idx === worldIdx);
}

/**
 * Check if a world is unlocked
 * @param {number} worldIdx
 * @param {Array<number>} worldsCleared
 * @returns {boolean}
 */
export function isWorldUnlocked(worldIdx, worldsCleared) {
  const world = WORLDS[worldIdx];
  if (worldIdx === 0) return true; // World 1 always unlocked
  if (!world.unlockedBy === null) return false;
  return worldsCleared.includes(world.unlockedBy);
}

// src/games/fighter/state.ts
// Fighter game TypeScript types and initial state.
//
// Stage 1 (Foundation): types + initialState only.
// Stage 2 (Combat Core): combat types extended.
// Stage 3 (HP + Counter-Attack): hero HP, monster variants, counter-attack.

export type ItemType = 'sword' | 'shield' | 'potion';

export interface Item {
  type: ItemType;
  name: string;
  cost: number;
  effect: { atk?: number; def?: number; heal?: number };
}

// ---- Stage 3: Hero with shield bonus ----

export interface Hero {
  hp: number;
  maxHp: number;
  atk: number;
  def: number;  // base defense (shield adds +3)
  equip: [Item | null, Item | null, Item | null];
  shieldBonus: number;  // additional def from shield: -3 damage per hit
  lastHitAt: number;  // timestamp of last damage taken
}

// ---- Stage 3: Monster variants ----

export type MonsterId = 'fungus' | 'worm' | 'dragon';

export interface MonsterVariant {
  id: MonsterId;
  name: string;
  atk: number;
  def: number;
  baseHp: number;
  color: string;  // placeholder bg color (Stage 5 swaps real PNG)
  emoji: string;  // text overlay for placeholder
  counterIntervalMs: number;
}

export const MONSTER_VARIANTS: Record<MonsterId, MonsterVariant> = {
  fungus:  { id: 'fungus',  name: '懒词菌',   atk: 5,  def: 0, baseHp: 30,  color: '#84cc16', emoji: '菌', counterIntervalMs: 3000 },
  worm:    { id: 'worm',    name: '多义虫',   atk: 8,  def: 2, baseHp: 50,  color: '#f97316', emoji: '虫', counterIntervalMs: 2500 },
  dragon:  { id: 'dragon',  name: '拼写巨龙', atk: 20, def: 5, baseHp: 100, color: '#dc2626', emoji: '龙', counterIntervalMs: 2000 },
};

// ---- Stage 3: Damage calculation ----

/**
 * Calculate damage taken by hero from a monster attack.
 *
 * @param monster - The attacking monster
 * @param hero - The hero receiving damage
 * @returns The damage amount hero should take (after shield reduction).
 *          Guaranteed minimum 1 damage.
 *
 * Formula: max(1, monster.atk - hero.shieldBonus)
 */
export function heroTakeDamage(monster: Omit<Monster, 'hp' | 'maxHp'>, hero: Pick<Hero, 'shieldBonus'>): number {
  return Math.max(1, monster.atk - hero.shieldBonus);
}

export interface Monster {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
}

export interface Stage {
  id: number;
  name: string;
  monsters: Omit<Monster, 'hp' | 'maxHp'>[];  // queue of monster TEMPLATES
  reward: number;  // stage-clear star bonus
}

// ---- Stage definitions ----

/** Monster HP formula: small monster = 30 HP, dragon boss = 100 HP */
export function monsterHpFor(template: Omit<Monster, 'hp' | 'maxHp'>): number {
  if (template.id === 'dragon') return 100;
  if (template.id === 'worm') return 50;
  return 30;  // fungus default
}

export const STAGES: Stage[] = [
  { id: 1, name: '新手试炼', monsters: Array(5).fill({ id: 'fungus', name: '懒词菌', atk: 5, def: 0 }), reward: 5 },
  { id: 2, name: '继续前进', monsters: Array(8).fill({ id: 'fungus', name: '懒词菌', atk: 5, def: 0 }), reward: 8 },
  { id: 3, name: '多义虫来袭', monsters: Array(6).fill({ id: 'worm', name: '多义虫', atk: 8, def: 2 }), reward: 10 },
  { id: 4, name: '混编突袭', monsters: [...Array(6).fill({ id: 'fungus', name: '懒词菌', atk: 5, def: 0 }), ...Array(4).fill({ id: 'worm', name: '多义虫', atk: 8, def: 2 })], reward: 12 },
  { id: 5, name: '巨龙巢穴', monsters: [{ id: 'dragon', name: '拼写巨龙', atk: 20, def: 5 }, ...Array(5).fill({ id: 'worm', name: '多义虫', atk: 8, def: 2 })], reward: 20 },
];

export type GameStatus = 'menu' | 'fighting' | 'won' | 'lost' | 'shop';

/** Result of evaluating a stage transition. Tells the UI what to do. */
export interface StageTransition {
  nextStatus: GameStatus;
  nextStageIdx?: number;
  bonus?: number;          // stars awarded on stage clear
  reason: 'cleared' | 'victory' | 'defeat' | 'continue';
}

export interface GameState {
  hero: Hero;
  currentMonster: Monster | null;
  stageIdx: number;
  stageQueueRemaining: number;  // how many monsters left in current stage queue
  stageStartIdx: number;  // index into current stage's monsters queue
  bank: number;
  sessionStars: number;
  status: GameStatus;
  equippedItems: { sword: boolean; shield: boolean; potion: boolean };  // Stage 5: per-run owned items
}

/** Returns the initial GameState for a new fighter game session. */
export function initialState(): GameState {
  return {
    hero: { hp: 100, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: 0 },
    currentMonster: null,
    stageIdx: 0,
    stageQueueRemaining: 0,
    stageStartIdx: 0,
    bank: 0,
    sessionStars: 0,
    status: 'menu',
    equippedItems: { sword: false, shield: false, potion: false },
  };
}

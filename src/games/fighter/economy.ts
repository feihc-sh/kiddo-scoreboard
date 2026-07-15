// src/games/fighter/economy.ts
// Fighter game economy: localStorage bank persistence + quiz integration.
//
// Stage 5 (Shop + Economy): localStorage-backed star bank with graceful SSR guard.
// All functions are pure except commitSessionToBank (documented side effect) and
// saveBank (trivially observable).

import type { GameState } from './state.ts';

// ---- localStorage key ----

const BANK_KEY = 'fighterStarBank';

// ---- Bank persistence ----

/** Load star bank from localStorage. Returns 0 in SSR/non-browser environments. */
export function loadBank(): number {
  const ls = (globalThis as { localStorage?: Storage }).localStorage;
  if (!ls) return 0;
  const raw = ls.getItem(BANK_KEY);
  return raw ? parseInt(raw, 10) || 0 : 0;
}

/** Save star bank to localStorage. No-op in SSR/non-browser environments. */
export function saveBank(bank: number): void {
  const ls = (globalThis as { localStorage?: Storage }).localStorage;
  if (!ls) return;
  ls.setItem(BANK_KEY, String(bank));
}

/**
 * Commit sessionStars to the persistent bank.
 *
 * Side effect: calls saveBank() with the new bank total.
 *
 * @param state  Current game state
 * @returns New state with bank += sessionStars, sessionStars = 0
 */
export function commitSessionToBank(state: GameState): GameState {
  const newBank = state.bank + state.sessionStars;
  saveBank(newBank);
  return {
    ...state,
    bank: newBank,
    sessionStars: 0,
  };
}

// ---- Quiz integration (out-of-band) ----

type GlobalWithDispatch = typeof globalThis & {
  dispatchEvent: (event: Event) => boolean;
};

/**
 * Called by quiz module on correct answer.
 * Dispatches a browser CustomEvent for fighter.js to pick up.
 *
 * @param difficulty  'easy' = 1 star, 'hard' = 2 stars
 * @returns The number of stars awarded
 */
export function onQuizCorrect(difficulty: 'easy' | 'hard'): { stars: number } {
  const stars = difficulty === 'hard' ? 2 : 1;
  const global = globalThis as GlobalWithDispatch;
  if (typeof global.dispatchEvent === 'function') {
    global.dispatchEvent(new CustomEvent('fighter:add-stars', { detail: { stars } }));
  }
  return { stars };
}

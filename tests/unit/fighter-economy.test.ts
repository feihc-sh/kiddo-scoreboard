// tests/unit/fighter-economy.test.ts
//
// TDD unit tests for src/games/fighter/economy.ts localStorage bank persistence.
// RED: write tests first, confirm they fail, then implement GREEN.
//
// Uses LocalStorageMock for vitest node environment.

import { describe, it, expect, beforeEach } from 'vitest';

// ---- Node environment mocks (must be set before importing economy.ts) ----

class LocalStorageMock {
  private store: Record<string, string> = {};
  getItem(key: string): string | null { return this.store[key] ?? null; }
  setItem(key: string, value: string): void { this.store[key] = value; }
  removeItem(key: string): void { delete this.store[key]; }
  clear(): void { this.store = {}; }
  key(index: number): string | null { return Object.keys(this.store)[index] ?? null; }
  get length(): number { return Object.keys(this.store).length; }
}

const mockStorage = new LocalStorageMock();

// Mock window for node environment (vitest uses node env, no window by default)
// Must be defined BEFORE importing economy.ts
const eventHandlers: Map<string, Set<(e: Event) => void>> = new Map();

// Polyfill CustomEvent for Node environment (required by onQuizCorrect)
(globalThis as Record<string, unknown>).CustomEvent = class CustomEvent extends Event {
  constructor(type: string, options?: { detail?: unknown }) {
    super(type);
    this.detail = options?.detail;
  }
  declare detail: unknown;
};

(globalThis as Record<string, unknown>).window = {
  localStorage: mockStorage,
  dispatchEvent: (e: Event) => {
    const handlers = eventHandlers.get(e.type);
    if (handlers) handlers.forEach(h => h(e));
    return true;
  },
  addEventListener: (type: string, handler: (e: Event) => void) => {
    if (!eventHandlers.has(type)) eventHandlers.set(type, new Set());
    eventHandlers.get(type)!.add(handler);
  },
  removeEventListener: (type: string, handler: (e: Event) => void) => {
    eventHandlers.get(type)?.delete(handler);
  },
};
// Also set dispatchEvent on globalThis so economy.ts can find it (uses globalThis, not window)
(globalThis as Record<string, unknown>).dispatchEvent = (e: Event) => {
  const handlers = eventHandlers.get(e.type);
  if (handlers) handlers.forEach(h => h(e));
  return true;
};
(globalThis as Record<string, unknown>).localStorage = mockStorage;

// ---- Import economy functions ----
import { loadBank, saveBank, commitSessionToBank, onQuizCorrect } from '../../src/games/fighter/economy.ts';
import type { GameState } from '../../src/games/fighter/state.ts';

// Helper to build a GameState with equippedItems
function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    hero: { hp: 100, maxHp: 100, atk: 10, def: 0, equip: [null, null, null], shieldBonus: 0, lastHitAt: 0 },
    currentMonster: null,
    stageIdx: 0,
    stageQueueRemaining: 0,
    stageStartIdx: 0,
    bank: 0,
    sessionStars: 0,
    status: 'fighting',
    equippedItems: { sword: false, shield: false, potion: false },
    ...overrides,
  };
}

beforeEach(() => {
  mockStorage.clear();
  eventHandlers.clear();
});

describe('loadBank', () => {

  it('returns 0 when localStorage empty', () => {
    expect(loadBank()).toBe(0);
  });

  it('returns parsed number from localStorage', () => {
    mockStorage.setItem('fighterStarBank', '42');
    expect(loadBank()).toBe(42);
  });

  it('returns 0 for non-numeric value in localStorage', () => {
    mockStorage.setItem('fighterStarBank', 'abc');
    expect(loadBank()).toBe(0);
  });

  it('returns 0 for empty string in localStorage', () => {
    mockStorage.setItem('fighterStarBank', '');
    expect(loadBank()).toBe(0);
  });

});

describe('saveBank', () => {

  it('writes to localStorage with BANK_KEY', () => {
    saveBank(99);
    expect(mockStorage.getItem('fighterStarBank')).toBe('99');
  });

  it('writes stringified number to localStorage', () => {
    saveBank(0);
    expect(mockStorage.getItem('fighterStarBank')).toBe('0');
  });

  it('overwrites previous value', () => {
    saveBank(10);
    saveBank(20);
    expect(mockStorage.getItem('fighterStarBank')).toBe('20');
  });

});

describe('commitSessionToBank', () => {

  it('adds sessionStars to bank', () => {
    const state = makeState({ bank: 5, sessionStars: 10 });
    const next = commitSessionToBank(state);
    expect(next.bank).toBe(15);
  });

  it('resets sessionStars to 0', () => {
    const state = makeState({ bank: 5, sessionStars: 10 });
    const next = commitSessionToBank(state);
    expect(next.sessionStars).toBe(0);
  });

  it('calls saveBank with new bank value', () => {
    const state = makeState({ bank: 5, sessionStars: 10 });
    commitSessionToBank(state);
    expect(mockStorage.getItem('fighterStarBank')).toBe('15');
  });

  it('handles zero sessionStars (no-op for bank)', () => {
    const state = makeState({ bank: 7, sessionStars: 0 });
    const next = commitSessionToBank(state);
    expect(next.bank).toBe(7);
    expect(next.sessionStars).toBe(0);
    expect(mockStorage.getItem('fighterStarBank')).toBe('7');
  });

  it('is pure: does not mutate input state', () => {
    const state = makeState({ bank: 5, sessionStars: 10 });
    const next = commitSessionToBank(state);
    expect(state.bank).toBe(5);
    expect(state.sessionStars).toBe(10);
    expect(next).not.toBe(state);
  });

});

describe('onQuizCorrect', () => {

  it('returns 1 star for easy', () => {
    const result = onQuizCorrect('easy');
    expect(result.stars).toBe(1);
  });

  it('returns 2 stars for hard', () => {
    const result = onQuizCorrect('hard');
    expect(result.stars).toBe(2);
  });

  it('dispatches fighter:add-stars event with correct detail', () => {
    const received: Event[] = [];
    const win = (globalThis as Record<string, unknown>).window as { addEventListener: (type: string, h: (e: Event) => void) => void; removeEventListener: (type: string, h: (e: Event) => void) => void };
    const handler = (e: Event) => { received.push(e); };
    win.addEventListener('fighter:add-stars', handler);
    try {
      onQuizCorrect('easy');
      expect(received.length).toBe(1);
      expect((received[0] as CustomEvent).detail).toEqual({ stars: 1 });
    } finally {
      win.removeEventListener('fighter:add-stars', handler);
    }
  });

  it('dispatches fighter:add-stars event for hard with 2 stars', () => {
    const received: Event[] = [];
    const win = (globalThis as Record<string, unknown>).window as { addEventListener: (type: string, h: (e: Event) => void) => void; removeEventListener: (type: string, h: (e: Event) => void) => void };
    const handler = (e: Event) => { received.push(e); };
    win.addEventListener('fighter:add-stars', handler);
    try {
      onQuizCorrect('hard');
      expect(received.length).toBe(1);
      expect((received[0] as CustomEvent).detail).toEqual({ stars: 2 });
    } finally {
      win.removeEventListener('fighter:add-stars', handler);
    }
  });

});

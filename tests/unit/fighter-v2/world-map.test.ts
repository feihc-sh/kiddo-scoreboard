// tests/unit/fighter-v2/world-map.test.ts
//
// Unit tests for Fighter V2 world-map.js - 5-node path map
// Pure unit tests - testing isWorldUnlocked, getCurrentWorldIdx, allWorldsCleared functions
// DOM rendering tests are in e2e/world-map.spec.ts

import { describe, it, expect } from 'vitest';
import {
  isWorldUnlocked,
  getCurrentWorldIdx,
  allWorldsCleared,
} from '../../../public/fighter/v2/world-map.js';
import { WORLDS } from '../../../public/fighter/v2/stages.js';

describe('isWorldUnlocked', () => {
  it('World 1 (idx 0) is always unlocked', () => {
    expect(isWorldUnlocked(0, [])).toBe(true);
    expect(isWorldUnlocked(0, [0])).toBe(true);
    expect(isWorldUnlocked(0, [0, 1, 2])).toBe(true);
  });

  it('World 2 (idx 1) requires World 1 cleared', () => {
    expect(isWorldUnlocked(1, [])).toBe(false);
    expect(isWorldUnlocked(1, [0])).toBe(true);
    expect(isWorldUnlocked(1, [0, 1])).toBe(true);
  });

  it('World 3 (idx 2) requires World 2 cleared', () => {
    expect(isWorldUnlocked(2, [])).toBe(false);
    expect(isWorldUnlocked(2, [0])).toBe(false);
    expect(isWorldUnlocked(2, [0, 1])).toBe(true);
  });

  it('World 4 (idx 3) requires World 3 cleared', () => {
    expect(isWorldUnlocked(3, [])).toBe(false);
    expect(isWorldUnlocked(3, [0, 1])).toBe(false);
    expect(isWorldUnlocked(3, [0, 1, 2])).toBe(true);
  });

  it('World 5 (idx 4) requires World 4 cleared', () => {
    expect(isWorldUnlocked(4, [])).toBe(false);
    expect(isWorldUnlocked(4, [0, 1, 2])).toBe(false);
    expect(isWorldUnlocked(4, [0, 1, 2, 3])).toBe(true);
  });
});

describe('getCurrentWorldIdx', () => {
  // Note: This function is used for calculating "next" current world
  // The actual "current" world is determined by session.worldIdx
  // This function helps calculate what the next current world would be

  it('returns 0 when no worlds cleared', () => {
    expect(getCurrentWorldIdx([])).toBe(0);
  });

  it('returns 1 when World 1 cleared', () => {
    expect(getCurrentWorldIdx([0])).toBe(1);
  });

  it('returns 2 when Worlds 1-2 cleared', () => {
    expect(getCurrentWorldIdx([0, 1])).toBe(2);
  });

  it('returns -1 when all worlds cleared', () => {
    expect(getCurrentWorldIdx([0, 1, 2, 3, 4])).toBe(-1);
  });
});

describe('allWorldsCleared', () => {
  it('returns false when no worlds cleared', () => {
    expect(allWorldsCleared([])).toBe(false);
  });

  it('returns false when only some worlds cleared', () => {
    expect(allWorldsCleared([0])).toBe(false);
    expect(allWorldsCleared([0, 1])).toBe(false);
    expect(allWorldsCleared([0, 1, 2])).toBe(false);
    expect(allWorldsCleared([0, 1, 2, 3])).toBe(false);
  });

  it('returns true when all 5 worlds cleared', () => {
    expect(allWorldsCleared([0, 1, 2, 3, 4])).toBe(true);
  });
});

describe('WORLDS consistency', () => {
  it('WORLDS has exactly 5 entries', () => {
    expect(WORLDS).toHaveLength(5);
  });

  it('each world has correct unlock dependency', () => {
    // World 0: no unlock needed
    expect(WORLDS[0].unlockedBy).toBeNull();
    // World 1-4: each needs previous world cleared
    for (let i = 1; i < 5; i++) {
      expect(WORLDS[i].unlockedBy).toBe(i - 1);
    }
  });
});

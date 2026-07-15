// tests/unit/fighter-v2/stage-intro.test.ts
//
// Unit tests for Fighter V2 stage-intro.js - stage roster + start button
// Pure unit tests - testing helper functions
// DOM rendering tests are in e2e/world-map.spec.ts

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildMonsterDescription,
  isStageCleared,
  startCombat,
} from '../../../public/fighter/v2/stage-intro.js';
import { STAGES } from '../../../public/fighter/v2/stages.js';

// Mock alert for startCombat tests
const originalAlert = globalThis.alert;
beforeEach(() => {
  globalThis.alert = vi.fn();
});
afterEach(() => {
  globalThis.alert = originalAlert;
});

describe('buildMonsterDescription', () => {
  it('returns "即将开放..." for empty monsters', () => {
    const result = buildMonsterDescription({ monsters: [] });
    expect(result).toBe('即将开放...');
  });

  it('returns "即将开放..." for undefined monsters', () => {
    const result = buildMonsterDescription({ monsters: undefined });
    expect(result).toBe('即将开放...');
  });

  it('formats single monster type correctly', () => {
    const stage = STAGES.find((s) => s.id === '1-1')!;
    const result = buildMonsterDescription(stage);
    expect(result).toContain('懒词菌');
    expect(result).toContain('×3');
  });

  it('formats multiple monster types with + separator', () => {
    const stage = STAGES.find((s) => s.id === '2-3')!;
    const result = buildMonsterDescription(stage);
    expect(result).toContain('多义虫');
    expect(result).toContain('懒词菌');
    expect(result).toContain('+');
  });

  it('returns correct description for boss stage 3-3', () => {
    const stage = STAGES.find((s) => s.id === '3-3')!;
    const result = buildMonsterDescription(stage);
    expect(result).toContain('拼写巨龙');
    expect(result).toContain('×1');
    expect(result).toContain('多义虫');
    expect(result).toContain('×3');
  });

  it('describes stage 1-2 correctly', () => {
    const stage = STAGES.find((s) => s.id === '1-2')!;
    const result = buildMonsterDescription(stage);
    expect(result).toBe('懒词菌 ×4');
  });

  it('describes stage 2-1 correctly', () => {
    const stage = STAGES.find((s) => s.id === '2-1')!;
    const result = buildMonsterDescription(stage);
    expect(result).toBe('多义虫 ×3');
  });

  it('describes stage 3-1 correctly', () => {
    const stage = STAGES.find((s) => s.id === '3-1')!;
    const result = buildMonsterDescription(stage);
    expect(result).toContain('多义虫 ×4');
    expect(result).toContain('懒词菌 ×2');
  });
});

describe('isStageCleared', () => {
  it('returns true if world is cleared', () => {
    expect(isStageCleared(0, 0, [0])).toBe(true);
    expect(isStageCleared(1, 2, [0, 1])).toBe(true);
    expect(isStageCleared(2, 0, [0, 1, 2])).toBe(true);
  });

  it('returns false if world is not cleared', () => {
    expect(isStageCleared(0, 0, [])).toBe(false);
    expect(isStageCleared(1, 0, [0])).toBe(false);
    expect(isStageCleared(2, 0, [0, 1])).toBe(false);
  });

  it('returns false if worldsCleared is undefined', () => {
    expect(isStageCleared(0, 0, undefined as unknown as [])).toBe(false);
  });
});

describe('startCombat', () => {
  it('shows alert with stage info', () => {
    startCombat(0, 0);
    expect(globalThis.alert).toHaveBeenCalled();
    const alertText = (globalThis.alert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(alertText).toContain('P3');
    expect(alertText).toContain('1-1');
  });

  it('shows alert with correct stage number formatting', () => {
    startCombat(2, 2);
    const alertText = (globalThis.alert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(alertText).toContain('3-3');
  });

  it('shows alert mentioning combat preparation', () => {
    startCombat(1, 1);
    const alertText = (globalThis.alert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(alertText).toContain('准备进入');
    expect(alertText).toContain('2-2');
  });
});

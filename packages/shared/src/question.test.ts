/**
 * question.test.ts — TDD RED phase: 5 test cases for question domain
 *
 * @see question.ts
 */
import { describe, expect, it } from 'vitest';
import {
  isCorrect,
  isValidOption,
  parseOptionsJson,
  serializeOptionsJson,
} from './question.js';

describe('isCorrect', () => {
  it('returns true when selectedIndex matches answerIndex', () => {
    const question = {
      id: 1,
      stem: 'apple',
      options: [
        { text: '苹果' },
        { text: '香蕉' },
        { text: '橘子' },
        { text: '葡萄' },
      ],
      answerIndex: 0,
      difficulty: 'easy' as const,
      ecdictRef: null,
      created_at: 1000,
    };
    expect(isCorrect(question, 0)).toBe(true);
  });

  it('returns false when selectedIndex does not match answerIndex', () => {
    const question = {
      id: 2,
      stem: 'banana',
      options: [
        { text: '苹果' },
        { text: '香蕉' },
        { text: '橘子' },
        { text: '葡萄' },
      ],
      answerIndex: 1,
      difficulty: 'medium' as const,
      ecdictRef: null,
      created_at: 1000,
    };
    expect(isCorrect(question, 0)).toBe(false);
    expect(isCorrect(question, 3)).toBe(false);
  });

  it('returns false when user retries with wrong answer', () => {
    const question = {
      id: 3,
      stem: 'orange',
      options: [
        { text: '苹果' },
        { text: '香蕉' },
        { text: '橘子' },
        { text: '葡萄' },
      ],
      answerIndex: 2,
      difficulty: 'hard' as const,
      ecdictRef: null,
      created_at: 1000,
    };
    // First attempt: wrong
    expect(isCorrect(question, 0)).toBe(false);
    // Second attempt: still wrong
    expect(isCorrect(question, 1)).toBe(false);
  });

  it('boundary: answerIndex 3 (last option)', () => {
    const question = {
      id: 4,
      stem: 'grape',
      options: [
        { text: '苹果' },
        { text: '香蕉' },
        { text: '橘子' },
        { text: '葡萄' },
      ],
      answerIndex: 3,
      difficulty: 'hard' as const,
      ecdictRef: null,
      created_at: 1000,
    };
    expect(isCorrect(question, 3)).toBe(true);
    expect(isCorrect(question, 2)).toBe(false);
  });

  it('JSON serialization roundtrip: parse → serialize → parse', () => {
    const json = '[{"text":"苹果"},{"text":"香蕉"},{"text":"橘子"},{"text":"葡萄"}]';
    const options = parseOptionsJson(json);
    const serialized = serializeOptionsJson(options);
    expect(JSON.parse(serialized)).toEqual(JSON.parse(json));
  });
});

describe('parseOptionsJson', () => {
  it('parses valid 4-option JSON', () => {
    const json = '[{"text":"苹果"},{"text":"香蕉"},{"text":"橘子"},{"text":"葡萄"}]';
    const options = parseOptionsJson(json);
    expect(options).toHaveLength(4);
    expect(options[0]).toEqual({ text: '苹果' });
    expect(options[2]).toEqual({ text: '橘子' });
  });

  it('throws for non-array JSON', () => {
    expect(() => parseOptionsJson('{}')).toThrow();
    expect(() => parseOptionsJson('"hello"')).toThrow();
  });

  it('throws for array with wrong length', () => {
    expect(() => parseOptionsJson('[{"text":"A"},{"text":"B"}]')).toThrow();
    expect(() => parseOptionsJson('[{"text":"A"},{"text":"B"},{"text":"C"}]')).toThrow();
  });
});

describe('isValidOption', () => {
  it('returns true for valid indices 0-3', () => {
    expect(isValidOption(0)).toBe(true);
    expect(isValidOption(1)).toBe(true);
    expect(isValidOption(2)).toBe(true);
    expect(isValidOption(3)).toBe(true);
  });

  it('returns false for invalid indices', () => {
    expect(isValidOption(-1)).toBe(false);
    expect(isValidOption(4)).toBe(false);
    expect(isValidOption(100)).toBe(false);
  });

  it('returns false for non-integers', () => {
    expect(isValidOption(1.5)).toBe(false);
    expect(isValidOption(NaN)).toBe(false);
    expect(isValidOption(Infinity)).toBe(false);
  });
});

describe('serializeOptionsJson', () => {
  it('serializes 4 options to valid JSON', () => {
    const options = [
      { text: '红' },
      { text: '蓝' },
      { text: '绿' },
      { text: '黄' },
    ];
    const json = serializeOptionsJson(options);
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(4);
    expect(parsed[3]).toEqual({ text: '黄' });
  });

  it('throws for wrong number of options', () => {
    expect(() =>
      serializeOptionsJson([{ text: 'A' }, { text: 'B' }])
    ).toThrow();
  });
});

// tests/unit/week.test.ts
// Tests for src/utils/week.ts — no D1 dependency, pure functions.
import { describe, it, expect } from 'vitest';
import {
  shanghaiDateString,
  todayShanghai,
  isoWeekString,
  currentWeek,
  shanghaiDateToUnix,
  shanghaiWeekRange,
  nowUnix,
} from '../../src/utils/week.ts';

describe('shanghaiDateString', () => {
  it('formats Shanghai date for an instant well inside a day', () => {
    // 2026-06-04 10:00 UTC == 2026-06-04 18:00 Shanghai
    const instant = Date.UTC(2026, 5, 4, 10, 0, 0);  // June is month 5 (0-indexed)
    expect(shanghaiDateString(instant)).toBe('2026-06-04');
  });

  it('rolls to next day for late UTC instants past 16:00 (Shanghai midnight crossing)', () => {
    // 2026-06-04 17:00 UTC == 2026-06-05 01:00 Shanghai
    const instant = Date.UTC(2026, 5, 4, 17, 0, 0);
    expect(shanghaiDateString(instant)).toBe('2026-06-05');
  });

  it('keeps previous day for early UTC instants before 16:00', () => {
    // 2026-06-04 15:59 UTC == 2026-06-04 23:59 Shanghai
    const instant = Date.UTC(2026, 5, 4, 15, 59, 0);
    expect(shanghaiDateString(instant)).toBe('2026-06-04');
  });

  it('handles month boundary correctly', () => {
    // 2026-06-30 17:00 UTC == 2026-07-01 01:00 Shanghai
    const instant = Date.UTC(2026, 5, 30, 17, 0, 0);
    expect(shanghaiDateString(instant)).toBe('2026-07-01');
  });

  it('handles year boundary correctly', () => {
    // 2026-12-31 17:00 UTC == 2027-01-01 01:00 Shanghai
    const instant = Date.UTC(2026, 11, 31, 17, 0, 0);
    expect(shanghaiDateString(instant)).toBe('2027-01-01');
  });

  it('pads single-digit month and day with zero', () => {
    // 2026-01-05 12:00 UTC == 2026-01-05 20:00 Shanghai
    const instant = Date.UTC(2026, 0, 5, 12, 0, 0);
    expect(shanghaiDateString(instant)).toBe('2026-01-05');
  });

  it('accepts a Date object', () => {
    const d = new Date(Date.UTC(2026, 5, 4, 10, 0, 0));
    expect(shanghaiDateString(d)).toBe('2026-06-04');
  });

  it('accepts a Unix-seconds number (converted to ms internally)', () => {
    // shanghaiDateString now expects MILLISECONDS; old call style was input as seconds
    // (kept here for back-compat documentation — pass ms directly in new code)
    const ms = Date.UTC(2026, 5, 4, 10, 0, 0);
    expect(shanghaiDateString(ms)).toBe('2026-06-04');
  });
});

describe('todayShanghai', () => {
  it('returns YYYY-MM-DD format', () => {
    expect(todayShanghai()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('is the same as shanghaiDateString(now)', () => {
    expect(todayShanghai()).toBe(shanghaiDateString(Date.now()));
  });
});

describe('isoWeekString', () => {
  it('returns YYYY-Www format with zero-padded week', () => {
    expect(isoWeekString()).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('2026-06-04 is in week 23 (Thursday)', () => {
    // 2026-06-04 12:00 UTC == 2026-06-04 20:00 Shanghai (Thursday)
    const instant = Date.UTC(2026, 5, 4, 12, 0, 0);
    expect(isoWeekString(instant)).toBe('2026-W23');
  });

  it('2025-12-31 (Wed) is in week 01 of 2026 (next year)', () => {
    // 2025-12-31 12:00 UTC == 2025-12-31 20:00 Shanghai
    // ISO: week containing the year's first Thursday. 2026-01-01 is Thursday.
    const instant = Date.UTC(2025, 11, 31, 12, 0, 0);
    expect(isoWeekString(instant)).toBe('2026-W01');
  });

  it('2024-12-30 (Mon) is in week 01 of 2025', () => {
    // 2024-12-30 12:00 UTC == 2024-12-30 20:00 Shanghai (Monday)
    // 2025-01-02 is Thursday, so 2024-12-30 (Mon) is in 2025-W01
    const instant = Date.UTC(2024, 11, 30, 12, 0, 0);
    expect(isoWeekString(instant)).toBe('2025-W01');
  });

  it('2024-12-29 (Sun) is still in 2024-W52', () => {
    // 2024-12-29 12:00 UTC == 2024-12-29 20:00 Shanghai (Sunday)
    const instant = Date.UTC(2024, 11, 29, 12, 0, 0);
    expect(isoWeekString(instant)).toBe('2024-W52');
  });
});

describe('shanghaiDateToUnix', () => {
  it('round-trips with shanghaiDateString', () => {
    // 2026-06-04 in Shanghai. Pick a known UTC instant that maps to it.
    const instant = Date.UTC(2026, 5, 4, 12, 0, 0);
    const dateStr = shanghaiDateString(instant);  // '2026-06-04'
    const unix = shanghaiDateToUnix(dateStr);
    // Convert back: that Unix instant at 00:00 Shanghai = 16:00 UTC previous day
    // shanghaiDateString expects MILLISECONDS, unix is in SECONDS
    const back = shanghaiDateString(unix * 1000);
    expect(back).toBe('2026-06-04');
  });

  it('returns Shanghai midnight as Unix seconds', () => {
    // 2026-06-04 00:00 Shanghai == 2026-06-03 16:00 UTC
    const expected = Math.floor(Date.UTC(2026, 5, 3, 16, 0, 0) / 1000);
    expect(shanghaiDateToUnix('2026-06-04')).toBe(expected);
  });

  it('throws on invalid date format', () => {
    expect(() => shanghaiDateToUnix('2026/06/04')).toThrow();
    expect(() => shanghaiDateToUnix('not-a-date')).toThrow();
    expect(() => shanghaiDateToUnix('2026-6-4')).toThrow();
  });
});

describe('shanghaiWeekRange', () => {
  it('returns a 7-day range starting on Monday Shanghai', () => {
    // 2026-06-04 is Thursday. Monday of that week is 2026-06-01.
    const instant = Date.UTC(2026, 5, 4, 12, 0, 0);
    const [start, end] = shanghaiWeekRange(instant);
    // shanghaiWeekRange returns Unix SECONDS; shanghaiDateString expects MILLISECONDS
    expect(shanghaiDateString(start * 1000)).toBe('2026-06-01');
    expect(shanghaiDateString(end * 1000)).toBe('2026-06-08');
    expect(end - start).toBe(7 * 86400);
  });

  it('handles week starting on Sunday → returns next Monday', () => {
    // 2026-06-07 is Sunday. Monday of that week is 2026-06-01 (week starts Mon)
    const instant = Date.UTC(2026, 5, 7, 12, 0, 0);
    const [start] = shanghaiWeekRange(instant);
    expect(shanghaiDateString(start * 1000)).toBe('2026-06-01');
  });

  it('handles week starting on Monday', () => {
    // 2026-06-01 is Monday. Range is [2026-06-01, 2026-06-08)
    const instant = Date.UTC(2026, 5, 1, 12, 0, 0);
    const [start, end] = shanghaiWeekRange(instant);
    expect(shanghaiDateString(start * 1000)).toBe('2026-06-01');
    expect(shanghaiDateString(end * 1000)).toBe('2026-06-08');
  });
});

describe('nowUnix', () => {
  it('returns a Unix-seconds integer close to Date.now()/1000', () => {
    const before = Math.floor(Date.now() / 1000);
    const result = nowUnix();
    const after = Math.floor(Date.now() / 1000);
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });
});

describe('currentWeek', () => {
  it('equals isoWeekString(Date.now())', () => {
    expect(currentWeek()).toBe(isoWeekString(Date.now()));
  });
});

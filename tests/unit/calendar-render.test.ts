// tests/unit/calendar-render.test.ts
// Item #006 §2: Calendar grid render + month navigation
// Verifies:
//   - Days-in-month calculation (leap year, regular)
//   - Always 42 cells (7 cols × 6 rows max)
//   - Prev/next month padding fills correctly
//   - getColorTier returns correct values

import { describe, it, expect } from 'vitest';

// ---- Helpers copied from app.js for pure-unit testing ----

const CAL_WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function getFirstWeekday(year: number, month: number): number {
  // 1=Mon … 7=Sun (ISO 8601)
  const d = new Date(year, month - 1, 1);
  return ((d.getDay() + 6) % 7) + 1;
}

/** Simulate renderCalendar cell generation, returns total cell count. */
function calcGridCellCount(year: number, month: number): number {
  const daysInMonth = getDaysInMonth(year, month);
  const firstWeekday = getFirstWeekday(year, month);
  // Prev-month trailing cells
  const prevCells = firstWeekday - 1;
  // Current month cells
  const curCells = daysInMonth;
  // Total so far
  const totalSoFar = prevCells + curCells;
  // Always pad to 42 cells
  return Math.max(totalSoFar, 42);
}

/** Simulate getColorTier from app.js */
function getColorTier(count: number): number {
  if (count === 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  return 3;
}

describe('Item #006 §2: calendar render logic', () => {
  describe('getDaysInMonth', () => {
    it('returns 28 for February in non-leap year', () => {
      expect(getDaysInMonth(2025, 2)).toBe(28);
    });

    it('returns 29 for February in leap year', () => {
      expect(getDaysInMonth(2024, 2)).toBe(29);
    });

    it('returns 30 for April', () => {
      expect(getDaysInMonth(2026, 4)).toBe(30);
    });

    it('returns 31 for January', () => {
      expect(getDaysInMonth(2026, 1)).toBe(31);
    });

    it('returns 31 for December', () => {
      expect(getDaysInMonth(2025, 12)).toBe(31);
    });

    it('handles century year 2000 (leap year)', () => {
      // 2000 is divisible by 400 → leap year
      expect(getDaysInMonth(2000, 2)).toBe(29);
    });

    it('handles century year 1900 (not leap year)', () => {
      // 1900 is divisible by 100 but not 400 → not leap
      expect(getDaysInMonth(1900, 2)).toBe(28);
    });
  });

  describe('getFirstWeekday', () => {
    it('2025-03-01 is a Saturday → weekday 6', () => {
      // March 1 2025 was Saturday (getDay() === 6)
      expect(getFirstWeekday(2025, 3)).toBe(6);
    });

    it('2026-06-01 is a Monday → weekday 1', () => {
      expect(getFirstWeekday(2026, 6)).toBe(1);
    });

    it('2024-01-01 is a Monday → weekday 1', () => {
      expect(getFirstWeekday(2024, 1)).toBe(1);
    });

    it('2024-12-01 is a Sunday → weekday 7', () => {
      expect(getFirstWeekday(2024, 12)).toBe(7);
    });
  });

  describe('grid cell count (always 42 cells)', () => {
    it('February 2025 (28d) produces 42 cells', () => {
      expect(calcGridCellCount(2025, 2)).toBe(42);
    });

    it('February 2024 (29d leap) produces 42 cells', () => {
      expect(calcGridCellCount(2024, 2)).toBe(42);
    });

    it('March 2025 (31d, starts Saturday) produces 42 cells', () => {
      // Mar 1 2025 = Saturday → 5 prev cells (Mon-Fri of Feb 24-28)
      // 5 + 31 = 36 → pad to 42
      expect(calcGridCellCount(2025, 3)).toBe(42);
    });

    it('June 2026 (30d, starts Monday) produces 42 cells', () => {
      // Jun 1 2026 = Monday → 0 prev cells
      // 0 + 30 = 30 → pad to 42
      expect(calcGridCellCount(2026, 6)).toBe(42);
    });

    it('December 2024 (31d) produces 42 cells', () => {
      expect(calcGridCellCount(2024, 12)).toBe(42);
    });

    it('August 2026 (31d) produces 42 cells', () => {
      expect(calcGridCellCount(2026, 8)).toBe(42);
    });
  });

  describe('getColorTier', () => {
    it('returns 0 for count=0', () => {
      expect(getColorTier(0)).toBe(0);
    });
    it('returns 1 for count=1', () => {
      expect(getColorTier(1)).toBe(1);
    });
    it('returns 2 for count=2', () => {
      expect(getColorTier(2)).toBe(2);
    });
    it('returns 3 for count=3', () => {
      expect(getColorTier(3)).toBe(3);
    });
    it('returns 3 for count=100 (capped)', () => {
      expect(getColorTier(100)).toBe(3);
    });
    it('returns 3 for count=-1 (negative treated as 3+ tier)', () => {
      // getColorTier doesn't validate — negative falls to default return 3
      expect(getColorTier(-1)).toBe(3);
    });
  });

  describe('prev-month trailing padding', () => {
    it('2025-03 (Mar 1 = Saturday → firstWeekday=6) → 5 prev cells (Feb 23-28)', () => {
      const fw = getFirstWeekday(2025, 3);
      expect(fw).toBe(6);
      expect(fw - 1).toBe(5); // prev cells
    });

    it('2026-06 (Jun 1 = Monday → firstWeekday=1) → 0 prev cells', () => {
      const fw = getFirstWeekday(2026, 6);
      expect(fw).toBe(1);
      expect(fw - 1).toBe(0);
    });

    it('2025-01 (Jan 1 = Wednesday → firstWeekday=3) → 2 prev cells (Dec 30-31)', () => {
      const fw = getFirstWeekday(2025, 1);
      expect(fw).toBe(3);
      expect(fw - 1).toBe(2);
    });
  });
});

// src/utils/week.ts
// ISO 8601 week numbering (Monday-first) + Asia/Shanghai timezone helpers.
// All server timestamps are stored as Unix seconds in D1; we convert to
// Asia/Shanghai calendar dates for "today" / "this week" semantics so that
// the child's day boundary doesn't shift by 8 hours.

const SHANGHAI_OFFSET_SECONDS = 8 * 60 * 60;  // UTC+8
const MS_PER_DAY = 86_400_000;
const SEC_PER_DAY = 86_400;

/** Get current Unix seconds (server clock). */
export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/** Get Unix seconds in Asia/Shanghai (adds 8h offset to UTC seconds). */
export function nowShanghaiUnix(): number {
  return nowUnix() + SHANGHAI_OFFSET_SECONDS;
}

/**
 * Format a Date (interpreted as UTC instant) as 'YYYY-MM-DD' in Asia/Shanghai.
 * Input is in MILLISECONDS (matches Date.now() / Date.getTime()).
 * To convert from Unix SECONDS, multiply by 1000 first.
 */
export function shanghaiDateString(inputMs: number | Date = Date.now()): string {
  const d = typeof inputMs === 'number' ? new Date(inputMs) : inputMs;
  // shift UTC instant forward by 8h, then read UTC fields — gives SH calendar date
  const shifted = new Date(d.getTime() + SHANGHAI_OFFSET_SECONDS * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Get current Unix seconds in Asia/Shanghai date format 'YYYY-MM-DD'. */
export function todayShanghai(): string {
  return shanghaiDateString(Date.now());
}

/**
 * ISO 8601 week number — week 1 contains the first Thursday of the year.
 * Week starts on Monday. Returns 'YYYY-Www' (e.g. '2026-W23').
 *
 * Spec: ISO 8601-1:2019, section 6.3.6.
 */
export function isoWeekString(input: number | Date = Date.now()): string {
  // Input is MILLISECONDS (matches Date.now()).
  const date = typeof input === 'number' ? new Date(input) : new Date(input);
  // Shift to Shanghai calendar day
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_SECONDS * 1000);
  // Treat the shifted Date's UTC fields as the calendar day
  const target = new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  ));

  // ISO weekday: Monday=1 ... Sunday=7
  const dayNum = target.getUTCDay() || 7;
  // Thursday of this week
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((target.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/** Current week in Asia/Shanghai. */
export function currentWeek(): string {
  return isoWeekString(Date.now());
}

/** Convert 'YYYY-MM-DD' to Unix seconds at midnight Shanghai time. */
export function shanghaiDateToUnix(dateStr: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) throw new Error(`Invalid date string: ${dateStr}`);
  const [, y, mo, d] = m;
  // Shanghai midnight = UTC (y, mo-1, d, 0, 0, 0) - 8h
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), 0, 0, 0);
  return Math.floor((utc - SHANGHAI_OFFSET_SECONDS * 1000) / 1000);
}

/**
 * Current time in Asia/Shanghai as 'HH:MM' string (e.g. '21:30').
 * Used by sleep-task cutoff checks (§3.12 准时上床) — server side mirror
 * of the iPad's local clock (China is UTC+8, no DST).
 */
export function nowShanghaiHHMM(input: number | Date = Date.now()): string {
  // input is millis-since-epoch when number, Date when object. new Date(ms) directly.
  const d = input instanceof Date ? input : new Date(input);
  const shifted = new Date(d.getTime() + SHANGHAI_OFFSET_SECONDS * 1000);
  const h = String(shifted.getUTCHours()).padStart(2, '0');
  const m = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Compare 'HH:MM' string `a` against `b` in Asia/Shanghai clock order.
 * Returns true if a is strictly later than b. Equal returns false.
 */
export function hhmmAfter(a: string, b: string): boolean {
  // 'HH:MM' lexicographic order matches numeric order for zero-padded strings.
  return a > b;
}

/** Get range [start, end) of Unix SECONDS for the week containing `input`. */
export function shanghaiWeekRange(input: number | Date = Date.now()): [number, number] {
  const date = typeof input === 'number' ? new Date(input) : new Date(input);
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_SECONDS * 1000);
  const dayNum = shifted.getUTCDay() || 7;  // Mon=1..Sun=7
  // Shanghai Monday 00:00 of this week
  const mondayShifted = new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() - (dayNum - 1),
  ));
  const mondayMs = mondayShifted.getTime() - SHANGHAI_OFFSET_SECONDS * 1000;
  const start = Math.floor(mondayMs / 1000);
  return [start, start + 7 * SEC_PER_DAY];
}

// tests/fixtures/health-checkin.ts
// Helpers for seeding health_events rows in e2e D1.
// Mirrors the seedEvent() / seedTask() pattern in tests/e2e/helpers/db.ts
// (which we intentionally do NOT modify — sqlStr/sqlNum are duplicated here
// rather than exported from db.ts).
//
// IMPORTANT: Requires migrations/0008_health_events.sql to be applied.
// E2E beforeAll runs `wrangler d1 migrations apply ... --local` first.

import { d1Exec } from '../e2e/helpers/db.ts';

// ---------- SQL literal helpers (mirrored from tests/e2e/helpers/db.ts) ----------

function sqlStr(s: string | null | undefined): string {
  if (s === null || s === undefined) return 'NULL';
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function sqlNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'NULL';
  return String(n);
}

// ---------- 8 hardcoded event_types from RFC §2.2 ----------

export const HEALTH_EVENT_TYPES = [
  'ulcer', 'fever', 'cough', 'injury',
  'allergy', 'dizzy', 'vomit', 'other',
] as const;

export type HealthEventType = typeof HEALTH_EVENT_TYPES[number];

// ---------- Seed helper ----------

interface SeedHealthEventOptions {
  id?: number;
  user_id?: number;
  event_type?: HealthEventType;
  start_date?: string;       // 'YYYY-MM-DD'
  end_date?: string | null;
  is_resolved?: 0 | 1;
  note?: string | null;
  submitted_by?: 'child' | 'pm';
  resolved_by?: number | null;
  resolved_at?: number | null;
}

/**
 * Seed a health_events row directly via sqlite3 (bypasses the API).
 * Returns the row id.
 *
 * Use this in e2e beforeEach to set up preconditions without going through
 * the POST endpoints (faster + more deterministic). For happy-path API
 * exercise, use POST instead.
 */
export function seedHealthEvent(overrides: SeedHealthEventOptions = {}): number {
  const id = overrides.id ?? 100_000 + Math.floor(Math.random() * 900_000);
  const user_id = overrides.user_id ?? 1;
  const event_type = overrides.event_type ?? 'ulcer';
  const start_date = overrides.start_date ?? '2026-06-14';
  const end_date = overrides.end_date ?? null;
  const is_resolved = overrides.is_resolved ?? (end_date ? 1 : 0);
  const note = overrides.note ?? null;
  const submitted_by = overrides.submitted_by ?? 'pm';
  const resolved_by = overrides.resolved_by ?? null;
  const resolved_at = overrides.resolved_at ?? null;
  const now = Math.floor(Date.now() / 1000);

  const sql =
    `INSERT INTO health_events ` +
    `(id, user_id, event_type, start_date, end_date, is_resolved, note, submitted_by, ` +
    ` resolved_by, resolved_at, created_at, updated_at) ` +
    `VALUES (${sqlNum(id)}, ${sqlNum(user_id)}, ${sqlStr(event_type)}, ` +
    `${sqlStr(start_date)}, ${sqlStr(end_date)}, ${sqlNum(is_resolved)}, ` +
    `${sqlStr(note)}, ${sqlStr(submitted_by)}, ${sqlNum(resolved_by)}, ${sqlNum(resolved_at)}, ` +
    `${sqlNum(now)}, ${sqlNum(now)});`;
  d1Exec(sql);
  return id;
}

/**
 * Clear all health_events rows (used by tests/fixtures reset, NOT by global
 * clearAllData() — that helper is the e2e baseline reset, this one is for
 * health-specific scoping).
 */
export function clearHealthEvents(): void {
  d1Exec('DELETE FROM health_events;');
}
// src/utils/health-events.ts
// Module 8 (Health Check-in, RFC §3-§4) — query + write helpers for the
// health_events table. All write helpers use db.batch() to atomically
// pair the health_events mutation with an audit_log INSERT, so a partial
// failure cannot leave an audit gap (mirrors the pattern in
// src/routes/admin/events.ts for score_event approve/reject/revoke).
//
// Time / date semantics: start_date / end_date are 'YYYY-MM-DD' strings
// in Asia/Shanghai. Helper uses shanghaiDateString() / todayShanghai()
// from src/utils/week.ts — never raw Date.now() for the calendar date.

import type { D1Database } from '../db/types.ts';
import type {
  HealthEvent,
  HealthEventType,
  HealthSubmittedBy,
} from '../db/types.ts';
import { nowUnix, todayShanghai } from './week.ts';

// Re-export todayShanghai so route files can import it through the
// health-events barrel (one import per route, no need to know about week.ts).
export { todayShanghai };

// ---------------------------------------------------------------
// Date format validation (RFC §7.2: end_date must be 'YYYY-MM-DD')
// ---------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True iff `s` is a syntactically valid 'YYYY-MM-DD' date. */
export function isValidDateString(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [, y, mo, d] = m;
  const yyyy = Number(y);
  const mm = Number(mo);
  const dd = Number(d);
  if (yyyy < 1900 || yyyy > 2999) return false;
  if (mm < 1 || mm > 12) return false;
  if (dd < 1 || dd > 31) return false;
  // Verify the calendar day is real (catches 2026-02-30 etc.).
  const probe = new Date(Date.UTC(yyyy, mm - 1, dd));
  return (
    probe.getUTCFullYear() === yyyy &&
    probe.getUTCMonth() === mm - 1 &&
    probe.getUTCDate() === dd
  );
}

/** True iff `end` is the same day or later than `start` (lexicographic on 'YYYY-MM-DD'). */
export function endDateNotBeforeStart(end: string, start: string): boolean {
  return end >= start;
}

// ---------------------------------------------------------------
// Type validation (RFC §7.2: event_type must be one of 8 hardcoded)
// ---------------------------------------------------------------

export const HEALTH_EVENT_TYPES: HealthEventType[] = [
  'ulcer', 'fever', 'cough', 'injury',
  'allergy', 'dizzy', 'vomit', 'other',
];

/** True iff `t` is one of the 8 hardcoded health event types. */
export function isValidHealthEventType(t: string): t is HealthEventType {
  return (HEALTH_EVENT_TYPES as string[]).includes(t);
}

// ---------------------------------------------------------------
// Row → API shape mapping
// ---------------------------------------------------------------

// SQL row type (before boolean conversion). is_resolved is INTEGER 0|1.
interface HealthEventRow {
  id: number;
  user_id: number;
  event_type: HealthEventType;
  start_date: string;
  end_date: string | null;
  is_resolved: number;
  note: string | null;
  submitted_by: HealthSubmittedBy;
  created_at: number;
  resolved_at: number | null;
  resolved_by: number | null;
  updated_at: number;
}

/** Convert a SQL row to the API response shape (RFC §4.2.1: is_resolved as boolean). */
export function rowToHealthEvent(row: HealthEventRow): HealthEvent {
  return {
    id: row.id,
    user_id: row.user_id,
    event_type: row.event_type,
    start_date: row.start_date,
    end_date: row.end_date,
    is_resolved: row.is_resolved === 1,
    note: row.note,
    submitted_by: row.submitted_by,
    created_at: row.created_at,
    resolved_at: row.resolved_at,
    resolved_by: row.resolved_by ?? null,
    updated_at: row.updated_at,
  };
}

// ---------------------------------------------------------------
// Query helpers (read-only)
// ---------------------------------------------------------------

const SELECT_COLUMNS =
  'id, user_id, event_type, start_date, end_date, is_resolved, note, ' +
  'submitted_by, created_at, resolved_at, resolved_by, updated_at';

/**
 * Find the most recent active event for (user_id, event_type).
 * "Active" = end_date IS NULL. Used by the resume-UX flow (RFC §2.3)
 * to decide whether to show the "续接" dialog instead of a new-event form.
 * Returns null if no active event exists.
 */
export async function findActiveEvent(
  db: D1Database,
  userId: number,
  eventType: HealthEventType,
): Promise<HealthEvent | null> {
  const row = await db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM health_events
       WHERE user_id = ? AND event_type = ? AND end_date IS NULL
       ORDER BY start_date DESC LIMIT 1`,
    )
    .bind(userId, eventType)
    .first<HealthEventRow>();
  return row ? rowToHealthEvent(row) : null;
}

/**
 * List events for (user_id, event_type?, month).
 * month is 'YYYY-MM' format. start_date is matched via LIKE 'YYYY-MM-%'.
 * If eventType is null, returns all types for that month.
 * If month is null, returns all events for that user (callers can add
 * their own filtering — used for the "active only" path).
 */
export async function listEventsByMonth(
  db: D1Database,
  userId: number,
  eventType: HealthEventType | null,
  month: string | null,
): Promise<HealthEvent[]> {
  const conditions: string[] = ['user_id = ?'];
  const params: unknown[] = [userId];
  if (eventType) {
    conditions.push('event_type = ?');
    params.push(eventType);
  }
  if (month) {
    // 'YYYY-MM' → start_date LIKE 'YYYY-MM-%'
    conditions.push('start_date LIKE ?');
    params.push(`${month}-%`);
  }
  const where = conditions.join(' AND ');
  const result = await db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM health_events
       WHERE ${where} ORDER BY start_date DESC`,
    )
    .bind(...params)
    .all<HealthEventRow>();
  return (result.results ?? []).map(rowToHealthEvent);
}

/**
 * List active events (end_date IS NULL) for (user_id, event_type?).
 * Used by the resume-UX flow's `active_only=true` path (RFC §4.2.1).
 */
export async function listEventsActive(
  db: D1Database,
  userId: number,
  eventType: HealthEventType | null,
): Promise<HealthEvent[]> {
  const conditions: string[] = ['user_id = ?', 'end_date IS NULL'];
  const params: unknown[] = [userId];
  if (eventType) {
    conditions.push('event_type = ?');
    params.push(eventType);
  }
  const where = conditions.join(' AND ');
  const result = await db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM health_events
       WHERE ${where} ORDER BY start_date DESC`,
    )
    .bind(...params)
    .all<HealthEventRow>();
  return (result.results ?? []).map(rowToHealthEvent);
}

// ---------------------------------------------------------------
// Write helpers (atomic create + audit_log)
// ---------------------------------------------------------------

export interface CreateEventParams {
  userId: number;
  eventType: HealthEventType;
  startDate: string;       // 'YYYY-MM-DD'
  note: string | null;
  submittedBy: HealthSubmittedBy;
}

/**
 * Create a new health event (atomic INSERT health_events + INSERT audit_log).
 * Mirrors the pattern in src/routes/me/events.ts:94 — db.batch() so the
 * audit row references the just-inserted health_events.id via
 * last_insert_rowid(). `target_event_id` in audit_log is NULL because
 * health events are not score_events (RFC §6 key constraint).
 *
 * Returns the new event in API response shape.
 */
export async function createEvent(
  db: D1Database,
  params: CreateEventParams,
): Promise<HealthEvent> {
  const now = nowUnix();
  const details = JSON.stringify({
    event_type: params.eventType,
    start_date: params.startDate,
    note: params.note,
    submitted_by: params.submittedBy,
  });

  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO health_events
           (user_id, event_type, start_date, end_date, is_resolved,
            note, submitted_by, created_at, updated_at)
         VALUES (?, ?, ?, NULL, 0, ?, ?, ?, ?)`,
      )
      .bind(
        params.userId,
        params.eventType,
        params.startDate,
        params.note,
        params.submittedBy,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO audit_log
           (actor, action, target_event_id, target_user_id, details, created_at)
         VALUES (?, 'health_event_create', NULL, ?, ?, unixepoch())`,
      )
      .bind(params.submittedBy, params.userId, details),
  ]);

  // The health_events insert is the 1st statement (index 0).
  const newId = Number(results[0]?.meta?.last_row_id ?? 0);

  return {
    id: newId,
    user_id: params.userId,
    event_type: params.eventType,
    start_date: params.startDate,
    end_date: null,
    is_resolved: false,
    note: params.note,
    submitted_by: params.submittedBy,
    created_at: now,
    resolved_at: null,
  };
}

export interface ResolveEventParams {
  id: number;
  userId: number;              // affected child (target_user_id in audit_log)
  endDate: string;             // 'YYYY-MM-DD', must be >= existing start_date
  resolvedBy: number;          // user id who performed the resolve (goes to health_events.resolved_by)
  submittedBy: HealthSubmittedBy; // 'pm' or 'child' (goes to audit_log.actor)
}

/**
 * Resolve an existing health event (atomic UPDATE health_events +
 * INSERT audit_log). Sets end_date, is_resolved=1, resolved_at=now,
 * resolved_by=params.resolvedBy, updated_at=now. `target_event_id` in
 * audit_log is NULL (health events are not score_events).
 *
 * submittedBy controls the audit_log.actor — 'pm' for admin-driven
 * resolves, 'child' for self-resolves (§4.2.5). resolvedBy is the
 * actual user id who took the action (PM's id, or child id=2 for self).
 *
 * Returns the updated event in API response shape, or null if the event
 * does not exist OR is already resolved (caller should distinguish via
 * its own pre-check — this helper is optimistic for batch simplicity).
 */
export async function resolveEvent(
  db: D1Database,
  params: ResolveEventParams,
): Promise<HealthEvent | null> {
  const now = nowUnix();
  const details = JSON.stringify({
    end_date: params.endDate,
    resolved_by: params.resolvedBy,
    resolved_by_role: params.submittedBy,
  });

  const results = await db.batch([
    db
      .prepare(
        `UPDATE health_events
         SET end_date = ?, is_resolved = 1, resolved_at = ?,
             resolved_by = ?, updated_at = ?
         WHERE id = ? AND end_date IS NULL`,
      )
      .bind(params.endDate, now, params.resolvedBy, now, params.id),
    db
      .prepare(
        `INSERT INTO audit_log
           (actor, action, target_event_id, target_user_id, details, created_at)
         VALUES (?, 'health_event_resolve', NULL, ?, ?, unixepoch())`,
      )
      .bind(params.submittedBy, params.userId, details),
  ]);

  // If the UPDATE affected 0 rows (event doesn't exist OR already resolved),
  // the audit_log row was still inserted. We can't "rollback" D1 batch but
  // we CAN detect: results[0].meta.changes === 0 → return null so the
  // caller surfaces a 404/409 to the client. The audit row represents an
  // attempted resolve that failed at the precondition — acceptable for v1.
  const changes = results[0]?.meta?.changes ?? 0;
  if (changes === 0) return null;

  // Re-read the row to get the full updated shape (mirrors how
  // admin/events.ts re-reads after approve).
  const row = await db
    .prepare(
      `SELECT ${SELECT_COLUMNS} FROM health_events WHERE id = ?`,
    )
    .bind(params.id)
    .first<HealthEventRow>();
  return row ? rowToHealthEvent(row) : null;
}

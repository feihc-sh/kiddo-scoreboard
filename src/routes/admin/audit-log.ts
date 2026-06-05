// src/routes/admin/audit-log.ts
// PM-only: read the audit log. Optional filters: limit, actor, action, target_user_id.
//
// GET /api/admin/audit-log
//   ?limit=N          (default 100, clamped to [1, 500])
//   ?actor=pm|child|system
//   ?action=<AuditAction>
//   ?target_user_id=N
//
// Response:
//   { entries: AuditLogEntry[], count: number }
//
// Each entry's `details` is the parsed JSON object (not the raw JSON string
// stored in D1) so the API surface is immediately usable by the frontend.

import { Hono } from 'hono';
import type { Context } from 'hono';
import { getPmUserId } from '../../middleware/requirePm.ts';
import { readAuditLog, type AuditFilter, type AuditLogRow } from '../../utils/audit.ts';
import type { Actor, AuditAction } from '../../db/types.ts';
import type { Env } from '../../worker.ts';

const auditLog = new Hono<{ Bindings: Env }>();

function unauthorized(c: Context<{ Bindings: Env }>) {
  return c.json(
    { error: { code: 'UNAUTHORIZED', message: 'PM session required' } },
    401,
  );
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return 100;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    // Garbage input -> fall back to default 100, still clamped.
    return 100;
  }
  return Math.min(500, Math.max(1, n));
}

function parseActor(raw: string | undefined): Actor | undefined {
  if (raw === undefined) return undefined;
  if (raw === 'pm' || raw === 'child' || raw === 'system') return raw;
  return undefined;
}

function parseTargetUserId(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return undefined;
  return n;
}

function parseDetails(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { _raw: raw };
  }
}

export type AuditLogEntry = Omit<AuditLogRow, 'details'> & {
  details: Record<string, unknown>;
};

auditLog.get('/', async (c) => {
  const pmUserId = await getPmUserId(c);
  if (pmUserId == null) return unauthorized(c);

  const filter: AuditFilter = { limit: parseLimit(c.req.query('limit')) };
  const actor = parseActor(c.req.query('actor'));
  if (actor) filter.actor = actor;
  const actionRaw = c.req.query('action');
  if (actionRaw) filter.action = actionRaw as AuditAction;
  const targetUserId = parseTargetUserId(c.req.query('target_user_id'));
  if (targetUserId !== undefined) filter.target_user_id = targetUserId;

  const rows = await readAuditLog(c.env.DB, filter);
  const entries: AuditLogEntry[] = rows.map((r) => ({
    id: r.id,
    actor: r.actor,
    action: r.action,
    target_event_id: r.target_event_id,
    target_user_id: r.target_user_id,
    created_at: r.created_at,
    details: parseDetails(r.details),
  }));

  return c.json({ entries, count: entries.length });
});

export default auditLog;

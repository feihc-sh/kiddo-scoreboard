// src/routes/admin/events.ts
// PM-only event management: approve / reject / revoke / edit.
// All mutations are atomic: event UPDATE + audit_log INSERT go through
// a single db.batch() so a partial failure cannot leave an audit gap.

import { Hono } from 'hono';
import type { Context } from 'hono';
import { getPmUserId } from '../../middleware/requirePm.ts';
import { computeBalance } from '../../utils/balance.ts';
import type {
  AccountType,
  Balance,
  EventStatus,
  ScoreEvent,
} from '../../db/types.ts';
import type { Env } from '../../worker.ts';

const events = new Hono<{ Bindings: Env }>();

// ---------------- helpers ----------------

function badId(idRaw: string | undefined): number | null {
  if (!idRaw) return null;
  const n = Number(idRaw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function unauthorized(c: Context<{ Bindings: Env }>) {
  return c.json(
    { error: { code: 'UNAUTHORIZED', message: 'PM session required' } },
    401,
  );
}

async function loadEvent(c: Context<{ Bindings: Env }>, id: number) {
  return c.env.DB
    .prepare(
      `SELECT id, user_id, type, change_value, reason, status, submitted_by,
              source, source_ref, reviewed_by, reviewed_at, week_of, created_at
       FROM score_events WHERE id = ?`,
    )
    .bind(id)
    .first<ScoreEvent>();
}

// ---------------- POST /:id/approve ----------------

events.post('/:id/approve', async (c) => {
  const pmUserId = await getPmUserId(c);
  if (pmUserId == null) return unauthorized(c);

  const id = badId(c.req.param('id'));
  if (id == null) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'id must be a positive integer' } },
      400,
    );
  }

  const db = c.env.DB;
  const ev = await loadEvent(c, id);
  if (!ev) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'event not found' } },
      404,
    );
  }
  if (ev.status !== 'pending') {
    return c.json(
      {
        error: {
          code: 'INVALID_STATUS',
          message: `cannot approve event in status '${ev.status}'`,
        },
      },
      409,
    );
  }

  const now = Math.floor(Date.now() / 1000);

  await db.batch([
    db
      .prepare(
        `UPDATE score_events
         SET status = 'approved', reviewed_by = ?, reviewed_at = ?
         WHERE id = ?`,
      )
      .bind(pmUserId, now, id),
    db
      .prepare(
        `INSERT INTO audit_log
           (actor, action, target_event_id, target_user_id, details, created_at)
         VALUES ('pm', 'approve_event', ?, ?, ?, ?)`,
      )
      .bind(
        id,
        ev.user_id,
        JSON.stringify({ reason: ev.reason, change_value: ev.change_value }),
        now,
      ),
  ]);

  const newBalance: Balance = await computeBalance(db, ev.user_id);
  return c.json({ id, status: 'approved' as EventStatus, new_balance: newBalance });
});

// ---------------- POST /:id/reject ----------------

events.post('/:id/reject', async (c) => {
  const pmUserId = await getPmUserId(c);
  if (pmUserId == null) return unauthorized(c);

  const id = badId(c.req.param('id'));
  if (id == null) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'id must be a positive integer' } },
      400,
    );
  }

  const db = c.env.DB;
  const ev = await loadEvent(c, id);
  if (!ev) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'event not found' } },
      404,
    );
  }
  if (ev.status !== 'pending') {
    return c.json(
      {
        error: {
          code: 'INVALID_STATUS',
          message: `cannot reject event in status '${ev.status}'`,
        },
      },
      409,
    );
  }

  const now = Math.floor(Date.now() / 1000);

  await db.batch([
    db
      .prepare(
        `UPDATE score_events
         SET status = 'rejected', reviewed_by = ?, reviewed_at = ?
         WHERE id = ?`,
      )
      .bind(pmUserId, now, id),
    db
      .prepare(
        `INSERT INTO audit_log
           (actor, action, target_event_id, target_user_id, details, created_at)
         VALUES ('pm', 'reject_event', ?, ?, ?, ?)`,
      )
      .bind(id, ev.user_id, JSON.stringify({ reason: ev.reason }), now),
  ]);

  return c.json({ id, status: 'rejected' as EventStatus });
});

// ---------------- POST /:id/revoke ----------------

events.post('/:id/revoke', async (c) => {
  const pmUserId = await getPmUserId(c);
  if (pmUserId == null) return unauthorized(c);

  const id = badId(c.req.param('id'));
  if (id == null) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'id must be a positive integer' } },
      400,
    );
  }

  const db = c.env.DB;
  const ev = await loadEvent(c, id);
  if (!ev) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'event not found' } },
      404,
    );
  }
  if (ev.status !== 'approved' && ev.status !== 'rejected') {
    return c.json(
      {
        error: {
          code: 'INVALID_STATUS',
          message: `cannot revoke event in status '${ev.status}'`,
        },
      },
      409,
    );
  }

  const originalStatus = ev.status;
  const wasApproved = originalStatus === 'approved';
  const now = Math.floor(Date.now() / 1000);

  await db.batch([
    db
      .prepare(
        `UPDATE score_events
         SET status = 'revoked', reviewed_by = ?, reviewed_at = ?
         WHERE id = ?`,
      )
      .bind(pmUserId, now, id),
    db
      .prepare(
        `INSERT INTO audit_log
           (actor, action, target_event_id, target_user_id, details, created_at)
         VALUES ('pm', 'revoke_event', ?, ?, ?, ?)`,
      )
      .bind(
        id,
        ev.user_id,
        JSON.stringify({ original_status: originalStatus }),
        now,
      ),
  ]);

  const newBalance = wasApproved ? await computeBalance(db, ev.user_id) : null;
  return c.json({
    id,
    status: 'revoked' as EventStatus,
    new_balance: newBalance,
  });
});

// ---------------- PUT /:id (edit) ----------------

interface EditBody {
  type?: AccountType;
  change_value?: number;
  reason?: string;
}

function parseEditBody(raw: unknown): { ok: true; value: EditBody } | { ok: false; code: string; message: string } {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'BAD_REQUEST', message: 'body must be a JSON object' };
  }
  const body = raw as Record<string, unknown>;
  const out: EditBody = {};

  if ('type' in body) {
    if (body.type !== 'game_time' && body.type !== 'pocket_money') {
      return { ok: false, code: 'BAD_REQUEST', message: 'type must be game_time or pocket_money' };
    }
    out.type = body.type;
  }
  if ('change_value' in body) {
    if (typeof body.change_value !== 'number' || !Number.isFinite(body.change_value)) {
      return { ok: false, code: 'BAD_REQUEST', message: 'change_value must be a finite number' };
    }
    out.change_value = body.change_value;
  }
  if ('reason' in body) {
    if (typeof body.reason !== 'string') {
      return { ok: false, code: 'BAD_REQUEST', message: 'reason must be a string' };
    }
    out.reason = body.reason;
  }

  if (out.type === undefined && out.change_value === undefined && out.reason === undefined) {
    return { ok: false, code: 'BAD_REQUEST', message: 'at least one of type, change_value, reason is required' };
  }
  return { ok: true, value: out };
}

events.put('/:id', async (c) => {
  const pmUserId = await getPmUserId(c);
  if (pmUserId == null) return unauthorized(c);

  const id = badId(c.req.param('id'));
  if (id == null) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'id must be a positive integer' } },
      400,
    );
  }

  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'invalid JSON body' } },
      400,
    );
  }
  const parsed = parseEditBody(raw);
  if (!parsed.ok) {
    return c.json(
      { error: { code: parsed.code, message: parsed.message } },
      400,
    );
  }
  const patch = parsed.value;

  const db = c.env.DB;
  const ev = await loadEvent(c, id);
  if (!ev) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'event not found' } },
      404,
    );
  }

  // Build dynamic SET clause from provided fields only.
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.type !== undefined) {
    sets.push('type = ?');
    params.push(patch.type);
  }
  if (patch.change_value !== undefined) {
    sets.push('change_value = ?');
    params.push(patch.change_value);
  }
  if (patch.reason !== undefined) {
    sets.push('reason = ?');
    params.push(patch.reason);
  }
  params.push(id);
  const setClause = sets.join(', ');

  // Capture before/after for audit.
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  if (patch.type !== undefined && patch.type !== ev.type) {
    oldValues.type = ev.type;
    newValues.type = patch.type;
  }
  if (patch.change_value !== undefined && patch.change_value !== ev.change_value) {
    oldValues.change_value = ev.change_value;
    newValues.change_value = patch.change_value;
  }
  if (patch.reason !== undefined && patch.reason !== ev.reason) {
    oldValues.reason = ev.reason;
    newValues.reason = patch.reason;
  }

  const now = Math.floor(Date.now() / 1000);

  await db.batch([
    db
      .prepare(`UPDATE score_events SET ${setClause} WHERE id = ?`)
      .bind(...params),
    db
      .prepare(
        `INSERT INTO audit_log
           (actor, action, target_event_id, target_user_id, details, created_at)
         VALUES ('pm', 'edit_event', ?, ?, ?, ?)`,
      )
      .bind(
        id,
        ev.user_id,
        JSON.stringify({ old_values: oldValues, new_values: newValues }),
        now,
      ),
  ]);

  // Reload to get the canonical updated row.
  const updated = await loadEvent(c, id);
  if (!updated) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'event disappeared after update' } },
      404,
    );
  }

  // Balance only changes if the event was previously approved and we touched type/change_value.
  const balanceChanged =
    ev.status === 'approved' &&
    (newValues.type !== undefined || newValues.change_value !== undefined);
  const newBalance = balanceChanged
    ? await computeBalance(db, updated.user_id)
    : null;

  return c.json({
    event: updated,
    new_balance: newBalance,
  });
});

export default events;

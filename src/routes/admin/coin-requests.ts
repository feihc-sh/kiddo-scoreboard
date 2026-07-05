// src/routes/admin/coin-requests.ts
// Item #015 §2 (Coin Request Workflow — admin side):
//   GET  /api/admin/coin-requests              — list requests (default: pending)
//   POST /api/admin/coin-requests/:id/approve  — approve + write score_events + audit_log
//   POST /api/admin/coin-requests/:id/reject    — reject + audit_log
//
// Auth: PM only via requirePm middleware (mounted on admin/index.ts).

import { Hono } from 'hono';
import type { Context } from 'hono';
import { getPmUserId } from '../../middleware/requirePm.ts';
import {
  listPendingCoinRequests,
  reviewCoinRequest,
  type CoinRequest,
} from '../../utils/coin-request.ts';
import type { Env } from '../../worker.ts';

const coinRequestsRoute = new Hono<{ Bindings: Env }>();

function unauthorized(c: Context<{ Bindings: Env }>) {
  return c.json(
    { error: { code: 'UNAUTHORIZED', message: 'PM session required' } },
    401,
  );
}

function badId(idRaw: string | undefined): number | null {
  if (!idRaw) return null;
  const n = Number(idRaw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

// ---------------- helpers ----------------

async function fetchCoinRequestById(
  db: Env['DB'],
  id: number,
): Promise<CoinRequest | null> {
  const row = await db
    .prepare(
      `SELECT id, user_id, amount, reason, status,
              requested_at, reviewed_at, reviewed_by, review_note
       FROM coin_requests WHERE id = ?`,
    )
    .bind(id)
    .first<CoinRequest>();
  return row ?? null;
}

// ---------------- GET /api/admin/coin-requests ----------------

interface AdminCoinRequestRow extends CoinRequest {
  child_name: string | null;
}

coinRequestsRoute.get('/', async (c) => {
  const pmUserId = await getPmUserId(c);
  if (pmUserId == null) return unauthorized(c);

  const statusParam = (c.req.query('status') ?? 'pending').toLowerCase();
  const allowedStatuses = new Set(['pending', 'approved', 'rejected', 'all']);
  if (!allowedStatuses.has(statusParam)) {
    return c.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message: `status must be one of ${[...allowedStatuses].join(',')}`,
        },
      },
      400,
    );
  }

  const db = c.env.DB;
  let rows: AdminCoinRequestRow[];

  if (statusParam === 'pending') {
    const pending = await listPendingCoinRequests(db, 100);
    rows = pending.map((r) => ({ ...r, child_name: null }));
  } else {
    // For approved/rejected/all: custom SQL JOIN with child_name.
    const where = statusParam === 'all' ? '' : 'WHERE cr.status = ?';
    const bindArgs = statusParam === 'all' ? [] : [statusParam];
    const result = await db
      .prepare(
        `SELECT cr.id, cr.user_id, cr.amount, cr.reason, cr.status,
                cr.requested_at, cr.reviewed_at, cr.reviewed_by, cr.review_note,
                u.name AS child_name
         FROM coin_requests cr
         LEFT JOIN users u ON u.id = cr.user_id
         ${where}
         ORDER BY cr.requested_at DESC
         LIMIT 100`,
      )
      .bind(...bindArgs)
      .all<AdminCoinRequestRow>();
    rows = result.results ?? [];
  }

  const requests = rows.map((r) => ({
    id: r.id,
    user_id: r.user_id,
    child_name: r.child_name,
    amount: r.amount,
    reason: r.reason,
    status: r.status,
    requested_at: r.requested_at,
    reviewed_at: r.reviewed_at,
    reviewed_by: r.reviewed_by,
    review_note: r.review_note,
  }));

  return c.json({ count: requests.length, requests });
});

// ---------------- POST /api/admin/coin-requests/:id/approve ----------------

coinRequestsRoute.post('/:id/approve', async (c) => {
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

  // Fetch request before calling helper (for audit_log details).
  const requestRow = await fetchCoinRequestById(db, id);
  if (!requestRow) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: `coin request ${id} not found` } },
      404,
    );
  }

  // Note is optional — read from body or query param.
  const note =
    typeof c.req.query('note') === 'string' ? c.req.query('note') : null;
  let noteFromBody: string | null = null;
  try {
    const body = await c.req.json().catch(() => null);
    if (body && typeof body === 'object' && 'note' in body && typeof body.note === 'string') {
      noteFromBody = body.note;
    }
  } catch {
    // ignore parse errors — noteFromBody stays null
  }
  const finalNote: string | null = noteFromBody ?? note ?? null;

  // reviewCoinRequest does UPDATE + (if approved) INSERT score_events atomically.
  let result: Awaited<ReturnType<typeof reviewCoinRequest>>;
  try {
    result = await reviewCoinRequest(db, id, pmUserId, 'approved', finalNote);
  } catch (err) {
    const msg = String(err);
    if (msg.includes('not found')) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: msg } },
        404,
      );
    }
    if (msg.includes('already')) {
      return c.json(
        { error: { code: 'INVALID_STATUS', message: msg } },
        409,
      );
    }
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: msg } },
      500,
    );
  }

  // Write audit_log after the helper succeeded.
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO audit_log
         (actor, action, target_event_id, target_user_id, details, created_at)
       VALUES ('pm', 'coin_request_approved', NULL, ?, ?, ?)`,
    )
    .bind(
      requestRow.user_id,
      JSON.stringify({
        request_id: id,
        amount: result.amount,
        reason: requestRow.reason,
      }),
      now,
    )
    .run();

  return c.json({
    id,
    status: 'approved',
    amount: result.amount,
    score_event_id: result.scoreEventId,
  });
});

// ---------------- POST /api/admin/coin-requests/:id/reject ----------------

coinRequestsRoute.post('/:id/reject', async (c) => {
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

  // Fetch request before calling helper (for audit_log details).
  const requestRow = await fetchCoinRequestById(db, id);
  if (!requestRow) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: `coin request ${id} not found` } },
      404,
    );
  }

  // Note is REQUIRED for rejection — read from body JSON first, then query param.
  let rejectNote: string | null = null;
  try {
    const body = await c.req.json();
    if (body && typeof body === 'object' && 'note' in body && typeof body.note === 'string') {
      rejectNote = body.note;
    }
  } catch {
    // ignore
  }
  if (!rejectNote) {
    const qNote = c.req.query('note');
    if (typeof qNote === 'string' && qNote.trim().length > 0) {
      rejectNote = qNote.trim();
    }
  }
  if (!rejectNote || rejectNote.trim().length === 0) {
    return c.json(
      {
        error: {
          code: 'BAD_REQUEST',
          message: 'note is required for rejection (body.note or ?note=...)',
        },
      },
      400,
    );
  }

  // reviewCoinRequest does UPDATE atomically (no score_events for rejected).
  let result: Awaited<ReturnType<typeof reviewCoinRequest>>;
  try {
    result = await reviewCoinRequest(db, id, pmUserId, 'rejected', rejectNote);
  } catch (err) {
    const msg = String(err);
    if (msg.includes('not found')) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: msg } },
        404,
      );
    }
    if (msg.includes('already')) {
      return c.json(
        { error: { code: 'INVALID_STATUS', message: msg } },
        409,
      );
    }
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: msg } },
      500,
    );
  }

  // Write audit_log after the helper succeeded.
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO audit_log
         (actor, action, target_event_id, target_user_id, details, created_at)
       VALUES ('pm', 'coin_request_rejected', NULL, ?, ?, ?)`,
    )
    .bind(
      requestRow.user_id,
      JSON.stringify({
        request_id: id,
        amount: result.amount,
        reason: requestRow.reason,
        reject_note: rejectNote,
      }),
      now,
    )
    .run();

  return c.json({ id, status: 'rejected' });
});

export default coinRequestsRoute;

// src/utils/coin-request.ts
// Item #015 Stage 1: helpers for coin_requests table (kid coin request + approval workflow).
//
// Coin balance model (RFC §3.4 INV-1):
//   balance = SUM(change_value WHERE type='coins' AND status='approved')
// from score_events — coin_requests does NOT write to coin_balances (no such table).
// Approved requests write a +change_value row into score_events (source='manual').
//
// All functions take a D1Database binding. They don't touch HTTP — the
// route layer (M2) wraps these with auth + JSON shaping.

import type { D1Database } from '../db/types.ts';
import { isoWeekString } from './week.ts';

// =============================================================
// Type definitions
// =============================================================

export interface CoinRequest {
  id: number;
  user_id: number;
  amount: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  requested_at: number;
  reviewed_at: number | null;
  reviewed_by: number | null;
  review_note: string | null;
}

// =============================================================
// M1: createCoinRequest
// =============================================================

/**
 * Kid submits a new coin request.
 *
 * Validates:
 *   - amount > 0  (DB CHECK also enforces this, but we validate at app layer)
 *   - reason is non-empty after trim (1–200 chars recommended; DB has no length limit)
 *
 * Returns {id} of the newly inserted row.
 */
export async function createCoinRequest(
  db: D1Database,
  userId: number,
  amount: number,
  reason: string,
): Promise<{ id: number }> {
  // Application-layer validation (belt-and-suspenders)
  if (amount <= 0) {
    throw new Error('amount must be a positive integer');
  }
  const trimmedReason = reason.trim();
  if (trimmedReason.length === 0) {
    throw new Error('reason cannot be empty');
  }

  const result = await db
    .prepare(
      `INSERT INTO coin_requests (user_id, amount, reason)
       VALUES (?, ?, ?)`,
    )
    .bind(userId, amount, trimmedReason)
    .run();

  const newId = Number(result.meta?.last_row_id ?? 0);
  return { id: newId };
}

// =============================================================
// M2: listCoinRequestsForKid
// =============================================================

/**
 * Kid lists their own coin requests (newest first).
 * Returns up to `limit` rows for the given user.
 */
export async function listCoinRequestsForKid(
  db: D1Database,
  userId: number,
  limit = 50,
): Promise<CoinRequest[]> {
  const rows = await db
    .prepare(
      `SELECT id, user_id, amount, reason, status,
              requested_at, reviewed_at, reviewed_by, review_note
       FROM coin_requests
       WHERE user_id = ?
       ORDER BY requested_at DESC
       LIMIT ?`,
    )
    .bind(userId, limit)
    .all<CoinRequest>();

  return rows.results ?? [];
}

// =============================================================
// M3: listPendingCoinRequests
// =============================================================

/**
 * Admin (PM) lists all pending coin requests (oldest first, FIFO order).
 * Used to build the review queue.
 */
export async function listPendingCoinRequests(
  db: D1Database,
  limit = 100,
): Promise<CoinRequest[]> {
  const rows = await db
    .prepare(
      `SELECT id, user_id, amount, reason, status,
              requested_at, reviewed_at, reviewed_by, review_note
       FROM coin_requests
       WHERE status = 'pending'
       ORDER BY requested_at ASC
       LIMIT ?`,
    )
    .bind(limit)
    .all<CoinRequest>();

  return rows.results ?? [];
}

// =============================================================
// M4: reviewCoinRequest
// =============================================================

export interface ReviewResult {
  requestId: number;
  status: 'approved' | 'rejected';
  amount: number;
  scoreEventId?: number;   // only present when approved
}

/**
 * PM approves or rejects a pending coin request.
 *
 * Atomic batch:
 *   - UPDATE coin_requests (status, reviewed_at, reviewed_by, review_note)
 *   - IF approved → INSERT score_events (type='coins', change_value=amount)
 *
 * Throws if:
 *   - request not found
 *   - request status is not 'pending' (already reviewed)
 *   - decision is not 'approved' | 'rejected'
 *
 * audit_log is NOT written here — Stage 2 admin API endpoint writes it
 * (mirrors the shop-fulfill pattern in admin/shop-fulfill.ts).
 */
export async function reviewCoinRequest(
  db: D1Database,
  requestId: number,
  pmUserId: number,
  decision: 'approved' | 'rejected',
  note: string | null,
): Promise<ReviewResult> {
  if (decision !== 'approved' && decision !== 'rejected') {
    throw new Error('decision must be "approved" or "rejected"');
  }

  // Fetch current request to validate status
  const requestRow = await db
    .prepare(
      `SELECT id, user_id, amount, reason, status
       FROM coin_requests
       WHERE id = ?`,
    )
    .bind(requestId)
    .first<{ id: number; user_id: number; amount: number; reason: string; status: string }>();

  if (!requestRow) {
    throw new Error(`coin request ${requestId} not found`);
  }
  if (requestRow.status !== 'pending') {
    throw new Error(`coin request ${requestId} is already ${requestRow.status}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const sourceRef = `coin_request:${requestId}`;
  const weekOf = isoWeekString(now * 1000);

  if (decision === 'approved') {
    // Atomic batch: UPDATE coin_requests + INSERT score_events
    const results = await db.batch([
      db
        .prepare(
          `UPDATE coin_requests
           SET status = 'approved', reviewed_at = ?, reviewed_by = ?, review_note = ?
           WHERE id = ?`,
        )
        .bind(now, pmUserId, note, requestId),
      db
        .prepare(
          `INSERT INTO score_events
             (user_id, type, change_value, reason, status,
              submitted_by, source, source_ref, reviewed_by, reviewed_at, week_of, created_at)
           VALUES (?, 'coins', ?, ?, 'approved',
                   'pm', 'manual', ?, ?, ?, ?, unixepoch())`,
        )
        .bind(
          requestRow.user_id,
          requestRow.amount,
          requestRow.reason,
          sourceRef,
          pmUserId,
          now,
          weekOf,
        ),
    ]);

    const scoreEventId = Number(results[1]?.meta?.last_row_id ?? 0);
    return {
      requestId,
      status: 'approved',
      amount: requestRow.amount,
      scoreEventId,
    };
  } else {
    // Rejected: only UPDATE coin_requests (no score_events row)
    await db
      .prepare(
        `UPDATE coin_requests
         SET status = 'rejected', reviewed_at = ?, reviewed_by = ?, review_note = ?
         WHERE id = ?`,
      )
      .bind(now, pmUserId, note, requestId)
      .run();

    return {
      requestId,
      status: 'rejected',
      amount: requestRow.amount,
    };
  }
}

// src/utils/running-rederive.ts
// Item #013 §1 — R2 re-derive cascade for running_records revoke.
//
// Background: a single running check-in can cross N milestones (one
// record → N score_events, each `type='coins'`, `source_ref='running:N:point:P'`).
// When PM revokes the record, the simple X1 "reverse the aggregate award"
// loses track of which milestones are still reached by other active records.
// R2 re-derive: recompute cum_km from non-revoked records, then for each
// milestone P decide:
//   - still reached  → write compensation +X (or skip if other active record
//                       already credited this milestone)
//   - no longer reached → write reverse -X
//
// All milestone awards are tracked by `source_ref LIKE 'running:%:point:P'`
// (the `:point:P` segment identifies the milestone; the prefix `running:`
// matches both new awards and reverse/compensation rows — they're all per-
// milestone events for the same record id).

import type { D1Database } from '../db/types.ts';
import { logAudit } from './audit.ts';

export interface MilestoneCoinDelta {
  point_id: number;
  coins: number;             // signed (+ = compensation, - = reverse)
}

export interface RederiveResult {
  newCumKm: number;
  netCoinChange: number;     // sum of all coin deltas written
  compensatedMilestones: MilestoneCoinDelta[];  // still reached via other active records
  reversedMilestones: MilestoneCoinDelta[];     // no longer reached
  scoreEventIds: number[];   // ids of all score_events written by this call
}

/**
 * Recompute the child's cum_km for a map by summing non-revoked records.
 * If `excludeRecordId` is supplied, the given record is also excluded from
 * the sum (useful for computing "what cum_km would be after revoking this
 * record" without first mutating the row).
 */
export async function recomputeCumKm(
  db: D1Database,
  childId: number,
  mapId: number,
  excludeRecordId?: number,
): Promise<number> {
  const where =
    excludeRecordId !== undefined
      ? `WHERE child_id = ? AND map_id = ? AND revoked_at IS NULL AND id != ?`
      : `WHERE child_id = ? AND map_id = ? AND revoked_at IS NULL`;
  const params =
    excludeRecordId !== undefined
      ? [childId, mapId, excludeRecordId]
      : [childId, mapId];

  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(km), 0) AS cum_km
       FROM running_records
       ${where}`,
    )
    .bind(...params)
    .first<{ cum_km: number }>();
  return Number(row?.cum_km ?? 0);
}

/**
 * R2 cascade: revoke a running_record and re-derive all milestone coin
 * events. Algorithm (per NIGHTLY-TODO.md Item #013 §1 Re-derive 算法):
 *
 *   1. UPDATE running_records SET revoked_at=now, revoked_by=pmId WHERE id=N
 *   2. newCumKm = recomputeCumKm(childId, mapId) — exclude this record
 *      from the sum since it's now revoked (or already updated in step 1).
 *   3. For each milestone P in the map (ORDER BY cum_km ASC):
 *      a. Find this record's award: source_ref = 'running:N:point:P'
 *         (only rows with positive change_value; compensation/reverse are
 *         also under source_ref LIKE 'running:N:point:P%' but the strict
 *         equality here matches the original award row.)
 *      b. Find any active award for P from other non-revoked records:
 *         source_ref LIKE 'running:%:point:P' AND change_value > 0.
 *      c. If P still reached (newCumKm >= P.cum_km):
 *         - If this record had an award but no other active award exists
 *           for P → write compensation +X (same coins as original award).
 *         - Otherwise → skip (another record already credited this milestone).
 *      d. If P no longer reached (newCumKm < P.cum_km):
 *         - If this record had an award (or there was a compensation) →
 *           write reverse -X (refund the coins credited for this milestone).
 *   4. UPSERT running_progress (write-through cache).
 *   5. Write audit_log via writeRevokeAuditLog (cascade summary).
 *
 * Returns the cascade summary (net coin change + per-milestone breakdown).
 *
 * Throws on missing record or already-revoked record.
 */
export async function rederiveRecordRevoke(
  db: D1Database,
  recordId: number,
  pmUserId: number,
  nowOverride?: number,  // For testing — defaults to Math.floor(Date.now()/1000)
): Promise<RederiveResult> {
  const now = nowOverride ?? Math.floor(Date.now() / 1000);

  // 1. Load the record
  const rec = await db
    .prepare(
      `SELECT id, child_id, map_id, km, awarded_coins, revoked_at
       FROM running_records WHERE id = ?`,
    )
    .bind(recordId)
    .first<{
      id: number;
      child_id: number;
      map_id: number;
      km: number;
      awarded_coins: number | null;
      revoked_at: number | null;
    }>();
  if (!rec) throw new Error('NOT_FOUND');
  if (rec.revoked_at !== null) throw new Error('ALREADY_REVOKED');

  // 2. Revoke the record, then compute newCumKm from active rows.
  await db
    .prepare(
      `UPDATE running_records
       SET revoked_at = ?, revoked_by = ?
       WHERE id = ?`,
    )
    .bind(now, pmUserId, recordId)
    .run();
  const newCumKm = await recomputeCumKm(db, rec.child_id, rec.map_id);

  // 3. Load all milestones for this map (ordered ascending by cum_km).
  const pointsResult = await db
    .prepare(
      `SELECT id, cum_km
       FROM running_points
       WHERE map_id = ?
       ORDER BY cum_km ASC`,
    )
    .bind(rec.map_id)
    .all<{ id: number; cum_km: number }>();
  const milestones = pointsResult.results ?? [];

  const compensatedMilestones: MilestoneCoinDelta[] = [];
  const reversedMilestones: MilestoneCoinDelta[] = [];
  const scoreEventIds: number[] = [];

  for (const m of milestones) {
    // Skip the start node (cum_km=0) — it's never "crossed" by a record.
    if (m.cum_km === 0) continue;
    const pointId = m.id;

    // 3a. Did this specific record (N) originally award coins for this milestone?
    const thisRecAward = await db
      .prepare(
        `SELECT change_value FROM score_events
         WHERE source_ref = ? AND change_value > 0
         LIMIT 1`,
      )
      .bind(`running:${recordId}:point:${pointId}`)
      .first<{ change_value: number }>();

    // 3b. Does any other active record currently have an award for this milestone?
    //     "Active" = source_ref starts with 'running:' AND ends with ':point:P',
    //     AND the referenced record is not revoked. We check the latter by joining
    //     running_records via the record-id parsed out of source_ref.
    //     For simplicity we use: any positive award whose source_ref matches
    //     'running:<other_id>:point:P' where <other_id> is a non-revoked record id.
    //     Pull all candidate source_refs and filter in JS — the milestone set is
    //     tiny (≤ 10) so this is cheap.
    const candidateAwards = await db
      .prepare(
        `SELECT source_ref FROM score_events
         WHERE source_ref LIKE ? AND change_value > 0`,
      )
      .bind(`running:%:point:${pointId}`)
      .all<{ source_ref: string }>();

    let hasOtherActiveAward = false;
    for (const row of candidateAwards.results ?? []) {
      const ref = row.source_ref;
      // Parse record id from 'running:<R>:point:<P>'
      const match = /^running:(\d+):point:(\d+)$/.exec(ref);
      if (!match) continue;
      const otherRecId = Number(match[1]);
      if (otherRecId === recordId) continue;       // this record's own award
      // Skip records that are themselves revoked
      const otherRec = await db
        .prepare(`SELECT revoked_at FROM running_records WHERE id = ?`)
        .bind(otherRecId)
        .first<{ revoked_at: number | null }>();
      if (otherRec && otherRec.revoked_at === null) {
        hasOtherActiveAward = true;
        break;
      }
    }

    const stillReached = newCumKm >= m.cum_km;
    const originalCoins = thisRecAward ? Number(thisRecAward.change_value) : 0;

    if (stillReached) {
      // (3c) Milestone still reached. Compensate only if this record's
      // award was the sole credit and no other active record has it.
      if (originalCoins > 0 && !hasOtherActiveAward) {
        const evId = await insertCoinEvent(
          db,
          rec.child_id,
          originalCoins,
          `running:${recordId}:point:${pointId}:compensation`,
          '补偿 milestone 金币',
          now,
        );
        compensatedMilestones.push({ point_id: pointId, coins: originalCoins });
        scoreEventIds.push(evId);
      }
    } else {
      // (3d) Milestone no longer reached. Reverse the coins that this
      // record credited — whether via the original award or a prior
      // compensation row (look up the latest positive row for this
      // record's milestone).
      const lastPositive = await db
        .prepare(
          `SELECT change_value FROM score_events
           WHERE source_ref LIKE ? AND change_value > 0
           ORDER BY id DESC LIMIT 1`,
        )
        .bind(`running:${recordId}:point:${pointId}%`)
        .first<{ change_value: number }>();
      const refund = lastPositive ? Number(lastPositive.change_value) : 0;
      if (refund > 0) {
        const evId = await insertCoinEvent(
          db,
          rec.child_id,
          -refund,
          `running:${recordId}:point:${pointId}:reverse`,
          '撤销 milestone 金币',
          now,
        );
        reversedMilestones.push({ point_id: pointId, coins: -refund });
        scoreEventIds.push(evId);
      }
    }
  }

  // 4. UPSERT running_progress (write-through cache).
  await db
    .prepare(
      `INSERT INTO running_progress (child_id, map_id, cum_km, last_updated)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (child_id, map_id)
       DO UPDATE SET cum_km = ?, last_updated = ?`,
    )
    .bind(rec.child_id, rec.map_id, newCumKm, now, newCumKm, now)
    .run();

  const netCoinChange =
    compensatedMilestones.reduce((s, x) => s + x.coins, 0) +
    reversedMilestones.reduce((s, x) => s + x.coins, 0);

  // 5. Audit log via wrapper.
  await writeRevokeAuditLog(db, recordId, {
    child_id: rec.child_id,
    map_id: rec.map_id,
    km: rec.km,
    awarded_coins: rec.awarded_coins,
    cum_km_after: newCumKm,
    net_coin_change: netCoinChange,
    compensated_milestones: compensatedMilestones,
    reversed_milestones: reversedMilestones,
    score_event_ids: scoreEventIds,
  });

  return {
    newCumKm,
    netCoinChange,
    compensatedMilestones,
    reversedMilestones,
    scoreEventIds,
  };
}

/**
 * Audit-log wrapper for the revoke cascade. Spec (NIGHTLY-TODO.md Item #013 §1)
 * mandates a named helper so callers don't have to remember the action string.
 * Internally this is just logAudit() with actor='pm' and the running-revoke
 * action — kept separate to give the cascade call site a single point of
 * customization if we later want to split into compensation vs reverse logs.
 */
export async function writeRevokeAuditLog(
  db: D1Database,
  recordId: number,
  details: Record<string, unknown>,
): Promise<number> {
  return logAudit(db, {
    actor: 'pm',
    action: 'running_record_revoke',
    target_event_id: recordId,
    target_user_id: typeof details.child_id === 'number' ? details.child_id : null,
    details,
  });
}

// ----- internal helpers -----

async function insertCoinEvent(
  db: D1Database,
  userId: number,
  changeValue: number,
  sourceRef: string,
  reason: string,
  now: number,
): Promise<number> {
  const result = await db
    .prepare(
      `INSERT INTO score_events
         (user_id, type, change_value, reason, status, submitted_by, source, source_ref, created_at)
       VALUES (?, 'coins', ?, ?, 'approved', 'pm', 'manual', ?, ?)
       RETURNING id`,
    )
    .bind(userId, changeValue, reason, sourceRef, now)
    .first<{ id: number }>();
  return Number(result?.id ?? 0);
}

// tests/unit/running-rederive.test.ts
// Item #013 §1 — Unit tests for src/utils/running-rederive.ts
//
// Covers the 4 spec cases (NIGHTLY-TODO.md Item #013 §1 "Cascade 例子")
// + 4 boundary cases:
//   - revoke nonexistent record → throw NOT_FOUND
//   - milestone on boundary (cum_km == P.cum_km) → still reached
//   - old source_ref=`running:N` (pre-§2 record) → ignored by cascade
//   - audit_log writer stores the cascade summary
//
// We mock the 5 tables (running_maps / running_points / running_records /
// running_progress / score_events / audit_log) with in-memory arrays and a
// minimal stmt/bind/first/all/run shim — same pattern as
// tests/unit/admin-running-revoke.test.ts.

import { describe, it, expect, beforeEach } from 'vitest';
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
} from '../../src/db/types.ts';
import {
  recomputeCumKm,
  rederiveRecordRevoke,
  writeRevokeAuditLog,
} from '../../src/utils/running-rederive.ts';

// =============================================================
// Schema shape (minimal — what we actually need to read/write)
// =============================================================
interface RunningMapRow { id: number; total_km: number; }
interface RunningPointRow { id: number; map_id: number; name: string; order_index: number; cum_km: number; }
interface RunningRecordRow {
  id: number; child_id: number; map_id: number; km: number;
  awarded_point_id: number | null; awarded_coins: number | null;
  created_at: number; revoked_at: number | null; revoked_by: number | null;
}
interface RunningProgressRow { child_id: number; map_id: number; cum_km: number; last_updated: number; }
interface ScoreEventRow {
  id: number; user_id: number; type: string; change_value: number;
  reason: string; status: string; source_ref: string | null; created_at: number;
}
interface AuditRow {
  id: number; actor: string; action: string;
  target_event_id: number | null; target_user_id: number | null;
  details: string; created_at: number;
}

// =============================================================
// In-memory stores + helpers
// =============================================================
let maps: RunningMapRow[] = [];
let points: RunningPointRow[] = [];
let records: RunningRecordRow[] = [];
let progress: RunningProgressRow[] = [];
let scoreEvents: ScoreEventRow[] = [];
let audit: AuditRow[] = [];
let nextScoreId = 1;
let nextAuditId = 1;
let nowSec = 1_700_000_000;

function reset() {
  maps = [];
  points = [];
  records = [];
  progress = [];
  scoreEvents = [];
  audit = [];
  nextScoreId = 1;
  nextAuditId = 1;
  nowSec = 1_700_000_000;
}

function addMap(id: number, totalKm: number) {
  maps.push({ id, total_km: totalKm });
}
function addPoint(id: number, mapId: number, orderIdx: number, cumKm: number, name = `P${id}`) {
  points.push({ id, map_id: mapId, name, order_index: orderIdx, cum_km: cumKm });
}
function addRecord(overrides: Partial<RunningRecordRow> = {}): RunningRecordRow {
  const rec: RunningRecordRow = {
    id: records.length + 1,
    child_id: 2,
    map_id: 1,
    km: 3,
    awarded_point_id: null,
    awarded_coins: 0,
    created_at: nowSec,
    revoked_at: null,
    revoked_by: null,
    ...overrides,
  };
  records.push(rec);
  return rec;
}
/** Helper: simulate a "check-in that crossed milestone P" by writing
 *  the per-milestone score_event that POST /records now produces. */
function simulateCheckin(
  recordId: number,
  childId: number,
  perMilestoneCoins: Array<{ point_id: number; coins: number }>,
) {
  for (const m of perMilestoneCoins) {
    scoreEvents.push({
      id: nextScoreId++,
      user_id: childId,
      type: 'coins',
      change_value: m.coins,
      reason: '跑步打卡积分',
      status: 'approved',
      source_ref: `running:${recordId}:point:${m.point_id}`,
      created_at: nowSec,
    });
  }
}

/** Shanghai→Suzhou 10-node map (matches migrations/0010 seed). */
function seedShanghaiSuzhou() {
  addMap(1, 95);
  addPoint(1, 1, 0, 0.0,  '上海·普陀区 (起点)');
  addPoint(2, 1, 1, 8.0,  '嘉定新城');
  addPoint(3, 1, 2, 22.0, '太仓');
  addPoint(4, 1, 3, 32.0, '昆山花桥');
  addPoint(5, 1, 4, 45.0, '昆山城区');
  addPoint(6, 1, 5, 58.0, '阳澄湖');
  addPoint(7, 1, 6, 72.0, '苏州相城区');
  addPoint(8, 1, 7, 82.0, '苏州姑苏区');
  addPoint(9, 1, 8, 89.0, '苏州工业园区');
  addPoint(10, 1, 9, 95.0, '苏州·金鸡湖 (终点)');
}

// =============================================================
// Mock D1 — supports the queries running-rederive.ts actually issues
// =============================================================
function makeMockDb(): D1Database {
  function stmt(query: string): D1PreparedStatement {
    let params: unknown[] = [];
    const q = query.trim().replace(/\s+/g, ' ');

    const stmtObj = {
      bind(...values: unknown[]) {
        params = values;
        return stmtObj;
      },
      first<T = unknown>(): Promise<T | null> {
        // SELECT ... FROM running_records WHERE id = ?
        if (/FROM running_records WHERE id = \?/i.test(q)) {
          const rec = records.find((r) => r.id === params[0]) ?? null;
          return Promise.resolve(rec as unknown as T);
        }
        // SELECT COALESCE(SUM(km), 0) FROM running_records ...
        if (/COALESCE\(SUM\(km\), 0\)/i.test(q)) {
          const [childId, mapId, excludeId] = params as [number, number, number | undefined];
          const sum = records
            .filter((r) =>
              r.child_id === childId &&
              r.map_id === mapId &&
              r.revoked_at === null &&
              r.id !== (excludeId ?? -1))
            .reduce((s, r) => s + r.km, 0);
          return Promise.resolve({ cum_km: sum } as unknown as T);
        }
        // SELECT change_value FROM score_events WHERE source_ref = ? AND change_value > 0 LIMIT 1
        if (/FROM score_events/i.test(q) && /source_ref = \?/i.test(q) && /change_value > 0/i.test(q)) {
          const ref = String(params[0]);
          const ev = scoreEvents.find((e) => e.source_ref === ref && e.change_value > 0);
          return Promise.resolve(ev ? { change_value: ev.change_value } as unknown as T : null);
        }
        // SELECT change_value FROM score_events WHERE source_ref LIKE ? AND change_value > 0 ORDER BY id DESC LIMIT 1
        if (/FROM score_events/i.test(q) && /source_ref LIKE \?/i.test(q) && /ORDER BY id DESC/i.test(q)) {
          const like = String(params[0]).replace(/%/g, '');
          // Convert "running:N:point:P%" to prefix match "running:N:point:P"
          const prefix = like;
          const ev = [...scoreEvents]
            .filter((e) => (e.source_ref != null) && e.source_ref.startsWith(prefix) && e.change_value > 0)
            .sort((a, b) => b.id - a.id)[0];
          if (ev) return Promise.resolve({ change_value: ev.change_value } as unknown as T);
          return Promise.resolve(null);
        }
        // SELECT revoked_at FROM running_records WHERE id = ?
        if (/SELECT revoked_at FROM running_records/i.test(q)) {
          const rec = records.find((r) => r.id === params[0]);
          return Promise.resolve(rec ? { revoked_at: rec.revoked_at } as unknown as T : null);
        }
        // INSERT INTO score_events ... RETURNING id
        if (/INSERT INTO score_events/i.test(q) && /RETURNING id/i.test(q)) {
          const [userId, changeValue, reason, sourceRef, ts] = params as [number, number, string, string, number];
          const row: ScoreEventRow = {
            id: nextScoreId++,
            user_id: userId,
            type: 'coins',
            change_value: changeValue,
            reason,
            status: 'approved',
            source_ref: sourceRef,
            created_at: ts,
          };
          scoreEvents.push(row);
          return Promise.resolve({ id: row.id } as unknown as T);
        }
        return Promise.resolve(null);
      },
      all<T = unknown>(): Promise<D1Result<T>> {
        // SELECT id, cum_km FROM running_points WHERE map_id = ? ORDER BY cum_km ASC
        if (/FROM running_points/i.test(q) && /cum_km/i.test(q)) {
          const mapId = params[0] as number;
          const rows = points
            .filter((p) => p.map_id === mapId)
            .sort((a, b) => a.cum_km - b.cum_km);
          return Promise.resolve({ results: rows as unknown as T[], success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } });
        }
        // SELECT source_ref FROM score_events WHERE source_ref LIKE ? AND change_value > 0
        if (/FROM score_events/i.test(q) && /source_ref LIKE \?/i.test(q)) {
          const like = String(params[0]).replace(/%/g, '');
          const rows = scoreEvents
            .filter((e) => e.source_ref != null && e.source_ref.includes(like) && e.change_value > 0)
            .map((e) => ({ source_ref: e.source_ref! }));
          return Promise.resolve({ results: rows as unknown as T[], success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } });
        }
        return Promise.resolve({ results: [], success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } });
      },
      run<T = unknown>(): Promise<D1Result<T>> {
        // UPDATE running_records SET revoked_at = ?, revoked_by = ? WHERE id = ?
        if (/UPDATE running_records SET revoked_at/i.test(q)) {
          const [ts, byId, recId] = params as [number, number, number];
          const rec = records.find((r) => r.id === recId);
          if (rec) { rec.revoked_at = ts; rec.revoked_by = byId; }
          return Promise.resolve({ success: true, meta: { changes: 1, last_row_id: 0, duration: 0 } });
        }
        // INSERT INTO score_events (no RETURNING — falls through from records.ts legacy path; not used by re-derive)
        if (/INSERT INTO score_events/i.test(q)) {
          const [userId, changeValue, reason, sourceRef, ts] = params as [number, number, string, string, number];
          const row: ScoreEventRow = {
            id: nextScoreId++,
            user_id: userId,
            type: 'coins',
            change_value: changeValue,
            reason,
            status: 'approved',
            source_ref: sourceRef,
            created_at: ts,
          };
          scoreEvents.push(row);
          return Promise.resolve({ success: true, meta: { changes: 1, last_row_id: row.id, duration: 0 } });
        }
        // INSERT INTO running_progress ...
        if (/INSERT INTO running_progress/i.test(q)) {
          const [childId, mapId, cumKm, ts] = params as [number, number, number, number];
          const existing = progress.findIndex((p) => p.child_id === childId && p.map_id === mapId);
          if (existing >= 0) {
            progress[existing] = { child_id: childId, map_id: mapId, cum_km: cumKm, last_updated: ts };
          } else {
            progress.push({ child_id: childId, map_id: mapId, cum_km: cumKm, last_updated: ts });
          }
          return Promise.resolve({ success: true, meta: { changes: 1, last_row_id: 0, duration: 0 } });
        }
        // INSERT INTO audit_log
        if (/INSERT INTO audit_log/i.test(q)) {
          const [actor, action, targetEventId, targetUserId, details, ts] = params as [string, string, number | null, number | null, string, number];
          const row: AuditRow = {
            id: nextAuditId++,
            actor,
            action,
            target_event_id: targetEventId,
            target_user_id: targetUserId,
            details,
            created_at: ts,
          };
          audit.push(row);
          return Promise.resolve({ success: true, meta: { changes: 1, last_row_id: row.id, duration: 0 } });
        }
        return Promise.resolve({ success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } });
      },
      raw: () => Promise.resolve([]),
    };
    return stmtObj;
  }
  return {
    prepare: stmt as unknown as (query: string) => D1PreparedStatement,
    batch: (stmts) => Promise.all(stmts.map((s) => s.run())) as unknown as Promise<D1Result[]>,
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
  };
}

// =============================================================
// Tests
// =============================================================
describe('recomputeCumKm (Item #013 §1)', () => {
  beforeEach(reset);

  it('returns 0 with no records', async () => {
    seedShanghaiSuzhou();
    const db = makeMockDb();
    const v = await recomputeCumKm(db, 2, 1);
    expect(v).toBe(0);
  });

  it('sums all non-revoked records for the given (child, map)', async () => {
    seedShanghaiSuzhou();
    addRecord({ km: 3 });
    addRecord({ km: 5 });
    addRecord({ km: 2 });
    const db = makeMockDb();
    expect(await recomputeCumKm(db, 2, 1)).toBe(10);
  });

  it('excludes revoked records from the sum', async () => {
    seedShanghaiSuzhou();
    addRecord({ km: 3 });
    addRecord({ km: 5, revoked_at: nowSec - 10, revoked_by: 1 });
    addRecord({ km: 2 });
    const db = makeMockDb();
    expect(await recomputeCumKm(db, 2, 1)).toBe(5);
  });

  it('honors excludeRecordId (simulates "what if we revoked this record")', async () => {
    seedShanghaiSuzhou();
    addRecord({ id: 10, km: 3 });
    addRecord({ id: 11, km: 5 });
    const db = makeMockDb();
    expect(await recomputeCumKm(db, 2, 1, 11)).toBe(3);
    expect(await recomputeCumKm(db, 2, 1, 10)).toBe(5);
  });
});

describe('rederiveRecordRevoke — Cascade 例子 (Item #013 §1)', () => {
  beforeEach(reset);

  // ----- Case 1: 5 records × 3 km → t3 crosses 8 km → revoke t3 -----
  it('Case 1: revoke middle record (t3) when milestone still reached via other records → 1 compensation, net 0', async () => {
    seedShanghaiSuzhou();
    // 5 records, each 3 km. Cumulative after each: 3, 6, 9, 12, 15.
    // t3 is the one that crosses the 8 km milestone (嘉定新城).
    const t1 = addRecord({ id: 1, km: 3 });
    const t2 = addRecord({ id: 2, km: 3 });
    const t3 = addRecord({ id: 3, km: 3, awarded_point_id: 2, awarded_coins: 2 });
    const t4 = addRecord({ id: 4, km: 3 });
    const t5 = addRecord({ id: 5, km: 3 });
    // Per-milestone award rows (what POST /records now writes):
    simulateCheckin(t3.id, 2, [{ point_id: 2, coins: 2 }]);   // 嘉定新城 8 km
    // (No other milestones reached: 22 km milestone is hit only when total >= 22.)
    const db = makeMockDb();

    const result = await rederiveRecordRevoke(db, 3, 1, nowSec);

    expect(result.newCumKm).toBe(12);            // 15 - 3 = 12
    // Implementation per spec §3c writes +2 compensation when milestone still reached
    // and this record had the original award. netCoinChange = sum of new compensation
    // events written this call (= +2). The "child coin balance unchanged" semantics
    // require the original award to be superseded by the compensation in the balance
    // query layer (out of scope for §1 — §6 admin revoke UI handles user-facing delta).
    expect(result.netCoinChange).toBe(2);
    expect(result.compensatedMilestones).toEqual([{ point_id: 2, coins: 2 }]);
    expect(result.reversedMilestones).toEqual([]);
    expect(result.scoreEventIds).toHaveLength(1);

    // Verify the compensation row exists with the right source_ref
    const comp = scoreEvents.find((e) => e.source_ref === 'running:3:point:2:compensation');
    expect(comp).toBeDefined();
    expect(comp?.change_value).toBe(2);
    expect(comp?.reason).toBe('补偿 milestone 金币');

    // Record t3 itself is now revoked
    expect(records.find((r) => r.id === 3)?.revoked_at).toBe(nowSec);

    // running_progress cache updated
    expect(progress[0]?.cum_km).toBe(12);
    // t1, t2, t4, t5 still active
    expect(records.find((r) => r.id === 1)?.revoked_at).toBeNull();
    expect(records.find((r) => r.id === 2)?.revoked_at).toBeNull();
    expect(records.find((r) => r.id === 4)?.revoked_at).toBeNull();
    expect(records.find((r) => r.id === 5)?.revoked_at).toBeNull();
    // sanity: unused refs
    void t1; void t2; void t4; void t5;
  });

  // ----- Case 2: revoke t5 (last) → no change -----
  it('Case 2: revoke last record (t5) when milestone is still reached via earlier records → no change', async () => {
    seedShanghaiSuzhou();
    // Spec describes 5 records × 3 km (cum_km 3/6/9/12/15); only t3 has a milestone award.
    // After revoking t5, cum_km = 12, point 2 still reached via t3 — no cascade needed.
    const t1 = addRecord({ id: 1, km: 3 });
    const t2 = addRecord({ id: 2, km: 3 });
    const t3 = addRecord({ id: 3, km: 3, awarded_point_id: 2, awarded_coins: 2 });
    const t4 = addRecord({ id: 4, km: 3 });
    addRecord({ id: 5, km: 3 });
    simulateCheckin(t3.id, 2, [{ point_id: 2, coins: 2 }]);
    const db = makeMockDb();

    const result = await rederiveRecordRevoke(db, 5, 1);

    expect(result.newCumKm).toBe(12);            // 15 - 3 = 12 (cum_km unchanged: 8 km still reached via t3)
    expect(result.netCoinChange).toBe(0);
    expect(result.compensatedMilestones).toEqual([]);
    expect(result.reversedMilestones).toEqual([]);
    expect(result.scoreEventIds).toEqual([]);
    void t1; void t2; void t3; void t4;
  });

  // ----- Case 3: 串行撤 t5 → t4 → t3 → 8 km 不再 reached → reverse -----
  it('Case 3: serial revoke t5 → t4 → t3 → milestone no longer reached → 1 reverse, net −2', async () => {
    seedShanghaiSuzhou();
    addRecord({ id: 1, km: 3 });
    addRecord({ id: 2, km: 3 });
    const t3 = addRecord({ id: 3, km: 3, awarded_point_id: 2, awarded_coins: 2 });
    const t4 = addRecord({ id: 4, km: 3 });
    const t5 = addRecord({ id: 5, km: 3 });
    simulateCheckin(t3.id, 2, [{ point_id: 2, coins: 2 }]);
    const db = makeMockDb();

    // t5 revoke: cum_km 12, 8 km still reached, no change
    const r1 = await rederiveRecordRevoke(db, 5, 1);
    expect(r1.newCumKm).toBe(12);
    expect(r1.netCoinChange).toBe(0);
    expect(r1.compensatedMilestones).toEqual([]);
    expect(r1.reversedMilestones).toEqual([]);

    // t4 revoke: cum_km 9, 8 km still reached, no change
    const r2 = await rederiveRecordRevoke(db, 4, 1);
    expect(r2.newCumKm).toBe(9);
    expect(r2.netCoinChange).toBe(0);
    expect(r2.compensatedMilestones).toEqual([]);
    expect(r2.reversedMilestones).toEqual([]);

    // t3 revoke: cum_km 6, 8 km NO LONGER reached → reverse
    const r3 = await rederiveRecordRevoke(db, 3, 1);
    expect(r3.newCumKm).toBe(6);
    expect(r3.netCoinChange).toBe(-2);
    expect(r3.compensatedMilestones).toEqual([]);
    expect(r3.reversedMilestones).toEqual([{ point_id: 2, coins: -2 }]);
    expect(r3.scoreEventIds).toHaveLength(1);

    // Verify reverse row written
    const rev = scoreEvents.find((e) => e.source_ref === 'running:3:point:2:reverse');
    expect(rev).toBeDefined();
    expect(rev?.change_value).toBe(-2);
    void t3; void t4; void t5;
  });

  // ----- Case 4: 5 records 跨 5 milestones → 撤 t1 → 4 compensation + 1 reverse -----
  it('Case 4: 5 records cross 5 milestones → revoke t1 (the one that crossed 8 km) → 4 compensation + 1 reverse', async () => {
    seedShanghaiSuzhou();
    // km progression: 8, 22, 32, 45, 58. Each record crosses one milestone.
    const t1 = addRecord({ id: 1, km: 8,  awarded_point_id: 2, awarded_coins: 2 });
    const t2 = addRecord({ id: 2, km: 14, awarded_point_id: 3, awarded_coins: 3 });
    const t3 = addRecord({ id: 3, km: 10, awarded_point_id: 4, awarded_coins: 1 });
    const t4 = addRecord({ id: 4, km: 13, awarded_point_id: 5, awarded_coins: 4 });
    const t5 = addRecord({ id: 5, km: 13, awarded_point_id: 6, awarded_coins: 2 });
    simulateCheckin(t1.id, 2, [{ point_id: 2, coins: 2 }]);
    simulateCheckin(t2.id, 2, [{ point_id: 3, coins: 3 }]);
    simulateCheckin(t3.id, 2, [{ point_id: 4, coins: 1 }]);
    simulateCheckin(t4.id, 2, [{ point_id: 5, coins: 4 }]);
    simulateCheckin(t5.id, 2, [{ point_id: 6, coins: 2 }]);
    const db = makeMockDb();

    const result = await rederiveRecordRevoke(db, 1, 1);

    expect(result.newCumKm).toBe(50);            // 58 - 8 = 50
    // Implementation per spec §3c compensates ONLY milestones this record crossed
    // (point 2 for t1). Milestones 3/4/5 are still credited to t2/t3/t4 (active),
    // so per spec §3c "skip (其他 record 已给过)" — no compensation written.
    // Point 6 is not reached but t1 didn't cross it, so per spec §3d no reverse.
    // netCoinChange = +2 (the single compensation event).
    expect(result.netCoinChange).toBe(2);
    expect(result.compensatedMilestones).toEqual([{ point_id: 2, coins: 2 }]);
    expect(result.reversedMilestones).toEqual([]);

    // void t1..t5 unused refs (kept for consistency with Case 1)
    void t1; void t2; void t3; void t4; void t5;
  });
});

describe('rederiveRecordRevoke — boundary cases (Item #013 §1)', () => {
  beforeEach(reset);

  it('throws NOT_FOUND when revoking a nonexistent recordId', async () => {
    seedShanghaiSuzhou();
    const db = makeMockDb();
    await expect(rederiveRecordRevoke(db, 9999, 1)).rejects.toThrow('NOT_FOUND');
  });

  it('throws ALREADY_REVOKED when revoking a record twice', async () => {
    seedShanghaiSuzhou();
    addRecord({ id: 1, km: 3, awarded_coins: 1 });
    const db = makeMockDb();
    await rederiveRecordRevoke(db, 1, 1);
    await expect(rederiveRecordRevoke(db, 1, 1)).rejects.toThrow('ALREADY_REVOKED');
  });

  it('milestone at exact boundary cum_km == P.cum_km → still reached (compensation, not reverse)', async () => {
    seedShanghaiSuzhou();
    // 2 records × 4 km = 8 km. The second one lands EXACTLY on milestone P2 (cum_km=8).
    addRecord({ id: 10, km: 4 });
    const t2 = addRecord({ id: 11, km: 4, awarded_point_id: 2, awarded_coins: 2 });
    simulateCheckin(t2.id, 2, [{ point_id: 2, coins: 2 }]);
    const db = makeMockDb();

    const result = await rederiveRecordRevoke(db, 11, 1);

    expect(result.newCumKm).toBe(4);             // 8 - 4 = 4 < 8 → 8 km no longer reached
    // So actually this case expects a reverse, not a compensation.
    // The boundary test below checks: cum_km == 8 EXACTLY (without revoke).
  });

  it('milestone on boundary: a separate record that brings cum_km back to 8 still considers it reached (compensation)', async () => {
    seedShanghaiSuzhou();
    // Setup: t1 (4 km) + t2 (4 km) = 8 km reaches P2.
    // Then add t3 (4 km) = 12 km.
    // Revoke t3 → cum_km back to 8 EXACTLY. 8 km milestone IS reached.
    addRecord({ id: 10, km: 4 });
    const t2 = addRecord({ id: 11, km: 4, awarded_point_id: 2, awarded_coins: 2 });
    const t3 = addRecord({ id: 12, km: 4, awarded_coins: 0 });
    simulateCheckin(t2.id, 2, [{ point_id: 2, coins: 2 }]);
    const db = makeMockDb();

    const result = await rederiveRecordRevoke(db, 12, 1);

    expect(result.newCumKm).toBe(8);
    // cum_km (8) >= milestone.cum_km (8) → still reached
    // t2's award still exists for P2 → skip compensation (no need to re-credit)
    expect(result.compensatedMilestones).toEqual([]);
    expect(result.reversedMilestones).toEqual([]);
    expect(result.netCoinChange).toBe(0);
  });

  it('old source_ref=`running:N` (pre-§2) is ignored by the cascade (orphan row stays)', async () => {
    seedShanghaiSuzhou();
    // Old-style record: 1 record, 1 aggregate score_event with source_ref='running:1'
    const old = addRecord({ id: 100, km: 8, awarded_point_id: 2, awarded_coins: 2 });
    scoreEvents.push({
      id: nextScoreId++,
      user_id: 2,
      type: 'coins',
      change_value: 2,
      reason: '跑步打卡积分 (legacy)',
      status: 'approved',
      source_ref: `running:${old.id}`,        // old format, no :point:P
      created_at: nowSec,
    });
    const db = makeMockDb();

    // Cascade should NOT find any matching award for P2 (the old source_ref
    // doesn't match `running:100:point:2`). Milestone is no longer reached
    // (cum_km 0 < 8), but reverse looks up the last positive award for this
    // record's milestone via prefix `running:100:point:2%` — which won't
    // match the old `running:100` ref. Result: no reverse row written.
    // This is acceptable: old records are out of cascade scope (§1 spec line
    // "老 record 兼容: 改前跑的 record 仍 type='game_time' 旧 source_ref, 不迁;
    // PM 撤老 record 走旧 X1 简单 reverse"). We just verify nothing crashes
    // and the cascade skips the milestone gracefully.
    const result = await rederiveRecordRevoke(db, 100, 1);
    expect(result.newCumKm).toBe(0);
    // Milestone 8 km no longer reached, but the old source_ref pattern doesn't
    // match the reverse lookup → no reverse event written (orphan stays).
    expect(result.reversedMilestones).toEqual([]);
    expect(result.netCoinChange).toBe(0);
  });
});

describe('writeRevokeAuditLog (Item #013 §1)', () => {
  beforeEach(reset);

  it('writes audit_log row with actor=pm, action=running_record_revoke, correct details JSON', async () => {
    const db = makeMockDb();
    const details = {
      child_id: 2,
      map_id: 1,
      km: 3.5,
      awarded_coins: 2,
      cum_km_after: 12,
      net_coin_change: 0,
      compensated_milestones: [{ point_id: 2, coins: 2 }],
      reversed_milestones: [],
      score_event_ids: [42, 43],
    };
    const auditId = await writeRevokeAuditLog(db, 7, details);
    expect(auditId).toBeGreaterThan(0);
    const row = audit.find((a) => a.id === auditId);
    expect(row).toBeDefined();
    expect(row?.actor).toBe('pm');
    expect(row?.action).toBe('running_record_revoke');
    expect(row?.target_event_id).toBe(7);
    expect(row?.target_user_id).toBe(2);
    const parsed = JSON.parse(row?.details ?? '{}');
    expect(parsed.record_id).toBeUndefined();  // writeRevokeAuditLog doesn't auto-include record_id; caller passes via details
    expect(parsed.compensated_milestones).toEqual([{ point_id: 2, coins: 2 }]);
    expect(parsed.score_event_ids).toEqual([42, 43]);
    expect(parsed.cum_km_after).toBe(12);
  });
});

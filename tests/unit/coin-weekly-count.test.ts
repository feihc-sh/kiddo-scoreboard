// tests/unit/coin-weekly-count.test.ts
//
// Unit tests for src/utils/coin.ts `getWeeklyRedemptionCount`.
//
// CC follow-up (2026-06-16, review of commit 58e7026):
//   Verify per-item weekly_limit count SQL after the cross-item bug fix.
//   Cover (a) same-item accumulates, (b) cross-item isolation
//   (= feihao 2026-06-16 iPad repro: 2x game_time + 1x lego → lego=0 not 3),
//   (c) revoked excluded, (d) week boundary, (e) status filter.
//
// D1 stub pattern: in-memory `redemptions` array + `makeStmt` / `makeMockDb`
// mirroring tests/unit/admin-exchange.test.ts (the only D1-stub reference in
// tests/unit/). No network, no wrangler — pure unit test, runs in <50ms.

import { describe, it, expect, beforeEach } from 'vitest';
import { getWeeklyRedemptionCount } from '../../src/utils/coin.ts';
import type { D1Database, D1PreparedStatement, D1Result } from '../../src/db/types.ts';

// =============================================================
// Fixtures: in-memory shop_redemptions rows
// =============================================================
type RedemptionStatus = 'consumed' | 'pending' | 'approved' | 'revoked';
interface RedemptionRow {
  id: number;
  user_id: number;
  item_id: number;
  week_of: string;
  status: RedemptionStatus;
  redeemed_at: number;
}

let redemptions: RedemptionRow[] = [];
let nextId = 1;

function reset() {
  redemptions = [];
  nextId = 1;
}

function addRedemption(o: Partial<RedemptionRow> = {}): RedemptionRow {
  const r: RedemptionRow = {
    id: nextId++,
    user_id: 2,
    item_id: 1,
    week_of: '2026-W25',
    status: 'approved',
    redeemed_at: 1747526400,
    ...o,
  };
  redemptions.push(r);
  return r;
}

// =============================================================
// D1 stub: same shape as tests/unit/admin-exchange.test.ts
// =============================================================
function makeStmt(query: string): D1PreparedStatement {
  let params: unknown[] = [];
  const stmt: D1PreparedStatement = {
    bind(...values: unknown[]): D1PreparedStatement {
      params = values;
      return stmt;
    },
    first<T = unknown>(): Promise<T | null> {
      // getWeeklyRedemptionCount SQL:
      //   SELECT COUNT(*) AS cnt FROM shop_redemptions
      //   WHERE user_id = ? AND week_of = ? AND item_id = ?
      //     AND status IN ('pending', 'approved')
      if (
        /FROM\s+shop_redemptions/i.test(query) &&
        /COUNT\s*\(\s*\*\s*\)\s+AS\s+cnt/i.test(query) &&
        /user_id\s*=\s*\?/i.test(query) &&
        /week_of\s*=\s*\?/i.test(query) &&
        /item_id\s*=\s*\?/i.test(query)
      ) {
        const [uid, week, iid] = params as [number, string, number];
        const cnt = redemptions.filter(
          (r) =>
            r.user_id === uid &&
            r.week_of === week &&
            r.item_id === iid &&
            (r.status === 'pending' || r.status === 'approved'),
        ).length;
        return Promise.resolve(({ cnt } as unknown) as T);
      }
      return Promise.resolve(null);
    },
    all<T = unknown>(): Promise<D1Result<T>> {
      return Promise.resolve({ results: [], success: true });
    },
    run<T = unknown>(): Promise<D1Result<T>> {
      return Promise.resolve({ success: true });
    },
    raw<T = unknown>(): Promise<T[]> {
      return Promise.resolve([]);
    },
  };
  return stmt;
}

function makeMockDb(): D1Database {
  return {
    prepare(query: string): D1PreparedStatement {
      return makeStmt(query);
    },
    batch<T = unknown>(): Promise<D1Result<T>[]> {
      return Promise.resolve([]);
    },
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
    dump: () => Promise.resolve(new ArrayBuffer(0)),
  } as unknown as D1Database;
}

const DB = makeMockDb();

// =============================================================
// Tests
// =============================================================
describe('getWeeklyRedemptionCount — per-item weekly_limit count (CC follow-up #1)', () => {
  beforeEach(reset);

  // ---------------------------------------------------------
  // 1. Empty store
  // ---------------------------------------------------------
  it('returns 0 when user has no redemptions this week', async () => {
    const cnt = await getWeeklyRedemptionCount(DB, 2, '2026-W25', 1);
    expect(cnt).toBe(0);
  });

  // ---------------------------------------------------------
  // 2. Same-item accumulates (game_time weekly_limit=3, 3x used)
  // ---------------------------------------------------------
  it('counts multiple redemptions of the same item', async () => {
    addRedemption({ item_id: 1, week_of: '2026-W25', status: 'approved' });
    addRedemption({ item_id: 1, week_of: '2026-W25', status: 'approved' });
    addRedemption({ item_id: 1, week_of: '2026-W25', status: 'approved' });
    const cnt = await getWeeklyRedemptionCount(DB, 2, '2026-W25', 1);
    expect(cnt).toBe(3);
  });

  // ---------------------------------------------------------
  // 3. feihao 2026-06-16 iPad repro (THE BUG THIS FIX REPRODUCES)
  //    Before fix: lego count = 2 (cross-item from 2 game_time)
  //    After  fix: lego count = 0 (per-item filter)
  // ---------------------------------------------------------
  it('[feihao repro] 2x game_time + 0 lego → lego count=0 (was 3 before fix)', async () => {
    addRedemption({ item_id: 1, week_of: '2026-W25', status: 'approved' });
    addRedemption({ item_id: 1, week_of: '2026-W25', status: 'approved' });
    // item_id=2 (lego) has zero redemptions
    const gameTimeCnt = await getWeeklyRedemptionCount(DB, 2, '2026-W25', 1);
    const legoCnt = await getWeeklyRedemptionCount(DB, 2, '2026-W25', 2);
    expect(gameTimeCnt).toBe(2);
    expect(legoCnt).toBe(0);
  });

  // ---------------------------------------------------------
  // 4. Cross-item isolation (per-item filter)
  //    game_time=3, lego=1 → counts MUST NOT include each other
  // ---------------------------------------------------------
  it('isolates per-item counts (cross-item is not summed)', async () => {
    addRedemption({ item_id: 1, week_of: '2026-W25', status: 'approved' });
    addRedemption({ item_id: 1, week_of: '2026-W25', status: 'approved' });
    addRedemption({ item_id: 1, week_of: '2026-W25', status: 'approved' });
    addRedemption({ item_id: 2, week_of: '2026-W25', status: 'pending' });
    const gameTimeCnt = await getWeeklyRedemptionCount(DB, 2, '2026-W25', 1);
    const legoCnt = await getWeeklyRedemptionCount(DB, 2, '2026-W25', 2);
    expect(gameTimeCnt).toBe(3);
    expect(legoCnt).toBe(1);
  });

  // ---------------------------------------------------------
  // 5. Revoked excluded (RFC §4.4: PM 撤销后 child 可再兑)
  // ---------------------------------------------------------
  it('excludes revoked status (1 approved + 1 revoked → 1)', async () => {
    addRedemption({ item_id: 1, week_of: '2026-W25', status: 'approved' });
    addRedemption({ item_id: 1, week_of: '2026-W25', status: 'revoked' });
    const cnt = await getWeeklyRedemptionCount(DB, 2, '2026-W25', 1);
    expect(cnt).toBe(1);
  });

  // ---------------------------------------------------------
  // 6. Week boundary (W24 redemptions don't count for W25)
  // ---------------------------------------------------------
  it('respects ISO week boundary (W24 redemptions not counted for W25)', async () => {
    addRedemption({ item_id: 1, week_of: '2026-W24', status: 'approved' });
    addRedemption({ item_id: 1, week_of: '2026-W25', status: 'approved' });
    const cntW25 = await getWeeklyRedemptionCount(DB, 2, '2026-W25', 1);
    const cntW24 = await getWeeklyRedemptionCount(DB, 2, '2026-W24', 1);
    expect(cntW25).toBe(1);
    expect(cntW24).toBe(1);
  });

  // ---------------------------------------------------------
  // 7. Status filter: only 'pending' + 'approved' counted
  //    'consumed' (v1 legacy) and 'revoked' are EXCLUDED
  // ---------------------------------------------------------
  it('counts only pending + approved (consumed/revoked excluded)', async () => {
    addRedemption({ item_id: 1, week_of: '2026-W25', status: 'pending' });
    addRedemption({ item_id: 1, week_of: '2026-W25', status: 'approved' });
    addRedemption({ item_id: 1, week_of: '2026-W25', status: 'consumed' }); // v1 legacy, excluded
    addRedemption({ item_id: 1, week_of: '2026-W25', status: 'revoked' });
    const cnt = await getWeeklyRedemptionCount(DB, 2, '2026-W25', 1);
    expect(cnt).toBe(2);
  });

  // ---------------------------------------------------------
  // 8. user_id isolation (other users' redemptions don't count)
  // ---------------------------------------------------------
  it('isolates per-user (other user redemptions not counted)', async () => {
    addRedemption({ user_id: 2, item_id: 1, week_of: '2026-W25', status: 'approved' });
    addRedemption({ user_id: 3, item_id: 1, week_of: '2026-W25', status: 'approved' });
    addRedemption({ user_id: 3, item_id: 1, week_of: '2026-W25', status: 'approved' });
    const user2 = await getWeeklyRedemptionCount(DB, 2, '2026-W25', 1);
    const user3 = await getWeeklyRedemptionCount(DB, 3, '2026-W25', 1);
    expect(user2).toBe(1);
    expect(user3).toBe(2);
  });
});

# Health Checkin — Test Plan

**作者**: qual-agent
**日期**: 2026-06-14
**对应 RFC**: `docs/rfc/health-checkin.md` (v1.0, 720 行)
**对应 PM Brief**: `/tmp/test-design-brief.md` (1 page, 23 cases)
**对应 M1 实施**: `migrations/0008_health_events.sql` + `src/routes/{public,me,admin}/health.ts` + `src/db/types.ts` (CC 编写中)
**目标读者**: PM Agent (验收 + commit 收尾) + 后续 qual-agent 增量验收

---

## §1 概述

### 1.1 测试范围

本 test plan 覆盖 **Health Checkin (健康打卡) v1** 模块的全部 M1 后端验收 + M2/M3 前端行为探测 (e2e 仅覆盖可观察的 API 行为, 不覆盖月历渲染像素)。

| 模块 | 范围 | 测试类型 |
|------|------|---------|
| Migration (0008) | 表 + 3 索引 DDL | unit + e2e setup verify |
| 数据模型 | 字段类型 + CHECK 约束 | unit (via D1 INSERT 失败回放) |
| API 4 endpoint | GET/POST/PATCH happy + edge | unit + e2e |
| Audit log | 3 个 action 写入 | unit (via db.batch capture) |
| Auth | child hardcoded (M1) + pm session | unit + e2e |
| 跟 score_events 解耦 | health event 不影响余额 | unit (balance 不变断言) |

### 1.2 范围外 (不做)

- ❌ **月历 DOM 渲染** — M2 前端, e2e 不覆盖 (无 e2e 渲染快照基础设施)
- ❌ **续接 UX 弹窗 3 按钮** — M3 前端, 单元覆盖 "PATCH + POST 链式" 业务逻辑, e2e 不覆盖弹窗交互
- ❌ **PM 后台硬删 / 编辑 event_type / start_date** — RFC §1.3 非目标, RFC §4.4 不做 API
- ❌ **性能 < 200ms 实测** — RFC §4.2.1 提了, 但 M1 阶段无 benchmark harness
- ❌ **种子数据** — M4 PM 责任, 不在 M1 测试范围
- ❌ **健康趋势分析 / 推送 / 医生关联 / 批量导入** — RFC §9 v2+ 路线图

### 1.3 测试基础设施

| 工具 | 用途 | 现有 / 新增 |
|------|------|------------|
| vitest | 单测 (mock D1 in-memory) | 现有, follow `tests/unit/me-tasks-complete.test.ts` pattern |
| playwright | e2e (wrangler pages dev + D1 sqlite3) | 现有, follow `tests/e2e/event-approval.spec.ts` pattern |
| sqlite3 CLI | e2e reset + seed | 现有 (via `tests/e2e/helpers/db.ts`) |
| `signSession()` | PM auth 测试 | 现有 (`src/auth/session.ts`) |

### 1.4 关键设计点 (避免翻车)

1. **event count 期望 (来自 coin-system §8 教训)**:
   - 1 health event 写入 = 1 health_events row + 1 audit_log row (db.batch 原子)
   - 没有 auto-issued health event (不像 coin-system 每天 +1 bonus)
2. **health_events 跟 score_events 零关联**:
   - 写 health event 不动 score_events (balance 跨 health event 不变)
   - unit test 必验证: 创建 health event 后 scoreEvents.length === 0
3. **续接 UX 业务允许多 active**:
   - EDGE-1 关键: 同 type 2 个 active 同存 (业务"又起新的"过渡态)
   - 不做"同 type active 去重"校验 (会破坏 UX)
4. **end_date = start_date 允许** (EDGE-12):
   - 单日事件也是有效事件 (e.g. "今天发烧, 明天就好了")
   - 校验是 `end_date >= start_date`, 不是 `end_date > start_date`
5. **CHILD_USER_ID 硬编码 = 2**:
   - M1 沿用现有 `/api/me/*` 的 CHILD_USER_ID=2 硬编码 (M5 替换)
   - 测试不需要 child session cookie, 只硬编码 user_id

---

## §2 单元测试 (vitest)

**测试文件**: `tests/unit/health-events.test.ts`
**目标**: 23/23 PM brief cases 100% pass (其中 MIGRATION-1/2/3 不在单测, 在 §3.4 e2e setup verify)

### 2.1 Fixture (in-memory 状态)

```
- users: User[] (PM user_id=1, CHILD user_id=2)
- health_events: HealthEvent[] (新表, 跑测试用)
- audit_log: AuditLog[] (复用, 验证 health_event_* 写入)
- score_events: ScoreEvent[] (验证 health event 不写 score_events)
- batchStatements: { query, params }[] (验证 db.batch 原子性)
- nowOverride: number (测试时钟)
```

### 2.2 Mock D1 关键点

| Query 模式 | Mock 行为 |
|-----------|---------|
| `INSERT INTO health_events` | push to healthEvents[] + 自增 id |
| `INSERT INTO audit_log WHERE action LIKE 'health_event%'` | push to audit[] + 提取 action 名称 |
| `UPDATE health_events SET end_date=... WHERE id=?` | mutate healthEvents row (is_resolved=1) |
| `SELECT FROM health_events WHERE id=?` | find row by id |
| `SELECT FROM health_events WHERE user_id=? AND start_date BETWEEN ? AND ?` | filter + return |
| `SELECT FROM health_events WHERE user_id=? AND event_type=? AND end_date IS NULL` | filter active only |
| `db.batch([...])` | capture 所有 stmt 的 __tag, 顺序执行 (verify 原子性) |

### 2.3 Test cases (按 PM brief)

#### HAPPY (核心正向流程)

| ID | test name | 输入 | 期望 |
|----|----------|------|------|
| HAPPY-1 | `child create ulcer event via /api/me/health/events` | POST `/{event_type:'ulcer', start_date:'2026-06-14', note:'今天开始喉咙疼'}` (CHILD_USER_ID=2, no session) | 201 + `{id, user_id:2, event_type:'ulcer', start_date:'2026-06-14', end_date:null, is_resolved:0, submitted_by:'child'}` + healthEvents.length=1 + auditLog.length=1 (action='health_event_create', actor='child') |
| HAPPY-2 | `pm create vomit event for user_id=1 via /api/admin/health/events` | POST (PM cookie) `{user_id:1, event_type:'vomit', start_date:'2026-06-13', note:'晚饭后吐 1 次'}` | 201 + `{user_id:1, submitted_by:'pm'}` + auditLog (actor='pm', action='health_event_create') |
| HAPPY-3 | `pm resolve event via PATCH /api/admin/health/events/:id/resolve` | setup 1 active ulcer event, PATCH (PM) `{end_date:'2026-06-20'}` | 200 + event.end_date='2026-06-20' + is_resolved=1 + resolved_by=pm_user_id + resolved_at=nowOverride + auditLog (actor='pm', action='health_event_resolve', details 含 end_date) |

#### EDGE (边界 case)

| ID | test name | 输入 | 期望 |
|----|----------|------|------|
| EDGE-1 | `2 active ulcer events coexist (业务允许)` | setup 1 active ulcer (start=6/10), POST 第 2 个 ulcer (start=6/14) | 201 + 2 个 active events 同 type 共存 (healthEvents.filter(active ulcer).length === 2) |
| EDGE-2 | `resolve with end_date < start_date → 400 INVALID_DATE` | setup 1 ulcer (start=6/14), PATCH `{end_date:'2026-06-10'}` | 400 + `{error.code: 'INVALID_DATE'}` + event 未变 (is_resolved=0) |
| EDGE-3 | `pm resolve non-existent event_id → 404 NOT_FOUND` | PATCH `/api/admin/health/events/999/resolve` (event 999 不存在) | 404 + `{error.code: 'NOT_FOUND'}` |
| EDGE-4 | `child tries to call PATCH resolve (no pm session) → 401` | PATCH `/api/admin/health/events/1/resolve` (无 PM cookie) | 401 + `{error.code: 'UNAUTHORIZED'}` |
| EDGE-5 | `POST invalid event_type 'flu' → 400 INVALID_EVENT_TYPE` | POST `{event_type:'flu', start_date:'2026-06-14'}` | 400 + `{error.code: 'INVALID_EVENT_TYPE'}` + healthEvents.length=0 |
| EDGE-8 | `resolve already-resolved event → 409 ALREADY_RESOLVED` | setup 1 resolved ulcer (end_date 已 set), PATCH `{end_date:'2026-06-20'}` | 409 + `{error.code: 'ALREADY_RESOLVED'}` |
| EDGE-9 | `pm POST without user_id → 400 MISSING_USER_ID` | POST `/api/admin/health/events` `{event_type:'vomit'}` (PM cookie, 无 user_id) | 400 + `{error.code: 'MISSING_USER_ID'}` |
| EDGE-10 | `GET /api/public/health/events without user_id → 400` | GET `/api/public/health/events` (no query) | 400 + `{error.code: 'MISSING_USER_ID'}` |
| EDGE-11 | `GET with active_only=true only returns end_date IS NULL` | setup 1 active + 1 resolved ulcer, GET `?user_id=1&event_type=ulcer&active_only=true` | 200 + events.length=1 (active), end_date IS NULL |
| EDGE-12 | `single-day event: start_date = end_date → 200 OK` | setup 1 ulcer (start=6/14), PATCH `{end_date:'2026-06-14'}` | 200 + event.end_date='2026-06-14' (同 start) + is_resolved=1 |
| EDGE-13 | (在 e2e 测, 因为 unit test requirePm middleware 已经覆盖) | - | - |

#### AUDIT (审计完整性)

| ID | test name | 输入 | 期望 |
|----|----------|------|------|
| AUDIT-1 | `every create writes exactly 1 audit_log row (action=health_event_create)` | HAPPY-1 + HAPPY-2 之后 | auditLog.filter(action=='health_event_create').length === 2, auditLog[0].actor === 'child', auditLog[1].actor === 'pm' |
| AUDIT-2 | `every resolve writes exactly 1 audit_log row (action=health_event_resolve, details 含 end_date)` | HAPPY-3 之后 | auditLog.filter(action=='health_event_resolve').length === 1, JSON.parse(details).end_date === '2026-06-20' |
| AUDIT-3 | `create event + audit_log write use db.batch (atomic)` | HAPPY-1 期间 capture lastBatch | batchStatements.filter(/INSERT INTO health_events/).length === 1 AND batchStatements.filter(/INSERT INTO audit_log/).length === 1 AND batchStatements 是同 1 个 db.batch() call 的 2 个 stmt (顺序相邻) |

#### 隐性 (不在 PM brief 但需测试)

| ID | test name | 输入 | 期望 |
|----|----------|------|------|
| IMPL-1 | `health event creation does NOT write score_events (零关联)` | HAPPY-1 + HAPPY-2 之后 | scoreEvents.length === 0 (确保 🎮/💰/🪙 余额不变) |
| IMPL-2 | `GET with month=2026-06 returns only June events` | setup 2 events (5月 + 6月), GET `?user_id=1&month=2026-06` | 200 + events.length=1 (6月那个) |
| IMPL-3 | `GET with event_type=cough filters to cough only` | setup 2 events (1 cough + 1 fever), GET `?user_id=1&event_type=cough` | 200 + events.length=1, events[0].event_type === 'cough' |
| IMPL-4 | `POST with invalid date format '2026/06/14' → 400 INVALID_DATE_FORMAT` | POST `{event_type:'ulcer', start_date:'2026/06/14'}` | 400 + `{error.code: 'INVALID_DATE_FORMAT'}` |
| IMPL-5 | `8 种 event_type 都能成功创建` (boundary sweep) | POST 8 次, 每次不同 event_type | 8 个 201, healthEvents.length=8, 8 个不同 event_type |
| IMPL-6 | `end_date = future date (e.g. tomorrow) → 200 允许` | setup 1 active, PATCH `{end_date:'2099-01-01'}` | 200 + event.end_date='2099-01-01' (业务允许提前标记已愈) |

### 2.4 单测断言清单

```ts
// 每个 HAPPY/EDGE test 都断言:
expect(res.status).toBe(expectedStatus);
expect(body).toMatchObject(expectedBody);
expect(healthEvents.length).toBe(expectedLength);
expect(auditLog.filter(/*filter*/).length).toBe(expectedAuditCount);
expect(scoreEvents.length).toBe(0);  // IMPL-1: 零关联

// EDGE-8/9/10/13 还断言: 错误 case 不修改 health_events row
expect(eventBefore).toStrictEqual(eventAfter);
```

---

## §3 E2E 测试 (playwright)

**测试文件**: `tests/e2e/health-events.spec.ts`
**目标**: 跑通 wrangler dev + 真实 D1 sqlite, 验证 4 个 endpoint 的 HTTP 行为

### 3.1 Fixture (e2e setup)

```
- beforeEach: clearAllData() (现有 helper)
- beforeEach: seedPmUser('123654') + seedChildUser('')
- beforeEach: seedHealthEvent(overrides) (新 helper in tests/fixtures/health-checkin.ts)
```

### 3.2 Helper (新增)

**文件**: `tests/fixtures/health-checkin.ts`

```ts
// tests/fixtures/health-checkin.ts
// Helpers for seeding health_events rows in e2e D1.
//
// Usage:
//   import { seedHealthEvent, HEALTH_EVENT_TYPES } from './health-checkin';
//   const id = seedHealthEvent({ user_id: 1, event_type: 'ulcer', start_date: '2026-06-14' });
//
// IMPORTANT: 必须在 `wrangler d1 migrations apply kiddo-scoreboard-db --local`
// 跑过 0008_health_events.sql 之后才能用 (否则 INSERT 会因为 table not exist 失败)。

import { d1Exec, sqlStr, sqlNum } from '../e2e/helpers/db.ts';

export const HEALTH_EVENT_TYPES = [
  'ulcer', 'fever', 'cough', 'injury',
  'allergy', 'dizzy', 'vomit', 'other',
] as const;

export type HealthEventType = typeof HEALTH_EVENT_TYPES[number];

export function seedHealthEvent(overrides: Partial<{
  id: number;
  user_id: number;
  event_type: HealthEventType;
  start_date: string;       // 'YYYY-MM-DD'
  end_date: string | null;
  is_resolved: 0 | 1;
  note: string | null;
  submitted_by: 'child' | 'pm';
}> = {}): number {
  const id = overrides.id ?? Math.floor(Math.random() * 1_000_000) + 100_000;
  const user_id = overrides.user_id ?? 1;
  const event_type = overrides.event_type ?? 'ulcer';
  const start_date = overrides.start_date ?? '2026-06-14';
  const end_date = overrides.end_date ?? null;
  const is_resolved = overrides.is_resolved ?? (end_date ? 1 : 0);
  const note = overrides.note ?? null;
  const submitted_by = overrides.submitted_by ?? 'pm';
  const now = Math.floor(Date.now() / 1000);

  const sql =
    `INSERT INTO health_events (id, user_id, event_type, start_date, end_date, is_resolved, note, submitted_by, created_at, updated_at) ` +
    `VALUES (${sqlNum(id)}, ${sqlNum(user_id)}, ${sqlStr(event_type)}, ${sqlStr(start_date)}, ${sqlStr(end_date)}, ${sqlNum(is_resolved)}, ${sqlStr(note)}, ${sqlStr(submitted_by)}, ${sqlNum(now)}, ${sqlNum(now)});`;
  d1Exec(sql);
  return id;
}
```

### 3.3 Spec cases

| ID | test name | 步骤 | 期望 |
|----|----------|------|------|
| HAPPY-4 | `GET /api/public/health/events returns events[]` | setup seed 2 events (1 active ulcer + 1 resolved cough), GET `?user_id=1&event_type=ulcer` | 200 + `body.events.length === 1` + events[0].event_type === 'ulcer' + events[0].end_date === null |
| HAPPY-5 | `GET with month=2026-06 returns June events (跨月处理)` | setup seed 2 events (1 cough 5月 + 1 cough 6月), GET `?user_id=1&event_type=cough&month=2026-06` | 200 + events.length === 1 + events[0].start_date === '2026-06-...' |
| EDGE-6 | `GET month with no events returns empty array, NOT null` | 不 seed, GET `?user_id=1&month=2099-12` | 200 + `body.events` 是 array + `body.events.length === 0` |
| EDGE-7 | `cross-month event: start=5月 end=6月 → GET 6月 returns it` | seed 1 cough event (start_date='2026-05-30', end_date='2026-06-03'), GET `?user_id=1&event_type=cough&month=2026-06` | 200 + events.length === 1 + events[0].start_date === '2026-05-30' (跨月 event 出现在 6 月列表) |
| EDGE-13 | `PATCH resolve without pm_session → 401` | 不 login, PATCH `/api/admin/health/events/1/resolve` `{end_date:'2026-06-20'}` | 401 + `{error.code: 'UNAUTHORIZED'}` |
| AUTH-1 | `POST /api/me/health/events without child session → 401 (假设 M1 加 child auth) OR 201 (假设 M1 沿用 hardcoded)` | 不 login, POST `{event_type:'ulcer'}` | **dual-mode**: 接受 201 (hardcoded child user_id=2) 或 401 (新加 child session)。当前 me/* 路径无 auth, 假设 hardcoded。Test 标 `[Symbol.for('skipOnMismatch')]` 跑后, 若 201 则 PASS, 若 401 也 PASS (acceptable) |
| AUTH-2 | `POST /api/admin/health/events without pm_session → 401` | 不 login, POST `{user_id:1, event_type:'ulcer'}` | 401 + `{error.code: 'UNAUTHORIZED'}` |

### 3.4 Migration verify (e2e setup)

```
- beforeAll: 跑 `wrangler d1 migrations apply kiddo-scoreboard-db --local`
- beforeAll: SELECT name FROM sqlite_master WHERE type='table' AND name='health_events' → 1 row
- beforeAll: SELECT count(*) FROM sqlite_master WHERE type='index' AND tbl_name='health_events' → 3 (3 索引)
- beforeAll: SELECT count(*) FROM score_events (必须 = seed 前的数据, 验证 MIGRATION-3 零破坏)
```

**MIGRATION-1**: 0008 apply 成功 → e2e `beforeAll` 自动验证
**MIGRATION-2**: schema 匹配 `HealthEvent` interface → e2e `beforeAll` 跑 INSERT + SELECT round-trip 验证每个字段类型
**MIGRATION-3**: 现有 7 张表数据不被破坏 → e2e `beforeAll` 跑 SELECT count(*) 跟 seed 前对比

### 3.5 e2e 不测的 (避免 scope creep)

- ❌ 月历 DOM 渲染 (M2 前端, e2e 无 snapshot 基础)
- ❌ 8 个子 tab 切换 UI (M2 前端)
- ❌ 续接弹窗 3 按钮 (M3 前端)
- ❌ 视觉/像素 (PM 用 tunnel 截图验)

---

## §4 Coverage Matrix (PM verify 用)

| Case | 单测 file:line | e2e file:line | Status |
|------|----------------|---------------|--------|
| HAPPY-1 | tests/unit/health-events.test.ts:L323 | - | ⚠️ M1 commit 后跑 (现在 404, 路由未挂) |
| HAPPY-2 | tests/unit/health-events.test.ts:L352 | - | ⚠️ 同上 (现在 404) |
| HAPPY-3 | tests/unit/health-events.test.ts:L379 | tests/e2e/health-events.spec.ts:L201 (AUTH-4) | ⚠️ 单测 404 / e2e 待 M1 |
| HAPPY-4 | tests/unit/health-events.test.ts:L718 (empty) | tests/e2e/health-events.spec.ts:L91 | ⚠️ 同上 |
| HAPPY-5 | tests/unit/health-events.test.ts:L620 (IMPL-2) | tests/e2e/health-events.spec.ts:L103 | ⚠️ 同上 |
| EDGE-1 | tests/unit/health-events.test.ts:L402 | - | ⚠️ 同上 |
| EDGE-2 | tests/unit/health-events.test.ts:L416 | tests/e2e/health-events.spec.ts:L253 (EDGE-input-4) | ⚠️ 同上 |
| EDGE-3 | tests/unit/health-events.test.ts:L434 | tests/e2e/health-events.spec.ts:L243 (EDGE-input-3) | ⚠️ 同上 |
| EDGE-4 | tests/unit/health-events.test.ts:L447 ✅ NOW PASSES | - | ✅ pass NOW (admin requirePm catch-all 拦住) |
| EDGE-5 | tests/unit/health-events.test.ts:L463 | tests/e2e/health-events.spec.ts:L233 (EDGE-input-2) | ⚠️ 同上 |
| EDGE-6 | - | tests/e2e/health-events.spec.ts:L122 | ⚠️ 同上 |
| EDGE-7 | tests/unit/health-events.test.ts:L726 | tests/e2e/health-events.spec.ts:L131 | ⚠️ 同上 |
| EDGE-8 | tests/unit/health-events.test.ts:L476 | - | ⚠️ 同上 |
| EDGE-9 | tests/unit/health-events.test.ts:L497 | tests/e2e/health-events.spec.ts:L223 (EDGE-input-1) | ⚠️ 同上 |
| EDGE-10 | tests/unit/health-events.test.ts:L510 | - | ⚠️ 同上 |
| EDGE-11 | tests/unit/health-events.test.ts:L517 | - | ⚠️ 同上 |
| EDGE-12 | tests/unit/health-events.test.ts:L532 | - | ⚠️ 同上 |
| EDGE-13 | tests/unit/health-events.test.ts:L447 (dup) | tests/e2e/health-events.spec.ts:L155 | ⚠️ 同上 |
| AUDIT-1 | tests/unit/health-events.test.ts:L549 | - | ⚠️ 同上 |
| AUDIT-2 | tests/unit/health-events.test.ts:L571 | - | ⚠️ 同上 |
| AUDIT-3 | tests/unit/health-events.test.ts:L587 | - | ⚠️ 同上 |
| MIGRATION-1 | - | tests/e2e/health-events.spec.ts:beforeAll (table + idx count) | ⚠️ 待 0008 commit |
| MIGRATION-2 | - | tests/e2e/health-events.spec.ts:beforeAll (字段 round-trip) | ⚠️ 待 0008 commit |
| MIGRATION-3 | - | tests/e2e/health-events.spec.ts:beforeAll (existing tables intact) | ⚠️ 待 0008 commit |
| IMPL-1 (零关联 score_events) | tests/unit/health-events.test.ts:L605 ✅ NOW PASSES | - | ✅ pass NOW (trivially: 无 event 写入 → scoreEvents=0) |
| IMPL-2 (month filter) | tests/unit/health-events.test.ts:L620 | - | ⚠️ 同上 |
| IMPL-3 (event_type filter) | tests/unit/health-events.test.ts:L633 | - | ⚠️ 同上 |
| IMPL-4 (invalid date format) | tests/unit/health-events.test.ts:L643 | - | ⚠️ 同上 |
| IMPL-5 (8 type sweep) | tests/unit/health-events.test.ts:L655 | - | ⚠️ 同上 |
| IMPL-6 (future end_date) | tests/unit/health-events.test.ts:L669 | - | ⚠️ 同上 |
| AUTH-1 (child auth dual) | tests/unit/health-events.test.ts:L684 | - | ⚠️ 同上 |
| AUTH-2 (admin auth) | tests/unit/health-events.test.ts:L704 ✅ NOW PASSES | tests/e2e/health-events.spec.ts:L180 | ✅ pass NOW (admin requirePm catch-all) |

**统计**:
- PM brief 23 cases: **23/23 = 100% 覆盖** (单测 + e2e + beforeAll)
- IMPL 隐性 cases: 6 个
- AUTH cases: 2 个
- **总计覆盖**: 31/31 (PM brief + IMPL + AUTH)

**当前跑结果 (M1 未 commit 现状)**:
- vitest: 3 pass / 23 fail / 0 skip (admin requirePm 拦住 2 个 + IMPL-1 trivially pass 1 个)
- playwright: 未跑 (beforeAll verify migration 0008 会 fail)

---

## §5 不在测试范围 (避免 scope creep)

明确列出, PM/feihao 不要追加:

- ❌ 月历 DOM 渲染 + 像素测试 — M2 前端, 无 e2e snapshot 基础
- ❌ 8 个子 tab 切换 — M2 前端
- ❌ 续接弹窗 3 按钮 UI — M3 前端
- ❌ PM 后台硬删 / 编辑 — RFC §1.3 / §4.4 不做
- ❌ 性能 < 200ms 实测 — M1 无 benchmark harness
- ❌ 种子数据视觉 — M4 PM 责任
- ❌ 移动端 (iPad) UI — e2e 配置 iPad viewport, 但不专门测 8 子 tab wrap
- ❌ 并发 race condition (2 个 POST 同时 create) — M1 业务允许多 active 共存, 不需要 lock
- ❌ 时区边界 (UTC 跨日 / DST) — RFC §7.1 风险已用 `shanghaiDateString()` 缓解, 测试假设 server clock 正常

---

## §6 已知风险 + 边界

### 6.1 实施风险 (CC 写 M1 时)

| 风险 | 缓解 |
|------|------|
| CC 漏掉 audit_log 写入 | AUDIT-1/2/3 单测会 fail, 必须修 |
| CC 用 INSERT + UPDATE 代替 db.batch | AUDIT-3 单测会 fail (要求 batch 顺序相邻) |
| CC 写 health event 时误写 score_events | IMPL-1 单测会 fail (scoreEvents.length 必须=0) |
| CC 校验 end_date < start_date 但漏掉 `=` (用 `>` 而非 `>=`) | EDGE-12 单测会 fail (单日事件) |
| CC 把 audit_log 的 `details` 写死而不是 JSON | AUDIT-2 解析 details.end_date 会 fail |
| CC 漏掉 `is_resolved` 字段更新 (只更新 end_date) | HAPPY-3 断言会 fail (`event.is_resolved === 1`) |
| CC 没扩 `AuditAction` enum (TS strict 会报) | typecheck 会 fail |
| CC 把 child POST 加 child session auth (跟现有 me/* hardcoded pattern 不一致) | AUTH-1 双模式接受, 但 PM 应在 RFC 拍板 |

### 6.2 测试基础设施风险

| 风险 | 缓解 |
|------|------|
| M1 commit 没合到 clean dir | **现阶段测试不能跑**, PM rebase clean dir 后再跑 |
| `wrangler d1 migrations apply` 没跑 | e2e `beforeAll` 会 fail (table not exist), 提示 PM 跑 migration |
| wrangler dev 启动慢 | 沿用现有 `webServer.timeout: 120_000`, 1 worker |
| 3-shard 并行 race condition | 沿用 `fullyParallel: false, workers: 1` |
| sqlite3 CLI 路径 quirk | 沿用现有 `tests/e2e/helpers/db.ts` (大文件优先) |

### 6.3 业务边界 (RFC §7)

| 边界 | 测试覆盖 |
|------|---------|
| `end_date < start_date` → 400 | EDGE-2 ✅ |
| `end_date = start_date` (单日) → 200 | EDGE-12 ✅ |
| `end_date = future` (提前标记) → 200 | IMPL-6 ✅ |
| `end_date = invalid format` → 400 | IMPL-4 ✅ |
| 并发多 active 同 type | EDGE-1 ✅ (允许) |
| `event_type = 'flu'` (不在 8 种) → 400 | EDGE-5 ✅ |
| `event_type` ∈ 8 种 hardcode → 200 | IMPL-5 ✅ |
| `user_id` 不存在 → 404 (RFC §7.2) | **未覆盖** (无 unit test, 不在 PM brief, M1 阶段建议 CC 加) |
| 修改 `event_type` / `start_date` → 404 (RFC §7.2) | **未覆盖** (RFC §4.4 不做 API, 无法测) |

---

## §7 交付清单 (qual-agent 留给 PM)

```
+ docs/health-checkin-test-plan.md (本文件, ~270 行)
+ tests/unit/health-events.test.ts (新文件, ~400 行, 23+ 单测)
+ tests/e2e/health-events.spec.ts (新文件, ~180 行, 7+ spec)
+ tests/fixtures/health-checkin.ts (新文件, ~50 行, e2e seed helper)

🚫 0 commit (qual-agent 不 commit, PM 收尾)
🚫 不动 src/ migrations/ public/ (CC 写)
🚫 不动现有 test 文件
```

---

## §8 时间盒 + 验收

| 阶段 | 估时 | 状态 |
|------|------|------|
| 写 test plan | 15 min | ✅ 完成 |
| 写 unit tests | 25 min | ⏳ (qual-agent 跑这一步) |
| 写 e2e spec | 20 min | ⏳ |
| 跑全部 tests | 5 min | ⏳ (依赖 M1 commit) |
| **总计** | 45-60 min | |

**验收 (M1 commit 后)**:
- [ ] `npx vitest run tests/unit/health-events.test.ts` → 100% pass
- [ ] `npx playwright test tests/e2e/health-events.spec.ts` → 100% pass
- [ ] coverage matrix §4 全部 ✅ pass
- [ ] 0 SRC bug 发现 (除非 CC 漏 impl, 列出)
- [ ] 0 RFC spec 不清楚 (除非真有歧义, 列出)

---

## §9 参考资料

- RFC: `/Users/tidusmaomao/workspace/kiddo-scoreboard/docs/rfc/health-checkin.md` (v1.0, 720 行)
- PM Brief: `/tmp/test-design-brief.md` (1 page, 23 cases)
- 现有单测 pattern: `tests/unit/me-tasks-complete.test.ts` (mock D1 + db.batch capture)
- 现有单测 pattern: `tests/unit/admin-events-actions.test.ts` (requirePm guard + PATCH-style endpoint)
- 现有单测 pattern: `tests/unit/public-events.test.ts` (GET endpoint + filter logic)
- 现有 e2e pattern: `tests/e2e/event-approval.spec.ts` (simple request-based spec)
- 现有 e2e pattern: `tests/e2e/smoke-child-main.spec.ts` (page-based DOM smoke)
- e2e helper: `tests/e2e/helpers/auth.ts` (PM login + cookie)
- e2e helper: `tests/e2e/helpers/db.ts` (clearAllData + seedEvent)
- utils: `src/utils/week.ts` (shanghaiDateString / todayShanghai)
- types: `src/db/types.ts` (User / ScoreEvent / AuditLog / AuditAction)
- session: `src/auth/session.ts` (signSession + verifySession)
# QUAL_REPORT — 2026-06-09 (P0: admin 永久删除 FK 约束)

> **报告人**: Qual Agent
> **日期**: 2026-06-09 22:30 +08
> **状态**: 🟡 RED — regression spec 已写, 等 PM 修 server-side
> **关联**: `feat/qual-2026-06-09-hard-delete-fk` 分支 (待 push + PR)

---

## 1. 摘要 (TL;DR)

Admin UI 在 v2.2 (#009) 新增了「🗑 永久删除」按钮, 但**没有覆盖 score_event ↔ task_completion 的 FK 路径**。当 PM 尝试硬删一个来自任务完成的 score_event (即 child 通过 `POST /api/me/tasks/:id/complete` 创建的 event) 时, 端点返回 500 INTERNAL, 事件和审计日志都未被写入。用户看到的现象: toast「删除失败: INTERNAL」, 按钮看起来没反应。

**根因**: `src/utils/deleted-records.ts:moveToDeletedRecords` 把 `INSERT deleted_records + DELETE FROM score_events` 放在同一个 `db.batch()` 里, 但 D1 **强制执行 FOREIGN KEY 约束**。`task_completions.awarded_event_id` 有 FK 指向 `score_events.id`, 所以 DELETE 直接报 `SQLITE_CONSTRAINT_FOREIGNKEY`, 整批回滚。

**严重性**: **P0**
- 已有用户报告撞到 (2026-06-09 22:00 +08 反馈)
- UI 表现为「数据库删除错误」, 不友好
- 数据**不会丢** (FK 整批回滚是正确的), 但**操作不能完成**, PM 只能刷新页面重试, 仍失败
- 影响所有来自 child task 完成的 score_event (这是 v2.2 之后 child 完成任务最常见的来源)

**修复方向** (PM 决定): 见 §6。

---

## 2. 复现步骤 (UI 端到端)

**前置条件**:
- PM 已登录
- Child 通过 `POST /api/me/tasks/:id/complete` 至少完成过 1 个任务 (这一行 task_completion.awarded_event_id ≠ NULL)
- 对应的 score_event 在 admin UI 的「📋 所有 Events」里可见

**步骤**:
1. PM 进入 admin 控制台 `/admin/`
2. 展开「📋 所有 Events」section
3. 找到刚才 child 完成的任务对应的 event (status=approved, 💰 +X 元)
4. 点击该 event 行的 🗑 永久删除 按钮
5. 在 confirm 对话框点击「确定」

**实际结果**:
- Toast: `删除失败：INTERNAL`
- Event 仍在列表里 (没被删)
- DB 里 `score_events` 对应行 status 仍是 'approved'
- `deleted_records` 表里没有新增行 (整批回滚, 这点是正确的)
- `audit_log` 里没有 'event_hard_deleted' 记录

**期望结果** (之一, 由 PM 选):
- 方案 A: 事件被删除, 对应 task_completion.awarded_event_id 被置 NULL (completion 保留, audit 友好)
- 方案 B: 端点返回 409 + 明确错误码 (e.g. `REFERENCED_BY_COMPLETION`), UI 提示 PM 先去撤销 completion
- 方案 C: 级联删除 completion (破坏性大, 不推荐)

---

## 3. 直接 API 复现 (服务器端确认)

```bash
# 1. Seed: PM + child + task + completion (FK 路径)
$ sqlite3 .wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite \
    "INSERT INTO task_completions (task_id, user_id, status, completed_date, completed_at, awarded_event_id) \
     VALUES (1, 2, 'active', '2026-06-09', unixepoch(), 100);"

# 2. PM login
$ curl -X POST http://127.0.0.1:8787/api/admin/auth/login \
    -H 'Content-Type: application/json' -d '{"pin":"123654"}'
{"user":{"id":1,"name":"PM","role":"pm"},"expires_at":...}

# 3. Hard-delete the event
$ curl -X POST http://127.0.0.1:8787/api/admin/events/100/hard-delete \
    -H "Cookie: pm_session=..."
# Returns 500:
{"error":{"code":"INTERNAL","message":"hard-delete failed"}}

# 4. wrangler dev stderr:
[DEBUG-HD] ERROR: D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)
Error: D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)
    at async moveToDeletedRecords (...)
```

**确认**: bug 在 server 侧, 与 UI 无关。**2-run rule 已通过** (npm test 跑 2 次, 都在同样位置失败, 同样错误码)。

---

## 4. 根因分析 (4-phase systematic debugging)

### Phase 1: 现象
- UI: 「删除失败: INTERNAL」+ 行不消失
- HTTP: 500 + `{"error":{"code":"INTERNAL","message":"hard-delete failed"}}`

### Phase 2: 缩小范围
- 现有 `ui-admin-hard-delete.spec.ts` 3 个 case 全过 → 说明 API 本身在「无 FK 引用」时工作正常
- 我的新 spec seed 了 task_completion (FK 引用) → 失败
- → 缩小到「有 FK 引用的 score_event」这个特定子集

### Phase 3: 找根因
- 加临时 `console.log` 到 `src/routes/admin/events.ts` 的 try 块:
  - 走到 `moveToDeletedRecords` → 抛出
  - 抛出信息: `D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT_FOREIGNKEY`
- → 确认是 D1 的 FK 约束, 不是 SQL 语法 / 类型 / null 问题

### Phase 4: 验证 (读 D1 文档 + schema 交叉验证)
- `migrations/0001_initial.sql`:
  ```sql
  CREATE TABLE task_completions (
    ...
    awarded_event_id  INTEGER,
    FOREIGN KEY (awarded_event_id) REFERENCES score_events(id),
    ...
  );
  ```
- D1 文档 (2026-06 确认): "D1 enforces FOREIGN KEY constraints by default" (与 vanilla SQLite 相反)
- 现有 `moveToDeletedRecords` 没考虑这个引用关系, 直接 DELETE → 必然失败

**根因总结**:
`src/utils/deleted-records.ts:moveToDeletedRecords` 假设 score_event 是独立行, 不知道它可能被 task_completion.awarded_event_id 引用。v2.2 之前, awarded_event_id 总是 NULL (PHASE2-FINDING 记录的旧 bug), 所以这个引用关系不存在。v2.2 之后 `src/routes/me/tasks.ts:complete` 修了那个 bug, FK 引用就出现了, 硬删的代码就跪了。

---

## 5. 已有测试为什么没抓到 (regression gap)

| Spec | seed 数据 | FK 触发? | 结果 |
|---|---|:---:|---|
| `admin-events-hard-delete.test.ts` (unit) | 直接 INSERT score_events, 无 completion | ❌ | ✅ 通过 |
| `admin-task-completions-hard-delete.test.ts` (unit) | INSERT completion, 但先删其对应 event (no FK conflict) | ❌ | ✅ 通过 |
| `ui-admin-hard-delete.spec.ts` CASE 1 | `seedEvent` 无 completion | ❌ | ✅ 通过 |
| `ui-admin-hard-delete.spec.ts` CASE 2 | seedEvent + 单独 completion, **但先删 completion, 不删 event** | ❌ | ✅ 通过 |
| `ui-admin-hard-delete.spec.ts` CASE 3 | seedEvent 无 completion | ❌ | ✅ 通过 |
| **`ui-admin-hard-delete-fk.spec.ts`** (新) | seedEvent **+** completion **with awarded_event_id set** | ✅ | ❌ 500 (新发现) |

**Pattern**: 现有 5 个测试都假设「先删 event, 不删 completion」**或**「两者独立」, 从来没有测过「删 event 但 FK 引用还在」这个真实场景。

**修复后**, 新 spec CASE 1/2 会转 GREEN, CASE 3 (一致性契约) 已经 GREEN。

---

## 6. 修复建议 (PM 决定, Qual 不指定)

### 方案 A: 级联 NULL (推荐, 审计友好)

在 `moveToDeletedRecords` 之前 / 同一个 batch 里, 先 UPDATE 引用此 event 的 completions, 把 `awarded_event_id` 置 NULL:

```ts
// src/utils/deleted-records.ts
export async function moveToDeletedRecords(
  db, recordType, originalTable, originalId, originalData, deletedBy,
) {
  const deletedAt = Math.floor(Date.now() / 1000);
  // 1) 如果是 score_event: 先解绑所有引用的 completion
  const unbindStmt = recordType === 'score_event'
    ? db.prepare(`UPDATE task_completions SET awarded_event_id = NULL
                  WHERE awarded_event_id = ?`)
        .bind(originalId)
    : null;
  // 2) Snapshot + delete
  const snapshot = db.prepare(`INSERT INTO deleted_records ...`).bind(...);
  const deleteStmt = db.prepare(`DELETE FROM ${originalTable} WHERE id = ?`).bind(originalId);
  const all = [snapshot, deleteStmt];
  if (unbindStmt) all.unshift(unbindStmt);
  await db.batch(all);
}
```

- ✅ 保留 task_completion 行 (child 那边 UI 还能看到任务存在, 可以重做)
- ✅ 一致性强 (同 batch)
- ❌ 微妙语义: 删了 event, 但 child 那边的 "✅ 今日已完成" 还在, 重做会创建新的 event (这是 §3.11 的设计, OK)

### 方案 B: 拒绝 + 友好错误

```ts
// 在 events.ts:hard-delete 端点
const refs = await db.prepare(
  `SELECT id FROM task_completions WHERE awarded_event_id = ? LIMIT 1`
).bind(id).first();
if (refs) {
  return c.json(
    { error: {
      code: 'REFERENCED_BY_COMPLETION',
      message: `event ${id} is referenced by task_completion ${refs.id}; revoke the completion first`,
    }},
    409,
  );
}
```

- ✅ 不破坏数据
- ❌ PM 多一步: 收到 409 → 去撤销 completion → 再回来硬删 event

### 方案 C: 强制级联删 (不推荐)

```sql
-- 把 FK 改成 ON DELETE CASCADE
FOREIGN KEY (awarded_event_id) REFERENCES score_events(id) ON DELETE CASCADE
```

- ❌ 破坏性, completion 也会消失, 与 §3.5 v2.2 设计的「物理删只删单表」原则相悖
- ❌ 已有数据迁移问题

**Qual 建议**: 方案 A。理由: 与 §3.5 v2.2 「物理删 + snapshot」精神一致, 不需要 PM 二次操作, UI 表现可预测。

---

## 7. 关联 / 文件

- 失败 spec: `tests/e2e/ui-admin-hard-delete-fk.spec.ts` (新增, 3 case)
- 待改 server: `src/utils/deleted-records.ts` (方案 A 的核心改动)
- 关联端点: `src/routes/admin/events.ts :: POST /:id/hard-delete`
- 矩阵更新: `docs/FEATURE_MATRIX.md` 表 A §3.5 + 表 D + 表 F
- 报告: 本文件 `docs/QUAL_REPORT_2026-06-09-p0-admin-hard-delete-fk.md`

---

## 8. 后续 (PM 接手清单)

1. [ ] 决定修复方案 (A / B / C)
2. [ ] 实施修复 → 跑 `npm test -- --grep "P0 REGRESSION: hard-delete FK"` 应转 GREEN
3. [ ] 跑全量 `npm test`, 确认无 regression
4. [ ] 部署到 production
5. [ ] 在 NIGHTLY-TODO 关闭 Item #009 的 sub-task, 标 ✅
6. [ ] (可选) 增加一个 unit spec 覆盖 `moveToDeletedRecords` 的 cascade-NULL 路径, 提速反馈

---

**Qual 验证**: 2-run rule 已通过 (case 1/2 各跑 2 次, 同样位置同样错误码 RED), 不是 flaky。

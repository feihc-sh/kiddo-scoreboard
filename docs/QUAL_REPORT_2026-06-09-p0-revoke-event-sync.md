# QUAL_REPORT — 2026-06-09 (P0: admin 撤销 event 不同步 child UI)

> **报告人**: Qual Agent
> **日期**: 2026-06-09 22:50 +08
> **状态**: 🟡 RED — regression spec 已写, 等 PM 修 server-side
> **关联**: `feat/qual-2026-06-09-revoke-event-sync` 分支 (待 push + PR)

---

## 1. 摘要 (TL;DR)

Admin UI 在 v2.2 (#009) 之前, 撤销按钮在「全部事件」和「任务完成历史」两个 section 各有一份, 但**只有 completion-level 的撤销是工作的**。当 PM 点「全部事件」section 里的 撤销 (作用于 score_event), 服务端只更新 `score_events.status = 'revoked'`, 完全没碰 `task_completions`。结果: child UI 刷新后, 任务还是显示「✅ 今日已完成 (点击撤销)」, 没有任何迹象表明 PM 已经撤销了它。

**根因**:
- `src/routes/admin/events.ts:revokeEvent` (event-level) 只 `db.batch([UPDATE score_events, INSERT audit_log])`, 没碰 `task_completions`
- `src/routes/admin/task-completions.ts:revoke` (completion-level) 同一个 `db.batch([UPDATE task_completions, UPDATE score_events, INSERT audit_log])` — 三表一致更新
- child UI 的 `/api/public/tasks/today-status` 用 `task_completions.status = 'revoked'` 来算 `uncompleted_today_ids`, 所以只看到 completion-level 撤销

**严重性**: **P0**
- 用户已撞到 (2026-06-09 22:00 +08 反馈)
- PM 信任危机: 以为撤销了, child 那边没反应
- 数据状态不一致 (event=revoked, completion=active) — audit 上矛盾
- 影响所有来自任务完成的 score_event

**修复方向** (PM 决定): 见 §6。

---

## 2. 复现步骤 (UI 端到端)

**前置条件**:
- PM 已登录
- Child 通过 `POST /api/me/tasks/:id/complete` 至少完成过 1 个任务
- 该任务的 task_completion.awarded_event_id ≠ NULL

**步骤**:
1. PM 进入 admin 控制台 `/admin/`
2. 展开「📋 所有 Events」section (注意: 不是「✅ 任务完成历史」)
3. 找到刚才 child 完成的任务对应的 event (status=approved)
4. 点击该 event 行的「撤销」按钮 (位于该 row 的左中位置)
5. 在 confirm 对话框点击「确定」

**实际结果**:
- Admin UI: 该 event 行从 approved 状态变成 revoked ✅
- Admin UI: 「✅ 任务完成历史」里那条 completion 仍是 active (PM 不一定注意到)
- Child UI: 刷新后, 任务按钮**仍然显示**「✅ 今日已完成 (点击撤销)」+ 绿色对勾 — **完全没反映 PM 的撤销**
- DB: `score_events.status = 'revoked'`, `task_completions.status = 'active'` — **矛盾**

**期望结果** (之一, 由 PM 选):
- 方案 A: PM 撤销 event 后, child 任务立即显示「系统休眠中」+ 灰色 (与 completion-level 撤销一致) (PR #27 Mecha redesign 文案, 原「明天再来 🌙」)
- 方案 B: 端点拒绝 + 友好错误 (e.g. `REFERENCED_BY_COMPLETION`), UI 提示 PM 去「任务完成历史」section 用 completion-level 撤销
- 方案 C: Admin UI 在「全部事件」里, 对被 task_completion 引用的 event **不显示**撤销按钮, 强制走 completion-level 路径

---

## 3. 直接 API 复现 (服务器端确认)

```bash
# 1. Seed: PM + child + task + completion (FK 引用, status=active)
$ sqlite3 .wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite \
    "INSERT INTO task_completions (task_id, user_id, status, completed_date, completed_at, awarded_event_id)
     VALUES (1, 2, 'active', '2026-06-09', unixepoch(), 100);"

# 2. PM login
$ curl -X POST http://127.0.0.1:8787/api/admin/auth/login \
    -H 'Content-Type: application/json' -d '{"pin":"123654"}'
{"user":{...}, ...}

# 3. Revoke the event
$ curl -X POST http://127.0.0.1:8787/api/admin/events/100/revoke \
    -H "Cookie: pm_session=..."
# Returns 200:
{"id":100,"status":"revoked","new_balance":{"game_time":0,"pocket_money":0}}

# 4. Check child today-status — BUG: task still shows as completed
$ curl 'http://127.0.0.1:8787/api/public/tasks/today-status?user_id=2'
# Returns:
{"completed_task_ids":[1],"uncompleted_today_ids":[],"today":"2026-06-09"}
# Expected:
{"completed_task_ids":[],"uncompleted_today_ids":[1],"today":"2026-06-09"}
```

**2-run rule 已通过** (npm test 跑 2 次, 都在同样位置失败, 同样错误码 / 数组内容)。

---

## 4. 根因分析 (4-phase systematic debugging)

### Phase 1: 现象
- Admin UI: event 状态变 revoked, toast「已撤销」 ✅
- Child UI: 任务仍显示「✅ 今日已完成」 ❌
- DB 状态: `score_events.status = 'revoked'`, `task_completions.status = 'active'`

### Phase 2: 缩小范围
- 在 admin UI 的「✅ 任务完成历史」section 里点 撤销 — 这个**是工作的** (child UI 立即变「明天再来」)
- 在 admin UI 的「📋 所有 Events」section 里点 撤销 — **不工作**
- → 缩小到「event-level 撤销」这一条路径

### Phase 3: 找根因 (代码 diff)
- `src/routes/admin/events.ts:revokeEvent`:
  ```ts
  await db.batch([
    UPDATE score_events SET status='revoked' ...,
    INSERT audit_log ('pm', 'revoke_event', ...),
  ]);
  ```
  → **没碰 task_completions**
- `src/routes/admin/task-completions.ts:revoke`:
  ```ts
  await db.batch([
    UPDATE task_completions SET status='revoked' ...,
    UPDATE score_events SET status='revoked' ...,
    INSERT audit_log ('pm', 'task_revoke', ...),
  ]);
  ```
  → 3 表一致更新
- → 确认: event-level 路径**漏了** task_completions 更新

### Phase 4: 验证
- 复现脚本 (Playwright + API 双重验证): 100% 一致
- child UI 渲染逻辑 (public/app.js:150-160): 完全依赖 `uncompletedTodayIds` 决定按钮 class, 没问题
- completion-level 路径**没坏**, 所以 child UI 那边读接口是正常的, 怪的是 data writer

**根因总结**:
`revokeEvent` 端点只考虑「event 是独立行」的情况, 没考虑它可能是 task_completion 的 `awarded_event_id` 来源 (v2.2 之后才出现这种情况, 因为之前这个外键总是 NULL — 旧 bug)。当 event 来自任务完成时, 撤销它**必须**连带撤销 completion, 否则数据状态矛盾。

---

## 5. 已有测试为什么没抓到 (regression gap)

| Spec | 测什么 | event ↔ completion 关系? | 结果 |
|---|---|:---:|---|
| `flow-deduct-revoke.spec.ts` (e2e) | PM 撤销一个**手动** (-5 扣分) event | 不涉及 (event 来源是 manual, 不是 task) | ✅ 通过 |
| `admin-events-actions.test.ts` (unit) | approve / reject / revoke event | 不涉及 FK | ✅ 通过 |
| `flow-task-lifecycle.spec.ts` (e2e) | PM 撤销**completion** | ✅ 测了, 用的是 completion-level 撤销 | ✅ 通过 |
| `admin-task-revoke.test.ts` (unit) | completion-level revoke | ✅ 测了 | ✅ 通过 |
| **`ui-admin-revoke-event-sync.spec.ts`** (新) | event-level revoke 后的 child UI 同步 | ✅ 测了, RED | ❌ 暴露 bug |

**Pattern**: 现有测试**完全没测**「event-level 撤销 + event 来自 task completion」这个真实场景。所有 revoke 测试要么用手动 event, 要么走 completion-level 路径。

**修复后**, 新 spec CASE 1/2 会转 GREEN, CASE 3 (completion-level 保护) 已经 GREEN。

---

## 6. 修复建议 (PM 决定, Qual 不指定)

### 方案 A: event-level 撤销连带 completion (推荐, 用户体验一致)

在 `src/routes/admin/events.ts:revokeEvent` 的 `db.batch()` 里, 先查 task_completion, 如果存在, 一起改:

```ts
// src/routes/admin/events.ts:revokeEvent (修订)
const refs = await db.prepare(
  `SELECT id FROM task_completions WHERE awarded_event_id = ? LIMIT 1`
).bind(id).first<{ id: number }>();

const statements = [
  db.prepare(`UPDATE score_events SET status='revoked', ... WHERE id = ?`).bind(pmUserId, now, id),
  db.prepare(`INSERT INTO audit_log ('pm', 'revoke_event', ...)`).bind(id, ev.user_id, ..., now),
];
if (refs) {
  // 撤销 event 时, 如果有 completion 引用, 一起撤销
  statements.push(
    db.prepare(`UPDATE task_completions SET status='revoked', revoked_at=?, revoked_by=? WHERE id = ?`)
      .bind(now, pmUserId, refs.id),
  );
}
await db.batch(statements);
```

- ✅ UX 一致: child UI 看到的就是 PM 操作后的结果
- ✅ 1 次审计: event 撤销 + completion 撤销都在同一批, 容易 audit
- ❌ 语义模糊: 一个「撤销」按钮做了两件事, PM 可能意外撤销 child 的任务完成

### 方案 B: 拒绝 + 引导到 completion-level

```ts
const refs = await db.prepare(
  `SELECT id FROM task_completions WHERE awarded_event_id = ? LIMIT 1`
).bind(id).first<{ id: number }>();
if (refs) {
  return c.json(
    { error: {
      code: 'REFERENCED_BY_COMPLETION',
      message: `event ${id} is the source of task_completion ${refs.id}; use the completion-level revoke`,
    }},
    409,
  );
}
```

- ✅ 语义最清晰: PM 明确知道两个操作是分开的
- ❌ PM 体验差: 看到 409 → 去另一个 section 再操作
- ❌ admin UI 需要把 409 翻译成友好提示

### 方案 C: Admin UI 隐藏 撤销按钮 (force complete path)

修改 `src/routes/admin/events.ts:revokeEvent` 的入参校验**前端提前**, 在 `public/admin/admin.js:renderAllEvents` 里查 task_completion, 如果有引用就不渲染撤销按钮:

```js
${canRevoke && !ev.referencedByCompletion
  ? `<button class="pm-btn warn" data-act="revoke" data-id="${ev.id}">撤销</button>`
  : ''}
```

需要加一个 `referencedByCompletion` 字段, 可以在 events list endpoint 里 JOIN 一下。

- ✅ UX 最好: 不会出现「按钮存在但点完没反应」的情况
- ❌ 实现复杂: 需要改 API 端点返回 + UI 渲染
- ❌ 仍然有「手动 event 撤销」这个 case 不需要 completion 联动, 需要小心

**Qual 建议**: 方案 A 或 C。理由: 这两个都不强迫 PM 多一次操作, UX 直观。方案 B 错误码清晰但操作繁琐。

---

## 7. 关联 / 文件

- 失败 spec: `tests/e2e/ui-admin-revoke-event-sync.spec.ts` (新增, 3 case: 1 通过, 2 RED)
- 待改 server: `src/routes/admin/events.ts :: POST /:id/revoke`
- 对照 (working): `src/routes/admin/task-completions.ts :: POST /:id/revoke`
- 矩阵更新: `docs/FEATURE_MATRIX.md` 表 A §3.2 + §3.4, 表 D, 表 F
- 报告: 本文件 `docs/QUAL_REPORT_2026-06-09-p0-revoke-event-sync.md`

---

## 8. 后续 (PM 接手清单)

1. [ ] 决定修复方案 (A / B / C)
2. [ ] 实施修复 → 跑 `npm test -- --grep "P0 REGRESSION: admin revoke event"` 应转 GREEN
3. [ ] 跑全量 `npm test`, 确认无 regression
4. [ ] 部署到 production
5. [ ] (建议) 加一个 unit spec 覆盖 `revokeEvent` 联动 completion 的逻辑, 加速 CI 反馈

---

**Qual 验证**: 2-run rule 已通过 (case 1/2 各跑 2 次, 同样位置、同样状态)。CASE 3 (completion-level 已 work 的) 仍然 GREEN, 证明新 spec 不会误伤 working 路径。

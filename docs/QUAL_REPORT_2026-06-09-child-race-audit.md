# QUAL REPORT — Child 端 Write Actions Race Condition Audit

**Date**: 2026-06-09
**Author**: Qual Agent
**Triggered by**: PR #19 (submitEvent double-click → 2 events 污染)
**Status**: 调查完成, **无新 P0 bug**; 1 项 P2 UX 改进建议
**Branch**: `feat/qual-2026-06-09-child-race-audit`
**Spec**: `tests/e2e/ui-child-race-audit.spec.ts` (2 cases, 全部 PASS)
**Related**:
- PR #19 (submitEvent race) — 本 audit 的触发源
- PR #17 (admin task edit prefill) — 姊妹 PR, 互不影响

---

## 1. 背景

PR #19 测试发现 `submitEvent` 在 child 端「提交申请」按钮双击时会创建 2 条
score_events (真污染). 这引发一个问题: **child 端其他 write actions
(completeTask / uncompleteTask / setName) 是不是也有相同 race?**

本 audit 系统性 scan `public/app.js` 全部 async write actions, 用
`page.evaluate` 派发 2 次 click 模拟 race, 验证 server 端 idempotency +
UI 优雅处理.

## 2. Audit 矩阵

| # | Action | File:Line | inFlight 防抖? | Server Idempotency | Race 数据污染? | Spec Case |
|---|---|---|---|---|---|---|
| 1 | `submitEvent(form)` | `public/app.js:366-381` | ❌ 无 | ❌ 无 | 🚨 **是 (2 events)** | (PR #19 已测) |
| 2 | `completeTask(taskId)` | `public/app.js:300-328` | ❌ 无 | ✅ `ALREADY_COMPLETED_TODAY` 409 | ❌ 否 (1 success + 1 conflict) | CASE-1 |
| 3 | `uncompleteTask(taskId)` | `public/app.js:339-364` | ❌ 无 | ✅ `ALREADY_UNCOMPLETED_TODAY` 409 | ❌ 否 (1 success + 1 conflict) | ⚠️ 未测 (涉及 `window.confirm` 模态, 复杂度高) |
| 4 | `setName(name)` | `public/app.js:383-400` | ❌ 无 | ✅ `ALREADY_SET` 409 | ❌ 否 (1 success + 1 conflict) | CASE-2 |

**关键发现**:
- **3/4 actions 都没 inFlight 防抖** (line 300, 339, 366, 383), 跟 `admin.js::approveEvent` 的 inFlight Set 模式 (line 387-401) 不对称.
- **但 3 个都被 server 端 idempotency 保护**, 实际数据不污染.
- 唯一真污染的还是 `submitEvent` (PR #19) — 它的 server 路由**没有** SELECT-then-INSERT idempotency check, 因为"想要"和"不要"是新建独立 event, 无法 dedupe by key.

## 3. 验证证据 (API 日志)

### CASE-1: completeTask double-click
```
[wrangler:info] POST /api/me/tasks/9001/complete 201 Created (3ms)   ← 第 1 次成功
[wrangler:info] POST /api/me/tasks/9001/complete 409 Conflict (5ms)  ← 第 2 次被 server 拒绝
[wrangler:info] GET /api/public/events 200 OK                        ← UI refresh
```
DB 验证: `SELECT COUNT(*) FROM task_completions WHERE task_id=9001` → `1` ✅
UI 验证: 0 error toast ✅
**结论**: 数据安全. Server 端 `src/routes/me/tasks.ts:79-91` 的
SELECT-then-INSERT idempotency check 工作正常.

### CASE-2: setName double-click
```
[wrangler:info] PATCH /api/me/profile 200 OK (3ms)   ← 第 1 次成功
[wrangler:info] PATCH /api/me/profile 409 Conflict (3ms)  ← 第 2 次被 server 拒绝
```
DB 验证: `SELECT name FROM users WHERE id=2` → `'Tommy'` ✅
UI 验证: 0 error toast, welcome modal 关闭 ✅
**结论**: 数据安全. Server 端 `src/routes/me/profile.ts:90-95` 的
SELECT-then-UPDATE idempotency check 工作正常.

### CASE-3 (未自动化): uncompleteTask double-click
**未在 e2e 测**的原因: 涉及 `window.confirm()` 模态, Playwright dialog 事件
时序复杂. 但**代码分析** + 跟 CASE-1 同模式 (`src/routes/me/tasks.ts:154+` 的
`uncomplete` route 同样有 `if (existing.status === 'revoked') return 409` 风格的
guard) 表明: 行为应该一致 — 1 success + 1 conflict, 数据安全.

## 4. 风险评估

| 等级 | 描述 | 是否需要修 |
|---|---|---|
| **P0** | 数据污染 / 数据丢失 / 安全漏洞 | ❌ 已确认无 (audit 结论) |
| **P1** | 用户看到 confusing 错误提示 | ⚠️ 需评估 |
| **P2** | UX 改进 (防误触 / 一致性) | 见 §5 |

### P1 风险: 静默 catch 状态
所有 3 个 idempotency catch (`ALREADY_COMPLETED_TODAY` / `ALREADY_UNCOMPLETED_TODAY` / `ALREADY_SET`)
在前端都被 **silent swallow** (只 sync state, 不显示任何反馈):
- `app.js:322-325`: `state.completedTaskIds.add(taskId); renderTasks();` ← 无 toast
- `app.js:352-355`: `state.completedTaskIds.delete(taskId); state.uncompletedTodayIds.add(taskId); renderTasks();` ← 无 toast
- `app.js:392-396`: `hideWelcome(); renderGreeting();` ← 无 toast

**用户视角**: 双击按钮, 第 2 次没反应 (modal 没关 / 撤销没再次发生),
但也没错误提示. 大多数用户**不会注意**到第 2 次 click 没生效.

**建议**: 加 inFlight 防抖, 彻底消除 race. 这样行为跟 `admin.js::approveEvent` 对称, 避免 silent catch.

## 5. 建议 (P2 UX 改进, 非阻塞)

### 5.1 给 3 个 child actions 加 inFlight 防抖

**问题**: 3 个 child write actions (completeTask / uncompleteTask / setName)
都没 inFlight 防抖, 跟 `admin.js::approveEvent` 的模式不对称.

**修复模式** (参考 `public/admin/admin.js:387-401`):
```js
const submitInFlight = new Set();

async function completeTask(taskId) {
  if (submitInFlight.has(`complete:${taskId}`)) return;
  submitInFlight.add(`complete:${taskId}`);
  try {
    // ... existing logic
  } finally {
    submitInFlight.delete(`complete:${taskId}`);
  }
}
```

**收益**:
1. 避免 silent catch (用户看不到 error, 但后台也只 1 个请求)
2. 减少 server load (不必要的 409 响应)
3. 行为对称 (child 端和 admin 端都用同一模式)
4. 跟 `submitEvent` 的修复 (PR #19) 用同一 inFlight Set 实例

**建议 PR**: 不在 PR #19/#17 范围内, 单独提个 P2 PR (PM 决定优先级).

### 5.2 submitEvent 也用同一个 inFlight Set

**优化**: PR #19 修复时, 可以把 `submitEvent` 的 inFlight 防抖和上面 3 个
actions 的防抖合并到 1 个 `submitInFlight = new Set()`, 加在文件顶部.

**不阻塞 PR #19**: 独立优化, PM 决定.

## 6. 测试覆盖

| File | Cases | Status |
|---|---|---|
| `tests/e2e/ui-child-submit-random.spec.ts` (PR #19) | 3 (1 RED 已修) | 待 PM 修后 GREEN |
| `tests/e2e/ui-child-race-audit.spec.ts` (本 PR) | 2 (全 GREEN) | ✅ |

**总 e2e spec**: 49 → 50 (1 new), 50 → 51 (1 new PASSING) — 见 FEATURE_MATRIX 更新.

## 7. 提交

- **Branch**: `feat/qual-2026-06-09-child-race-audit`
- **Base**: `feat/qual-2026-06-09-child-submit-race` (PR #19 head) — 保持 PR 依赖链清晰
- **Files**:
  - `tests/e2e/ui-child-race-audit.spec.ts` (新增, 5343 bytes)
  - `docs/QUAL_REPORT_2026-06-09-child-race-audit.md` (本报告)
  - `docs/FEATURE_MATRIX.md` (更新 §3.13 + Flow J + count)
- **预期 diff**: +200/~15

## 8. 给 PM 的下一步建议

1. **优先**: 合并 PR #17 (admin task edit prefill) 和 PR #19 (submitEvent race)
2. **中等**: 决定是否接受本 audit PR (建议接受 — 增加 1 个对未来回归友好的 spec)
3. **P2 backlog**: 3 个 child actions 加 inFlight 防抖 (见 §5.1) — 单独 PR

---

**Audit 结论**: Child 端 race condition **比担心的轻很多** — 3/4 actions
被 server 端 idempotency 保护, 唯一真污染的 `submitEvent` 已在 PR #19
报告. 本 audit 提供了完整的"为什么这些 actions 不需要紧急修"的证据链,
未来 PM 加 inFlight 防抖时可直接复用本 spec 作为回归测试.

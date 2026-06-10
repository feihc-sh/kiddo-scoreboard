# Qual 验收报告 — 2026-06-09 (Child Submit Race Condition, double-click)

> **触发**: 用户 DM Qual Agent — "在用户端点击「提交申请」按钮, 随机填完表格后点击提交, 查看用户端显示的 log 是否正确. 有没有多余的条目, 或者是缺少的条目?"
>
> **被验对象**: `main` HEAD = `837ccc3`
>
> **Qual Agent**: 本文件作者
>
> **关联文件**: `tests/e2e/ui-child-submit-random.spec.ts` (新增) / `public/app.js :: submitEvent` (定位 bug) / `public/admin/admin.js :: inFlight` (参考修复模板)

---

## 1. 验收结论 (TL;DR)

| 项 | 结论 |
|---|---|
| **测试编写** | ✅ 完成 — 1 文件 / 3 case (SINGLE + MULTI + DOUBLE-CLICK RACE) |
| **测试执行** | ✅ 2-run 验证: Case 1/2 稳定 pass, Case 3 稳定 fail (同位置同原因, 2-run rule 通过) |
| **Bug 确认** | 🚨 **真 bug, 非 flaky** — `public/app.js :: submitEvent()` 没有 inFlight 防抖, 2 次 form submit event 触发 2 次 POST → log 多 1 条"幽灵 event" |
| **Bug 严重度** | **P1 (中)** — 双击/快速点击会创建重复 event, 影响余额正确性 + PM 端待审列表多 1 条垃圾 |
| **当前测试矩阵** | `docs/FEATURE_MATRIX.md` 表 C §3.12 缺 1 个回归 spec 登记 |
| **建议下一步** | PM 给 `submitEvent` 加 inFlight Set 防抖 (参考 admin 端 `approveEvent` line 387-401) → Qual 重跑验证 GREEN → 合入 |

---

## 2. Bug 详情

### 2.1 用户场景

小朋友在用户端 (`/`) 点击「📝 提交申请」打开 modal, 填好 type / amount / reason 后, **手抖双击提交按钮** (或者点击瞬间第二次按压). 期望: 1 个 event 进入 log. 实际: **2 个 event 进入 log**, PM 待审列表也看到 2 条. PM 不知道这是 1 次操作还是 2 次, 容易误批.

### 2.2 Root Cause

`public/app.js :: submitEvent()` (line 366-381) **完全没有防双击机制**:

```js
async function submitEvent(form) {
  const type = form.type.value;
  const amount = parseInt(form.amount.value, 10);
  const dir = state.selectedDir;
  const reason = form.reason.value.trim();
  const change_value = dir * Math.abs(amount);
  try {
    await api('POST', '/api/me/events', { type, change_value, reason });
    closeSubmitModal();           // ← 在 await 之后
    toast('已提交，等家长审核～', 'success');
    loadEvents().then(renderEvents).catch(() => {});
  } catch (e) {
    toast('提交失败：' + e.message, 'error');
  }
}
```

**对比 admin 端** (有防抖):
```js
// public/admin/admin.js line 387-401
const inFlight = new Set();
async function approveEvent(id) {
  if (inFlight.has(id)) return;        // ← inFlight 防双击
  inFlight.add(id);
  try {
    await api('POST', `/api/admin/events/${id}/approve`);
    ...
  } finally {
    inFlight.delete(id);
  }
}
```

`submitEvent` **没有任何 inFlight 防护**, 所以第 1 次 submit 触发后, 第 2 次 submit 立即进入 try 块, 启动第 2 个 `await api()` → 2 个 POST 同时 in-flight → 都成功 → log +2 条.

### 2.3 复现步骤 (自动化)

```ts
// tests/e2e/ui-child-submit-random.spec.ts Case 3
await page.evaluate(() => {
  const form = document.querySelector('#submit-form');
  form.requestSubmit();   // 第 1 次
  form.requestSubmit();   // 第 2 次 (race)
});
// 期望: log 1 条;  实际: log 2 条
```

API log 证据:
```
[wrangler:info] POST /api/me/events 201 Created (4ms)   ← 第 1 次
[wrangler:info] POST /api/me/events 201 Created (5ms)   ← 第 2 次 (race)
```

---

## 3. 测试设计

### 3.1 文件

- 新建: `tests/e2e/ui-child-submit-random.spec.ts` (1 describe / 3 cases)
- 复用 `helpers/db.ts :: clearAllData + seedPmUser + seedChildUser`
- 模拟"8-10 岁小朋友操作": type/dir/amount/reason 全部随机 (用 `Math.random()`), reason 加随机 suffix 防同 reason 误判

### 3.2 用例

| Test | 场景 | 期望 | 实际 |
|---|---|---|---|
| `SINGLE` | 随机生成 1 笔, 提交 | log +1 条, 字段全对 (amount/reason/icon/status) | ✅ pass |
| `MULTI` | 5 笔随机数据, 顺序提交 | log +5 条, 每条字段都对, 全 pending | ✅ pass |
| `DOUBLE-CLICK RACE` | `page.evaluate` 派发 2 次 `form.requestSubmit()` | log +1 条 (inFlight 防抖) | ❌ **fail (log +2)** |

### 3.3 "多余/缺少" 检测策略

- **多余条目**: `await expect(items).toHaveCount(N)` (期望 N, 实际 N+1 = bug)
- **缺少条目**: 提交后看 log, `items.filter({ hasText: reason })` 必须存在
- **内容正确性**: 每条 row 检查 amount/icon/status (跟提交的一致)

---

## 4. 测试执行 (clean-room)

### 4.1 Pre-flight

- ✅ 端口 8787 空闲 (无 wrangler/workerd 进程)
- ✅ `npm run test:e2e` 自动触发 `pretest:e2e → bash scripts/clean-test-db.sh`
- ✅ 没有任何 PM agent (PID 617 my-pm / PID 630 pm-for-claude) 在跑 workerd/playwright

### 4.2 Run 1 (RED)

```
Running 3 tests using 1 worker
  ✓ 1 SINGLE: 随机填表 + 提交 → log 恰好多 1 条, 字段全部正确 (2.0s)
  ✓ 2 MULTI: 5 次随机填表 + 提交 → log 恰好多 5 条, 每条字段都正确 (2.7s)
  ✘ 3 DOUBLE-CLICK RACE: 派发 2 次 form submit event → log 应当只多 1 条 (913ms)

  Error: expect(locator).toHaveCount(expected) failed
  Locator:  locator('#event-list .event-item')
  Expected: 1
  Received: 2
```

→ Case 3 fail: 2 次 POST → log +2 条. Case 1/2 pass: 正常提交流程无 bug.

### 4.3 Run 2 (RED — 2-run rule 验证)

```
  ✓ 1 SINGLE
  ✓ 2 MULTI
  ✘ 3 DOUBLE-CLICK RACE (同位置, 同原因)
```

→ **同位置, 同原因 → 真 bug, 非 flaky infra**.

---

## 5. 修复建议 (供 PM 参考, Qual 不修代码)

### 5.1 最小修复 (3 行 + 1 个 Set)

在 `public/app.js` line 366 之前添加:

```js
const submitInFlight = new Set();
```

在 `submitEvent` 函数 try 块之前加 `if (submitInFlight.has('submit')) return; submitInFlight.add('submit');`, 在 `catch` 之后加 `submitInFlight.delete('submit');` (或用 try/finally):

```js
async function submitEvent(form) {
  if (submitInFlight.has('submit')) return;   // ← 防双击
  submitInFlight.add('submit');
  const type = form.type.value;
  const amount = parseInt(form.amount.value, 10);
  const dir = state.selectedDir;
  const reason = form.reason.value.trim();
  const change_value = dir * Math.abs(amount);
  try {
    await api('POST', '/api/me/events', { type, change_value, reason });
    closeSubmitModal();
    toast('已提交，等家长审核～', 'success');
    loadEvents().then(renderEvents).catch(() => {});
  } catch (e) {
    toast('提交失败：' + e.message, 'error');
  } finally {
    submitInFlight.delete('submit');          // ← 清状态
  }
}
```

### 5.2 替代方案 (更彻底, 推荐)

直接在 form submit 后禁用按钮:

```js
$('#submit-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;                        // ← 立即禁用
  submitEvent(e.target).finally(() => {
    btn.disabled = false;                     // ← 重新启用 (modal 关了所以看不到)
  });
});
```

### 5.3 顺手修 admin 端对称场景

admin 端 `approveEvent` / `rejectEvent` / `revokeEvent` / `deleteTask` / `deleteEvent` 等都有 inFlight, **对称的 child 端其他按钮** (e.g. `completeTask` line 300, `uncompleteTask` line 339) 也没 inFlight, 建议一起 audit.

---

## 6. 矩阵更新建议

`docs/FEATURE_MATRIX.md` 表 C §3.12 (Child Event Submit) 加 1 行 regression 登记:

```diff
- | **3.12** | Child Event Submit | ✓ | ✓ | ✓ | `smoke-child-submit.spec.ts` `ui-child-submit-happy.spec.ts` `ui-child-submit-edge.spec.ts` |
+ | **3.12** | Child Event Submit | ✓ | ✓ | ✓ | `smoke-child-submit.spec.ts` `ui-child-submit-happy.spec.ts` `ui-child-submit-edge.spec.ts` `ui-child-submit-random.spec.ts` (regression: random fill + double-click race, see QUAL_REPORT_2026-06-09-child-submit) |
```

---

## 7. 已知事项 / Pre-existing

- **typecheck 27 fail** (memory 已知): `tsconfig.json` 缺 `DOM` lib + Task mock 缺 `cutoff_time`. 与本次 regression **无关**, 不阻塞 e2e.
- **2 个 unit test fail** (memory 已知): `me-tasks-complete` 批顺序期望未跟随 commit 5021b7d 同步. 与本次 **无关**.

---

## 8. Final Verdict

🚨 **FAIL** — 1 个新测试 fail (DOUBLE-CLICK RACE: 期望 1 条, 实际 2 条), 真 bug 已 100% 复现 (2-run rule). 建议 PM 修 `submitEvent` 加 inFlight Set 防抖, 修完 Qual 重跑 2 轮验证 GREEN 后可合入.

**版本**: v2026-06-09 (child-submit)
**维护**: Qual Agent

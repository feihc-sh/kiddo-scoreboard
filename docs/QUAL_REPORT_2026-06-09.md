# Qual 验收报告 — 2026-06-09 (PM 任务编辑回填 regression)

> **触发**: 用户 DM Qual Agent — "在登记新的每日任务的时候, 它是可以编辑的. 那个编辑的那个按钮按下去了之后, 它没有从之前填入的数据库里边把之前的状态导出来. 我要加一个测试, 就是按了编辑按钮, 要看它每一个详细的 item 是否和库内原先填过的内容是一致的."
>
> **被验对象**: `main` HEAD = `837ccc3` (本地与 `origin/main` 一致)
>
> **Qual Agent**: 本文件作者
>
> **关联文件**: `tests/e2e/ui-admin-tasks-edit-prefill.spec.ts` (新增) / `public/admin/admin.js` startEditTask (定位 bug) / `docs/NIGHTLY-TODO.md` (建议 PM 入列)

---

## 1. 验收结论 (TL;DR)

| 项 | 结论 |
|---|---|
| **测试编写** | ✅ 完成 — 1 文件 / 2 case (HAPPY + HAPPY-2 反向) |
| **测试执行** | ✅ 2-run 验证 (Run 1: 1 fail / 1 pass, Run 2: 1 fail / 1 pass — 同位置同原因, 2-run rule 通过) |
| **Bug 确认** | 🚨 **真 bug, 非 flaky** — `public/admin/admin.js :: startEditTask()` 没回填 v2.1 字段 `cutoff_time` 和 `is_self_lockout` |
| **Bug 严重度** | **P1 (中)** — 不阻塞核心流程 (创建 / 删除 / 改其他字段 仍工作), 但 PM 编辑 sleep 类任务时会"丢设置" |
| **当前测试矩阵** | `docs/FEATURE_MATRIX.md` 表 C 缺 1 个 regression spec 登记 |
| **建议下一步** | PM 修 `startEditTask` (2 行代码) → Qual 重跑验证 GREEN → 合入 |

---

## 2. Bug 详情

### 2.1 用户场景

PM 在 admin 页面配置"每日任务" (例如 "准时上床 21:30 截止 + 自动锁")。保存后, 再点该任务的"编辑"按钮, 期望看到数据库里原先填的内容。但 `cutoff_time` 输入框是空的, `is_self_lockout` 复选框未勾选。如果 PM 不重新填这两项就保存, 就会把 sleep task 的"准时上床"设置清掉。

### 2.2 Root Cause

`public/admin/admin.js :: startEditTask()` (line 433-449) 缺 2 行回填赋值:

```js
function startEditTask(id) {
  state.editingTaskId = id;
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  const f = $('#new-task-form');
  f.elements['name'].value = t.name;            // ✅
  f.elements['icon'].value = t.icon || '';      // ✅
  f.elements['icon'].dispatchEvent(new Event('input', { bubbles: true }));
  f.elements['token_reward'].value = t.token_reward;  // ✅
  f.elements['target_account'].value = t.target_account;  // ✅
  f.elements['category'].value = t.category;    // ✅
  f.elements['sort_order'].value = t.sort_order;  // ✅
  // ❌ 缺: f.elements['cutoff_time'].value = t.cutoff_time || '';
  // ❌ 缺: f.elements['is_self_lockout'].checked = t.is_self_lockout === 1;
  $('#new-task-form-wrap').hidden = false;
  $('#btn-new-task').textContent = '编辑中…';
  f.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
```

### 2.3 字段对比表

| 字段 | HTML form 存在 | submitNewTask 提交 | startEditTask 回填 | 状态 |
|---|---|---|---|---|
| `name` | ✅ | ✅ | ✅ | OK |
| `icon` | ✅ | ✅ | ✅ | OK |
| `token_reward` | ✅ | ✅ | ✅ | OK |
| `target_account` | ✅ | ✅ | ✅ | OK |
| `category` | ✅ | ✅ | ✅ | OK |
| `sort_order` | ✅ | ✅ | ✅ | OK |
| **`cutoff_time`** (v2.1) | ✅ (`<input type="time">`) | ✅ | ❌ **缺失** | 🚨 **BUG** |
| **`is_self_lockout`** (v2.1) | ✅ (`<input type="checkbox">`) | ✅ | ❌ **缺失** | 🚨 **BUG** |

后端 (`src/routes/admin/tasks.ts :: TASK_COLUMNS` line 22-25) 已正确返回这 2 个字段; `parseUpdateBody` 也已支持 PUT 写入 (line 346-361)。所以**纯前端 bug**, 修 2 行即可。

### 2.4 复现步骤

```bash
# 1. 启动 dev (PM 通常用 npm run dev / wrangler pages dev)
cd /Users/tidusmaomao/workspace/kiddo-scoreboard
npm run dev  # 或: wrangler pages dev --port 8787

# 2. 在 admin 页面 (/admin/) 创建一个 sleep task:
#    名称: 准时上床, 截止: 21:30, 勾选"截止后自动锁"
# 3. 保存.
# 4. 在该任务行点 [编辑] 按钮.
# 5. 观察: cutoff_time 输入框为空, is_self_lockout 复选框未勾选.
# 6. 直接点保存 (不修改任何字段) → 数据库的 cutoff_time 被清成 NULL, is_self_lockout 被改成 0.
```

---

## 3. 测试设计

### 3.1 文件

- 新建: `tests/e2e/ui-admin-tasks-edit-prefill.spec.ts` (1 describe / 2 tests)
- 不修改任何共享 helper (`tests/e2e/helpers/db.ts` 中 `seedTask` 仍不支持 v2.1 字段 — 这是另一个 follow-up, 不在本 PR 范围)

### 3.2 用例

| Test | 场景 | 期望 |
|---|---|---|
| `HAPPY` | 编辑一个**带 v2.1 字段**的 sleep task (cutoff='21:30', is_self_lockout=1) | 8 个字段**全部**从 DB 回填到表单 |
| `HAPPY-2` | 编辑一个**普通 task** (cutoff=NULL, is_self_lockout=0) | cutoff_time 空字符串 + checkbox unchecked; 6 个普通字段正常回填 (反向证明: 不"误开"v2.1 字段) |

### 3.3 字段覆盖 (符合用户"每一个详细的 item")

测**所有 8 个字段**回填, 而不仅 v2.1 字段. 这样如果未来有字段添加遗漏, 这个 spec 也会立即 fail.

---

## 4. 测试执行 (clean-room)

### 4.1 Pre-flight

- ✅ 端口 8787 空闲 (无 wrangler/workerd 进程)
- ✅ `npm run test:e2e` 自动触发 `pretest:e2e → bash scripts/clean-test-db.sh` (按 `package.json` 配置, 项目硬性要求)
- ✅ D1 sqlite 文件存在 (`b6d6f164...sqlite`, 122KB)
- ✅ WebKit 已安装
- ✅ 没有任何 PM agent (PID 617 my-pm / PID 630 pm-for-claude) 在跑 workerd/playwright (避免 cross-process 干扰)

### 4.2 Run 1 (RED)

```
Running 2 tests using 1 worker
  ✘  1 HAPPY: 编辑按钮按下后, 8 个字段全部从 DB 回填 (11.6s)
  ✓  2 HAPPY-2: 编辑一个非 sleep task (1.1s)

  Error: expect(locator).toHaveValue(expected) failed
  Locator:  locator('#new-task-form').locator('[name="cutoff_time"]')
  Expected: "21:30"
  Received: ""
  Timeout:  10000ms
```

→ Test 1 fail: `cutoff_time` 没回填. Test 2 pass: 普通 task 的 NULL 场景正常.

### 4.3 Run 2 (RED — 2-run rule 验证)

```
  ✘  1 HAPPY: ... (同位置, 同原因)
  ✓  2 HAPPY-2: ... (同结果)
```

→ **同位置, 同原因 → 真 bug, 非 flaky infra**.

---

## 5. 修复建议 (供 PM 参考, Qual 不修代码)

### 5.1 最小修复 (2 行)

在 `public/admin/admin.js` line 445 后追加:

```js
f.elements['cutoff_time'].value = t.cutoff_time || '';
f.elements['is_self_lockout'].checked = t.is_self_lockout === 1 || t.is_self_lockout === true;
```

### 5.2 建议 (可选, 不阻塞)

把 `startEditTask` 改造成"基于 `form.elements[name]` 遍历回填"模式, 这样未来加字段不容易再漏:

```js
const fields = ['name', 'icon', 'token_reward', 'target_account', 'category', 'sort_order', 'cutoff_time'];
for (const name of fields) {
  if (name in t) f.elements[name].value = t[name] ?? '';
}
f.elements['is_self_lockout'].checked = t.is_self_lockout === 1 || t.is_self_lockout === true;
```

但这会改架构, 留给 PM 决定.

### 5.3 顺手补 `seedTask` helper

`tests/e2e/helpers/db.ts :: seedTask()` 不支持 v2.1 字段. 建议 PM 后续 PR 加上 `cutoff_time?`, `is_self_lockout?` overrides. 不阻塞本修复, 但能减少后续 test 用 `d1Exec` 直插 SQL.

---

## 6. 矩阵更新建议

`docs/FEATURE_MATRIX.md` 表 C (§3.5 PM Task Config) 加 1 行 regression 登记. 建议改写:

```diff
- | **3.5** | PM Task Config (CRUD) | ✓ | ✓ | ✓ | `smoke-admin-tasks.spec.ts` `ui-admin-tasks.spec.ts` `ui-admin-emoji-picker.spec.ts` `task-system.spec.ts` |
+ | **3.5** | PM Task Config (CRUD) | ✓ | ✓ | ✓ | `smoke-admin-tasks.spec.ts` `ui-admin-tasks.spec.ts` `ui-admin-emoji-picker.spec.ts` `ui-admin-tasks-edit-prefill.spec.ts` (regression: v2.1 fields prefill) `task-system.spec.ts` |
```

---

## 7. 已知事项 / Pre-existing

- **typecheck 27 fail** (memory 已知): `tsconfig.json` 缺 `DOM` lib + Task mock 缺 `cutoff_time`. 与本次 regression **无关**, 不阻塞 e2e.
- **2 个 unit test fail** (memory 已知): `me-tasks-complete` 批顺序期望未跟随 commit 5021b7d 同步. 与本次 **无关**.

---

## 8. Final Verdict

🚨 **FAIL** — 1 个测试 fail (cutoff_time 不回填), 真 bug 已 100% 复现 (2-run rule). 建议 PM 入 NIGHTLY-TODO #010 (或在 #009 旁加 subtask) 修 `startEditTask`, 修完 Qual 重跑 2 轮验证 GREEN 后可合入.

**版本**: v2026-06-09
**维护**: Qual Agent

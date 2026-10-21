# 文档差距审计 (DOC GAP AUDIT) — 2026-10-21

**审计对象**: `kiddo-scoreboard` 分支 `feature/task-active-days` (已 merge 到 main 并 deploy)
**审计范围**: `git log --oneline d13b2bb..HEAD` = 8 个 commit, 22 个文件, +2305/-54
**方法**: 只读。逐行读实现代码作为"现实基线", 再逐份比对 `docs/` + 根 `CLAUDE.md`。
**规则**: 每条关于代码的事实都带 `path:line` + 原文引用。无法在代码中验证的写 "unverified"。

> ⚠️ 本报告**没有修改任何文件**。所有建议编辑都是待粘贴文本, 未 apply。

---

## 0. 审计基准: 本分支改了什么

`git diff --stat d13b2bb..HEAD` — 变更文件全表:

| 类别 | 文件 |
|---|---|
| migration | `migrations/0020_task_active_days.sql` (新增) |
| server | `src/routes/admin/task-completions.ts`, `src/routes/admin/tasks.ts`, `src/routes/me/tasks.ts`, `src/routes/public/tasks.ts`, `src/utils/coin.ts`, `src/utils/week.ts`, `src/db/types.ts` |
| front-end | `public/admin/admin.js`, `public/admin/index.html`, `public/app.js` |
| tests | 9 个 unit spec (2 个全新, 7 个扩充) |
| docs | `docs/task-active-days-spec.md` (新增), `docs/NIGHTLY-TODO.md` |

Commit 列表:

```
58027df fix(admin): reset-day double-deducts coins for already-revoked rows
fe8e1a7 feat(admin): reset-day = 清空重来 (delete-based) + restore-day mirror
4b8faff docs(nightly-todo): Item #017 — all-tasks-complete parent push
de89a45 test: pin explicit date in status=all test (was midnight-rollover flaky)
3b477c1 fix(kid-ui): check-in toast showed legacy token_reward instead of the real +1 coin
e8962d9 feat(admin): task-completions status=all + history panel defaults to 全部
c4f51d1 fix(bonus): all-complete +3 now counts only tasks due today
37bda08 feat(tasks): per-task active days — server gating + admin config + kid UI + tests
```

**关键发现 (先行结论)**: `docs/` 全目录 grep `active_days|reset-day|status=all|TASK_NOT_ACTIVE_TODAY|task_restore|todayShanghaiISODay` 只命中 **2 个文件** —— `docs/task-active-days-spec.md` (29 处) 和 `docs/NIGHTLY-TODO.md` (1 处, 顺带提及)。**PRD / ARCHITECTURE / FEATURE_MATRIX / TEST_PLAN / PROGRESS / INDEX / INCIDENTS / CHILD_UI_FINDINGS 零命中**, 即 8 个已上生产的功能点在整个文档体系里没有任何一处记录。

---

# 第 1 部分: 现实基线 — 代码现在实际做什么

## 1.a `tasks.active_days` (任务生效日)

### Schema

`migrations/0020_task_active_days.sql:9` — 单列 TEXT, 无默认值:

```sql
ALTER TABLE tasks ADD COLUMN active_days TEXT;
```

`migrations/0020_task_active_days.sql:4-5` 注释定义语义:
```sql
--   NULL  = every day (default, back-compat for all existing tasks)
--   [1,2,3,4,5] = Mon-Fri only; [6,7] = Sat-Sun only
```

TS 类型 `src/db/types.ts:107-109`:
```ts
  // task-active-days: ISO weekdays [1..7] (Mon=1) when this task can be
  // completed. null = every day. Stored as JSON text in D1.
  active_days: number[] | null;
```

### 时区 / 星期约定

`src/utils/week.ts:111-114` —— 本分支新增的 helper:
```ts
export function todayShanghaiISODay(): number {
  const shifted = new Date(Date.now() + SHANGHAI_OFFSET_SECONDS * 1000);
  return shifted.getUTCDay() || 7;
}
```
即 **Asia/Shanghai (UTC+8) 的 ISO 星期, Mon=1 .. Sun=7** (与 `isoWeekString` 同一套 shift 手法, 见 `src/utils/week.ts:41-45`)。

### NULL / 空 / 脏值的处理

三处 read 层各自复制了一份 `parseActiveDays` (代码注释显式承认这是有意重复):
- `src/routes/me/tasks.ts:37-49`
- `src/routes/public/tasks.ts:23-35`
- `src/utils/coin.ts:88-100`

三份实现语义一致: `null` / `undefined` / `''` → `null` (= 每天); `JSON.parse` 失败 → `null`; 非整数或越界 (不在 1-7) 的元素被 filter 掉; 也接受已解析好的数组 (给 unit mock 用)。

**写侧归一化** `src/routes/admin/tasks.ts:38-57` (`normalizeActiveDays`):
```ts
function normalizeActiveDays(raw: unknown): { ok: true; value: string | null } | { ok: false; message: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, value: null };
  }
  ...
  if (raw.length === 0) {
    return { ok: true, value: null };
  }
```
→ **去重 + 升序排序后 `JSON.stringify`** (`:55-56`); 越界/非整数 → 400 (`:43`, `:51`, 消息 `active_days must be an array of integers 1-7`)。

### 服务端强制 (哪个路由 / 哪个错误码 / 顺序)

路由: **`POST /api/me/tasks/:id/complete`**。`src/routes/me/tasks.ts:125-133`:

```ts
  if (task.active_days !== null && task.active_days.length > 0) {
    const today = todayShanghaiISODay();
    if (!task.active_days.includes(today)) {
      return c.json(
        { error: { code: 'TASK_NOT_ACTIVE_TODAY', message: '该任务今天不是生效日' } },
        400,
      );
    }
  }
```

**顺序**: 在 §3.12 cutoff 检查 **之前**。`src/routes/me/tasks.ts:123-124` 注释:
```ts
  // 2.4 task-active-days: refuse if today is not an active day for this task.
  //     Runs BEFORE the §3.12 cutoff check (active_days applies on weekends too,
```
实际顺序可从代码位置确认: active_days 检查在 `:125-133`, cutoff 检查在 `:174-182`。
单元测试断言了这个顺序: `tests/unit/me-tasks-complete.test.ts:582` `it('active_days check fires BEFORE cutoff check when today is non-active day', ...)`。

`POST /:id/uncomplete` **不**做 active_days 检查 (只查 `is_active`), 见 `src/routes/me/tasks.ts:376-396` —— 已读代码确认, 该路由的 task load (`:376-383`) 解析了 `active_days` 但没有用它做任何 gate。

### Admin UI

表单: `public/admin/index.html:109-140` —— 7 个 checkbox (`name="active_days"` value=1..7, 标签 一~日) + 3 个 preset 按钮 (`:115-117`):
```html
                  <button type="button" data-days-preset="all" class="pm-btn ghost">每天</button>
                  <button type="button" data-days-preset="weekdays" class="pm-btn ghost">工作日</button>
                  <button type="button" data-days-preset="weekend" class="pm-btn ghost">周末</button>
```

helper: `public/admin/admin.js:1053-1072` (`setActiveDaysFromArray` / `applyActiveDaysPreset` / `readActiveDaysFromForm`)。
- preset: `all` → `[1..7]`, `weekdays` → `[1..5]`, `weekend` → `[6,7]` (`public/admin/admin.js:1061-1063`)
- 空选 → `null` 上线 (`public/admin/admin.js:1071`): `return vals.length ? vals : null;`
- 提交 (`public/admin/admin.js:1153`): `active_days: readActiveDaysFromForm(),`
- 编辑预填 (`public/admin/admin.js:1039-1041`):
```js
  setActiveDaysFromArray(
    Array.isArray(t.active_days) ? t.active_days : [1, 2, 3, 4, 5, 6, 7],
  );
```

> 🚨 **P0 代码发现 (非文档问题, 但影响文档准确性)**: `GET /api/admin/tasks` (`src/routes/admin/tasks.ts:92-107`) **不解析 `active_days`**, 直接把 D1 的 JSON 原文串返回:
> ```ts
>   const rows = await bound.all<Task>();
>   return c.json({ tasks: rows.results ?? [] });      // :106
> ```
> 对比 POST (`:283-312`) 和 PUT (`:570-590`) 都做了 `JSON.parse`。于是 admin 前端 `Array.isArray(t.active_days)` 恒为 `false` → `public/admin/admin.js:1040` 永远 fallback 到 `[1,2,3,4,5,6,7]` → **编辑一个 `active_days=[1,2,3,4,5]` 的任务时, 7 个框显示全勾; PM 若不手动改就直接保存, `readActiveDaysFromForm()` 返回 `[1..7]`, 服务端 `normalizeActiveDays` 存成 `"[1,2,3,4,5,6,7]"` —— 生效日限制被静默放宽成"每天"。**
> 现有测试未覆盖该路径: `tests/unit/admin-tasks-active-days.test.ts` 只测 POST (`:312` describe) 和 PUT (`:413` describe), 无 GET list 用例; `tests/unit/admin-tasks-config.test.ts:221` 的 mock 在 INSERT 时就 `JSON.parse` 了, 掩盖了真实 D1 的 TEXT 形态。
> **建议**: 修代码 (非文档), 或在文档里显式记录该限制。详见 §3 E-9。

### 小孩端 UI

`public/app.js:1189-1193`:
```js
    // task-active-days: today is an active day for this task iff
    //   - active_days is null/empty (== every day), OR
    //   - today (1..7) is included.
    const isActiveToday = !Array.isArray(t.active_days) || t.active_days.length === 0
      || t.active_days.includes(todayISODay);
```
状态机顺序 `public/app.js:1194`: `revoked → done → notActiveToday → isSleepLocked → normal`。
非生效日渲染 `public/app.js:1220-1228`: 按钮 `disabled = true`, class `task-btn-locked-out`, badge 文案 `生效日: 一·三·五` (由 `activeDaysLabel()` `public/app.js:1182-1185` 生成, 空 → `每天`)。
小孩端 ISO day 内联计算 (无构建步骤, 不 import) `public/app.js:1177-1180`。

数据来源: `GET /api/public/tasks` 在 `src/routes/public/tasks.ts:59-62` 逐行 `parseActiveDays`。

---

## 1.b `POST /api/admin/task-completions/reset-day`

路由定义 `src/routes/admin/task-completions.ts:281`。请求体契约 `:279`:
```
//   body: { user_id: number, date?: 'YYYY-MM-DD' (default todayShanghai), confirm?: true }
```
实际实现还多两个字段 (`:285-287`): `mode?: 'restore'`。

### 鉴权 / 入参 / 幂等

| 项 | 行为 | 证据 |
|---|---|---|
| auth guard | PM session, 否则 401 `UNAUTHORIZED` | `:282-283`, `unauthorized()` 定义 `:549-554` |
| `user_id` | 必填正整数, 否则 400 `BAD_REQUEST` | `:288-294` |
| `date` | 可选, 默认 `todayShanghai()`; 非 `YYYY-MM-DD` → 400 | `:296-304` |
| **confirm flag** | `body.confirm !== true` → 400 `CONFIRM_REQUIRED` `'pass confirm:true to reset'` | `:306-312` |
| **幂等 (清空模式)** | 当天无任何 row → `{success:true, reset_count:0, bonus_reversed:false, new_balance}` 提前返回, **不写任何行** | `:447-450` |
| **幂等 (restore 模式)** | 当天无 revoked row → `{success:true, restored_count:0, bonus_restored:false, ...}` | `:336-339` |

### 两种模式

`src/routes/admin/task-completions.ts:323`:
```ts
  const mode = body.mode === 'restore' ? 'restore' : 'revoke';
```
注意: 默认值字符串是 `'revoke'`, 但该模式的**实际行为是 delete-based**; 变量名有误导性。

---

### 模式 1 — 默认 "清空当天打卡" (delete-based)

`:434-436` 注释:
```ts
  // Load ALL of the day's completions (both statuses) for this user — the
  // delete-based reset (feihao 拍板 2026-10-20 "清空重来") wipes the whole
  // day so the kid sees every task back to 未完成 and can check in again.
```
SELECT 无 status 过滤 (`:437-445`), **active 和 revoked 行都删**。

**每行写入顺序** (`:454-503`, 单个 `db.batch()` = 隐式事务):
```
  //   snapshot → delete subitems → delete completion → (-1 coin, ACTIVE ONLY) → audit.
  // (D1 batch = implicit transaction; a mid-way failure rolls back all.)
```

1. **快照** → `deleted_records` (`:470-475`):
```ts
        db
          .prepare(
            `INSERT INTO deleted_records
               (record_type, original_id, original_data, deleted_at, deleted_by, original_table)
             VALUES ('task_completion', ?, ?, ?, ?, 'task_completions')`,
          )
          .bind(completion.id, JSON.stringify(completion), now, pmUserId),
```
2. **删子项** `summer_homework_subitems` (`:477-478`)
3. **删 completion 行** (`:479-481`): `DELETE FROM task_completions WHERE id = ?`
4. **硬币回退 — 仅 active 行** (`:460-467`):
```ts
  // Bug fix (feihao 2026-10-21 "清空已撤销任务也扣金币"): a revoked row's +1
  // was ALREADY reversed at revoke time — writing another -1 here would
  // double-deduct. Revoked rows get snapshot+delete+audit only, no coin.
  const statements = [];
  let coinReversals = 0;
  for (const completion of rows) {
    const wasActive = completion.status === 'active';
    const revokeCoin = wasActive
      ? buildRevokeTaskCoinSQL(userId, completion.task_id, date)
      : null;
```
   - `status === 'active'` → 写 `-1` (`buildRevokeTaskCoinSQL`, `src/utils/coin.ts:425-443`, `source_ref = revoke:task:<taskId>:<date>:<userId>`)
   - `status === 'revoked'` → **不写硬币**, 因为它当初 revoke 时已经回退过 (`src/utils/coin.ts:437-442` reason `revoke:task:#${taskId}`)
5. **audit** (`:485-501`): `actor='pm'`, `action='task_revoke'`, `details = {completion_id, task_id, bulk_reset_day, mode:'delete'}` (`:494-499`)
   - 注意 `mode:'delete'` —— 审计 action 名仍是 `task_revoke` 而非 `task_reset`, 只能靠 details 字段区分

**Bonus -3 反转** (`:506-526`):
```ts
  // Bonus reversal (idempotent, own batch — mirrors /:id/revoke §bonus).
  let bonusReversed = false;
  const bonusSql = await buildRevokeBonusSQLIfPresent(db, userId, date);
```
`buildRevokeBonusSQLIfPresent` (`src/utils/coin.ts:455-476`) 先查 `findBonusEvent` (`src/utils/coin.ts:158-173`):
```ts
      `SELECT id FROM score_events
       WHERE user_id = ? AND type = 'coins' AND change_value = 3
         AND reason LIKE 'bonus:%' AND source_ref = ?
         AND status = 'approved'`,
```
→ 只在**存在 approved 的 +3 bonus** 时写 `-3`, `source_ref = revoke:bonus:<date>:<userId>` (`src/utils/coin.ts:472-473`)。

**返回** (`:530-535`): `{ success, reset_count, bonus_reversed, new_balance }`, `reset_count` = 当天被删的**全部** row 数 (不是硬币回退数; `coinReversals` 变量 `:461,467` 被赋值但从未返回 —— 死变量)。

---

### 模式 2 — `mode:'restore'` (恢复已撤销打卡)

`:325-432`。SELECT 只取 `status = 'revoked'` 的行 (`:326-334`)。
每行 3 条语句 (`:344-375`):
```ts
        db
          .prepare(
            `UPDATE task_completions
             SET status = 'active', revoked_at = NULL, revoked_by = NULL
             WHERE id = ? AND status = 'revoked'`,
          )
```
→ `+1` 硬币, `source_ref = restore:task:<taskId>:<date>:<userId>` (`:358`) → audit `action='task_restore'` (`:363`)。

**Bonus 恢复** (`:379-423`), 双重幂等:
```ts
    // Bonus restore: only when the -3 reversal exists AND no +3 restore has
    // been written yet (idempotent on source_ref 'restore:bonus:...').
```
- 先查是否存在 `change_value = -3 AND source_ref = 'revoke:bonus:<date>:<userId>'` (`:382-389`)
- 再查是否已存在 `change_value = 3 AND source_ref = 'restore:bonus:<date>:<userId>'` (`:391-398`)
- 都满足才写 `+3` (`:403-407`)

**返回** (`:426-431`): `{ success, restored_count, bonus_restored, new_balance }`。

> ⚠️ **两个模式不是互逆的**。默认清空模式会 DELETE 所有行, 所以清空之后 restore 找不到任何 revoked row → `restored_count: 0` 空转。restore 只对"逐条 revoke"或"旧版本 bulk-revoke"留下的 revoked 行有意义。admin 前端注释已注意到这点 (`public/admin/admin.js:1326-1327`: *"only meaningful when rows were revoked individually or by an older reset"*), 但所有 docs 都没写。

---

## 1.c `GET /api/admin/task-completions`

`src/routes/admin/task-completions.ts:42`。参数与默认值:

| 参数 | 必填 | 默认 | 校验 | 行号 |
|---|---|---|---|---|
| `user_id` | 是 | — | 正整数, 否则 400 | `:52-65` |
| `date` | 否 | `todayShanghai()` | `YYYY-MM-DD`, 否则 400 | `:67-75` |
| `status` | 否 | `'active'` | ∈ {`active`,`revoked`,`all`}, 否则 400 | `:77-86` |

**本分支新增 `all`** — `:77-87`:
```ts
  // status: optional, default 'active'. 'all' = no status filter (feihao
  // 2026-10-20: reset-day leaves everything revoked — the admin history
  // panel defaults to 'all' now so revoked rows stay visible).
  const statusRaw = c.req.query('status') ?? 'active';
  if (statusRaw !== 'active' && statusRaw !== 'revoked' && statusRaw !== 'all') {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: "status must be 'active', 'revoked' or 'all'" } },
      400,
    );
  }
```
实现 `:89-92` — `all` 时 WHERE 子句和 bind 参数都少一个:
```ts
  const whereStatus = status === 'all' ? '' : 'AND status = ?';
  const bindAll = status === 'all'
    ? [userId, date]
    : [userId, date, status];
```

**服务端默认仍是 `active`**; 是**前端**默认改成 `全部` — `public/admin/admin.js:29`:
```js
  completionStatus: 'all',  // feihao 2026-10-20: default 全部 — revoked rows stay visible after reset-day
```
下拉选项 `public/admin/index.html:237` `<option value="all">全部</option>`。

---

## 1.d 每日 "全部完成" +3 bonus: "今天到期"集合怎么算

### 服务端 (权威)

`src/utils/coin.ts:117-146` — `isAllTasksCompleted(db, userId, date)`:

`:106-111` 文档注释定义 "due today":
```ts
 * "Due today" (task-active-days fix, 2026-10-20): tasks.is_active = 1 AND
 * (active_days IS NULL/empty → every day, OR today's ISO weekday is in
 * active_days). Tasks whose active_days exclude today can never be
 * completed today (server refuses with TASK_NOT_ACTIVE_TODAY), so they
 * must NOT block the +3 bonus.
```

`:122-133` 实现 (**JS 侧过滤, 不是 SQL `json_each`**):
```ts
  // Tasks due today, computed JS-side (workerd sqlite json_each is not
  // guaranteed, and the codebase parses active_days in JS elsewhere).
  const rows = await db
    .prepare(`SELECT id, active_days FROM tasks WHERE is_active = 1`)
    .all<{ id: number; active_days: string | null }>();
  const today = todayShanghaiISODay();
  const dueToday = (rows.results ?? []).filter((t) => {
    const days = parseActiveDays(t.active_days);
    return days === null || days.length === 0 || days.includes(today);
  });
  // Guard: zero tasks due today → no bonus (nothing to "complete all of").
  if (dueToday.length === 0) return false;
```
`:136-145` 只统计 `status = 'active'` 的 completion, 然后 `dueToday.every((t) => doneSet.has(t.id))`。

**调用链**:
1. `src/routes/me/tasks.ts:300-304` (complete 时) → `buildDailyBonusSQLIfAllDone(db, CHILD_USER_ID, today)`
2. `src/utils/coin.ts:392-416` — 先 `isAllTasksCompleted` 再 `findBonusEvent` 幂等守卫:
```ts
export async function buildDailyBonusSQLIfAllDone(
  _db: D1Database,
  userId: number,
  date: string,
): Promise<{ query: string; params: unknown[] } | null> {
  const allDone = await isAllTasksCompleted(_db, userId, date);
  if (!allDone) return null;

  const existing = await findBonusEvent(_db, userId, date);
  if (existing !== null) return null;
```
3. 老 helper `grantCoinsForTaskCompletion` (`src/utils/coin.ts:301`) 也调它 —— 共用同一语义。

**历史沿革** (`src/utils/coin.ts:76-82` 保留的旧 FIX 注释, 解释了为什么不能用计数相等):
```ts
 * FIX (2026-07-16 feihao 拍板): 用 NOT EXISTS 检查每个 active task 是不是
 * 都被今天 active completion 覆盖。旧 activeCount === doneCount 会被
 * "admin 关掉 task 但 task_completion 残留" 破坏 ... 新语义:
 * "active task 全完成 = bonus"
```

### 小孩端 (镜像)

`public/app.js:1303-1311`:
```js
  // task-active-days fix (2026-10-20): only tasks DUE today count toward the
  // "全部完成 +3" bonus. Not-due-today tasks can't be completed today, so
  // they must not keep the hint grey forever. Mirrors the server-side
  // isAllTasksCompleted() fix in src/utils/coin.ts.
  const shifted = new Date(Date.now() + 8 * 3600 * 1000);
  const todayISODay = shifted.getUTCDay() || 7;
  const dueToday = state.tasks.filter((t) =>
    !Array.isArray(t.active_days) || t.active_days.length === 0
    || t.active_days.includes(todayISODay));
```

### 第三处消费者: 进度条分母

`src/routes/public/tasks.ts:185-196` — `GET /api/public/tasks/progress` 的 `daily.total`:
```ts
  // task-active-days fix (2026-10-20): daily.total = tasks DUE today, not
  // all is_active tasks. A weekday-only task shouldn't pad Saturday's bar.
  const todayISODay = todayShanghaiISODay();
  const dueTodayCount = (activeTasks.results ?? []).filter((t) => {
    const days = parseActiveDays(t.active_days);
    return days === null || days.length === 0 || days.includes(todayISODay);
  }).length;
```
→ 影响小孩端 `public/app.js:1451-1454` 的撒纸屑判定 (`state.progress.daily.completed >= state.progress.daily.total`)。

---

## 1.e 小孩端打卡 toast: 显示什么 vs 实际发放什么

**实际发放** (服务端, 铁律): 每次任务完成 = **统一 +1 🪙**, 与 `tasks.token_reward` **无关**。
- `src/utils/coin.ts:342-377` `buildTaskCoinGrantSQL` 硬编码 `'coins', 1` (`:370-371`)
- bonus +3 另算 (`src/routes/me/tasks.ts:299-323`)
- 响应体里 `token_awarded: task.token_reward` (`src/routes/me/tasks.ts:332`) 是**遗留信息字段**, `task_reward` 保留给历史兼容

**本分支修复前**: toast 显示的是这个遗留 `token_reward` 数字 (例如 5), 与实际到账的 1 枚不符。

**修复后** `public/app.js:1435-1445`:
```js
    // Bug fix (feihao 2026-10-20): token_awarded is the legacy informational
    // token_reward (e.g. 5) — the ACTUAL grant is a uniform +1 coin per task
    // (Bug #1 2026-06-14), plus a one-off +3 bonus when all due-today tasks
    // are done (bonus_event_id present). Show what really landed, not the
    // stale legacy number.
    toast(
      r.bonus_event_id
        ? '+1 🪙 到账，今日全部完成 +3 🪙！'
        : '+1 🪙 到账',
      'success',
    );
```
判定依据是响应里的 `bonus_event_id` 非空 (`src/routes/me/tasks.ts:340`)。

**仍未修的同类问题**: `public/app.js:1839` 日历视图仍用遗留字段:
```js
        <span class="calendar-completion-reward">+${c.token_reward} 🪙</span>
```
→ 日历里一个实际只到账 +1 的任务仍会显示 `+5 🪙`。**P1 未修代码问题**, 记入 §2 G-10。

---

## 1.f 其他值得记录的行为 (来自本分支变更文件)

1. **`GET /api/admin/tasks` 不解析 `active_days`** — `src/routes/admin/tasks.ts:106` (详见 §1.a 的 🚨 P0)。
2. **`coinReversals` 是死变量** — `src/routes/admin/task-completions.ts:461,467` 赋值后从未读取/返回。
3. **reset-day 会删 `summer_homework_subitems`** — `src/routes/admin/task-completions.ts:477-478`。虽任务已于 2026-09-04 停用, 但历史数据的子项行会随清空一并消失 (有 `deleted_records` 快照可还原)。
4. **audit action 名复用**: 清空模式写 `action='task_revoke'` + `details.mode='delete'` (`:489,498`); restore 模式写 `action='task_restore'` (`:363,412`)。审计过滤器必须靠 `details.mode` 区分清空 vs 逐条撤销。
5. **`mode` 变量名误导** — `:323` 默认值字符串 `'revoke'` 对应的是 delete 行为。
6. **bonus 判定共 3 处消费者**: server (`src/utils/coin.ts:117`) / kid hint (`public/app.js:1299`) / progress 分母 (`src/routes/public/tasks.ts:185`)。三者各自实现了一份 due-today 过滤, **无共享函数** —— 改语义时三处必须同步 (代码注释已在 `src/routes/public/tasks.ts:21-22` 和 `src/utils/coin.ts:86-87` 承认这种重复是有意为之)。

---

# 第 2 部分: 文档差距矩阵

| Doc | What's missing/stale | Evidence from code | Priority |
|---|---|---|---|
| **PRD.md** | **F2 bonus 规则与代码直接矛盾** — 写"当天所有 active 任务完成时", 代码只算"今天到期的 active 任务" | 文档 `docs/PRD.md:913` `\| F2 \| 全任务完成 +3 bonus \| 当天所有 active 任务完成时...` vs `src/utils/coin.ts:128-131` | **P0** |
| **PRD.md** | 撤销语义只有 2 种 (revoke/hard-delete), 缺 reset-day delete + restore 两种 | 文档 `docs/PRD.md:135-136` (只有"PM 可撤销") vs `src/routes/admin/task-completions.ts:281,325` | **P0** |
| **PRD.md** | API 端点表漏 `reset-day` + `status=all` 参数 | 文档 `docs/PRD.md:541-542` 只有 `GET ...?date=&user_id=` 和 `POST /:id/revoke` vs `src/routes/admin/task-completions.ts:81,281` | **P0** |
| **PRD.md** | 数据模型无 `tasks.active_days` 列 | 文档 `docs/PRD.md:109-138` §3.4 任务系统表 vs `migrations/0020_task_active_days.sql:9` | **P1** |
| **PRD.md** | `task_completion` 状态机图缺 `→ DELETED` 和 `REVOKED → ACTIVE` 两条边 | 文档 `docs/PRD.md:645-655` 图 vs `src/routes/admin/task-completions.ts:347-349` (un-revoke) 和 `:479-481` (delete) | **P1** |
| **PRD.md** | 400 `TASK_NOT_ACTIVE_TODAY` 完全未记录 (只记录了 409 `ALREADY_COMPLETED_TODAY`) | 文档 `docs/PRD.md:206` `**任务重复完成**: ... API 返回 409 冲突` vs `src/routes/me/tasks.ts:129` | **P1** |
| **PRD.md** | 验收表无 active_days / reset-day 用例 (F1-F17 止于旧功能) | 文档 `docs/PRD.md:912-923` F1-F12 表 vs §1.a/§1.b | **P1** |
| **ARCHITECTURE.md** | **迁移清单停在 0004**, 缺 0006-0020 共 13 个 | 文档 `docs/ARCHITECTURE.md:283` 最后一行 `\| 0004 \| (无新表) \| tasks 加 cutoff_time + is_self_lockout 字段 \|` vs `migrations/0020_task_active_days.sql` 存在 | **P0** |
| **ARCHITECTURE.md** | "7 表" 计数过期 (0006 `deleted_records` 等未计) | 文档 `docs/ARCHITECTURE.md:43` `Tables (7): users / score_events / tasks / task_completions / audit_log / auth_attempts / app_config` + `:272` `## 📦 数据库 Schema 速查 (7 表)` | **P1** |
| **ARCHITECTURE.md** | 端点树漏 `POST /task-completions/reset-day` | 文档 `docs/ARCHITECTURE.md:97-99` 只有 `/` GET 和 `/:id/revoke` POST vs `src/routes/admin/task-completions.ts:281` | **P0** |
| **ARCHITECTURE.md** | utils 树漏 `coin.ts` (bonus +3 的唯一实现处) | 文档 `docs/ARCHITECTURE.md:130-132` 只列 `week.ts`/`balance.ts`/`audit.ts` vs `src/utils/coin.ts` 存在 | **P1** |
| **ARCHITECTURE.md** | 打卡流程图无 active_days gate 步骤 | 文档 `docs/ARCHITECTURE.md:164-186` "操作 A: 儿子点'完成任务'按钮" vs `src/routes/me/tasks.ts:125-133` | **P1** |
| **ARCHITECTURE.md** | 端点树未标 `status=all` 参数 / `TASK_NOT_ACTIVE_TODAY` 错误码 | 文档 `docs/ARCHITECTURE.md:76,98` vs `src/routes/admin/task-completions.ts:81`, `src/routes/me/tasks.ts:129` | **P2** |
| **ARCHITECTURE.md** | `最后更新: 2026-06-08 (v2.1)` / `版本: v2.1` 已过期 | 文档 `docs/ARCHITECTURE.md:7,341` | **P2** |
| **FEATURE_MATRIX.md** | 表 A 无 active_days / reset-day 行; 表 B 8 流程无"PM 清空当天打卡" | 文档 `docs/FEATURE_MATRIX.md:18-25`, `:34-45` vs §1.a/§1.b | **P0** |
| **FEATURE_MATRIX.md** | 表 C 无 admin 7-checkbox UI 行、无 kid 灰置/toast 行 | 文档 `docs/FEATURE_MATRIX.md:60,65` vs `public/admin/index.html:109-140`, `public/app.js:1220-1228,1440-1445` | **P1** |
| **FEATURE_MATRIX.md** | 表 E 单测清单缺 2 个全新 spec (1063 LoC) | 文档 `docs/FEATURE_MATRIX.md:140-143` (`**单元测试总数**: 26 文件 / ~147 用例`) vs `tests/unit/` 实际 **56 个 spec 文件** | **P0** |
| **FEATURE_MATRIX.md** | `最后更新: 2026-06-24` / `版本: v2.2 (2026-06-08)` 过期 | 文档 `docs/FEATURE_MATRIX.md:7,220` | **P2** |
| **FEATURE_MATRIX.md** | 当前状态栏 `(2026-06-09) 205 pass + 2 NEW regression RED` — 这些已随本分支修完 | 文档 `docs/FEATURE_MATRIX.md:193` | **P2** |
| **TEST_PLAN.md** | §7 Coverage Matrix 无任何新行 (最后一行 `\| §9.4 \| 审计按 actor 过滤 \|`) | 文档 `docs/TEST_PLAN.md:1659` vs 新增的 8 个 describe block | **P0** |
| **TEST_PLAN.md** | 无 §3.23 段落记录 task-active-days / reset-day 单测 | 文档 `docs/TEST_PLAN.md:1428` 最后一段是 `### 3.22 暑假作业 Modal` | **P0** |
| **TEST_PLAN.md** | TOC 只列到 3.15/3.16, 缺 3.17-3.22 | 文档 `docs/TEST_PLAN.md:30-31` vs `:1075-1488` | **P2** |
| **TEST_PLAN.md** | §3.17 / §3.18 编号顺序颠倒 | 文档 `docs/TEST_PLAN.md:1075` (`### 3.18`) 出现在 `:1124` (`### 3.17`) 之前 | **P3** |
| **PROGRESS.md** | 完全没有本分支 8 个 commit 的 shipped 记录; 最后条目是 v2.x Item #013 | 文档 `docs/PROGRESS.md:1052` `## ✅ v2.x — Running Milestone 金币袋 + R2 Cascade 撤销 (Item #013) — 2026-07-14`, 文件 1082 行到 EOF | **P0** |
| **PROGRESS.md** | 总测试数 `297 个（198 unit + 99 e2e）` 过期 | 文档 `docs/PROGRESS.md:39` vs `tests/unit/` 56 文件 | **P2** |
| **PROGRESS.md** | 遗留 pending 标记已过期 (`~2026-09 PM 手动删 task`) | 文档 `docs/PROGRESS.md:1045` `- 5 min cleanup 开学后 (~2026-09): PM 手动删 task + 删 modal HTML/JS/CSS` vs `docs/SUMMER-HOMEWORK-DISABLED.md:34` 已完成 | **P2** |
| **INDEX.md** | **不链接新增的 `docs/task-active-days-spec.md`** — 文档清单里没有它 | 文档 `docs/INDEX.md:22-59` 完整清单无此文件, 但 `docs/task-active-days-spec.md` 已 commit | **P0** |
| **INDEX.md** | 测试规模 `22 spec, 192 pass` / `50+ spec, 182 pass` 严重过期 | 文档 `docs/INDEX.md:86-87` vs 实际 56 unit spec + 75 e2e spec | **P1** |
| **INDEX.md** | migrations 目录速查只列 0001-0004 | 文档 `docs/INDEX.md:85` vs 实际 20 个 migration | **P1** |
| **INDEX.md** | npm scripts 表 `dev / test / test:e2e / deploy` 与 `package.json` 不符 (无 `typecheck` / `test:unit`) | 文档 `docs/INDEX.md:68` vs `package.json` 实际 scripts | **P1** |
| **INCIDENTS.md** | **本分支修的 4 个 bug 一个都没记** | 文档 `docs/INCIDENTS.md:150` 最后一条 `## 2026-08-02T16:19:16Z`, vs commit `58027df` / `c4f51d1` / `3b477c1` / `de89a45` | **P0** |
| **INCIDENTS.md** | 文件定位是"自动维护的 deploy/backup 失败记录", 结构上不收产品 bug | 文档 `docs/INCIDENTS.md:1` `# 🚨 kiddo-scoreboard Deploy Incidents` + `:3` `每次 backup / deploy 失败, Action 会自动追加一行在这里` | **P1** |
| **CHILD_UI_FINDINGS.md** | 没有记 toast 显示错误金额这个 kid-facing bug (F 系列只到 F15) | 文档 `docs/CHILD_UI_FINDINGS.md:302` `### F15. 成人化用词清单` 为最后一条 vs commit `3b477c1` | **P1** |
| **CLAUDE.md (root)** | **文件不存在** — 无法审计 | `ls -la CLAUDE.md` → `NO ROOT CLAUDE.md`; `find . -maxdepth 2 -name CLAUDE.md -not -path "./node_modules/*"` → 无结果 | **P2** (see §4) |
| **CHANGELOG.md** | 迁移清单停在 0018, 无 0019/0020, 无本分支条目 | 文档 `CHANGELOG.md:59` `- migrations/0018_question_attempts.sql — question_attempts 表（答题流水）` | **P1** |
| **README.md** | 数据模型清单停在 `migrations/0016-0018`, "5 张表已固化" 过期 | 文档 `README.md:123` `- ✅ 数据模型扩展: migrations/0016-0018 (families / questions / question_attempts) + users.openid 字段` + `README.md:106` `**数据库**: 5 张表已固化` | **P2** |
| **docs/task-active-days-spec.md** | **Status 仍写 `ready-for-impl`**, 实际已 merge + deploy | 文档 `docs/task-active-days-spec.md:22` `**Status**: ready-for-impl` | **P0** |
| **docs/task-active-days-spec.md** | §7 验收清单全未勾选, 但代码已上线 | 文档 `docs/task-active-days-spec.md:165-173` (17 个空 checkbox) | **P0** |
| **docs/task-active-days-spec.md** | §1 状态段写"worktree + CC dispatch 排队中" | 文档 `docs/task-active-days-spec.md:5` | **P1** |
| **docs/task-active-days-spec.md** | **§5.2 声称编辑预填有效, 与代码不符** (admin GET 不解析 → 恒 fallback 全勾) | 文档 `docs/task-active-days-spec.md:148` `预填 (L1032 附近): active_days 数组 → 勾对应 checkbox` vs `src/routes/admin/tasks.ts:106` | **P0** |
| **docs/task-active-days-spec.md** | §6 测试表漏列 reset-day / status=all / bonus×active_days 三个 suite | 文档 `docs/task-active-days-spec.md:154-159` 只列 4 个文件 vs 实际改了 9 个 | **P1** |
| **docs/NIGHTLY-TODO.md** | Item #017 正确引用了新的 due-today 语义 (**唯一正确的跨文档引用**) | 文档 `docs/NIGHTLY-TODO.md:954` `"打全" 判定已存在: isAllTasksCompleted() (2026-10-20 刚修过 active_days 语义)` | — ✅ 正确 |
| **docs/SUMMER-HOMEWORK-DISABLED.md** | §Step 5 bonus 验收项仍成立 (bonus 排除 inactive task) | 文档 `docs/SUMMER-HOMEWORK-DISABLED.md:87` `- [ ] Bonus: 完成所有 active task 后仍触发 +3 coin` vs `src/utils/coin.ts:125` (`WHERE is_active = 1`) | ✅ 仍正确 |

---

# 第 3 部分: 建议的确切编辑 (待粘贴, 未 apply)

> 以下每条都给出 **目标文件 + 插入锚点 + 可直接粘贴的 markdown**。保持外科手术式, 不重写整篇。

## E-1 — PRD.md: 修正 F2 bonus 规则 (P0)

**文件**: `docs/PRD.md` **位置**: `:913` 这一行整行替换。

```markdown
| F2 | 全任务完成 +3 bonus | **当天所有"到期"任务完成时** (到期 = `is_active=1` 且 `active_days` 为空/含今天), bonus +3 金币, 弹出"🎉 全任务完成！"提示 3 秒。**非当天的生效日任务不参与判定** (v2.x, 2026-10-20 修正) | Given: 3 个到期任务 (另有 1 个 `active_days=[1,2,3,4,5]` 的任务, 今天=周六) , 已完成 2 个<br>When: 完成第 3 个<br>Then: 金币 +3 (含任务本身的 +1 = +4), 弹提示 |
```

紧接其后 (`:913` 之后, F3 行之前) 插入:

```markdown
| F18 | 任务生效日拦截 (active_days, v2.x) | 今天的 ISO 星期 (Asia/Shanghai, Mon=1..Sun=7) 不在 `tasks.active_days` 内 → `POST /api/me/tasks/:id/complete` 返 400 `TASK_NOT_ACTIVE_TODAY`; 该检查早于 §3.12 cutoff 检查 | Given: 任务 `active_days=[1,2,3,4,5]`<br>When: 周六打卡<br>Then: 400 `TASK_NOT_ACTIVE_TODAY`, 不写任何行; 小孩端按钮灰置并显示"生效日: 一·三·五" |
| F19 | 清空当天打卡 / 恢复当天 (v2.x) | `POST /api/admin/task-completions/reset-day` 需 `confirm:true`; 默认模式**删除**当天全部 completion (含已撤销), 仅对原本 `status='active'` 的行回退 -1 🪙, 全量快照进 `deleted_records`, 已发 +3 则反转 -3; `mode:'restore'` 把当天 revoked 行恢复成 active 并补 +1, 若存在 -3 反转则补回 +3 | Given: 当天 3 条 completion (2 active + 1 revoked), 已发 +3 bonus<br>When: PM 点"清空当天打卡"<br>Then: 3 行全删, 写 2 条 -1 (不是 3 条), 1 条 -3 bonus 反转, `deleted_records` 3 条快照, audit 3 条 `action=task_revoke` + `details.mode='delete'` |
```

## E-2 — PRD.md: 补撤销语义 + 端点 + 状态机 (P0/P1)

**位置**: `docs/PRD.md:136` 之后 (`:135-136` 两条之后) 插入:

```markdown
- **批量清空当天打卡** (v2.x, 2026-10-20): `POST /api/admin/task-completions/reset-day` (PM only, 必须 `confirm:true`)。默认"清空重来"模式**物理删除**当天全部 `task_completions` (含已撤销行), 每行先快照进 `deleted_records` 再删。**金币回退只针对删除前 `status='active'` 的行写 -1** —— 已撤销行当初撤销时已回退过, 再扣就是双倍扣 (2026-10-21 修)。已发的 +3 bonus 反转 -3。
- **批量恢复当天打卡** (v2.x, 2026-10-20): 同一端点传 `mode:'restore'`, 把当天 `status='revoked'` 的行改回 `active` 并每条补 +1 🪙; 若存在对应的 -3 反转行则再补 +3 (对 `restore:bonus:` source_ref 幂等)。注意: 清空模式已把行删掉, 因此**两个模式不是互逆的**, restore 只对"逐条撤销"或旧版本 bulk-revoke 留下的 revoked 行有意义。
- 当天没有任何记录时两个模式都是幂等 no-op (`reset_count: 0` / `restored_count: 0`), 不写任何行。
```

**位置**: `docs/PRD.md:542` 之后插入两行:

```markdown
| **POST** | **`/api/admin/task-completions/reset-day`** | PM | 清空当天打卡 (默认, delete-based) / 恢复当天 (`mode:'restore'`), 需 `confirm:true` |
| **GET** | **`/api/admin/task-completions?user_id=&date=&status=`** | PM | 完成记录列表。`status` ∈ `active`(默认) / `revoked` / `all` |
```

**位置**: `docs/PRD.md:206` 之后插入:

```markdown
- **任务非生效日** (v2.x): 今天的 ISO 星期不在 `active_days` 内 → API 返回 400 `TASK_NOT_ACTIVE_TODAY`(先于 cutoff 检查判定)
```

**位置**: `docs/PRD.md:645-655` 状态机图, 在图后补:

```markdown
> **v2.x 补充**: 批量操作引入了图中未画的两条边 —— `ACTIVE → (物理删除)` (reset-day 默认模式, 走 `deleted_records` 快照) 和 `REVOKED → ACTIVE` (reset-day `mode:'restore'`)。逐条 revoke 仍是唯一的软删边。
```

## E-3 — ARCHITECTURE.md: 迁移清单补全 (P0)

**位置**: `docs/ARCHITECTURE.md:283` 之后插入。同时把 `:272` 的 `(7 表)` 与 `:43` 的 `Tables (7)` 一并改。

```markdown
| 0006 | `deleted_records` | 硬删除快照 (record_type / original_id / original_data JSON) |
| 0007 | `score_events` (重建) | 加 `type='coins'` + `source_ref`; coin 系统上线 |
| 0008 | `shop_items` / `shop_redemptions` | 商店 + 周限额兑换 |
| 0008 | `health_events` | 健康打卡事件 |
| 0009 | running 系列表 | 跑步地图 / 站点 / 记录 |
| 0011 | running_progress | 跑步进度 |
| 0012 | (无新表) | `awarded_minutes` → `awarded_coins` 重命名 |
| 0014 | `summer_homework_subitems` | 暑假作业 6 子项 (2026-09-04 起任务已停用) |
| 0015 | (无新表) | 商店项游戏时长 60 分钟档 |
| 0016 | `families` | PM ↔ 孩子归属 + `users.openid` |
| 0017 | `questions` | 4 选 1 题库 |
| 0018 | `question_attempts` | 答题流水 |
| 0019 | (无新表) | 一行 `UPDATE` 停用暑假作业 (`tasks.is_active=0`) |
| 0020 | (无新表) | **`tasks.active_days TEXT`** — ISO 星期 JSON 数组 `[1..7]`, NULL = 每天; 配套 400 `TASK_NOT_ACTIVE_TODAY` + bonus 只算当天到期任务 |
```

## E-4 — ARCHITECTURE.md: 端点树补 reset-day (P0)

**位置**: `docs/ARCHITECTURE.md:99` 之后插入:

```markdown
    │   ├── /reset-day                 POST   清空当天打卡 (delete-based, 需 confirm:true)
    │   │                                       / mode:'restore' 恢复当天已撤销打卡
```

`:98` 的 `/` 行建议改为 `GET 完成记录列表 (status: active|revoked|all, 默认 active)`, `:76` 的 complete 行建议补 `(非生效日 → 400 TASK_NOT_ACTIVE_TODAY)`。

## E-5 — ARCHITECTURE.md: utils 树补 coin.ts (P1)

**位置**: `docs/ARCHITECTURE.md:132` (`audit.ts` 行) 之后插入:

```markdown
    │   ├── coin.ts                # +1 打卡币 / -1 回退 / ±3 每日 bonus (isAllTasksCompleted 只算当天到期任务)
```

## E-6 — FEATURE_MATRIX.md: 表 A / B / C / E 补行 (P0/P1)

**位置**: `docs/FEATURE_MATRIX.md:25` (表 A 最后一行) 之后插入:

```markdown
| **3.16** | 任务生效日 (active_days) + 清空当天打卡/恢复 (v2.x, 2026-10-20) | `migrations/0020` + `routes/me/tasks.ts` + `utils/coin.ts :: isAllTasksCompleted` + `routes/admin/task-completions.ts :: POST /reset-day` | 3.23 (新增) | `admin-tasks-active-days.test.ts` `me-tasks-complete.test.ts` (gating + bonus 2 组 describe) `admin-task-completions-reset-day.test.ts` | (待补 e2e) | ⚠️ 100% unit / 0% e2e |
```

**位置**: `docs/FEATURE_MATRIX.md:45` (表 B 5.8 行) 之后插入:

```markdown
| **5.9** | PM 清空当天打卡 / 恢复当天 | PM | `POST /api/admin/task-completions/reset-day` (`mode` 缺省=清空; `mode:'restore'`=恢复) | `admin-task-completions-reset-day` 走的是 unit 覆盖, **e2e 尚缺** |
```

并把 `:47` 的 `**交互流程侧覆盖率**: **8/8 = 100%** ✅` 改为 `**交互流程侧覆盖率**: **8/9** (5.9 仅 unit 覆盖, e2e 待补)`, 把 `:27` 的 `7/7 = 100%` 改为 `8/8` 并追加 gap 说明行。

**位置**: `docs/FEATURE_MATRIX.md:69` (§3.15 行) 之后插入:

```markdown
| **3.23** | PM 任务生效日 UI (7 checkbox + 每天/工作日/周末 3 预设) | `public/admin/index.html:109-140` + `admin.js:1053-1072` | 3.16 | `admin-tasks-active-days.test.ts` (15 its, 仅 API 层) | (待补) |
| **3.24** | 小孩端非生效日灰置 + 打卡 toast 文案 | `public/app.js:1220-1228` + `:1435-1445` | 3.16 | `me-tasks-complete.test.ts` | (待补) |
```

## E-7 — FEATURE_MATRIX.md: 表 E 单测清单补新 suite (P0)

**位置**: `docs/FEATURE_MATRIX.md:141` 之后插入, 并修正 `:143` 的计数行:

```markdown
- `admin-tasks-active-days.test.ts` (v2.x, 15 its: POST 校验 11 + PUT 更新 4)
- `admin-task-completions-reset-day.test.ts` (v2.x, 11 its: 清空模式 8 + restore 模式 3)
- `admin-task-completions-list.test.ts` (v2.x 增补: `status=all` 用例)

**单元测试总数**: **56 个 spec 文件** (`ls tests/unit/*.test.ts | wc -l`), v2.2 baseline 26 + 后续累计。
```

## E-8 — INDEX.md: 补 spec 链接 + 修过期数字 (P0/P1)

**位置**: `docs/INDEX.md:34` 之后插入:

```markdown
- **[`docs/task-active-days-spec.md`](./task-active-days-spec.md)** — **✅ 2026-10-20 已上线** 任务生效日 (active_days) spec + 实施记录 (7 天自由勾选 + 每天/工作日/周末 3 预设, 服务端 400 `TASK_NOT_ACTIVE_TODAY`)
```

**位置**: `docs/INDEX.md:85-87` 三行替换:

```markdown
| `migrations/` | D1 schema | `0001_initial.sql` … **`0020_task_active_days.sql`** (共 20 个, 0005/0013 编号空缺) |
| `tests/unit/` | Vitest 单元测试 | **56 个 spec** (2026-10-21 实测) |
| `tests/e2e/` | Playwright e2e 测试 | **75 个 spec** (2026-10-21 实测) |
```

> ⚠️ `docs/INDEX.md:68` 的 npm scripts 描述 (`dev` / `test` / `test:e2e` / `deploy`) 与 `package.json` 实际不符 — 建议 PM 核对后一并修, 本报告未逐一核对每个 script 名。

## E-9 — task-active-days-spec.md: 状态更新 + 记录已知缺陷 (P0)

**位置**: `docs/task-active-days-spec.md:22` 替换:

```markdown
**Status**: ✅ **已实现并上线** (merge `37bda08` … `58027df`, 2026-10-20/21)
```

**位置**: `docs/task-active-days-spec.md:5` 替换:

```markdown
**状态**: ✅ 已实现并 deploy 到生产。后续同批上线: admin reset-day/restore (`fe8e1a7`, `58027df`)、bonus 只算当天到期 (`c4f51d1`)、status=all (`e8962d9`)、打卡 toast 修正 (`3b477c1`)。
```

**位置**: `docs/task-active-days-spec.md:148` (§5.2 预填说明) 之后插入 — **已知缺陷**:

```markdown
> 🐛 **已知缺陷 (2026-10-21 审计发现, 待修)**: `GET /api/admin/tasks` (`src/routes/admin/tasks.ts:106`) 直接返回 D1 行, **未 JSON.parse `active_days`**, 与 POST/PUT 的返回路径不一致 (`src/routes/admin/tasks.ts:283-312`, `:570-590`)。因此 admin 前端 `Array.isArray(t.active_days)` 恒为 false, `public/admin/admin.js:1040` 永远 fallback 到 `[1,2,3,4,5,6,7]` —— **编辑一个 `active_days=[1,2,3,4,5]` 的任务时 7 个框显示全勾; 若 PM 不改直接保存, 生效日限制会被静默放宽成"每天"**。§5.2 描述的预填行为目前**不成立**。现有单测未覆盖 (`admin-tasks-active-days.test.ts` 只测 POST/PUT)。
```

**位置**: `docs/task-active-days-spec.md:161` (§6 测试表) 之后插入:

```markdown
> **同批新增的其它 suite** (原表未列): `admin-task-completions-reset-day.test.ts` (605 行, 清空 8 its + restore 3 its)、`admin-task-completions-list.test.ts` (`status=all`)、`me-tasks-complete.test.ts` 新增 2 组 describe (`task-active-days gating` 4 its + `bonus × task-active-days` 3 its)、`week.test.ts` (`todayShanghaiISODay`)。
```

§7 验收清单 (`:165-173`) 的 checkbox 请 PM 按实际情况勾选或标注, 当前 17 个全空但代码已上线。

## E-10 — INCIDENTS.md: 本分支 4 个 bug 归档 (P0)

**问题**: `docs/INCIDENTS.md:3` 定位是 `每次 backup / deploy 失败, Action 会自动追加一行在这里` —— 自动写入器 `.github/scripts/record_incident.py` 不会写产品 bug。**建议不要往这个文件里手写产品 bug** (会被下次 CI append 混在 deploy 失败里)。两个选项:

**选项 A (推荐) — 新建 `docs/POSTMORTEMS.md`**, 内容:

```markdown
# 产品缺陷归档 (POSTMORTEMS)

> 与 `INCIDENTS.md` 区分: 那份是 CI 自动写的 deploy/backup 失败; 这份是**产品逻辑 bug**
> (影响对用户的金币/打卡语义), 按发现日期倒序。
> 格式沿用 `INCIDENTS.md:6-21` 的 4 段式 (Symptom / Root cause / Fix / Recovery)。

## 2026-10-21 — 清空当天打卡把已撤销行也扣了金币 (P0, 已上线)
- **Commit**: `58027df`
- **Symptom**: PM 点"清空当天打卡"后, 当天里**已撤销**的任务也被扣 1 枚 🪙, 余额比实际少。
- **Root cause**: reset-day 初版对当天每一行都写 -1 (`buildRevokeTaskCoinSQL`)。但已撤销行的 +1 在当初 revoke 时已经以 -1 回退过, 再写一次就是双倍扣。
- **Fix**: `src/routes/admin/task-completions.ts:462-467` — `const wasActive = completion.status === 'active';`, 只有 active 行才写 -1; revoked 行只做 snapshot + delete + audit。
- **Recovery**: 已修。对历史被多扣的日期, 需人工核对 `score_events` 中 `source_ref LIKE 'revoke:task:%'` 与 `task_completions` 快照 (该日 deleted_records 里有删除前的 status)。**具体哪些生产日期被多扣 — unverified, 需 PM 查生产 D1。**

## 2026-10-20 — 非生效日任务永远卡住 +3 bonus (P1, 已上线)
- **Commit**: `c4f51d1`
- **Symptom**: 配了"仅工作日"生效日的任务, 到了周末就再也无法拿到"全部完成 +3", 提示条一直灰着。
- **Root cause**: `isAllTasksCompleted()` 按 `is_active=1` 全量判定, 没考虑今天到期的任务只有一部分; 服务端 refuse (400 `TASK_NOT_ACTIVE_TODAY`) + 判定把不可能完成的任务也算进了分母。
- **Fix**: `src/utils/coin.ts:117-146` 改为先算 `dueToday` 集合 (`is_active=1` 且 `active_days` 空/含今天), 再判定 `dueToday.every(...)`; `dueToday.length === 0` 返 false。同步修正 `src/routes/public/tasks.ts:185-196` (progress 分母) 和 `public/app.js:1303-1311` (hint)。
- **Recovery**: 已修。已发出的 +3 不受影响 (不回溯)。

## 2026-10-20 — 打卡 toast 显示错误的金币数 (P1 kid-facing, 已上线)
- **Commit**: `3b477c1`
- **Symptom**: 孩子打卡后弹 `+5 🪙 到账`, 但余额只加了 1 —— 小孩会觉得"钱被吞了"。
- **Root cause**: toast 用响应里的 `token_awarded`, 而那是遗留字段 `tasks.token_reward` (信息性, 见 `src/routes/me/tasks.ts:332`); 实际入账是统一 +1 (`src/utils/coin.ts:342-377`)。
- **Fix**: `public/app.js:1440-1445` 改为固定文案 `+1 🪙 到账`, 有 `bonus_event_id` 时追加 `今日全部完成 +3 🪙！`。
- **Recovery**: 已修。**同类问题仍在日历视图**: `public/app.js:1839` `+${c.token_reward} 🪙` 仍显示遗留数字 —— 待修 (P1)。

## 2026-10-21 — status=all 单测跨午夜必红 (P2, 已修)
- **Commit**: `de89a45`
- **Symptom**: `tests/unit/admin-task-completions-list.test.ts` 的 `status=all` 用例 00:00 之后必红。
- **Root cause**: 用例没传 `date=`, 走服务端默认 `todayShanghai()` (`src/routes/admin/task-completions.ts:69`), 而 fixture 写死 `completed_date: '2026-10-20'`。午夜一过默认日期变成 10-21, 查不到行。
- **Fix**: 用例显式传 `date=2026-10-20`。
- **Recovery**: 已修。**教训**: 凡依赖 `todayShanghai()` 默认值的单测, 必须显式钉住 `date=` 参数。
```

**选项 B** — 若 PM 不愿新建文件, 则在 `docs/INCIDENTS.md` 末尾 (`:150` 之后, EOF) 追加, 但需加醒目分隔符避免与 CI 自动写入混淆:

```markdown
---
<!-- ↓↓↓ 以下为人工记录的产品 bug, 非 CI 自动 append ↑↑↑ -->

## 2026-10-21 — 清空当天打卡把已撤销行也扣了金币 (P0)
（内容同上表 "2026-10-21 — 清空当天打卡..." 4 段）
```

## E-11 — PROGRESS.md: 追加 shipped 条目 (P0)

**位置**: `docs/PROGRESS.md:1082` (EOF 前) 追加:

```markdown
## ✅ v2.x — 任务生效日 + 清空/恢复当天打卡 + bonus 语义修正 (2026-10-20/21)

**8 个 commit (merge 到 main + 已 deploy 生产)**: `37bda08` → `58027df`

**改动**
- `migrations/0020_task_active_days.sql` — `tasks.active_days TEXT` (ISO 星期 JSON 数组 `[1..7]`, NULL = 每天)
- **服务端生效日拦截**: `POST /api/me/tasks/:id/complete` → 400 `TASK_NOT_ACTIVE_TODAY` (`src/routes/me/tasks.ts:125-133`), 先于 §3.12 cutoff 检查; helper `todayShanghaiISODay()` (`src/utils/week.ts:111-114`, Asia/Shanghai, Mon=1..Sun=7)
- **Admin 配置**: 7 checkbox + 每天/工作日/周末 3 预设 (`public/admin/index.html:109-140`, `admin.js:1053-1072`); create/update 均接受 `active_days`, 去重升序归一化, 越界 → 400 (`src/routes/admin/tasks.ts:38-57`)
- **`POST /api/admin/task-completions/reset-day`** (PM only, 需 `confirm:true`):
  - 默认 "清空当天打卡" = **delete-based**, 删除当天全部 completion (含已撤销), 每行快照进 `deleted_records`; **仅对原本 active 的行回退 -1** (已撤销行当初已回退过, 再扣即双倍扣 — `58027df` 修)
  - `mode:'restore'` = 把当天 revoked 行改回 active + 每条补 +1; 存在 -3 反转则补回 +3 (对 `restore:bonus:` 幂等)
  - 两种模式在当天无记录时均幂等 no-op
- **`GET /api/admin/task-completions?status=all`** (新); 服务端默认仍 `active`, admin 历史面板默认改 `全部` (`admin.js:29`)
- **bonus "+3 全部完成" 改为只统计当天到期任务** (`c4f51d1`): `isAllTasksCompleted()` (`src/utils/coin.ts:117-146`) 先算 due-today 集合; 同步修正 progress 分母 (`src/routes/public/tasks.ts:185-196`) 与小孩端 hint (`public/app.js:1303-1311`)
- **小孩端打卡 toast 修正** (`3b477c1`): 不再显示遗留 `token_reward`, 改显真实 `+1 🪙 到账` (+ bonus 时追加 `+3`)

**测试状态**: unit +1351/-3, 新增 2 个 spec (`admin-task-completions-reset-day.test.ts` 605 行 11 its、`admin-tasks-active-days.test.ts` 458 行 15 its), 扩充 7 个。e2e **未覆盖** 新增的 reset-day / active_days UI。

**风险**: 🟡
- `GET /api/admin/tasks` 未解析 `active_days`, admin 编辑预填实际失效 (`src/routes/admin/tasks.ts:106`) — 见 `docs/task-active-days-spec.md` 已知缺陷段
- reset-day 与 `/:id/hard-delete` 现在共用 `deleted_records` 表, 审计 action 仍叫 `task_revoke` (靠 `details.mode='delete'` 区分)
```

## E-12 — TEST_PLAN.md: Coverage Matrix + 新段落 (P0)

**位置**: `docs/TEST_PLAN.md:1659` 之后插入:

```markdown
| §3.4 | 任务生效日 admin CRUD 校验 | §3.23 API 校验 | `admin-tasks-active-days.test.ts` (unit, 15 its) | ✅ 覆盖 (unit) |
| §5.2 | 任务生效日拦截 400 `TASK_NOT_ACTIVE_TODAY` | §3.23 子: 今天不在 active_days | `me-tasks-complete.test.ts` `task-active-days gating` (unit, 4 its) | ✅ 覆盖 (unit) |
| §3.4 | bonus +3 只算当天到期任务 | §3.23 子: `bonus × task-active-days` | `me-tasks-complete.test.ts` `bonus × task-active-days` (unit, 3 its) | ✅ 覆盖 (unit) |
| §5.6 | 清空当天打卡 (delete-based, 仅 active 行扣币) | §3.24 | `admin-task-completions-reset-day.test.ts` (unit, 8 its) | ✅ 覆盖 (unit) |
| §5.6 | 恢复当天打卡 (`mode:'restore'`) | §3.24 | `admin-task-completions-reset-day.test.ts` (unit, 3 its) | ✅ 覆盖 (unit) |
| §5.3 | 完成记录列表 `status=all` | §3.25 | `admin-task-completions-list.test.ts` (unit) | ✅ 覆盖 (unit) |
```

**位置**: `docs/TEST_PLAN.md:1485` 之后 (3.22 段末, `---` 之前) 插入新章节:

```markdown
### 3.23 任务生效日 (task active_days, v2.x — ✅ 已上线 2026-10-20)

**§3.23.1 API 校验** (unit, 11 its — `tests/unit/admin-tasks-active-days.test.ts:312` describe `POST /api/admin/tasks — task-active-days validation`)
- 接受: `null` / `[]` → 存 NULL (每天); `[6]`; `[1,2,3,4,5]`; `[1..7]` → 原样
- 归一化: `[1,1,2]` → `[1,2]` (去重); `[3,1,5]` → `[1,3,5]` (升序)
- 拒绝 (400 `BAD_REQUEST`): `[0]` / `[8]` (越界), `[1.5]` (非整数), `"1,2"` (非数组), `[{day:1}]` (非数字)

**§3.23.2 API 更新** (unit, 4 its — `:413` describe `PUT /api/admin/tasks/:id`)
- `null → [6,7]`; `[6,7] → null` (清除限制); 越界 400 且**不动原值**; `[6,6,7] → [6,7]`

**§3.23.3 服务端拦截** (unit, 4 its — `tests/unit/me-tasks-complete.test.ts:538` describe)
- `active_days=[1..5]` + 今天=周六 → 400 `TASK_NOT_ACTIVE_TODAY`
- `active_days=[6]` + 周六 → 200
- `active_days=null` → 任意天 200 (回归: 存量任务零影响)
- **顺序断言**: 生效日检查**先于** §3.12 cutoff 检查

**§3.23.4 bonus 交互** (unit, 3 its — `tests/unit/me-tasks-complete.test.ts:615` describe `bonus × task-active-days`)
- 非到期任务**不**阻塞 +3 (本次修的 bug)
- 到期但未完成的任务**仍然**阻塞 (回归)
- 当天零个到期任务 → 不发 bonus

**§3.23.5 时间 helper**
- `todayShanghaiISODay()` 返回 1-7 (Asia/Shanghai, `src/utils/week.ts:111-114`) — `tests/unit/week.test.ts`

- **引用**: `docs/task-active-days-spec.md`, PRD §3.16
- **缺口**: e2e 完全未覆盖 (admin 7-checkbox 交互 + 小孩端灰置渲染)

### 3.24 PM 清空当天打卡 / 恢复当天打卡 (v2.x — ✅ 已上线 2026-10-20/21)

**端点**: `POST /api/admin/task-completions/reset-day` (`src/routes/admin/task-completions.ts:281`)

**§3.24.1 清空模式 (默认, delete-based)** (unit, 8 its — `tests/unit/admin-task-completions-reset-day.test.ts:378` describe)
- 无 PM session → 401
- 无 `confirm:true` → 400 `CONFIRM_REQUIRED`
- `user_id` 缺失/非法 → 400; `date` 格式错 → 400
- 空 day → `success:true, reset_count:0` (幂等 no-op)
- 2 条 active → 两条都**删除**, 各 -1 币, 各 1 快照 + 1 audit
- **已撤销行也删** (但**不扣币** — `58027df` 修的双倍扣)
- 当天有 +3 bonus → 写 1 条 -3 反转, `bonus_reversed:true`

**§3.24.2 恢复模式 (`mode:'restore'`)** (unit, 3 its — `:526` describe)
- 无 revoked 行 → `restored_count:0` (幂等)
- 2 条 revoked → 都回 `active`, 各 +1 币, 同一个原子 batch
- 存在 -3 反转 → 补 +3; 重跑不重复发 (`restore:bonus:` source_ref 幂等)

**关键语义**: 两个模式**不是互逆的** — 清空会物理删除行, 所以清空后再 restore 是空转; restore 只对逐条 revoke 或旧版 bulk-revoke 留下的 revoked 行有效。
- **缺口**: e2e 未覆盖 (确认弹窗文案、积分回退的 UI 反馈)

### 3.25 完成记录列表 status=all (v2.x — ✅ 已上线 2026-10-20)

- `GET /api/admin/task-completions?user_id=&date=&status=` 支持 `active`(默认) / `revoked` / `all` (`src/routes/admin/task-completions.ts:81-92`)
- Admin 历史面板默认 `全部` (`public/admin/admin.js:29`)
- unit 覆盖见 `tests/unit/admin-task-completions-list.test.ts` (含 `status=all` 用例)
- ⚠️ **测试纪律**: 该 `status=all` 用例曾因依赖 `todayShanghai()` 默认值而跨午夜必红, 已由 `de89a45` 改为显式传 `date=`。**新用例一律显式钉住 `date=`**
```

## E-13 — CHANGELOG.md / README.md (P1/P2)

`CHANGELOG.md:5` (`## [V0.1.0] - 2026-08-03 ...`) 之前插入:

```markdown
## [V0.2.0] - 2026-10-21 — 任务生效日 (active_days) + 清空/恢复当天打卡 + bonus 语义修正

### Added
- `migrations/0020_task_active_days.sql` — `tasks.active_days TEXT` (ISO 星期 JSON 数组 `[1..7]`, NULL = 每天)
- `POST /api/admin/task-completions/reset-day` — 清空当天打卡 (delete-based, 需 `confirm:true`) / 恢复当天 (`mode:'restore'`)
- `GET /api/admin/task-completions?status=all` — 新增 `all` 筛选; admin 历史面板默认 `全部`
- 400 `TASK_NOT_ACTIVE_TODAY` — 今天不在任务生效日时拒绝打卡

### Changed
- 每日 "+3 全部完成" bonus 只统计**当天到期**的任务 (原来会卡住含非生效日任务的日期)
- `GET /api/public/tasks/progress` 的 `daily.total` = 当天到期任务数
- 小孩端打卡 toast 显示真实到账额 (`+1 🪙`), 不再显示遗留 `token_reward`

### Fixed
- 清空当天打卡不再对**已撤销**的行重复扣币 (双倍扣)
- 跨午夜的 `status=all` 单测 flaky
```

`README.md:123` 建议改为 `migrations/0016-0020`, `:106` 的 `5 张表` 需按实际重新统计。

---

# 第 4 部分: 今天已经正确的文档 (PM 无需重写)

| Doc | 为什么是正确的 | 证据 |
|---|---|---|
| **`docs/NIGHTLY-TODO.md` §Item #017** | **唯一跨文档正确引用新语义的地方**。明确写出 `isAllTasksCompleted()` 已在 2026-10-20 修过 `active_days` 语义, 并把它标为"打全"通知的唯一挂点 | `docs/NIGHTLY-TODO.md:954` `"打全" 判定已存在: isAllTasksCompleted() (2026-10-20 刚修过 active_days 语义) + buildDailyBonusSQLIfAllDone() 返回非 null 的分支 = 唯一挂点, **一处触发, 无需新轮询**` |
| **`docs/task-active-days-spec.md` §1-§5 (设计部分)** | D1-D6 决策、migration SQL、week.ts helper、me/tasks.ts 插入位置与顺序、admin UI 交互 —— 与实现逐条对应, 唯独 §5.2 预填有已知缺陷 (见 E-9) | `docs/task-active-days-spec.md:32-39` (D1-D6 表) 与 `src/routes/admin/tasks.ts:38-57`, `src/routes/me/tasks.ts:125-133`, `public/admin/index.html:109-140` 一致 |
| **`docs/task-active-days-spec.md` §8 (明确不做)** | scope 边界依然成立: 无跨午夜重渲染、makeup 不受限、不改 weekly grant | `docs/task-active-days-spec.md:175-181`, 且 `public/app.js` 里确无午夜重算逻辑 (已核对) |
| **`docs/SUMMER-HOMEWORK-DISABLED.md` Step 5 bonus 验收项** | "完成所有 active task 后仍触发 +3 coin (暑假作业不再 active, 排除出 bonus)" —— 代码里 bonus 判定确实以 `is_active=1` 起步, 停用任务被正确排除 | 文档 `docs/SUMMER-HOMEWORK-DISABLED.md:87` vs `src/utils/coin.ts:125` `SELECT id, active_days FROM tasks WHERE is_active = 1` |
| **`docs/coin-system-rfc.md` §bonus 描述** | "全任务完成 → bonus +3 coins (实时触发, 最后一个任务完成时立刻判定)" 的触发时机描述仍准确; 变的是"全部"的定义而非触发机制 | 文档 `docs/coin-system-rfc.md:93` vs `src/routes/me/tasks.ts:300-323` |
| **`docs/coin-system-rfc.md` §8.1 bonus source_ref 日期锚定** | "bonus 的 source_ref 不变 (一天只 1 次 bonus), 跨周撤销仍能找到原 +3" —— `findBonusEvent` 确实只按 date+userId 查 | 文档 `docs/coin-system-rfc.md:830` vs `src/utils/coin.ts:158-173` |
| **`docs/coin-system-test-plan.md` TC-X4 / F4 守恒用例** | "+3 → -3 → +3 净 +3 守恒" 的期望与 `buildRevokeBonusSQLIfPresent` 的幂等设计一致, **无需因本分支改动** | 文档 `docs/coin-system-test-plan.md:402-414` vs `src/utils/coin.ts:455-476` |
| **`docs/CHILD_UI_FINDINGS.md` §F2 (撤销语义矛盾)** | 已列在 `## ✅ Fixed` (`:15`), 其 CSS 修复 (`:56-62`) 是纯样式, 不受本分支的语义变更影响 | `docs/CHILD_UI_FINDINGS.md:15,46-65` |
| **`docs/PLAN.md`** | 只在 `:332` 提到一次 `T5.1 Wrangler 部署 + D1 migration` (checkbox 未勾), 属实施计划的历史文档, 与本分支无直接冲突 | `docs/PLAN.md:332` |

---

# 第 5 部分: 未验证 / 需要 PM 确认

按规则, 以下无法在代码中确认, 标 **unverified**:

1. **生产 D1 是否已 apply `0020`?** 本审计只读代码, 未运行 `wrangler d1 migrations list`。deploy 已发生 (`58027df` 已 merge), 推断已 apply, 但**未验证**。
2. **哪些生产日期曾被 `58027df` 之前的版本多扣了金币?** 需查生产 D1 的 `score_events` (`source_ref LIKE 'revoke:task:%'`) 与对应 `deleted_records` 快照比对。**未验证, 需 PM 查。**
3. **`docs/INDEX.md:68` 的 npm scripts 描述** (`dev` / `test` / `test:e2e` / `deploy`) 是否与 `package.json` 实际一致 —— 本报告只标了疑点, **未逐条核对**。
4. **FEATURE_MATRIX 表 E 之外的单测总数** —— `tests/unit/` 实测 56 个 spec 文件 (含 `.test.ts`), 但**各文件用例总数未统计** (需跑 `vitest --reporter=json`, 本审计不跑测试)。
5. **e2e 是否有任何用例间接覆盖了 reset-day / active_days?** 本次审计只查了文件名与 docs 引用, **未读 75 个 e2e spec 正文**。

---

## 附: 建议的落地顺序 (给 PM)

| 顺序 | 动作 | 理由 |
|---|---|---|
| 1 | **E-9 + E-11 + E-12 的状态字段** (spec `ready-for-impl` → 已上线, PROGRESS 补条目, TEST_PLAN 勾验收) | 状态错误最容易误导后续 agent/PM, 且是纯文本改动 |
| 2 | **E-1 (PRD F2 规则) + E-2 (PRD 撤销语义/端点)** | PRD 是业务真相源, 规则矛盾会导致后续决策跑偏 |
| 3 | **E-3 / E-4 / E-5 (ARCHITECTURE)** | 迁移清单停在 0004 是最大的结构性缺口 |
| 4 | **E-10 (POSTMORTEMS)** | 4 个 bug 的根因都已在代码注释里写清楚了, 顺手沉淀成本最低 |
| 5 | **E-6 / E-7 / E-8 (FEATURE_MATRIX / INDEX)** | 覆盖矩阵和索引, 属于"让人找得到" |
| 6 | **代码修复 (非文档)**: `GET /api/admin/tasks` 的 `active_days` 解析 + `public/app.js:1839` 日历遗留数字 | 见 §1.a 🚨 与 §1.e, 建议单开 issue, 不要混进文档 PR |
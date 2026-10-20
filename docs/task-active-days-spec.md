# task-active-days 冻结 spec + dispatch 状态 (2026-10-17)

**需求原话 (feihao)**: 给每一个任务设置打卡的生效日 — 勾选 active 周一~周五 还是周六周日这种。

**状态**: spec 已冻结。clarify 10min 未回复 → PM 按 `feihao-pm-autonomy` 以推荐方案 A (7 天自由勾选 + 每天/工作日/周末 3 快捷键) 推进; worktree + CC dispatch 因 terminal approval timeout (feihao 不在电脑前) 排队中 → 降级路径见本 skill R5。等 feihao 回"继续"。

**feihao 恢复后的下一步**:
1. 在 shop-tunnel repo: `git worktree add /Users/tidusmaomao/workspace/kiddo-scoreboard-task-days -b feature/task-active-days origin/main` (先 fetch)
2. `cp` 主 worktree 的 `.dev.vars` 过去 (R3)
3. 本 spec 拷到 `<worktree>/docs/task-active-days-spec.md` (R3: 禁写 `.hermes/` 路径)
4. CC dispatch 按 R3 prompt 模板; 验收按下方 §7 清单逐条核

> /tmp/kiddo-task-active-days/ 里的副本是易失的; 本文件是持久副本。

---

# Spec: 任务生效日 (task active days) — 周内勾选打卡日

**Feature ID**: task-active-days
**Date**: 2026-10-17
**Owner**: PM Agent (spec) / Code Agent (impl)
**Status**: ready-for-impl

## 0. 一句话需求 (feihao 原话)

> 给每一个任务设置一下打卡的时间，可以勾选它到底是 active 在周一到周五，还是周六周日这种。

每个任务可配置"一周里哪几天允许打卡"。今天是该任务的非生效日 → 小孩端按钮置灰不可点，服务端同样拒绝（双保险，与 §3.12 cutoff 同构）。

## 1. 设计决策 (PM 已拍, 可被 feihao 推翻)

| # | 决策 | 理由 |
|---|---|---|
| D1 | 配置粒度 = **7 天自由勾选** (周一~周日 7 个 checkbox) + admin 表单提供 3 个快捷键: 每天 / 工作日(一~五) / 周末(六日) | feihao 说"勾选"; 自由勾选是三档预设的超集, 以后想配"一三五"不用改 schema |
| D2 | 存储 = `tasks.active_days TEXT`, 内容为 JSON 数组 `[1,2,3,4,5]` (ISO weekday, Mon=1..Sun=7); **NULL 或 `[1..7]` = 每天** | 单列最简, 与现有单行配置列 (cutoff_time) 风格一致; NULL 语义保证存量任务零影响 |
| D3 | 校验口径 = **Asia/Shanghai ISO weekday** (复用 `src/utils/week.ts` 的时区约定) | 与 cutoff_time 同一套时间语义, 不引入第二套时区 |
| D4 | 非生效日的小孩端展示 = 按钮灰置 + 文案 `周X生效` (如 `周六生效`), disabled | 与 cutoff locked-out 同视觉语言但不同文案, 小孩能看懂"今天不是这个任务的日子" |
| D5 | 生效日检查在 **服务端 complete 路由** 强制 (400 `TASK_NOT_ACTIVE_TODAY`), 前端只是展示层 | 改前端绕不过, 与 §3.12 双保险同构 |
| D6 | admin 端: 任务表单加 7 checkbox + 3 快捷按钮; create/update 都接受 `active_days`; 不勾任何天 = 视为每天 (存 NULL) | 简化 admin 心智: 空选 = 不限制 |

## 2. 数据层

### 2.1 Migration `migrations/0020_task_active_days.sql` (0019 是当前最新)

```sql
-- Feature: task active days (任务生效日)
-- tasks.active_days: JSON array of ISO weekdays [1..7] (Mon=1 .. Sun=7).
--   NULL  = every day (default, back-compat for all existing tasks)
--   [1,2,3,4,5] = Mon-Fri only; [6,7] = Sat-Sun only
-- Server refuses completion when today's Asia/Shanghai ISO weekday
-- is not in active_days (400 TASK_NOT_ACTIVE_TODAY), mirroring §3.12 cutoff.

ALTER TABLE tasks ADD COLUMN active_days TEXT;
```

ALTER TABLE 无默认值即 NULL, 存量任务全部保持"每天" — 零迁移风险。

### 2.2 `src/db/types.ts`

`Task` interface (L92 附近) 增加:

```ts
// task-active-days: ISO weekdays [1..7] (Mon=1) when this task can be
// completed. null = every day. Stored as JSON text in D1.
active_days: number[] | null;
```

同时检查 db 读取层是否有 row->object mapping 需要解 JSON (若 repo 有 `mapTaskRow` 类函数, 在那里 `JSON.parse`; 若路由直接返回 row, 则在每处 SELECT 后处理)。

## 3. 服务端

### 3.1 `src/utils/week.ts` 新增 helper

```ts
/** Today's ISO weekday (Mon=1 .. Sun=7) in Asia/Shanghai. */
export function todayShanghaiISODay(): number {
  const shifted = new Date(Date.now() + SHANGHAI_OFFSET_SECONDS * 1000);
  return shifted.getUTCDay() || 7;
}
```

(与文件内 `isoWeekString` 的 shift 手法一致。)

### 3.2 `src/routes/me/tasks.ts` — complete 路由

- `TASK_COLUMNS` (L59) 增加 `active_days`。
- 在 §3.12 cutoff 检查 (L129-139) **之前**加生效日检查:

```ts
// 2.4 task-active-days: refuse if today is not an active day for this task.
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

- row 读取处把 `active_days` 从 JSON text 解析为 number[] (L76 / L334 两处 SELECT)。

### 3.3 `src/routes/public/tasks.ts`

- `TASK_COLUMNS` (L17) 增加 `active_days`。
- GET / 返回的每个 task 带 `active_days` (JSON 已解析为数组) — 小孩端 `public/app.js` `loadTasks()` 依赖此字段渲染。漏掉这份 = 前端拿不到字段。

### 3.4 `src/routes/admin/tasks.ts`

- `CreateBody` (L83) 增加 `active_days: number[] | null`。
- `parseCreateBody` / update 校验:
  - null / undefined → 存 NULL (每天)
  - 否则必须是 `number[]`, 每项 ∈ [1,7] 整数, 去重后非空 → 存 `JSON.stringify(sorted unique)`
  - 任何越界/非整数 → 400 `BAD_REQUEST: active_days must be an array of integers 1-7`
- UPDATE 路由 (L595 附近) 同样支持 `active_days` 更新。

## 4. 前端 — 小孩端 `public/app.js`

### 4.1 `renderTasks()` (L1167)

状态机插入顺序: `revoked → done → **notActiveToday** → isSleepLocked → normal`。

```js
const WEEKDAY_ZH = {1:'一',2:'二',3:'三',4:'四',5:'五',6:'六',7:'日'};
const isActiveToday = !Array.isArray(t.active_days) || t.active_days.length === 0
  || t.active_days.includes(todayISODay());
const notActiveToday = !done && !revoked && !isActiveToday;
```

`todayISODay()` 在 app.js 内实现 (`new Date(Date.now()+8*3600*1000).getUTCDay()||7`), 不 import (app.js 是无构建浏览器脚本)。

- notActiveToday → `btn.disabled = true`, class `task-btn-locked-out` (复用灰置样式), badge: `生效日: 一·三·五` 这种列出式。
- `updateCountdowns()` (L1300 附近) 不管此状态 (整天恒定, 无倒计时)。

### 4.2 跨午夜场景

页面长开跨 0 点不重算 — 与现有 cutoff 行为一致 (可接受, 不为本期 scope)。

## 5. 前端 — 管理端 `public/admin/index.html` + `admin.js`

### 5.1 表单 (index.html L101 cutoff 字段附近)

7 个 checkbox `name="active_days"` value=1..7 (标签 一~日) + 3 个 preset 按钮: `data-days-preset="all|weekdays|weekend"`。样式沿用现有 form-row 风格。

### 5.2 admin.js

- 预填 (L1032 附近): `active_days` 数组 → 勾对应 checkbox; null/空 → 全勾 (显示为每天)。
- 提交 (L1116 附近): `active_days: vals.length ? vals.map(Number) : null`。
- preset: all→[1..7], weekdays→[1-5], weekend→[6,7]; preset 后可再手动微调 (工作日 preset 然后取消周三 = 一二四五)。

## 6. 测试 (vitest, tests/unit/)

| 文件 | 用例 |
|---|---|
| `week.test.ts` | `todayShanghaiISODay()` 返回 1-7 (mock 时间验证 Mon/Sun 边界) |
| `me-tasks-complete.test.ts` 新增 describe | ① active_days=[1..5] + mock 今天=周六 → 400 `TASK_NOT_ACTIVE_TODAY`; ② [6] + 周六 → 200; ③ null → 任意天 200 (回归); ④ [6] 且过 cutoff → 生效日检查先于 cutoff (顺序断言) |
| admin 校验测试 (`admin-tasks-active-days.test.ts`, 无现成 admin task 测试则新建) | `[0]`/`[8]`/`[1.5]`/`"1,2"` → 400; `[1,1,2]` → 归一化 `[1,2]` |
| `lockout.test.ts` / `public-tasks.test.ts` | 原样通过 (回归, 不改断言) |

时间 mock 跟随 `me-tasks-complete.test.ts` 现有模式, 不发明新机制。

## 7. 验收清单 (CC 完成后 PM 逐条核)

- [ ] `npm run typecheck` PASS
- [ ] `npm run test:unit` 全绿 (既有测试零回归)
- [ ] `npx wrangler pages dev` 本地:
  - [ ] admin 建 task active_days=[6,7] → API 返回存储 `[6,7]`
  - [ ] (周六) 小孩端 [6,7] 任务可点, [1..5] 任务灰置显示生效日
  - [ ] curl POST complete 灰置任务 → 400 `TASK_NOT_ACTIVE_TODAY`
  - [ ] 存量任务 (NULL) 行为与改动前完全一致
- [ ] migration 0020 已加, `npx wrangler d1 migrations apply kiddo-scoreboard-db --local` 成功
- [ ] ❌ 不 push / 不 deploy / 不动 .github workflows (PM 负责)

## 8. 明确不做 (scope 边界)

- 不做跨午夜自动重渲染
- 不做 makeup 与生效日的交互变更 (makeup 属 admin 补录, 不受限)
- 不改 weekly grant / 周目标统计口径
- 不做 i18n / 不改视觉设计语言

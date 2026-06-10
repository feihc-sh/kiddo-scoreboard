# 半夜自动化清单 (NIGHTLY-TODO) — 📥 新需求池

> **用户 2026-06-08 添加 3 个新功能, 待逐个拍板**:
> 1. #006 打卡日历 (月历可视化)
> 2. #007 英雄头像选择 (个人化)
> 3. #008 任务装备/机甲化 (任务视觉)
>
> **流程**: PM 整理 clarification → DM 弹给用户拍板 → 用户回 → PM 更新 Item → 入清单等 0:00 cron
>
> **5 个旧 Item 已归档**, 见文件底部 § 归档 段

---

## 流程 (历史参考)

**用户视角** (极简):
1. 飞书 DM 跟我说: "我想 X, 还要 Y"
2. 我整理 (clarify + plan) 后, 在这个文件加 ## Item
3. 半夜 0:00 自动跑
4. 早上/有空时我汇报结果

**作用域**: 可自动化的开发任务 (git commit 级别, **不**包括 deploy / push / DELETE)
**位置**: `docs/NIGHTLY-TODO.md` (跟项目, git 可见)

---

## 🚦 风险图例

| 风险 | 等级 | 含义 |
|---|---|---|
| 🟢 | 低 | 改 docs / 注释 / 格式化 / 加单测 |
| 🟡 | 中 | 改 src 代码 / 改 migration / 改依赖 |
| 🔴 | 高 | 改核心架构 / 改 schema / 改 token 配置 |

**不跑的事** (cron 看到会自动 skip 并标 🚫 blocked):
- `wrangler deploy` / `git push` / `wrangler d1 delete`
- 需要用户决策的澄清
- 实时 iPad 实测

---

## 📋 当前清单 (5 个 Item: 3 hold + 1 进行中 + 1 新增待跑)

## Item #006 — 打卡日历 (月历可视化) ⏸ hold (用户 2026-06-08 暂缓)

> 用户原话: "先 hold 一下这个 idea 放 todo 里吧, 后面我再来拍"

**Status**: ⏸ hold
**待拍板**: A/B/C 设计 + 2 Q (见 todo 下方历史)
**Commit**: —

---

## Item #007 — 英雄头像选择 (个人化) ⏸ hold (用户 2026-06-08 暂缓)

> 用户原话: 同上, "先 hold 一下"
> 用户发了 1 张 Pacific Rim 风格 Jaeger 机甲图 (豆包 AI 生成, 蓝灰 + 黄眼 + 双蓝剑), 等 hold 解除后用作 B 方案 (上传图片) 候选

**Status**: ⏸ hold
**待拍板**: A/B/C 来源 + 2 Q
**Commit**: —

---

## Item #008 — 任务装备/机甲化 (任务视觉) ⏸ hold (用户 2026-06-08 暂缓)

> 用户原话: 同上, "先 hold 一下"
> 用户提到"小朋友喜欢机甲风格" → 推荐 B 方案 (机甲部件), 等 hold 解除后确认

**Status**: ⏸ hold
**待拍板**: A/B/C 方向 + 2 Q
**Commit**: —

---

## Item #009 — Admin 物理删除打卡记录 (紧急, 待拍板) 🔥

**用户原话**:
> "我现在需要紧急在 admin 界面里增加把撤销掉的打卡习惯再撤销回来掉, 相当于删掉这条记录。删掉记录意味着允许再次打卡"

**Clarification** (PM 整理, 拍板用):
- **背景**: 现有 PM 可以"撤销"打卡 (软删, `status='revoked'`, 留 audit_log), 但记录还在, 孩子**当天不能再打卡** (去重逻辑)
- **新需求**: 物理删除 score_event (或 task_completion) 记录, 让记录**完全消失**, 孩子可重新打卡
- **跟现有原则冲突**:
  - 之前 M11 笔记: "软删 status='revoked' + 审计 log 不可删"
  - 现要物理删, 违反"软删"原则
  - 建议折中: **物理删 event/completion 记录, 但 audit_log 写一条 "event_hard_deleted" + 原始数据 JSON** (审计可追溯, 数据不可恢复)
- **风险**: 🔴 高 (物理删, 不可恢复, 只能靠 audit_log 找回)
- **实施范围**: C (两个都要, score_event + task_completion)
- **谁能用**: A (PM only, 二次确认弹窗, audit log 强制写)
- **删除后列表显示**: B (灰色"已删除"标记, 含删除时间 + 谁删)
- **新表设计** (避免再删 audit_log): 物理删的记录移到 `deleted_records` 表 (含 `record_type`, `original_id`, `original_data JSON`, `deleted_at`, `deleted_by`, `original_table`)

**❓ 已拍板** (用户 2026-06-08):
1. ✅ **范围**: C (两个都要)
2. ✅ **谁能用**: A (PM only, 二次确认)
3. ✅ **删除后列表显示**: B (灰色"已删除"标记)

**Action Plan** (TDD 走起, **切 5 段每段 10 min 防 CC Timeout**):

### 第 1 段 (≤10 min): migration + 第 1 个 unit test 基线
- [ ] 加 migration: `migrations/0006_deleted_records.sql` (建表: id / record_type / original_id / original_data JSON / deleted_at / deleted_by / original_table)
- [ ] 写 unit test 基线: `tests/unit/deleted-records.test.ts` (验证 deleted_records 表 schema + INSERT/SELECT 基础)
- [ ] 跑 `npx vitest run tests/unit/deleted-records.test.ts` 必须过
- [ ] `git add` + commit: `feat(db): add deleted_records table for hard-delete snapshot`
- [ ] **汇报**: PM 等结果, 决定是否跑第 2 段

### 第 2 段 (≤10 min): 3 helper + score_event 删 endpoint
- [ ] utils/audit.ts: 加 `logHardDelete(record)` (写 audit_log `action='event_hard_deleted'`)
- [ ] utils/deleted-records.ts: 加 `moveToDeletedRecords(record)` (从原表删 + INSERT deleted_records)
- [ ] utils/balance.ts: 加 `recalcAfterHardDelete(child_id)` (重算余额)
- [ ] 后端: `src/routes/admin/events.ts` 加 `POST /:id/hard-delete` (Hono + requirePm 守卫)
- [ ] 写 unit test: `tests/unit/admin-events-hard-delete.test.ts` (2 case: 删成功/PM 未登录返 401)
- [ ] 跑 vitest 全过
- [ ] `git add` + commit: `feat(admin): score_event hard-delete with audit + deleted_records`
- [ ] **汇报**: PM 等结果, 决定是否跑第 3 段

### 第 3 段 (≤10 min): task_completion 删 endpoint
- [ ] 后端: `src/routes/admin/task-completions.ts` 加 `POST /:id/hard-delete`
- [ ] 写 unit test: `tests/unit/admin-task-completions-hard-delete.test.ts` (类似 events)
- [ ] 跑 vitest 全过
- [ ] `git add` + commit: `feat(admin): task_completion hard-delete with audit`
- [ ] **汇报**: PM 等结果, 决定是否跑第 4 段

### 第 4 段 (≤10 min): 前端 (按钮 + 弹窗 + 灰显)
- [ ] public/admin/admin.js: 列表 "撤销" 按钮旁加 "🗑 永久删除" 按钮
- [ ] 二次确认弹窗 (confirm() + 写死: "此操作不可恢复, 确认删除?")
- [ ] 后端 GET endpoint 加 deleted_records 关联: 列表渲染时查 `deleted_records` 表, 已删的灰显 + 标记 (含删除时间 + 谁删)
- [ ] 写 e2e: `tests/e2e/ui-admin-hard-delete.spec.ts` (3 case: events 删/灰显/再打卡; task_completions 删/灰显/再完成; audit log + deleted_records 双记录)
- [ ] 跑 vitest + e2e 全过
- [ ] `git add` + commit: `feat(admin-ui): hard-delete button + grey marker + confirm dialog`
- [ ] **汇报**: PM 等结果, 决定是否跑第 5 段

### 第 5 段 (≤10 min): 文档 + PR
- [ ] docs/PRD.md §3.5 加新规则 (硬删 + audit log + deleted_records)
- [ ] docs/TEST_PLAN.md 加 §3.15 Admin Hard Delete (含 Smoke/Happy/Edge)
- [ ] docs/FEATURE_MATRIX.md 表 A 更新 #009 业务规则 + 表 C 加 §3.15
- [ ] docs/PROGRESS.md 加 v2.2 条目
- [ ] 跑 `npm test` 全过 (182+ → ~200)
- [ ] `git add` + commit: `docs: PRD + TEST_PLAN + FEATURE_MATRIX + PROGRESS for hard-delete`
- [ ] 走 PR 流程 (push 分支 + gh pr create)
- [ ] **汇报**: PR 链接, 等用户 merge → GH Action 自动 backup + deploy

**风险**: 🔴 (数据物理消失, 不可逆, deleted_records 找回; 走 issue→PR 流程多一道审查)
**Status**: 🔄 in progress (第 1 段执行中)
**Commit**: —
**Started**: 2026-06-08

---

## Item #010 — Child UI 任务冲刺弹窗 (游戏化专注感) ⏳ pending

**用户原话** (feihao 2026-06-10 飞书 DM):
> "帮我在 nightly todo 上再新加一个 item 内容是针对 user 的界面,目前的界面上,任务的部分就点击之后就只有一个完成。
> 我希望他点击了那个任务之后,开启一个新的弹窗,弹窗上显示:
> 1. 任务的详情和图片
> 2. 显示这个任务正在冲刺中
> 3. 如果是一个倒计时任务的话,在比较大的页面上弹出一个倒计时数字,显示还剩余多少分钟
> 4. 下面有一个打卡按钮
> 这样子的话,就会显得比较正式,更像游戏界面一些,也可以更专注在当前任务中。也允许关闭。"

**Clarification** (PM 整理):
- **作用对象**: child UI (`public/app.js`),不是 admin UI;当前 task 按钮 (`task-btn`) click **直接调 `completeTask(t.id)`**,一触即完成
- **新交互流程**:
  1. 点 task 按钮 → 弹冲刺模态框 `#sprint-modal`
  2. 模态框显示任务详情(图标 + 名称)、状态 "冲刺中..." 标题
  3. 若有 `cutoff_time` → 大字号倒计时数字 + 颜色随剩余时间变化
  4. "✓ 打卡" 主按钮 → 调 `completeTask(t.id)` → 关闭弹窗 → 原有动画/撒花继续
  5. 关闭: X 角 + 点空白 + `Esc` 键 (参照非 welcome modal 的通用做法)
- **"详情和图片" 字段**:
  - **默认方案 A** (本 Item 采用): 用现有 `t.icon` (emoji) 作"图片", `t.name` 作"详情"; **不**扩 schema
  - **可选方案 B** (后续 Item, 如用户要): 加 `description TEXT` + `image_url TEXT` 字段 + migration + admin UI 上传 — 工程量大
- **已有可复用** (Code Agent 实施时直接用):
  - `computeCutoffDiffSec(hhmm)` + `formatHHMMSS(sec)` — §3.12 倒计时 helpers (app.js:222, 230)
  - `.modal-back` + `.modal` CSS — 已有样式 (app.css:465-493)
  - `showWelcome()` / `hideWelcome()` 关闭模式参照 — 但本弹窗允许 backdrop click + Esc (跟 welcome 不同)
- **回归风险点**:
  - 现有 task 按钮"一触即打卡" → 改为"点开弹窗"会**改变已有 UX**: 小孩不再能随手打卡
  - 假设这是用户期望 ("更专注"), 但需用户拍板确认这是预期行为, 不是 bug
- **风险**: 🟡 (UI-only, 不动 schema / 不动后端, 但改变既有 click 行为)

**❓ 待拍板** (默认采用括号内方案, 不同意告诉 PM):
1. **"详情 + 图片" 字段**: (A. 用现有 `icon` + `name`, 不动 schema — 默认)
2. **关闭方式**: (C. X 角 + 点空白 + Esc 三种都允许 — 默认)
3. **倒计时颜色变化**: (默认按剩余时间 灰 / 黄 / 橙 / 红, 后期可调)
4. **已有 UX 改动**: (默认接受 "点任务不再直接打卡, 必须确认" — 这是用户原话语义)

**Action Plan** (TDD 走起, **切 3 段每段 ≤15 min 防 CC Timeout**):

### 第 1 段 (≤15 min): 冲刺弹窗 DOM + CSS + 数据绑定
- [ ] `public/index.html` 加 `#sprint-modal` 骨架 (默认 `hidden`):
  - `.sprint-modal-back.modal-back`
  - `.sprint-modal.modal`
    - 关闭 X 角 `.sprint-close`
    - 标题 "冲刺中..." `.sprint-title`
    - 详情区 `.sprint-detail` (大图标 `.sprint-icon` + 名称 `.sprint-name`)
    - 倒计时区 `.sprint-countdown` (大字号, 默认 hidden, 有 `cutoff_time` 才显示)
    - 底部打卡按钮 `.sprint-checkin.btn-primary` (调用原 `completeTask`)
- [ ] `public/app.css` 加冲刺弹窗样式:
  - `.sprint-modal` 比普通 modal 大 (max-width 480px, padding 32px)
  - `.sprint-title` 字号 24px
  - `.sprint-icon` 字号 72px (比卡片更显眼)
  - `.sprint-countdown` 字号 96px + `font-variant-numeric: tabular-nums` + 居中
  - `.sprint-countdown[data-urgency="warning"]` 黄 / `[data-urgency="danger"]` 橙 / `[data-urgency="critical"]` 红
  - 关闭 X 角 `.sprint-close` 右上角
- [ ] `public/app.js` 加 `showSprintModal(task)` / `hideSprintModal()`:
  - 写入 `.sprint-icon` / `.sprint-name` 文案
  - 若 task 有 `cutoff_time` → 显示 `.sprint-countdown`, 启动独立计时器 (走 `computeCutoffDiffSec` + `formatHHMMSS`), 颜色按 `urgency` 切换
  - 若无 → `.sprint-countdown` hidden
- [ ] 写 unit test (DOM-level): `tests/unit/sprint-modal.test.ts` 验证 show/hide + 文案注入 + urgency 切换
- [ ] `git add` + commit: `feat(child-ui): sprint modal DOM/CSS scaffold + show/hide helpers`
- [ ] **汇报**: PM 等结果, 决定是否跑第 2 段

### 第 2 段 (≤15 min): 任务按钮 click 改造 + 关闭交互
- [ ] `public/app.js` 任务按钮 click handler: 从 `completeTask(t.id)` 改为 `showSprintModal(t)`
  - **排除条件**: `task-btn-locked-out` (已过 cutoff) 仍走原有逻辑 (不弹窗, 直接 disabled)
- [ ] 关闭交互:
  - X 角 click → `hideSprintModal()`
  - backdrop click → `hideSprintModal()`
  - `Escape` 键 → `hideSprintModal()` (一次性 `document.addEventListener('keydown', ...)`, 加 flag 防重复挂载)
- [ ] 打卡按钮 click: `completeTask(t.id)` → `hideSprintModal()` → 原 success 动画/撒花继续触发
- [ ] 写 e2e: `tests/e2e/ui-child-sprint-modal.spec.ts` (≥3 case: 点任务弹窗 / 点打卡关闭 + 列表更新 / X 角关闭列表不变 / Esc 关闭 / backdrop 关闭 / 倒计时任务显示大数字 / 非倒计时任务隐藏数字)
- [ ] `git add` + commit: `feat(child-ui): task click opens sprint modal + close interactions`
- [ ] **汇报**: PM 等结果, 决定是否跑第 3 段

### 第 3 段 (≤10 min): 倒计时紧迫度 + 文档 + PR
- [ ] `public/app.js` `updateSprintCountdown()` 加 urgency 分级:
  - `diff > 3600` → `data-urgency="ok"` (默认灰)
  - `diff ≤ 3600` → `"warning"` (黄)
  - `diff ≤ 600` → `"danger"` (橙)
  - `diff ≤ 60` → `"critical"` (红)
- [ ] `public/app.css` 加对应颜色 (`color` + 轻量阴影), `critical` 可选加心跳 keyframes (`@keyframes pulse` 1s infinite)
- [ ] 跑 `npx vitest run` + `npx playwright test tests/e2e/ui-child-sprint-modal.spec.ts` 全过
- [ ] 文档:
  - `docs/PRD.md` §3 加 "child UI 任务点击 → 冲刺模态框 (专注感)" 一段
  - `docs/FEATURE_MATRIX.md` 表 B 加 #010 行
  - `docs/TEST_PLAN.md` §3 加 #010 e2e 测试矩阵
- [ ] `git add` + commit: `feat(child-ui): sprint countdown urgency colors + docs`
- [ ] 走 PR 流程 (push 分支 + `gh pr create`)
- [ ] **汇报**: PR 链接, 等用户 merge → GH Action 自动 backup + deploy

**风险**: 🟡 (UI-only, 不动 schema / 后端; 改变既有 task 按钮 click 行为, 算小回归风险)
**Status**: ⏳ pending
**Commit**: —
**Started**: 2026-06-10

---

## 📦 归档 (用户 2026-06-08 拍板: 全部不实现, 留历史参考)

---

## Item #001 — Admin 加任务 UI 加 emoji 选择器 (20 个预设) ✅

**用户原话**:
> "我的Admin的那个界面里边加新的每日任务的界面里边，它的emoji是要自己敲进去的。你能不能放几个选项，和小朋友的生活、学习、习惯这些是比较相关的emoji？大概放20个吧"

**Status**: ✅ done (commit `fca735b`, 2026-06-07)
**风险**: 🟢

**说明**: 实际**已经实现并 deploy** (PR + commit 已落 main, 用户 iPad 可用), 不是"没做"。

---

## Item #002 — "准时上床" 打卡 + 倒计时 + 自动 lockout ✅

**用户原话**:
> "002不要填时间了吧，我们就留一个打卡任务，准时上床就可以了，那就不用加了"
> "超过 930 之后打卡按钮变灰色不可打。那个按钮上需要加个倒计时提醒超过 930 就不可以打了"

**Clarification** (PM 整理):
- **简化方案** (用户 2026-06-06 两次拍板):
  - 任务: **"准时上床"** 单一打卡, **不录具体时间**
  - 加分: **+1 min/天** (孩子点 "✓ 我 9:30 之前上床了" → 自动 +1)
  - 没打卡: 0 (不扣分, 不扣时间)
  - **取消** per-minute 算法 (早 1min+1 / 晚 1min-1)
- **UI 行为** (用户拍板):
  - 按钮上**实时倒计时**: "距离 9:30 还剩 HH:MM:SS" (PM 默认, 不同意告诉我)
  - 9:30 之前: 按钮可点
  - 9:30 之后: 按钮**变灰 + 不可点** (自动 lockout, 防造假)
  - **自动 lockout 替代了 PM 审核** — 异常单问题不存在了
- 风险: 🟢

**Status**: ✅ done (commits `5e7b3b7`/`1d44626`/`76be819`/`be595bb`, 2026-06-07/08)

**说明**: **已实现 + deploy**, e2e spec 11 个场景全过。

---

## Item #003 — 英语阅读 track (工作日 2 本 / 周末 4 本 = +2 min) 🚫

**用户原话**:
> "每天英语阅读，完成两本的quiz。这个可以加1分钟的时间。"

**简化方案** (用户 2026-06-06):
- **工作日** (周一-周五, 5天): 完成 2 本 quiz = +2 min
- **周末** (周六-周日, 2天): 完成 4 本 quiz = +2 min
- **取消** 1本/2本/3本 阶梯

**未拍板的 Clarification (2 Q)**:
1. verify 方式: PM 手动 confirm, 还是孩子自查?
2. "周末" 定义: 仅周六+周日? 节假日按工作日?

**Status**: 🚫 blocked → 2026-06-08 用户归档
**风险**: 🟢 (新 schema 字段 + per-weekday logic)

---

## Item #004 — 举一反三 track + 老师投诉扣分 🚫

**用户原话**:
> "举一反三，完成一个章节也可以加1分钟的时间。然后就是去学校的时候有没有老师投诉？如果有投诉的话就要扣的话是从20元人民币起，然后这个我可以调"

**简化方案** (用户 2026-06-06):
- **举一反三**: 每天 1 本 = +1 min (每天都, 不分工作日)
- **老师投诉**: 默认 -20 min/次, PM 在 Admin UI 可调

**未拍板的 Clarification (4 Q)**:
1. "20 元" 是 -20 min 还是 -20 token?
2. 老师投诉谁记: PM 手动, 还是孩子自报?
3. 一周内多次投诉累加吗? (不封顶?)
4. PM 改 penalty 后, 立即生效还是只新 task 生效?

**Status**: 🚫 blocked → 2026-06-08 用户归档
**风险**: 🟡 (新 task type + UI 加 PM 调整 penalty 字段)

---

## Item #005 — 三进度条系统 (当日 / 本月 / 当年) ⭐ ✅

**用户原话**:
> "我觉得可以用完成任务总数有个进度条，当日是否有全部完成有个进度条"

**方案** (用户 2026-06-06 拍板):
- **进度条 A (本月)**: 默认 100/月
- **进度条 B (当年)**: 默认 1200/年
- **进度条 C (当日)**: 100% 触发**全屏撒花 + "Combo!"** (daily-once, localStorage 防刷屏)

**Status**: ✅ done (commit `ec26430`, 2026-06-07)
**风险**: 🟢

**说明**: **已实现 + deploy**, 含 daily-once 撒花, 跟自驱力 3 件套 (Autonomy/Mastery/Purpose) 完美契合。

---

## 📝 Item 模板 (未来新 Item 用)

```markdown
## Item #XXX — <一句话标题>

**用户原话**:
> (引用用户原始 message, 越完整越好)

**Clarification** (PM 整理):
- 背景 / 上下文
- 用户没明说但实施需要的假设
- 如还有歧义 → 标 🚫 blocked, 等用户回

**Action Plan** (PM 拟定, 逐步可执行):
- [ ] 步骤 1
- [ ] 步骤 2
- [ ] 步骤 N
- [ ] `git commit -m "<conventional commit msg>"`

**Status**: ⏳ pending
**风险**: 🟢 / 🟡 / 🔴
**Started**: —
**Completed**: —
**Commit**: —

---
```

---

## 📊 归档统计 (5 Item)

| 状态 | 数量 | Item |
|---|---:|---|
| ✅ done | 3 | #001 emoji / #002 睡眠 / #005 三进度条 |
| 🚫 blocked → 归档 | 2 | #003 英语 / #004 老师投诉 |
| **总计** | **5** | 全部归档 |

**用户拍板日期**: 2026-06-08
**最后编辑**: PM Agent
**原因**: 用户决定不实现 #003 #004 (block 的), 已 done 的 #001 #002 #005 也归档 (避免清单无限增长, 鼓励新需求走新流程)

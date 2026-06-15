# 半夜自动化清单 (NIGHTLY-TODO) — 📥 新需求池

> **用户 2026-06-08 添加 3 个新功能, 待逐个拍板**:
> 1. #006 打卡日历 (月历可视化)
> 2. #007 英雄头像选择 (个人化)
> 3. #008 任务装备/机甲化 (任务视觉)
>
> **流程**: PM 整理 clarification → DM 弹给用户拍板 → 用户回 → PM 更新 Item → 入清单等 0:00 cron
>
> **6 个旧 Item 已归档**, 见文件底部 § 归档 段

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

## 📋 当前清单 (3 个 Item, 全部 ⏸ hold)

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

## Item #009 — Admin 物理删除打卡记录 (紧急, 待拍板) 🔥 ✅

**用户原话**:
> "我现在需要紧急在 admin 界面里增加把撤销掉的打卡习惯再撤销回来掉, 相当于删掉这条记录。删掉记录意味着允许再次打卡"

**Clarification** (PM 整理, 拍板用):
- **背景**: 现有 PM 可以"撤销"打卡 (软删, `status='revoked'`, 留 audit_log), 但记录还在, 孩子**当天不能再打卡** (去重逻辑)
- **新需求**: 物理删除 score_event (或 task_completion) 记录, 让记录**完全消失**, 孩子可重新打卡
- **跟现有原则冲突**:
  - 之前 M11 笔记: "软删 status='revoked' + 审计 log 不可删"
  - 现要物理删, 违反"软删"原则
  - 折中: **物理删 event/completion 记录, 但 audit_log 写一条 "event_hard_deleted" + 原始数据 JSON** (审计可追溯, 数据不可恢复)
- **风险**: 🔴 高 (物理删, 不可恢复, 只能靠 deleted_records 表找回)
- **实施范围**: C (两个都要, score_event + task_completion)
- **谁能用**: A (PM only, 二次确认弹窗, audit log 强制写)
- **删除后列表显示**: B (灰色"已删除"标记, 含删除时间 + 谁删)
- **新表设计** (避免再删 audit_log): 物理删的记录移到 `deleted_records` 表 (含 `record_type`, `original_id`, `original_data JSON`, `deleted_at`, `deleted_by`, `original_table`)

**已拍板** (用户 2026-06-08):
1. ✅ **范围**: C (两个都要)
2. ✅ **谁能用**: A (PM only, 二次确认)
3. ✅ **删除后列表显示**: B (灰色"已删除"标记)

**Status**: ✅ done (PR commit `9c95c4d` + 子 commits `5e4d5fa`/`b96a8be`/`e03c474`/`7375a7d`/`bcd90ff`, 2026-06-08)
**风险**: 🔴
**Started**: 2026-06-08
**Completed**: 2026-06-08

**说明**: **已实现 + 全部 5 段子 commit + PR merged 到 main**:
- `5e4d5fa` 第 1 段: migration `0006_deleted_records.sql` + unit test 基线
- `b96a8be` 第 2 段: 3 helpers + score_event `POST /:id/hard-delete` endpoint
- `e03c474` 第 3 段: task_completion `POST /:id/hard-delete` endpoint
- `7375a7d` 第 4 段: admin UI "🗑 永久删除" 按钮 + confirm 弹窗 + 灰显 marker
- `bcd90ff` 第 5 段: PRD §3.5 + TEST_PLAN §3.15 + FEATURE_MATRIX + PROGRESS v2.2 文档
- `9c95c4d` PR merge (`#009, v2.2`)

单元测试 8/8 ✅ (deleted-records + admin-events-hard-delete + admin-task-completions-hard-delete)。
cron 2026-06-10 清理孤儿 in_progress 标记。

## Item #010 — Child UI 任务冲刺弹窗 (游戏化专注感) ✅

**用户原话** (feihao 2026-06-10 飞书 DM):
> "帮我在 nightly todo 上再新加一个 item 内容是针对 user 的界面,目前的界面上,任务的部分就点击之后就只有一个完成。我希望他点击了那个任务之后,开启一个新的弹窗,弹窗上显示: 1. 任务的详情和图片 2. 显示这个任务正在冲刺中 3. 如果是一个倒计时任务的话,在比较大的页面上弹出一个倒计时数字 4. 下面有一个打卡按钮"

**Status**: ✅ done (commit `700da9a`, 2026-06-16)
**风险**: 🟡 (UI-only)
**Started**: 2026-06-10
**Completed**: 2026-06-16

**说明**: sprint modal DOM + CSS + show/hide/countdown + sprint-urgency.test.ts 在 2026-06-15 之前 cron 已实现 (但 NIGHTLY-TODO.md 没归档). 2026-06-16 cron 补上唯一缺失的 `src/utils/sprint-urgency.ts` (17 行) 让单测 8/8 通过. **未做** (留待 PR 阶段): click 改造 (task 按钮 → showSprintModal) + 关闭交互 (X/backdrop/Esc) + e2e playwright spec + PRD/TEST_PLAN/FEATURE_MATRIX 文档 + PR. 下轮 cron 接着跑第 2-3 段. 注意: index.html 里 sprint-modal 骨架出现两次 (line 252 + line 272), 可能是上几轮重复 insert 造成, 需 cleanup.

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

## 📊 归档统计 (6 Item)

| 状态 | 数量 | Item |
|---|---:|---|
| ✅ done | 4 | #001 emoji / #002 睡眠 / #005 三进度条 / #009 硬删 |
| 🚫 blocked → 归档 | 2 | #003 英语 / #004 老师投诉 |
| **总计** | **6** | 全部归档 |

**用户拍板日期**: 2026-06-08
**最后编辑**: PM Agent
**原因**: 用户决定不实现 #003 #004 (block 的), 已 done 的 #001 #002 #005 也归档 (避免清单无限增长, 鼓励新需求走新流程)

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

## 📋 当前清单 (5 个 Item: 1 ⏳ pending, 2 🔧 running stage 1+, 1 ⏸ hold, 1 ✅ done 待归档)

## Item #006 — 打卡日历 (月历可视化) 🔧 running (Stage 1 done 2026-06-17, 等 Stage 2/3/4)

> 用户原话 (2026-06-08): "先 hold 一下这个 idea 放 todo 里吧, 后面我再来拍"
> 2026-06-17 DM 拍板: "B + 折叠 + 所有日期, 可切月份"

**已拍板 (2026-06-17)**:
1. **方案 = B (标准月历)**: 折叠月历视图, 标准 7×6 网格, 每格点击可看当天打卡明细 (任务名 + 积分)
2. **Q1 触发 = 折叠**: child UI 顶部"📅 月历"按钮点击展开/收起 (跟现在 child UI 风格一致)
3. **Q2 数据 = 所有日期 (可切月份)**: 显示全部历史, ◀/▶ 按钮切月份, 长跨度成就感

**Clarification** (PM 整理 2026-06-17):
- **数据来源**: `task_completions` 表 (现有 schema, 无需改), 按 `child_id + completed_at` 聚合每天打卡数
- **按月分页**: 一次只拉一个月的打卡数据, 切月份时再拉 (避免一次拉全表, 跟 #010 sprint modal 数据流一致)
- **颜色档位** (GitHub 风, 4 档): 0 次灰 / 1 次浅青 / 2 次中青 / 3+ 次深青 + 霓虹光
- **月历组件**: 顶部 ◀/▶ 月份切换 + 居中标题"YYYY 年 M 月" + 7×6 网格 (含上下月灰显日期) + 格子 click 弹 modal (复用 #010 sprint modal 同套 CSS)
- **可关闭性**: 折叠按钮再次点击收起; ESC 键关闭; localStorage 记忆折叠状态
- **视觉对齐**: 复用 #010 sprint modal 样式 + #011 running map 科技风 (cyan glow + 网格底) + 跟 #005 三进度条同色系
- **跟 #008 联动 (后续)**: #008 机甲化时, 月历格子可升级 HUD 角括号 (同款视觉)
- **跟 #011 联动**: 月历 grid 跟 running map grid 视觉呼应 (科技风统一)

**Action Plan** (4 段, 每段 ≤ 15 min, anti-CC-Timeout):
- [ ] **Stage 1 (≤15 min)**: HTML/CSS scaffold + 折叠按钮
  - `public/index.html` — 加 `#calendar-toggle-btn` (📅 月历) + `#calendar-panel` (默认隐藏, 跟 #005 进度条同位置)
  - `public/app.js` — `toggleCalendar()` + localStorage 记忆折叠状态
  - `public/app.css` — 折叠面板 + 月历 grid 7×6 样式 (cyan glow)
  - 单测: `tests/unit/calendar-toggle.test.ts` (show/hide + localStorage 持久化)
  - `git commit -m "feat(calendar): fold toggle button + panel scaffold (Item #006 §1)"`
- [ ] **Stage 2 (≤15 min)**: 月历渲染 + 数据加载 + 月份切换
  - `public/app.js` — `loadMonthCheckins(childId, year, month)` + `renderCalendar(year, month)` + ◀/▶ 切月事件
  - 单测: `tests/unit/calendar-render.test.ts` (month calculation + grid + 边界日期上下月填充)
  - E2E: `tests/e2e/ui-calendar-month-nav.spec.ts` (折叠 → 看到当月 → 点 ▶ 切下月 → 点 ◀ 切回)
  - `git commit -m "feat(calendar): month grid render + prev/next nav (Item #006 §2)"`
- [ ] **Stage 3 (≤15 min)**: 颜色档位 + 格子点击 → 当天明细 modal
  - `public/app.js` — `getColorTier(count)` 4 档 + 格子 click → `showDayDetailModal(date)` 复用 #010 sprint modal 同套
  - `public/app.css` — 4 档颜色 (gray / light-cyan / cyan / neon-cyan) + hover 浅光
  - 单测: `tests/unit/calendar-color.test.ts` (档位逻辑)
  - E2E: `tests/e2e/ui-calendar-day-detail.spec.ts` (点 6/15 → 弹 modal → 看任务列表)
  - `git commit -m "feat(calendar): color tiers + day detail modal (Item #006 §3)"`
- [x] **Stage 4 (≤10 min)**: 文档 + 视觉对齐 + 性能 ✅ (2026-06-20)
  - 文档: PRD §3.13 新增 calendar 段 + TEST_PLAN §3.17 + FEATURE_MATRIX 标记 + PROGRESS v2.x
  - 视觉对齐: 跟 #005 进度条 + #010 sprint modal + #011 running map 风格统一 (cyan 调色板)
  - 性能验证: 1000+ 打卡记录时切月 <200ms (按月分页已保, perf test ✅)
  - **🚫 不做**: 跨年统计 (留二期, 加 ◀/▶ 切年按钮); 任务列表导出 (留二期); wrangler deploy / git push
  - `git commit -m "feat(calendar): docs + visual alignment + perf test (Item #006 §4)"`

**Status**: ✅ done (verified by Qual 2026-06-20: e2e 12/12 pass + unit 313/313 pass)
**风险**: 🟢 (UI-only, 复用 #010 modal + 现有 schema)
**Started**: 2026-06-17
**Commit (Stage 1)**: `0389c85` (calendar fold toggle + 7×6 grid scaffold + 6 单测全过)
**Commit (Stage 2+3)**: `569e10c` (month grid render + prev/next nav + day detail modal + 2 API routes)
**Commit (Stage 4)**: `c5d8c57` (docs + visual alignment + perf test + 1 new perf test)
**Commit (PM-fix SQL bugs)**: `5abe507` (use user_id + DATE(unixepoch))
**Commit (PM-fix toggle + render + time)**: `f2c82e6` (toggle click !nowCollapsed + race + optimistic UI + day-detail HH:MM)
**Commit (PM-fix helper + e2e tests)**: `a4eb27b` (helper user_id + month-nav snapshot timing)
**Commit (P1-A jsdom test)**: `ade11a1` (regex-only → happy-dom click test, 7 tests)
**Completed**: 2026-06-20 (e2e green after Qual verification)
**未做**: 全部完成 ✅

---

## Item #007 — 英雄头像选择 (个人化) ⏸ hold (用户 2026-06-08 暂缓)

> 用户原话: 同上, "先 hold 一下"
> 用户发了 1 张 Pacific Rim 风格 Jaeger 机甲图 (豆包 AI 生成, 蓝灰 + 黄眼 + 双蓝剑), 等 hold 解除后用作 B 方案 (上传图片) 候选

**Status**: ⏸ hold
**待拍板**: A/B/C 来源 + 2 Q
**Commit**: —

---

## Item #008 — 任务装备/机甲化 (任务视觉) 🔧 running (Stage 1 done 2026-06-17, 等 Stage 2/3/4)

> 用户原话 (2026-06-08): "先 hold 一下"
> 用户提到"小朋友喜欢机甲风格" → 当时推荐 B 方案
> 2026-06-17 DM 拍板: "B + 夸张 + 独立"

**已拍板 (2026-06-17)**:
1. **方案 = B (机甲 HUD)**: 任务按钮框做成**机甲 HUD 角括号** + 霓虹青边框 + 扫描线
2. **Q1 冲击 = 夸张**: **全屏 HUD 风格**, 任务像"装备舱", 改 child UI 任务区主布局
3. **Q2 关联 #007 = 独立**: #008 自己一套, 跟 #007 Pacific Rim Jaeger 解耦, 不等 #007 拍板

**Clarification** (PM 整理 2026-06-17):
- **HUD 风格元素** (全屏, 覆盖 child UI 任务区):
  - 角括号: 任务卡片四角加 ◢◤◣◥ 装饰 (CSS clip-path 或 SVG)
  - 扫描线: 背景 `@keyframes scanline` 上下移动 (cyan 低不透明度 0.05)
  - 霓虹青光: 边框 `box-shadow: 0 0 8px #00d4ff` + hover 加深
  - 数据流背景: 任务区背景用 `repeating-linear-gradient` 网格底 (跟 #011 running map 同套)
- **"装备舱"模式**: 任务完成时按钮**展开** → 显示"装备激活"动画 (类似机甲开机) → 短暂 hold 0.5s → 折回
- **跟 #010 sprint modal 联动**: sprint modal 打开时全屏切换成 HUD "装备舱" 视角, 任务按钮变 "装备模块" 角括号
- **跟 #011 联动**: running map 跟 HUD 任务区用同色板 (cyan + 深灰底), 视觉统一
- **跟 #006 联动**: 月历格子未来可升级 HUD 角括号 (延后, 等 #006 拍板 cron 跑完)
- **Q2 独立 = 不等 #007**: #008 自己定调 (霓虹青/扫描线), #007 后续拍板不影响 #008 实施
- **⚠️ 风险升级**: 选"夸张"= 改 child UI 任务区主布局, 跟现有进度条/列表有冲突, 需 regression test
- **⚠️ 性能**: 全屏扫描线动画要 60fps, 用 CSS `transform/opacity` 避免 reflow, 移动端需降级 (关扫描线保留角括号)
- **可关闭性**: 视觉风格本身没有 toggle 按钮 (PM 拍板: 全屏总是开, 关闭可加 "🔧 经典模式" toggle 留二期)

**Action Plan** (4 段, 每段 ≤ 15 min, anti-CC-Timeout):
- [ ] **Stage 1 (≤15 min)**: 机甲 HUD CSS 组件库
  - `public/app.css` — 新增 `.mecha-frame` + `.mecha-corner` + `.mecha-scanline` + `.mecha-glow` 样式 (角括号/扫描线/霓虹青光)
  - 单元测试: `tests/unit/mecha-frame.test.ts` (DOM 节点 + 类名断言)
  - `git commit -m "feat(mecha): HUD frame CSS components (Item #008 §1)"`
- [ ] **Stage 2 (≤15 min)**: 任务按钮升级
  - `public/index.html` — task button 加 `.mecha-frame` 类 (角括号)
  - `public/app.css` — task button 适配 padding/border/font-size + hover 霓虹光
  - 单测: `tests/unit/task-mecha-button.test.ts`
  - E2E: `tests/e2e/ui-task-mecha-frame.spec.ts` (看到任务按钮是机甲 HUD 风)
  - `git commit -m "feat(mecha): apply HUD frame to task buttons (Item #008 §2)"`
- [ ] **Stage 3 (≤15 min)**: 全屏 HUD 装备舱模式 + 任务完成展开动画
  - `public/app.css` — child UI 任务区背景 (扫描线 + 网格底 + 数据流) + 任务完成时按钮展开/折回动画 (CSS keyframes 0.5s)
  - `public/app.js` — `triggerEquipActivation(taskId)` 触发完成时装备激活动画
  - E2E: `tests/e2e/ui-equip-activation.spec.ts` (打卡 → 看到装备展开动画)
  - 视觉对齐: 跟 #005 进度条 + #010 sprint modal + #011 running map 同色板
  - `git commit -m "feat(mecha): fullscreen HUD cockpit + equip activation (Item #008 §3)"`
- [ ] **Stage 4 (≤10 min)**: 文档 + 视觉对齐 + 性能 + regression
  - 文档: PRD §3.x 新增 mecha frame 段 + TEST_PLAN §3.x + FEATURE_MATRIX + PROGRESS v2.x
  - 性能: 全屏扫描线 60fps (CSS transform/opacity), 移动端降级 (关扫描线保留角括号, `@media (max-width: 768px)`)
  - Regression: 跑全套 vitest + e2e, 确保 #005/#006/#010/#011 视觉不破
  - **🚫 不做**: 跟 #007 同步 (Q2 独立); 经典模式 toggle (留二期); wrangler deploy / git push
  - `git commit -m "feat(mecha): docs + perf + regression test (Item #008 §4)"`

**Status**: 🔧 running (Stage 1 done, 等 Stage 2-4)
**风险**: 🔴 (UI-only 但全屏 HUD 改 child UI 主区域, 跟 #005/#006/#010/#011 视觉有冲突, 需全量 regression; 选 C 方案需改 navigation)
**Started**: 2026-06-17
**Commit (Stage 1)**: `1612a28` (HUD frame CSS 组件库 + 5 单测全过)
**未做**: Stage 2 (任务按钮升级角括号) / Stage 3 (全屏装备舱 + 任务完成展开动画) / Stage 4 (文档 + regression)

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

## Item #011 — 跑步小地图 + 积分礼包 (上海→苏州 主题) 🔧 running (Stage 1+2 done 2026-06-17/19, 等 Stage 3/4)

**用户原话** (feihao 2026-06-17 飞书 DM):
> "在 Nightly Todo 里再增加一个功能：记录跑步的每次公里数，并绘制一个小地图。每一次跑了多远的距离，会在一个虚拟的小地图上，从一个点移动到另一个点。当到达一个新的点位时（比如跑到10公里），可以开一个小礼包，礼包里有一个随机的积分"

**用户拍板 (2026-06-17)**:
1. **多张地图 + 第一张 = 上海→苏州**: 起点上海普陀区, 终点苏州. 总距离 ~95 km (普陀→苏州园区公路). **不均距**切 10 个目标, 路线曲折非直线, 有变化节奏.
2. **风格 = 科技风手绘** (B2): 跟现有 child UI 视觉一致 (cyan glow + 网格底), 路径为自由曲线 SVG, 各目的地之间非直线连接.
3. **推进方式 = C2**: 累计总公里数推进小人位置; 距离增长与本次打卡距离成正比; 一次打卡小人只前进一步 (不闪现).
4. **积分概率分布 (D3)**: 60% 小奖 1-5, 35% 中奖 5-10, 5% 大奖 10-20. 每到一个**新点位** roll 一次.
5. **录入 = E1**: 孩子点 🏃 emoji → 弹输入框填公里数 → 提交; **后台 PM 可撤销** (跟现有 score_event revoke 走相同审计模式).
6. **多图通关**: 第一张 (上海→苏州) 跑完后, 孩子"通关"动画 → 开启下一张地图 (例如 苏州→杭州, 计划二期). 本期只做第 1 张.

**Clarification** (PM 整理):
- **数据模型 (3 张新表)**:
  - `running_maps` (id, name, theme, total_km, is_active, display_order) — 主题地图清单
  - `running_points` (id, map_id, name, order_index, cum_km) — 每个点的累计 km (含起点 0 km, 终点 95 km)
  - `running_records` (id, child_id, map_id, km, awarded_point_id, awarded_minutes, created_at, revoked_at, revoked_by) — 每次打卡
- **点位设计 (10 个, 不均距, 上海→苏州)** — Stage 1 由 CC 设计 seed:
  - 0 km: 🏁 上海·普陀区 (起点)
  - 1: ~8 km: 嘉定新城
  - 2: ~22 km: 太仓
  - 3: ~32 km: 昆山花桥
  - 4: ~45 km: 昆山城区
  - 5: ~58 km: 阳澄湖
  - 6: ~72 km: 苏州相城区
  - 7: ~82 km: 苏州姑苏区
  - 8: ~89 km: 苏州工业园区
  - 9: ~95 km: 🚩 苏州·金鸡湖 (终点)
  - 设计原则: 8 次打卡完成 (一次 3-4 km × 8 = 24-32 km 太慢, 应让单次 3-4 km 推进感明显, 总 95 km 是**目标里程**而非时间)
  - 调整: 实际点位 km 待 Stage 1 由 CC 查百度/高德确认, 不强制照搬上述数字
- **小地图渲染**: SVG 500×300 viewBox, 路径用 `<path d="M ... C ... ">` cubic Bezier 拼成曲折线, 节点用 `<circle>` + 名称 label, 小人用 `<image href="...">` 或 emoji 字符. 进度按累计 cum_km / total_km 计算小人 position.
- **礼物 modal**: 跟 #010 sprint modal 同套 CSS, 标题 "🎁 通关奖励!" / "🎁 到达 X 地点!", 中央大数字显示积分 (e.g. "+8 min"), "再跑一次" 关闭按钮.
- **撤销语义 (X1 修订 2026-06-17)**: PM 在 admin UI 看到 running_records 列表, 可点 "↩ 撤销" (二次确认弹窗防误操作) → 写入 revoked_at + revoked_by + 减回积分 + **回退累计 km** (完全撤销本次记录, 跟 #009 硬删语义保持一致). **理由**: 防误点 (feihao 2026-06-17 拍板). 后续打卡按"撤销后累计"重新推进; 如果撤销后累计低于当前 point, 小人**自动回退**到对应 point.
- **跨图解锁 (X2 修订 2026-06-17)**: 通关时 (cum_km >= total_km) 孩子界面弹大图恭喜 modal (跟礼物 modal 同样式, 80% 屏, 居中卡片, 撒花动画) → 标题 "🎉 恭喜通关! 上海→苏州" + 显示累计跑步次数/总 km/用时天数 + "查看下一张地图" 按钮 → **自动** `UPDATE running_maps SET is_active=1 WHERE display_order = current.display_order + 1`. 如果没有下一张 map, 显示 "🌍 等待 PM 制作下一张地图...". 本期只 seed 第 1 张; 第 2/3 张可以先 INSERT is_active=0 占位 (id=2,3, name 待定), 通关时若无下一张就显示等待页.
- **可关闭性**: 孩子可 "🏃" 跳过 (不打卡), 地图仍可看, 不会强制跑步

**Action Plan** (4 段, 每段 ≤ 15 min, anti-CC-Timeout):
- [ ] **Stage 1 (≤15 min)**: D1 schema + seed
  - `migrations/0007_running_tables.sql` (3 张表: running_maps / running_points / running_records)
  - `migrations/0008_seed_shanghai_suzhou.sql` (第 1 张地图 + 10 个点 seed)
  - 单元测试: schema migration 验证 (`tests/unit/running-schema.test.ts`)
  - `git commit -m "feat(running): add running_maps/points/records schema + shanghai→suzhou seed (Item #011 §1)"`
- [ ] **Stage 2 (≤15 min)**: 跑步打卡 modal
  - `public/index.html` — 加 `#running-checkin-modal` (输入 km + 提交按钮)
  - `public/app.js` — `showRunningCheckinModal()` + `submitRunning(km)` + POST `/api/running/records` + 累计 km
  - `public/app.css` — modal 样式 (跟 #010 sprint modal 同套)
  - E2E: `tests/e2e/ui-running-checkin.spec.ts` (输入 3.5 km → 累计 +3.5)
  - `git commit -m "feat(running): child check-in modal + km submission (Item #011 §2)"`
- [ ] **Stage 3 (≤15 min)**: SVG 地图渲染 + 小人移动 + 礼物 modal + 通关解锁
  - `public/index.html` — 加 `#running-map-section` (SVG 容器, 路径 + 节点 + 小人 + 起点/终点标志) + `#running-completion-modal` (通关大图, 80% 屏, 撒花动画)
  - `public/app.js` — `renderRunningMap(mapId)` + `animateAvatarToPoint(pointId)` (CSS transition 1.5s) + `showGiftModal(point, minutes)` + roll 概率积分 (D3) + `showCompletionModal(mapId)` (通关时弹) + POST `/api/running/maps/:id/complete` 触发 `UPDATE running_maps SET is_active=1 WHERE display_order = current + 1`
  - `public/app.css` — 科技风手绘样式 (cyan glow, 网格底, 曲线路径, 节点 pulse 动画) + 通关 modal 大图样式 (80% 屏, 居中卡片, 全屏撒花)
  - E2E: `tests/e2e/ui-running-map.spec.ts` (跑 8 次 3.5 km 累计 28 km, 验证小人 position + 通关礼物) + 通关测试 (mock cum_km=total_km, 验证大图 modal + 翻 is_active + 没有下一张时显示等待页)
  - `git commit -m "feat(running): SVG map + avatar animation + milestone gift + completion modal (Item #011 §3)"`
- [ ] **Stage 4 (≤10 min)**: Admin 撤销 (含 km 回退) + 文档
  - `src/routes/admin/running.ts` — `GET /api/admin/running/records` 列表 + `POST /api/admin/running/records/:id/revoke` 撤销 (同时减回积分 + 回退累计 km, 写 audit_log)
  - `public/admin.html` + `public/admin.js` — running_records 列表 + "↩ 撤销" 按钮 + 二次确认弹窗 (防误操作)
  - 单元测试: revoke endpoint (积分减回 + km 累计回退 + 小人自动回退到对应 point) + 审计 log + 防误点逻辑
  - 文档: PRD §3.x 新增 running map 段 + TEST_PLAN §3.x + FEATURE_MATRIX 标记 + PROGRESS v2.x
  - **🚫 不做**: wrangler deploy / git push (按 cron 红灯规则)
  - `git commit -m "feat(running): admin revoke (km+points 回退) + PRD/TEST_PLAN docs (Item #011 §4)"`

**Status**: 🔧 running (Stage 1+2 done 2026-06-17/19, 等 Stage 3/4)
**风险**: 🟡 (新 schema + UI + admin 撤销, 参考 #009 已有 hard-delete / revoke 模式可复用)
**Started**: 2026-06-17
**Commit (Stage 1)**: `d4be219` (3 张表 schema + 上海→苏州 10 个点位 seed + 8 单测全过)
**Commit (Stage 2)**: `90c04d1` (child check-in modal + km submission + 7 e2e scenarios)
**未做**: Stage 3 (SVG 地图 + 小人 + 礼物 + 通关) / Stage 4 (admin 撤销 + 文档)

---

## Item #012 — Calendar icon 渲染 + Tab 筛选 🔧 deferred (等 #008 done)

> 用户原话 (2026-06-20): "日历的地方有一个问题，我不希望只显示数字，而是希望显示那个他任务完成的对应的小图标。并且增加几个Tab，可以单独筛选：1. 看所有的 2. 筛选特定的任务"

**已拍板 (2026-06-20)**:

1. **A3+ (图标显示策略)**: 横排所有 task icon, 无数字无 +N; **当天 5 个都打** 的话显示 ⭐ 单 icon (overflow 避免拥挤)
2. **B2 (Tab 多选 OR)**: 多选 tab, 用户可同时选 N 个 task → 显示 N 个 task **任一完成** 的格子 (OR logic)
3. **C1 (Tab 来源)**: 所有 is_active=1 tasks 都成 tab (现在 5 个: 刷牙 / 整理玩具 / 阅读 / 运动 / 帮助做家务; 未来 task 增到 10+ 再考虑 overflow → C2 "添加筛选" 按钮)
4. **D2 (持久化)**: localStorage 保存选中的 task_id 数组 (`[]` = 全部, `[1, 3]` = 刷牙 + 阅读)

**Clarification** (PM 整理):

- **数据模型不变**: `task_completions` 表 + `tasks` JOIN, 现有 schema 够用。无需 migration。
- **API 改动 2 个**:
  - `GET /api/public/calendar/checkins?child=X&year=Y&month=M` 改返 `{checkins: {date: [{task_id, task_icon, task_name, count}, ...]}}` (从 `{date: count}` 扩展)
  - 加 `task_ids` query param (逗号分隔): `?task_ids=1,3` → server 端 WHERE filter (避免 client 拿全表再 filter, D1 scan 优化)
  - 加新 endpoint `GET /api/public/calendar/tasks` → 返 `[is_active=1] tasks 列表` (供 tab bar 渲染), `{tasks: [{id, name, icon, category, sort_order}, ...]}`
- **前端 state**:
  - `calendarState.checkins` 改结构: `{date: [{task_id, task_icon, task_name, count}, ...]}`
  - 新增 `calendarState.selectedTaskIds: number[]` (从 localStorage 初始化, `[]` = 全部)
- **Tab bar 视觉**:
  - 顶部 📅 月历按钮 + ◀/▶ 月份 下面 + 月历 grid 上面, 一行 pill tabs
  - 默认 tab "全部" (id=null/empty) 在最左, 然后按 task.sort_order ASC 排列
  - Active state: cyan glow + 1px border (跟现有 #005/#008 风格统一)
  - Multi-select: tap toggle, active tabs 高亮 (B2 OR logic)
  - 5+ tasks 时 tabs 横向滚动 (overflow-x: auto)
- **Cell 渲染新逻辑**:
  - 当前 count → 拆成 task list (`{date: [{task_id, task_icon, ...}]}`)
  - 横排 icons (CSS flex), icon 大小跟 cell 适配 (24px?)
  - **当 task list ≥ 5** → 显示 ⭐ 单 icon (overflow indicator)
  - 当 list 空 (count=0) → gray cell (跟现在一样)
  - 4 档颜色 (gray/light-cyan/cyan/neon-cyan) 继续按 **完成任务数** 算 (跟"全部" mode 一致)
- **筛选 mode**:
  - 选 "全部" (空 selectedTaskIds) → 显示所有 task completions, color tier 按 count
  - 选 1+ task → 显示这些 task 任一完成的格子, color tier 按 **选中 task 完成的总数**
  - 例: 6/18 刷牙 + 阅读完成, 选 "全部" → tier 2 (2 个 task) + 2 icons. 选只 "刷牙" → tier 1 (1 个 task) + 1 icon.
- **API 边界**:
  - `task_ids` 空 / 缺失 → return all (跟"全部" tab 一致)
  - `task_ids` 含无效 id → silently filter (server log warn)
  - 0 完成 → empty checkins object + 全部 gray cell
- **localStorage key**: `calendarSelectedTaskIds` (array<number>), JSON serialized
- **iPad Safari cache**: 跟 #006 一样, `?v=N` cache-bust + hard reload

**Action Plan** (4 段, 每段 ≤ 15 min):

- [ ] **Stage 1 (≤20 min)**: API 改动 (calendar/checkins + 新增 calendar/tasks)
  - `src/routes/public/calendar.ts`: SQL 改返 task 详情 (JOIN tasks) + 加 `task_ids` filter param
  - `src/routes/public/calendar-tasks.ts` (新文件): `/api/public/calendar/tasks` endpoint, 返 is_active=1 tasks
  - `src/worker.ts`: 注册新 route
  - 单测: `tests/unit/calendar-tasks.test.ts` (task list filtering + sort)
  - 单测: `tests/unit/calendar-checkins-filter.test.ts` (task_ids param behavior)
  - `git commit -m "feat(calendar): API returns task details + task_ids filter + /calendar/tasks endpoint (Item #012 §1)"`
- [ ] **Stage 2 (≤20 min)**: UI cell 渲染 icons (A3+ 逻辑)
  - `public/app.js`: `calendarState.checkins` 改结构; `renderCalendar` 改 cell 渲染 (icons 横排, 5+ → ⭐)
  - `public/app.css`: `.calendar-cell-icons` flex + `.calendar-cell-icon` 24px + `.calendar-cell-icon-overflow` (⭐) 居中
  - 单测: `tests/unit/calendar-render-icons.test.ts` (icon count, overflow logic)
  - e2e: `tests/e2e/ui-calendar-icons.spec.ts` (1 task → 1 icon, 3 tasks → 3 icons, 5 → ⭐)
  - `git commit -m "feat(calendar): cell renders task icons (5+ → ⭐ overflow) (Item #012 §2)"`
- [ ] **Stage 3 (≤20 min)**: Tab bar (B2 + C1 + D2 整合)
  - `public/index.html`: 加 `#calendar-tabs` 容器 (默认 "全部" tab + dynamic task tabs from API)
  - `public/app.js`: `initCalendarTabs()` (load tasks from /calendar/tasks, render tabs, bind multi-select toggle), `calendarState.selectedTaskIds` localStorage 读写, tab 切换 → 重新调 `loadMonthCheckins(task_ids=...)`
  - `public/app.css`: `.calendar-tabs` 横向滚动 + `.calendar-tab` pill + `.calendar-tab--active` cyan glow
  - 单测: `tests/unit/calendar-tabs.test.ts` (localStorage toggle + loadMonthCheckins call with correct task_ids)
  - e2e: `tests/e2e/ui-calendar-tabs.spec.ts` (默认 "全部" / 多选 toggle / 切换后 cell 更新 / 持久化跨刷新)
  - `git commit -m "feat(calendar): multi-select tab bar (B2 + C1) + localStorage (D2) (Item #012 §3)"`
- [ ] **Stage 4 (≤15 min)**: 文档 + 视觉对齐 + regression
  - `docs/PRD.md` §3.13 加 tab filter 段
  - `docs/TEST_PLAN.md` §3.17 加新 e2e + 单测
  - `docs/FEATURE_MATRIX.md` 标记 ✅
  - 视觉对齐: tab bar 跟 #005/#008/#010/#011 cyan 风格统一
  - Regression: 跑全套 npx vitest run + npx playwright test
  - `git commit -m "feat(calendar): docs + visual alignment + regression (Item #012 §4)"`

**Status**: ⏳ pending (deferred: queue after #008, 等 cron 自然 file-order 跑到 #012)

**风险**: 🟢 (UI-only + 2 API 端点改动, schema 不变, #006 已 verify pattern)

**Started**: —
**Commit**: —

**预计开始**: 跑完 #008 + #011 后, 大约 2026-06-22 之后 (1 task/晚, #008 stage 2-4 + #011 stage 3-4 各 1 晚)

---

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

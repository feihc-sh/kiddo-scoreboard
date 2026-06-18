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

## 📋 当前清单 (4 个 Item: 1 ⏳ pending, 3 ⏸ hold)

## Item #006 — 打卡日历 (月历可视化) ⏸ hold 🆕 (2026-06-17 激活, 待拍板 A/B/C)

> 用户原话 (2026-06-08): "先 hold 一下这个 idea 放 todo 里吧, 后面我再来拍"
> 2026-06-17 DM: "激活 6 和 8" → PM 整理 A/B/C 拍板选项

**Clarification** (PM 整理 2026-06-17):

**3 个 A/B/C 设计方案**:

- **A 方案 (轻量 — GitHub 风贡献条)**: 在 child UI 顶部加 7/30 天**水平条** (类似 GitHub contribution graph), 每格一天, 颜色深浅 = 打卡次数. 最轻量, 不占屏, 一眼看到"我最近勤不勤".
- **B 方案 (标准月历)**: 弹窗/折叠**月历视图**, 标准 7×5/6 网格, 每格点击可看当天打卡明细 (任务名 + 积分). 中等, 跟 iPad 适配, 信息密度适中.
- **C 方案 (互动大日历)**: 整页大日历 (类似 Apple Fitness 风格), 每格可点击展开当天任务列表, 顶部显示**当月统计** (总积分 / 打卡次数 / 连胜天数). 重量级, 沉浸感强, 跟 #005 B 进度条 + #011 跑步地图呼应.

**2 个 Q**:

- **Q1 触发方式**:
  - 折叠: child UI 顶部"📅 月历"按钮点击展开/收起 (跟现在 child UI 风格一致)
  - 弹窗: 全屏 modal 弹出 (跟 #010 sprint modal 同套)
  - 独立 tab: child UI 主菜单加"📅 月历" tab (最重, 改 navigation)
- **Q2 数据范围**:
  - 全部历史: 长跨度成就感 (e.g. 半年 1 万次打卡)
  - 近 30 天: 最近习惯高亮
  - 本月: 跟 #005 B 进度条 (月 100) 联动, 节奏感强

**Status**: ⏸ hold (待拍板 A/B/C + 2 Q, 拍板后 PM 拟定 Action Plan)
**风险**: 🟢 (UI-only, 无 schema 改动)
**Started**: —
**Commit**: —

---

## Item #007 — 英雄头像选择 (个人化) ⏸ hold (用户 2026-06-08 暂缓)

> 用户原话: 同上, "先 hold 一下"
> 用户发了 1 张 Pacific Rim 风格 Jaeger 机甲图 (豆包 AI 生成, 蓝灰 + 黄眼 + 双蓝剑), 等 hold 解除后用作 B 方案 (上传图片) 候选

**Status**: ⏸ hold
**待拍板**: A/B/C 来源 + 2 Q
**Commit**: —

---

## Item #008 — 任务装备/机甲化 (任务视觉) ⏸ hold 🆕 (2026-06-17 激活, 待拍板 A/B/C)

> 用户原话 (2026-06-08): "先 hold 一下"
> 用户提到"小朋友喜欢机甲风格" → 推荐 B 方案 (机甲部件), 等 hold 解除后确认
> 2026-06-17 DM: "激活 6 和 8" → PM 整理 A/B/C 拍板选项

**Clarification** (PM 整理 2026-06-17):

**3 个 A/B/C 设计方案**:

- **A 方案 (等级徽章)**: 每个 task 完成 N 次后升级 (铜 → 银 → 金 → 钻石), 任务按钮左侧加小型徽章. 渐进式, 不喧宾夺主, 保留现有布局.
- **B 方案 (机甲 HUD)** (PM 推荐, 跟 feihao 2026-06-08 偏好 + 跟 #007 Pacific Rim Jaeger 蓝灰 + 黄眼 + 双蓝剑 风格一致): 任务按钮框做成**机甲 HUD 角括号** + 霓虹青边框 + 扫描线, 跟现有 #010 sprint modal + #011 running map 科技风统一. 视觉冲击中等, gamification 明显.
- **C 方案 (装备/武器槽)**: 完成特定 task 解锁"装备" (枪/剑/盾/机器人), 装饰在 child UI 角落"装备库", 任务变成"装备库"导航. 重量级, gamification 最强, 改动最大.

**2 个 Q**:

- **Q1 视觉冲击等级**:
  - 微调: 只改按钮边框/角, 不动布局
  - 中等: 加 HUD 角括号 + 霓虹光, 按钮视觉升级 (PM 默认, 跟 #010/#011 呼应)
  - 夸张: 全屏 HUD 风格, 任务像"装备舱" (跟现有进度条/列表布局冲突大)
- **Q2 关联 #007 头像吗**:
  - 同款: 跟 #007 Pacific Rim Jaeger 同步, 视觉统一 (注意 #007 仍 hold, 解锁后风格直接对齐)
  - 独立: #008 自己一套, 跟 #007 解耦 (允许不同步拍板)

**Status**: ⏸ hold (待拍板 A/B/C + 2 Q, 拍板后 PM 拟定 Action Plan)
**风险**: 🟡 (UI-only, 但需要跟 #007/#010/#011 视觉对齐; 选 C 方案需改 navigation)
**Started**: —
**Commit**: —

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

## Item #011 — 跑步小地图 + 积分礼包 (上海→苏州 主题) ⏳ pending

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

**Status**: ⏳ pending
**风险**: 🟡 (新 schema + UI + admin 撤销, 参考 #009 已有 hard-delete / revoke 模式可复用)
**Started**: —
**Completed**: —
**Commit**: —

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

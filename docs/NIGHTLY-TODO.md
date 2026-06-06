# 半夜自动化清单 (NIGHTLY-TODO)

> **流程**：用户 DM PM Agent → PM 整理 (澄清 + 拟定 action plan) → 写进这个文件 → 每天 0:00 cron 自动跑 pending items → 第二天 PM 汇报结果回 DM
>
> **作用域**：可自动化的开发任务 (git commit 级别, **不**包括 deploy / push / DELETE)
>
> **位置**：`docs/NIGHTLY-TODO.md` (跟项目, git 可见)
>
> **最后更新**：2026-06-06 创建

---

## 🚦 风险图例

| 图标 | 等级 | 含义 |
|------|------|------|
| 🟢 | 低 | 改 docs / 注释 / 格式化 / 加单测 |
| 🟡 | 中 | 改 src 代码 / 改 migration / 改依赖 |
| 🔴 | 高 | 改核心架构 / 改 schema / 改 token 配置 |

> **不跑的事** (cron 看到会自动 skip 并标 🚫 blocked):
> - `wrangler deploy` / `git push` / `wrangler d1 delete`
> - 需要用户决策的澄清
> - 实时 iPad 实测

---

## 📋 怎么用

**用户视角**（极简）：
1. 飞书 DM 跟我说："我想 X, 还要 Y"
2. 我整理 (clarify + plan) 后, 在这个文件加 ## Item
3. 半夜 0:00 自动跑
4. 早上/有空时我汇报结果

**用户不需要操作这个文件**, 全程 DM 完成。

---

## 📝 Item 模板 (PM Agent 复制后改 ID)

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

## 📋 清单 (空 → 慢慢加)

## Item #001 — Admin 加任务 UI 加 emoji 选择器 (20 个预设)

**用户原话**:
> "我的Admin的那个界面里边加新的每日任务的界面里边，它的emoji是要自己敲进去的。你能不能放几个选项，和小朋友的生活、学习、习惯这些是比较相关的emoji？大概放20个吧"

**Clarification** (PM 整理):
- Admin 加任务表单里 emoji 输入框 → 改成 20 个预设按钮, 选了自动填入
- 20 个 emoji 范围: **生活 / 学习 / 习惯** 三大类, PM Agent 来挑
- 旧 emoji 字段保留手输入口 (高级用户)
- 用户没明说 → **20 个 emoji 列表需要 PM 拟一版给他拍板** (在 Action Plan 阶段)
- 风险: 🟢 (纯前端改动, DB 不动)

**Action Plan**:
- [ ] PM 拟 20 个 emoji 候选 (生活/学习/习惯分类), 写到这个 Item 的补充
- [ ] 委派 code-agent: 改 `admin/tasks.js` 的 emoji 字段 → 改成 20 个 button grid + 保留 input
- [ ] 写 e2e: 验证选 emoji 后能正确提交任务
- [ ] 跑 `npx vitest run` + `npx playwright test`
- [ ] `git commit -m "feat(admin/tasks): emoji picker (20 presets) for new task form"`

**Status**: ⏳ pending
**风险**: 🟢
**Started**: —
**Completed**: —
**Commit**: —

---

## Item #002 — 睡眠时间 track (双向: 按时加分 / 超时扣分)

**用户原话**:
> "晚上不能睡太晚，到9:30，如果睡觉超时的话要扣分。这个不是一个得分项，是一个扣分项，好像这个就没有。但是它是超时，如果提前睡的话是加分。超时的话是扣分。"

**Clarification** (PM 整理):
- 9:30 = **hard deadline** ✅ (用户确认)
- 触发: **儿童手动提交** (child UI 自己版面, 填"我 HH:MM 睡的")
- 加减分: **delta = max(0, (实际睡 - 21:30) in min) → 扣 delta min**
  - 准时 (≤9:30) → 0
  - 超时 1 min → -1 min
  - 超时 30 min → -30 min
  - **不设上限** (刷夜 = 惨)
- 信任机制: 儿童诚实提交 (用户判断: 孩子会诚实), PM 审核 + 可撤销异常单
- 风险: 🟡 (新 task type + child UI 提交入口 + PM 审核 + per-minute 算法)
- ❓ **还需要用户确认** (Q7 残留): PM 看到异常单 → 直接撤销, 还是先问小朋友? 我建议直接撤销 + 通知, 不打扰流程

**Action Plan**:
- [ ] 用户拍板 Q7
- [ ] 加 migration: `tasks` 加 `is_per_minute_penalty BOOLEAN` 字段 (睡眠用)
- [ ] 委派 code-agent: child UI 加 "📝 记录睡眠时间" 入口 (HH:MM 输入), 后端算 delta
- [ ] 委派 code-agent: PM admin 加 "审计" 列表, 异常睡眠单可撤销
- [ ] 写 e2e: 准时 → 0, 超时 5min → -5, 跨天 → 边界保护, 撤销 → 还原
- [ ] `git commit -m "feat(tasks): sleep tracking — child-submit + per-minute penalty + PM audit"`

**Status**: ⏳ pending
**风险**: 🟡
**Started**: —
**Completed**: —
**Commit**: —

---

## Item #003 — 英语阅读 track (完成 2 本 quiz +1 min)

**用户原话**:
> "每天英语阅读，完成两本的quiz。这个可以加1分钟的时间。"

**Clarification** (PM 整理):
- Task: "英语阅读", completion 条件: **完成 2 本 quiz**
- 加分: **+1 min/天**
- ❓ **需要用户确认**:
  1. 完成 **1 本** quiz 给不给奖励? (我建议 +0.5 min, 阶梯)
  2. 完成 **3 本以上** 有没有上限? (我建议 max +1 min/天, 别激励堆量)
  3. "quiz" 怎么 verify? PM 手动 confirm, 还是小朋友自查? (PM 拍板, 我建议手动)
- 实施: 复用现有 task + 加 `target_count INTEGER` 字段 (per-day target)
- 风险: 🟢 (现有 task 框架扩展)

**Action Plan**:
- [ ] 用户拍板 3 个 Clarification 问题
- [ ] 加 migration: `tasks.target_count INTEGER` (默认 1, 英语阅读用 2)
- [ ] 委派 code-agent: 改 child UI 完成按钮 + PM confirm 弹窗 (count field)
- [ ] 写 e2e: 完成 2 本 → +1, 完成 1 本 → +0.5, 完成 0 → 0
- [ ] `git commit -m "feat(tasks): add target_count for multi-completion tasks (e.g. reading 2 quizzes)"`

**Status**: ⏳ pending
**风险**: 🟢
**Started**: —
**Completed**: —
**Commit**: —

---

## Item #004 — 举一反三 track + 老师投诉扣分

**用户原话**:
> "举一反三，完成一个章节也可以加1分钟的时间。然后就是去学校的时候有没有老师投诉？如果有投诉的话就要扣的话是从20元人民币起，然后这个我可以调"

**Clarification** (PM 整理):
- **举一反三 task**: 完成 1 章节 → +1 min/天
- **老师投诉 task** (新机制, 跟睡眠一样是"扣分项"):
  - 默认 -20 min/次
  - PM 在 Admin UI 能调 (用户明示"我可以调")
- ❓ **需要用户确认**:
  1. "20 元" 实际是 **-20 min** 还是 -20 个 token?  我建议 -20 min (跟游戏时间同一单位)
  2. 老师投诉是 PM 手动记, 还是小朋友自报? (我建议 PM 手动, 防止滥用)
  3. **一周内多次投诉累加吗?**  我建议累加, 不封顶 (你既然能"调", 应该是想多投诉多扣)
  4. 举一反三: "1 章节" 是固定 1 章节, 还是 1+ 多章节? (我建议 1 章节 = 1 min, 超过按 1 min/step 上限 3 min/天 防止灌水)
- 实施: 加 `task_type='penalty'` (无 deadline, PM 触发时直接扣) + `default_penalty_min INTEGER`
- 风险: 🟡 (新 task type + UI 加 PM 调整 penalty 字段)

**Action Plan**:
- [ ] 用户拍板 4 个 Clarification 问题
- [ ] 加 migration: `tasks` 加 `default_penalty_min INTEGER` 字段
- [ ] 委派 code-agent: 加 "老师投诉" preset task + PM admin UI 调 penalty 字段
- [ ] 写 e2e: PM 记投诉 → 余额 -20, 改 penalty 字段 → 下次按新值扣
- [ ] `git commit -m "feat(tasks): add configurable penalty task (e.g. teacher complaint -20min default)"`

**Status**: ⏳ pending
**风险**: 🟡
**Started**: —
**Completed**: —
**Commit**: —

---

## Item #005 — 双进度条系统 (累计总数 + 当日全完成) ⭐ 优先级最高

**用户原话**:
> "我觉得可以用完成任务总数有个进度条，当日是否有全部完成有个进度条"

**Clarification** (PM 整理):
- **进度条 A (累计)**: 显示 "已完成 N / M 任务" 进度条, M 默认 **1000** (PM 在 Admin 可调)
- **进度条 B (当日)**: 显示 "今日 X / Y 任务" 进度条 (Y = 当日 active task 数), 100% 时触发**全屏撒花 + "Combo!" 文字**
- 两个进度条**位置**: child UI 主页**最显眼** (顶部, 占屏 1/3)
- **完全契合自驱力 3 件套**:
  - Autonomy: 进度条 B 让孩子自己看到 "今天还差几个"
  - Mastery: 进度条 A 让孩子看到 "我累计越来越多"
  - Purpose: 两者 = "每天做一点点, 累计起来有大意义"
- **不需要新 schema**: 现有 `task_completions` 表 + 简单 `app_config` 加 `total_target_count` 字段
- ✅ **用户拍板** (2026-06-06):
  1. 累计目标默认 **1000** (推荐采纳, 大约 1 年多完成)
  2. 撒花动效用 **CSS 粒子** (中等成本, 效果不错)
  3. 撒花触发 **每天 1 次** (避免刷屏, 也防止撤销后反复触发)
- 风险: 🟢 (纯前端 + 1 个 config 字段)

**Action Plan**:
- [ ] ~~用户拍板 3 个 Clarification 问题~~ ✅ 已拍板 (见上)
- [ ] 加 migration: `app_config` 表加 `total_target_count INTEGER DEFAULT 1000` (如果表不存在, 创建)
- [ ] 委派 code-agent: child UI 顶部加 2 个进度条 (累计 + 当日)
- [ ] 委派 code-agent: 100% 撒花动效 (CSS 粒子)
- [ ] 撒花 daily-once: localStorage 存 `lastConfettiAt` 戳, 跨天重置
- [ ] 写 e2e: 完成最后一个 task → 进度条 B 100% → 撒花出现
- [ ] 写 e2e: 累计 100 个 → 进度条 A 显示 10%
- [ ] 写 e2e: 撤销最后一个 task → 撒花不再次触发 (daily-once 生效)
- [ ] `git commit -m "feat(child-ui): dual progress bars (cumulative total + daily completion) with CSS confetti"`

**Status**: ⏳ pending
**风险**: 🟢
**Started**: —
**Completed**: —
**Commit**: —

---


## 📦 归档 (已完成, 最近 30 天)

(完成时 PM Agent 移动到这里, 30 天后清掉, 完整历史在 git log)


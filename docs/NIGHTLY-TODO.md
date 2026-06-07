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

## 📋 5 个 Item 一句话总结 (你拍板时看这个, 别看下面技术细节)

### Item #001 — Admin 加任务 UI 加 emoji 选择器
- **你想要的**: 在 Admin 加任务界面, 选 emoji 不用手敲, 给你 20 个常见 emoji 让你挑
- **当前状态**: 20 个 emoji 我列好了, 你说 OK ✅
- **待你拍板**: **无**, 可以直接跑
- **风险**: 🟢 (纯前端)

### Item #002 — "准时上床" 打卡 + 倒计时 + 灰按钮 ⭐
- **你想要的**: 9:30 之前孩子点 "✓ 我上床了" → +1 min, 9:30 之后按钮自动变灰不可点 (倒计时提醒)
- **当前状态**: ✅ **实现完成** (后端 migration + 5 处 patch + 文档 PRD §3.12 + TEST_PLAN §3.14, 待 e2e 验证 + commit)
- **待你拍板**: **0** (PM 默认: 倒计时格式 "距离 9:30 还剩 HH:MM:SS" 显示在按钮上, 不同意告诉我)
- **风险**: 🟢 (复用现有 task 框架, 加个新字段 `cutoff_time` + 灰按钮逻辑)
- **隐藏的好处**: 自动 lockout 替代了"PM 审核异常单", 你不用盯着
- **Commits** (待):
  - `feat(tasks): sleep button self-lockout — cutoff_time + is_self_lockout fields` (后端: migration 0004 + Task type + 2 路由 + week utils)
  - `feat(child-ui): sleep button countdown + auto-lockout at cutoff` (前端: renderTasks 倒计时 + 灰按钮 + setInterval)
  - `feat(admin): cutoff_time + is_self_lockout in task form` (admin 表单字段 + submitNewTask POST)
  - `test(e2e): sleep lockout spec — countdown + lockout + CUTOFF_PASSED + cross-day` (新 e2e §3.14)
  - `docs: PRD §3.12 + TEST_PLAN §3.14 + PROGRESS 条目`

### Item #003 — 英语阅读任务
- **你想要的**: 工作日 2 本 = +2 min, 周末 4 本 = +2 min (周末目标多但奖励一样)
- **当前状态**: 简化方案, 取消之前 1/2/3 本阶梯 ✅
- **待你拍板**: **2 个**
  - 孩子说"我做了 N 本" — 你手动确认, 还是让孩子自己报?
  - 周末算周六+周日? 节假日按工作日?
- **风险**: 🟢 (现有框架扩展)

### Item #004 — 举一反三 + 老师投诉
- **你想要的**:
  - 举一反三: 每天 1 本 = +1 min (每天都, 不分工作日)
  - 老师投诉: 一次扣 20 min, 你在 Admin UI 能调
- **当前状态**: 简化方案 ✅
- **待你拍板**: **4 个** (都是老师投诉相关的)
  - "20 元" 实际是扣 20 分钟还是 20 个金币? (我猜 20 分钟)
  - 老师投诉是你手动记, 还是孩子自报? (我猜你手动, 防止滥用)
  - 一周内多次投诉累加吗? (我猜累加, 不封顶)
  - 你改 penalty 后, 下次投诉就按新值扣, 还是只对新 task 生效? (我猜立即生效)
- **风险**: 🟡 (新 task 类型 + UI)

### Item #005 — 三进度条 (当日 / 本月 / 当年) ⭐ 第一个做
- **你想要的**: child UI 顶部 3 个进度条
  - **当日**: 今日完成几个, 100% 撒花 ("Combo!")
  - **本月**: 本月完成多少, 默认 100/月
  - **当年**: 本年完成多少, 默认 1200/年
- **当前状态**: 全拍板 ✅
- **待你拍板**: **无**
- **风险**: 🟢 (纯前端 + 2 个 config 字段)
- **注意**: 这是**最先做的** (风险低 + 立刻解决你最痛点"孩子不盯不做"的 30%)

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

**PM 拟的 20 个 emoji (拍板用)**:

| 习惯 (habit, 7) | 学习 (study, 7) | 生活 (chore/custom, 6) |
|---|---|---|
| 🦷 刷牙 | 📚 阅读 | 🛏️ 起床/睡觉 |
| 🛁 洗澡 | ✍️ 练字 | 🍎 吃饭/水果 |
| 🧹 整理 | 📝 写作业 | 🧺 收衣服 |
| 🏃 运动 | 🎨 画画 | 🐶 遛狗 |
| 💤 早睡 | 🎹 练琴 | 🧸 收玩具 |
| 🥛 喝水 | 🧮 数学 | 🧴 洗手 |
| 🧼 洗手 | 🗣️ 朗读 | |

(共 20 个, 用户拍板如要调整再改)

**Action Plan**:
- [x] PM 拟 20 个 emoji 候选 (生活/学习/习惯分类), 写到这个 Item 的补充
- [ ] 委派 code-agent: 改 `public/admin/index.html` + `admin.js` + `app.css` 加 20 个 button grid + 保留 input
- [ ] 写 e2e: 验证选 emoji 后能正确提交任务
- [ ] 跑 `npx vitest run`
- [ ] `git commit -m "feat(admin/tasks): emoji picker (20 presets) for new task form"`

**Status**: 🔧 running
**风险**: 🟢
**Started**: 2026-06-07
**Completed**: —
**Commit**: —

---

## Item #002 — "准时上床" 打卡 + 倒计时 + 自动 lockout

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
- **时区**: client local time (iPad 浏览器知道 user 时区) + server 二次校验防 client 篡改
- 风险: 🟢 (新 task type + 倒计时 + 灰按钮逻辑, 复用现有 task 框架)
- ✅ **已拍板** (用户 2026-06-06): 取消 per-minute, 改成"打卡 + 倒计时 + lockout"
- ⚠️ **PM 默认** (你不同意告诉我): 倒计时显示在按钮文字内, 格式 "距离 9:30 还剩 HH:MM:SS"

**Action Plan**:
- [x] ~~用户拍板 Q7~~ ✅ 不需要 (自动 lockout 替代)
- [x] ~~加 migration: `tasks` 加 `cutoff_time TIME` + `is_self_lockout INTEGER` (睡眠用)~~ ✅ migrations/0004_sleep_cutoff.sql 已写
- [x] ~~后端 Task type 加字段 + 2 路由校验 + week utils (nowShanghaiHHMM, hhmmAfter)~~ ✅ types.ts + tasks.ts (admin POST/PUT) + me/tasks.ts (CUTOFF_PASSED) + week.ts
- [x] ~~admin 表单加 cutoff_time + is_self_lockout 字段 (index.html)~~ ✅
- [x] ~~admin.js submitNewTask 把字段加进 POST body~~ ✅
- [x] ~~child UI 渲染 准时上床 按钮 + 倒计时 setInterval(1s) + 灰按钮 (.task-btn-locked)~~ ✅
- [x] ~~app.css 灰按钮样式~~ ✅
- [x] ~~PRD §3.12 + TEST_PLAN §3.14 (11 个测试场景) + PROGRESS 条目~~ ✅ 文档已补
- [ ] **跑 e2e 验证** (本地 D1, 跑 ui-child-sleep-lockout.spec.ts)
- [ ] `git commit` (上面 5 个 commit 计划)
- [ ] 推送到 production (待用户拍板 🔴)

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
- **新方案** (用户 2026-06-06 简化):
  - **工作日** (周一-周五, 5天): 完成 2 本 quiz = +2 min (一次奖励)
  - **周末** (周六-周日, 2天): 完成 4 本 quiz = +2 min (一次奖励, 目标数不同但奖励一样)
  - **取消** 1本/2本/3本 阶梯, 不再做半奖励
- 实施: `tasks` 表加 `target_count INTEGER` (工作日) + `weekend_target_count INTEGER` (周末), 周末逻辑用 weekday() 判断
- 风险: 🟡 (新 schema 字段 + per-weekday logic)
- ❓ **需要用户确认**:
  1. verify 方式: PM 手动 confirm, 还是小朋友自查? (我建议 PM 手动, 防止虚报)
  2. "周末"定义: 仅 周六+周日? (我建议是, 节假日按工作日算, 不特殊处理)

**Action Plan**:
- [ ] 用户拍板 2 个 Clarification 问题
- [ ] 加 migration: `tasks` 加 `target_count INTEGER` + `weekend_target_count INTEGER` (NULL = 跟工作日一样)
- [ ] 委派 code-agent: child UI 完成按钮支持 "N 本" 输入
- [ ] 委派 code-agent: 后端按 weekday() 自动选 target_count
- [ ] 委派 code-agent: PM confirm 弹窗 (数清楚几本)
- [ ] 写 e2e: 工作日完成 2 本 → +2, 周末完成 4 本 → +2, 周末完成 2 本 → 0
- [ ] `git commit -m "feat(tasks): add target_count + weekend_target_count for reading tasks"`

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
- **举一反三 task** (用户 2026-06-06 简化):
  - 每天 1 本 = +1 min (单一奖励, 取消 1/2/3 章阶梯)
  - **每天都 track**, 不分工作日/周末 (周一-周日不间断)
- **老师投诉 task** (新机制, 跟睡眠一样是"扣分项"):
  - 默认 -20 min/次
  - PM 在 Admin UI 能调 (用户明示"我可以调")
  - 用户说"20 元起, 我可以调" → 我猜: 默认 -20 min, PM 在 UI 调到任意值
- ❓ **需要用户确认** (4 个, 老师投诉相关的):
  1. "20 元" 实际是 **-20 min** 还是 -20 个 token?  我建议 **-20 min** (跟游戏时间同一单位)
  2. 老师投诉是 PM 手动记, 还是小朋友自报? (我建议 **PM 手动**, 防止滥用)
  3. **一周内多次投诉累加吗?**  (我建议 **累加, 不封顶**, 你既然能"调", 应该是想多投诉多扣)
  4. PM 在 Admin UI 改 penalty 字段: 改后立即生效 (下次投诉按新值) 还是仅新 task 生效? (我建议 **立即生效**, 简单)
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
- **进度条 A (本月)**: 显示 "本月已完成 N / 100 任务" 进度条, 默认 **100/月** (用户 2026-06-06 拍板, 不要 1000 累计那么久)
- **进度条 B (当年)**: 显示 "本年已完成 N / 1200 任务" 进度条, 默认 **1200/年** (≈ 100 × 12 月)
- **进度条 C (当日)**: 显示 "今日 X / Y 任务" 进度条 (Y = 当日 active task 数), 100% 时触发**全屏撒花 + "Combo!" 文字**
- 三个进度条**位置**: child UI 主页**最显眼** (顶部, 占屏 1/2) — 当日最显眼, 本月次之, 当年放小一点
- **每月 1 号自动重置本月计数器**, 每年 1 月 1 号重置当年计数器
- **完全契合自驱力 3 件套**:
  - Autonomy: 当日进度条 让孩子自己看到 "今天还差几个"
  - Mastery: 本月 + 当年进度条 让孩子看到 "我越来越多"
  - Purpose: 每天做一点点, 月度年度都有可见进展
- **不需要新 schema**: 现有 `task_completions` 表 + 简单 `app_config` 加 `monthly_target_count` + `yearly_target_count` 字段
- ✅ **用户拍板** (2026-06-06):
  1. 本月目标 **100**, 当年目标 **1200**
  2. 撒花动效用 **CSS 粒子** (中等成本, 效果不错)
  3. 撒花触发 **每天 1 次** (避免刷屏, 也防止撤销后反复触发)
- 风险: 🟢 (纯前端 + 2 个 config 字段)

**Action Plan**:
- [ ] ~~用户拍板 3 个 Clarification 问题~~ ✅ 已拍板 (见上)
- [ ] 加 migration: `app_config` 表加 `monthly_target_count INTEGER DEFAULT 100` + `yearly_target_count INTEGER DEFAULT 1200` (如果表不存在, 创建)
- [ ] 委派 code-agent: child UI 顶部加 3 个进度条 (当日 / 本月 / 当年, 当日最显眼)
- [ ] 委派 code-agent: 100% 撒花动效 (CSS 粒子)
- [ ] 撒花 daily-once: localStorage 存 `lastConfettiAt` 戳, 跨天重置
- [ ] 委派 code-agent: 月度 / 年度计数器, 每月 1 号 + 每年 1 月 1 号重置 (用 cron trigger 或 lazy reset on read)
- [ ] 写 e2e: 完成最后一个 task → 当日进度条 100% → 撒花出现
- [ ] 写 e2e: 本月累计 50 → 本月进度条显示 50%
- [ ] 写 e2e: 跨月后本月进度条自动从 0 开始
- [ ] 写 e2e: 撤销最后一个 task → 撒花不再次触发 (daily-once 生效)
- [ ] `git commit -m "feat(child-ui): tri progress bars (daily / monthly / yearly) with CSS confetti"`

**Status**: ⏳ pending
**风险**: 🟢
**Started**: —
**Completed**: —
**Commit**: —

---


## 📦 归档 (已完成, 最近 30 天)

(完成时 PM Agent 移动到这里, 30 天后清掉, 完整历史在 git log)


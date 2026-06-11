# 金币系统 RFC（Request for Comments）

**版本:** v1.0 (draft)
**日期:** 2026-06-11
**作者:** Code Agent（代岑斐灏 / feihao 决策）
**状态:** 待用户最终确认
**目标读者:** 用户（产品负责人）、Code Agent（实施者）、Qual Agent（验收者）

> 本 RFC 是 kiddo-scoreboard v2 的第 3 个账户——**金币（coins）**——的设计规格。
> 在现有 🎮 游戏时间 + 💰 零花钱 之外，引入 🪙 金币作为"任务激励 + 商店兑换"的新维度。
> 配套 commit `fc0604b` 已经预留了第 3 个 balance card placeholder，本 RFC 把它从占位符变成真实功能。

---

## 1. 背景与目标

### 1.1 现状

kiddo-scoreboard v2 已经稳定运行 2 个并行账户：

| 账户 | 来源 | 用途 |
|------|------|------|
| 🎮 游戏时间 (game_time, 分钟) | 任务直接奖励 + PM 手动发周额度 + 双账户兑换 | 玩 Switch / iPad 游戏 |
| 💰 零花钱 (pocket_money, 元) | 任务直接奖励 + PM 手动发周额度 + 双账户兑换 | 实体商品 / 攒钱 |

**当前痛点（岑斐灏 v2.1 反馈）：**

1. **任务奖励"种类单一"**：现在每个任务只能往 game_time 或 pocket_money 其中一个账户加分，孩子感受不到"努力攒东西"的乐趣——游戏时间只是消耗品，零花钱是被动储蓄。
2. **游戏时间来源过于分散**：任务奖励 + PM 周额度 + 双账户兑换都能产出游戏时间，孩子对"怎么又多出 30 分钟"没有清晰认知。
3. **缺乏"中期目标"**：现在的奖励都是即时的（完成任务立刻给 30 分钟游戏），没有"攒 → 兑"的成长感。
4. **撤销逻辑不闭环**：撤销任务时游戏时间回收没问题，但"全完成 bonus"这种正向激励机制完全缺失。

### 1.2 目标

引入 **🪙 金币** 作为第 3 个账户：

- ✅ **任务完成激励**：每完成一个任务 +1 金币，给孩子持续正反馈（比"任务 → 30 分钟游戏"的二选一更轻量）。
- ✅ **全任务完成 bonus**：当天所有任务全部完成额外 +3 金币，奖励"坚持一整天"的努力。
- ✅ **金币商店**：攒够金币可以兑换游戏时间（10 金币 = 10 分钟游戏时间，每周限 3 次），让孩子体验"攒 → 兑"的成就感。
- ✅ **游戏时间来源收敛**：任务不再直接奖励游戏时间，**游戏时间只能通过金币兑换获得**。这样孩子的"游戏时间" = "他用努力换来的"，来源清晰可追溯。
- ✅ **撤销闭环**：撤销任务时同步回收金币 + bonus，保持账本严格守恒。

### 1.3 非目标（明确不做）

- ❌ 不做金币 → 零花钱的反向兑换（金币只换游戏时间，第一阶段只 1 件商品）
- ❌ 不做金币排行榜 / 多孩竞争（仍只 1 个 child，但 schema 要 support 多孩）
- ❌ 不做金币过期机制（金币永久有效，除非被撤销回收）
- ❌ 不做金币抽奖 / 概率玩法（确定性兑换，确定性反馈）
- ❌ 不做 push 通知（金币变化在 child UI 实时显示即可）

### 1.4 成功指标

| 指标 | 目标值 | 衡量方式 |
|------|--------|----------|
| 孩子每周主动兑换次数 | ≥ 2 次 | shop_redemptions 表 COUNT(week_of) |
| 全任务完成率 | 比 v2.1 提升 ≥ 20% | task_completions WHERE completed_date = 今天 AND status='active' |
| 撤销对账一致性 | 100%（无孤儿金币事件） | audit_log + score_events 联合校验 |
| 兑换操作延迟 | < 500ms | API 响应时间 |
| 孩子对金币系统满意度 | "好玩 / 想攒" | 主观反馈（岑斐灏观察） |

### 1.5 与现有系统的关系

```
                      ┌─────────────────────┐
                      │   任务完成 (task)   │
                      └──────────┬──────────┘
                                 │
                                 ▼
        ┌────────────────────────────────────────┐
        │  写入 task_completions (status=active) │
        └────────────┬───────────────────────────┘
                     │
        ┌────────────┴─────────────┬──────────────┐
        ▼                          ▼              ▼
  +1 🪙 金币           (未来) 任务分类        检查 bonus
  (score_events,        写入 game_time         条件
   type='coins')        或 pocket_money        │
        │                                       ▼
        │                              +3 🪙 金币 bonus
        │                              (如果今天所有
        │                               active 任务
        │                               都完成)
        ▼                                       │
   🪙 金币账户  ────── 兑换 ──────►  🎮 游戏时间账户
   (代数和)              10 coins          (+10 min)
                        / 周限 3 次
```

**关键变化**：

- ❌ **移除**：tasks.token_reward 字段不再写入 game_time score_event（v3 兼容开关关闭）
- ✅ **新增**：tasks → coins 1:1 写入（每个 active completion 触发 1 条 coins +1）
- ✅ **新增**：全任务完成 → bonus +3 coins（实时触发，最后一个任务完成时立刻判定）
- ✅ **新增**：shop_items + shop_redemptions 表 + /api/coins/exchange 端点

---

## 2. 需求清单

### 2.1 锁定需求（10 条，feihao 已拍板）

| # | 需求 | 关键决策 |
|---|------|---------|
| 1 | 商店架构预留扩展 | `shop_items` + `shop_redemptions` 两表分离，item.kind 字段预留多种商品类型 |
| 2 | 周定义 | 自然周，**ISO 8601** 格式 `YYYY-Www`，周一 00:00 (Asia/Shanghai) ~ 周日 23:59 |
| 3 | 任务全完成判定 | **严格**：当天 active 任务数 = 完成任务数，**请假/禁用任务不计** |
| 4 | UI 入口 | 第 3 个 balance card（替换 commit `fc0604b` 的灰色 placeholder），点击进商店页 |
| 5 | 不足/用完 UX | 按钮置灰 + 文案（"还差 X 金币" / "本周次数已用完，下周一重置"） |
| 6 | 兑换历史透明 | child UI 完整展示本周 + 历史兑换记录（含时间、商品名、消耗金币） |
| 7 | 游戏时间来源重构 | **只靠兑换**获得；任务不再直接奖励 game_time；历史 token_reward 事件保留不动 |
| 8 | bonus 发放时机 | 最后一个任务完成**立刻**发（实时反馈，不延迟到次日凌晨） |
| 9 | 任务撤销联动 | 撤销任务 → 回收金币 -1 + 回收 bonus -3（如果 bonus 已发） |
| 10 | 撤销后重做 | 撤销后孩子重新完成所有任务 → 再发一次 bonus（状态重置语义） |

### 2.2 边界 UX 细节

#### 余额不足 UX

```
商品卡片（10 金币 = 10 分钟游戏）：
┌──────────────────────────────────┐
│  🎮 游戏时间 10 分钟              │
│  💎 价格：10 金币                  │
│                                  │
│  [本周剩余: 3/3 次]               │
│                                  │
│  [🔒 还差 4 金币] (按钮置灰)      │
└──────────────────────────────────┘
```

文案规则：

- 当前金币 < 商品价格：`🔒 还差 X 金币`（X = 商品价格 - 当前金币）
- 当前金币 ≥ 商品价格：按钮可点，显示 `🎁 兑换 (+10 分钟游戏时间)`

#### 周次数用完 UX

```
┌──────────────────────────────────┐
│  🎮 游戏时间 10 分钟              │
│  💎 价格：10 金币                  │
│                                  │
│  [本周剩余: 0/3 次]               │
│                                  │
│  [⏰ 本周已用完，下周一重置] (置灰)│
└──────────────────────────────────┘
```

文案规则：

- 本周已兑换次数 ≥ 3：`⏰ 本周已用 X/3 次，下周一重置`
- 本周已兑换次数 < 3：正常显示剩余次数

#### 兑换成功后 UX

```
✅ 兑换成功！
   🎮 游戏时间 +10 分钟
   🪙 金币 -10
   ⏰ 本周剩余 2/3 次
   
   [查看兑换历史]  [继续逛商店]
```

#### bonus 发放反馈

孩子完成最后一个任务时，UI 弹出短提示（不阻塞，3 秒自动消失）：

```
🎉 全任务完成！+3 金币 bonus！
   🪙 当前金币：XX 金币
```

### 2.3 业务规则细节

#### 全任务完成判定算法

```sql
-- 判定当天是否所有 active 任务都完成
-- 输入: user_id, completed_date
-- 输出: TRUE / FALSE
SELECT
  (SELECT COUNT(*) FROM tasks
     WHERE is_active = 1)
  =
  (SELECT COUNT(*) FROM task_completions tc
     WHERE tc.user_id = ? 
       AND tc.completed_date = ?
       AND tc.status = 'active')
  AS is_all_complete;
```

注意：

- `is_active = 1` 的任务才算（PM 临时禁用的不计）
- `status = 'active'` 的完成才算（已撤销的不计）
- UNIQUE 约束保证每天每任务最多 1 条 active completion
- **不区分"请假"**：岑斐灏确认，v1 阶段不引入请假机制，PM 临时禁用任务即可表达"今天不要求做"

#### 撤销回收算法

```sql
-- 撤销任务时:
-- 1. 反向金币 -1 (总是执行)
INSERT INTO score_events (user_id, type, change_value, reason, status, submitted_by, source, source_ref, week_of)
  VALUES (?, 'coins', -1, 'revoke:task#' || ?, 'approved', 'pm', 'task', ?, ?);

-- 2. 检查今天是否曾发过 bonus (3 coins, reason LIKE 'bonus:%')
SELECT id FROM score_events 
  WHERE user_id = ? 
    AND type = 'coins' 
    AND change_value = 3 
    AND reason LIKE 'bonus:%' 
    AND source_ref = ?  -- ref = 'YYYY-MM-DD:user_id'
    AND status = 'approved';

-- 3. 如果找到 → 反向 -3 bonus
INSERT INTO score_events (user_id, type, change_value, reason, status, submitted_by, source, source_ref, week_of)
  VALUES (?, 'coins', -3, 'revoke:bonus:' || ?, 'approved', 'pm', 'task', ?, ?);
```

注意：

- 撤销回收走 `score_events` 写反向事件，**不修改**原事件（保留完整审计链）
- bonus 回收用 `source_ref = '<date>:<user_id>'` 标识，方便反查
- 如果撤销后孩子重做并再次全完成 → bonus 重新发放（状态重置语义）

#### 周限额校验

```sql
-- 检查本周已兑换次数
SELECT COUNT(*) FROM shop_redemptions
  WHERE user_id = ? 
    AND week_of = ?  -- '2026-W23'
    AND status IN ('active', 'consumed');

-- 如果 < 3 → 允许兑换
-- 如果 >= 3 → 拒绝，返回 429 或 UI 置灰
```

边界：

- 周一 00:00 (Asia/Shanghai) 严格重置
- ISO 周计算用 `date('now', 'localtime')` + JS 端 `Intl.DateTimeFormat` 双重保险
- 兑换成功后立刻写入 `shop_redemptions`，状态 = `consumed`（v1 简化，无 `pending` 状态）

### 2.4 不在 v1 范围

明确**不做**的功能（避免 scope creep）：

- 金币 → 零花钱兑换
- 金币排行榜 / 多孩对比
- 金币等级 / 称号系统
- 金币过期 / 衰减机制
- 商店多商品（v1 只 1 件：10 分钟游戏时间）
- PM 后台配置商品（v1 商品 hardcode 在 seed migration）
- 兑换审批流程（v1 直接兑换，不需要 PM 审批）
- 金币转账 / 赠送
- 历史 token_reward 数据迁移（明确"只对新生效，历史保留"）

---

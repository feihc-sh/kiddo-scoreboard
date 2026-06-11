# Coin System Test Plan

**Status:** Draft v1
**Date:** 2026-06-11
**Owner:** Code Agent (规划) → PM Agent 审 → Qual Agent 实施
**Audience:** Qual Agent (写 e2e spec) + PM (验收对照)
**Scope:** Coin System (RFC §1-§9) — 12 条验收 F1-F12 + 4 条数据守恒 INV-1..4 + 8 条额外 edge case
**Source of truth:** `docs/coin-system-rfc.md` §7 (验收清单) + `docs/PRD.md` §12 (v2.1 摘要)

---

## Table of Contents

1. [测试策略总览](#1-测试策略总览)
2. [验收 F1-F12 对应测试用例](#2-验收-f1-f12-对应测试用例)
3. [额外测试用例（超过 F1-F12 范围）](#3-额外测试用例超过-f1-f12-范围)
4. [数据准备 (Seed 脚本)](#4-数据准备-seed-脚本)
5. [Mock 策略](#5-mock-策略)
6. [验收对照表](#6-验收对照表)
7. [实施顺序](#7-实施顺序)
8. [风险与依赖](#8-风险与依赖)

---

## 1. 测试策略总览

### 1.1 测试分层

| 层级 | 工具 | 目的 | 跑速 | 占比目标 |
|------|------|------|------|---------|
| **Unit** | vitest + miniflare D1 | 纯函数 + 边界（ISO week、bonus 判定幂等、周限额 SQL、跨日守恒） | < 5s/文件 | 60% |
| **Integration (API)** | vitest + miniflare D1 + Hono app | 整条 API 路径（POST /api/coins/exchange 的 3 步短路校验 + db.batch） | < 30s/文件 | 30% |
| **UI e2e** | Playwright + wrangler pages dev + 真实 D1 local | child UI 第 3 个 card + 商店页 + 兑换 modal + 按钮置灰 + bonus toast | < 60s/spec | 10% |

**金字塔逻辑**：
- 业务逻辑（bonus 幂等、周限额计算、守恒不变量）→ **Unit**（覆盖 RFC §2.3 算法 + §3.4 INV-1..4）
- API 端点契约（status code、response schema、db.batch 原子性）→ **Integration**
- UI 状态（置灰文案、modal/toast、跳转路由）→ **UI e2e**

### 1.2 测试环境

| 环境 | 用途 | 启动命令 |
|------|------|---------|
| **D1 local** | Unit + Integration | vitest 自带 miniflare（沿用现有 `tests/unit/*.test.ts` 模式） |
| **wrangler pages dev** | UI e2e + 手动冒烟 | `wrangler pages dev ./public --port 8787 --d1=DB --local` |
| **真实 Cloudflare Pages dev**（可选） | iPad Safari 真机验证 | cf pages dev branch 部署 |

**数据隔离**：
- 每个 spec 跑前 `clearAllData()`（沿用 `tests/e2e/helpers/db.ts`）
- 不 truncate `users`（id=1 PM, id=2 child 由 seed 重建）
- delete `score_events`, `task_completions`, `audit_log`, `tasks`, `shop_redemptions`, `shop_items`（v1 seed 重建商品）

### 1.3 编号贯穿

| 来源 | 编号 |
|------|------|
| RFC §7 | F1..F12 (验收) |
| RFC §7 + §3.4 | INV-1..4 (数据守恒) |
| 本测试计划 | TC-Fx (验收对应) / TC-Xx (额外 edge case) |
| e2e spec | `test('F1: 任务完成 +1 金币', ...)` |
| Qual 报告 | 章节用 F1..F12 + INV-1..4 + TC-Xx |

### 1.4 验收对照原则

- 每条 F1-F12 → **至少 1 个 TC**（不能空跑验收）
- 每条 INV-1..4 → **至少 1 个 SQL CHECK 测试**（单独 `tests/e2e/coin-invariants.spec.ts`，参考 RFC §9 M5.2）
- 跨周（F8）→ **必须** Mock 时间（vi.setSystemTime 或直接 UPDATE `redeemed_at`）
- iPad Safari 视觉 → 手动 QA 列表（不在自动化范围，参考 §5 视觉类）

### 1.5 优先级

| 优先级 | 含义 | 包含 |
|--------|------|------|
| **P0** | 必须通过才能合并 | F1, F2, F3, F4, F5, F6, F7, F8 + INV-1..4 |
| **P1** | 高优先级，本周必须覆盖 | F9, F10, F11, F12 + TC-X1..X7 |
| **P2** | 性能/边界，本周尽量 | TC-X8 (1000+ redemption 性能) |

---

## 2. 验收 F1-F12 对应测试用例

> 格式参考 RFC §7 + 用户要求：Given/When/Then + 具体断言 + Edge case。
> 路径沿用项目现有约定：`tests/unit/<file>.test.ts` (vitest + D1 miniflare) 或 `tests/e2e/<file>.spec.ts` (Playwright)。

### TC-F1 任务完成 +1 金币

- **类型**: integration
- **位置**: tests/unit/me-tasks-complete-coin.test.ts (扩展现有 me-tasks-complete.test.ts 或新建)
- **步骤**:
  - **Given**: child user_id=2 登录态, 金币初始 = 0, 有 1 个 active 任务 (tasks.id=1, is_active=1)
  - **When**: POST /api/me/tasks/1/complete (cookie=child_session)
  - **Then**: 200 OK, response 含 `coins_balance: 1`, `bonus_awarded: false`
- **断言**:
  - DB: `SELECT SUM(change_value) FROM score_events WHERE user_id=2 AND type='coins' AND status='approved'` = 1
  - score_events 新增 1 条: type='coins', change_value=+1, source='task', source_ref='<task_completion_id>', reason='task:#1', submitted_by='child'
  - task_completions 新增 1 条: status='active', awarded_event_id 指向上面那条 score_event
  - **不再**写 type='game_time' / 'pocket_money' 的 task 奖励 event（RFC §8.4 确认）
- **Edge case**:
  - **撤销该任务** → 金币 -1 → balance = 0（覆盖 TC-F3）
  - **当天重复 complete 同一任务** → 409 (UNIQUE 约束 `idx_task_completions_user_task_date`，沿用现有行为)

### TC-F2 全任务完成 +3 bonus

- **类型**: integration
- **位置**: tests/unit/coin-bonus.test.ts (新建)
- **步骤**:
  - **Given**: child user_id=2, 金币 = 0, tasks 表有 3 个 is_active=1 的任务, 今日已 complete task#1 + task#2 (各 +1, 共 +2 coins, 无 bonus)
  - **When**: POST /api/me/tasks/3/complete (完成第 3 个)
  - **Then**: 200 OK, response 含 `coins_balance: 5` (+1 任务 + +3 bonus), `bonus_awarded: true`
- **断言**:
  - DB: 3 条 task completions 全部 status='active'
  - score_events 新增 2 条: (a) +1 coins (task#3) (b) +3 coins (bonus), reason='bonus:<today>:2', source_ref='<today>:2', submitted_by='system'
  - 全过程 1 次原子（不能在 +1 后崩了而漏掉 bonus）→ 通过单条 db.batch 事务保证
- **Edge case**:
  - **幂等性**: 同一请求并发 2 次 → 只发 1 次 bonus（用 `source_ref = '<today>:2'` 唯一标识）
  - **跨日不重复**: 周日完成 3 个任务发 bonus → 周一完成 3 个任务**再**发 bonus（不同 source_ref）
  - **少于任务总数**: 只完成 2/3 → 不发 bonus（balance 只 +2, 没有 +3）

### TC-F3 撤销任务回收 -1 金币

- **类型**: integration
- **位置**: tests/unit/admin-task-completions-coin.test.ts (新建)
- **步骤**:
  - **Given**: F1 状态 (金币 = 1, task_completion#X status='active', awarded_event_id=E1)
  - **When**: POST /api/admin/task-completions/X/revoke (cookie=pm_session)
  - **Then**: 200 OK, response 含 `new_balance: { coins: 0, game_time: <不变> }`
- **断言**:
  - DB: `task_completions.status = 'revoked'`, `revoked_at = <now>`, `revoked_by = 1` (PM id)
  - score_events 新增 1 条: type='coins', change_value=-1, reason='revoke:task#1', source='task', source_ref='X', submitted_by='pm'
  - 金币余额: SUM(coins) = 0 (守恒)
- **Edge case**:
  - **撤销已撤销的 task** → 409 (现有 `revoke_idempotent` 行为)
  - **撤销非今日的 task** (历史 completion) → 仍写反向 -1，但 week_of = 当前周 (RFC §8.1)

### TC-F4 撤销任务回收 bonus -3（如果 bonus 已发）

- **类型**: integration
- **位置**: tests/unit/coin-bonus-revoke.test.ts (新建)
- **步骤**:
  - **Given**: F2 状态 (金币 = 5, 当天已发 +3 bonus, score_events 里有 +3 coins, reason='bonus:<today>:2')
  - **When**: POST /api/admin/task-completions/<任意一个 TC id>/revoke
  - **Then**: 200 OK, 金币 = 1 (= 5 - 1 任务 - 3 bonus)
- **断言**:
  - score_events 新增 2 条 (F3 的 -1 + 新增 -3 bonus):
    - (a) type='coins', change_value=-1, reason='revoke:task#X'
    - (b) type='coins', change_value=-3, reason='revoke:bonus:<today>:2', source_ref='<原 bonus event_id>'
  - 金币余额: SUM(coins WHERE user_id=2) = 1 (守恒)
- **Edge case**:
  - **bonus 未发场景**: 完成 1/3 任务 → 撤销该任务 → 只 -1 (没有 bonus 可回收)
  - **bonus 已被反向过**: F4 后再撤销同 TC → bonus 检查不存在 → 只 -1 (不重复 -3)
  - **跨周撤销** (RFC §8.1): 周一发 bonus, 周二撤销 → bonus 仍能反查到（source_ref 不依赖 week_of）

### TC-F5 撤销后重做再发 bonus

- **类型**: integration
- **位置**: tests/unit/coin-bonus-reissue.test.ts (新建)
- **步骤**:
  - **Given**: F4 状态 (金币 = 1, 已撤销 TC#1 + bonus, score_events: +1 → +1 → +3 → -1 → -3 = +1 净)
  - **When**:
    1. child 重新 POST /api/me/tasks/1/complete → 期望 +1 coins (金币 = 2)
    2. child 重新 POST /api/me/tasks/2/complete → 期望 +1 coins (金币 = 3)
    3. child 重新 POST /api/me/tasks/3/complete → 期望 +1 + +3 bonus (金币 = 7)
  - **Then**: 最终金币 = 7, score_events 中今天关于 bonus 的累计: +3 → -3 → +3 = 净 +3（守恒）
- **断言**:
  - score_events 新增 4 条 (重做 3 个任务的 +1 + 1 个新 bonus 的 +3)
  - 幂等检查通过: 当天 source_ref='<today>:2' 的 +3 coins status='approved' 只有 1 条（最后那条）
  - **INV-2 检查**: 同 source_ref 的 ±3 配对总和 = +3（净 +3）
- **Edge case**:
  - **快速重做**: 撤销 + 立刻重做（不跨日）→ bonus 再发（不卡顿）
  - **部分重做**: 只重做 1 个任务 → 不触发 bonus 判定（仍是 1/3 完成）
  - **不重做就再撤销另一个**: F4 后撤销 TC#2 → 只 -1（不重复 bonus，因为 bonus 已被反向）

### TC-F6 兑换扣金币 + 加游戏时间

- **类型**: integration
- **位置**: tests/unit/shop-exchange.test.ts (新建)
- **步骤**:
  - **Given**: child 金币 = 15, 游戏时间 = 0, 本周未兑换, shop_items 表有 id=1 (cost=10, reward=10 game_time, weekly_limit=3)
  - **When**: POST /api/coins/exchange { item_id: 1 }
  - **Then**: 200 OK, response: `{ redemption_id: 1, item: {...}, new_balance: { coins: 5, game_time: 10 }, weekly_remaining: 2 }`
- **断言**:
  - score_events 新增 2 条 (db.batch 原子):
    - (a) type='coins', change_value=-10, reason='exchange:item#1', source='exchange', submitted_by='child', week_of='<current>'
    - (b) type='game_time', change_value=+10, reason='exchange:item#1', source='exchange', submitted_by='system', week_of='<current>'
  - shop_redemptions 新增 1 条: status='consumed', coin_event_id=E_a, reward_event_id=E_b, week_of='<current>'
  - INV-3 检查: SUM(shop_redemptions.cost_coins WHERE status='consumed') = -SUM(coins events WHERE source='exchange')
  - INV-4 检查: SUM(shop_redemptions.reward_value) = SUM(game_time events WHERE source='exchange')
- **Edge case**:
  - **item 不存在**: item_id=999 → 400 `invalid_item_id`, 无任何写入
  - **item 禁用**: is_active=0 → 400 `invalid_item_id`, UI 不展示
  - **金币不足** (TC-F9 后端版本): 金币=5, item=10 → 400 `insufficient_coins`, 无写入
  - **db.batch 中途失败** (TC-X7): 模拟第 2 条 SQL 失败 → 全部回滚, score_events 不留脏数据

### TC-F7 周限额 3 次

- **类型**: integration
- **位置**: tests/unit/shop-exchange-weekly-limit.test.ts (新建)
- **步骤**:
  - **Given**: child 金币 = 100 (够 3 次), shop_items.weekly_limit=3, 本周 (week_of='2026-W24') 已成功兑换 2 次 (shop_redemptions 有 2 条 status='consumed')
  - **When**:
    - **Step 1**: POST /api/coins/exchange { item_id: 1 } → 期望 200, weekly_remaining: 0
    - **Step 2**: POST /api/coins/exchange { item_id: 1 } (第 4 次) → 期望 429 `weekly_limit_reached`
  - **Then**:
    - Step 1: shop_redemptions 本周累计 = 3, weekly_remaining = 0
    - Step 2: API 返 429 + 错误码 `weekly_limit_reached` + 详细 `{ used: 3, limit: 3 }`, 数据库无任何写入（事务回滚）
- **断言**:
  - DB: `SELECT COUNT(*) FROM shop_redemptions WHERE user_id=2 AND week_of='2026-W24' AND status='consumed'` = 3 (Step 1 后)
  - Step 2 失败后: shop_redemptions 仍是 3 条, score_events 没有新增 exchange 事件
- **Edge case**:
  - **前端绕过**: F10 UI 置灰 + TC-X2 race 同时测
  - **跨周** (TC-X1): 第 4 次失败 → 跨周 → 第 4 次成功
  - **item.weekly_limit=0**: 无限兑换 → Step 2 仍 200 (item 配置变种)
  - **第 3 次刚好用完**: 边界值, 不允许第 4 次 (≥, 不是 >)

### TC-F8 跨周自动重置

- **类型**: integration
- **位置**: tests/unit/shop-exchange-week-reset.test.ts (新建)
- **步骤**:
  - **Given**:
    - child user_id=2, 当前 mock 时间 = 2026-W23 周日 23:59:00 (Asia/Shanghai)
    - 本周 (week_of='2026-W23') 已兑换 3 次 (用完)
    - 金币 = 5
  - **When**:
    - **Step 1**: 验证 GET /api/coins/balance → `{ coins: 5, weekly_remaining: 0, week_of: '2026-W23' }`
    - **Step 2**: vi.setSystemTime(new Date('2026-06-08T16:00:01Z')) (Asia/Shanghai 2026-06-09 00:00:01)
    - **Step 3**: GET /api/coins/balance → `{ coins: 5, weekly_remaining: 3, week_of: '2026-W24' }`
    - **Step 4**: POST /api/coins/exchange { item_id: 1 } → 200 (金币够 + 周限额重置)
- **断言**:
  - Step 3: `week_of` = '2026-W24', `shop_redemptions WHERE week_of='2026-W24'` COUNT = 0
  - Step 4: weekly_remaining = 2 (用掉 1 次), shop_redemptions 新增 1 条 week_of='2026-W24'
- **Edge case**:
  - **跨周撤销** (TC-X3): 周一发 bonus → 周二撤销 → bonus 仍能找到并回收 (source_ref 跟 week_of 解耦)
  - **边界时间**: 周日 23:59:59 vs 周一 00:00:00 (差 1 秒) → week_of 翻转正确
  - **时区差异**: 测试环境 TZ=UTC 时, ISO week 计算要用 Asia/Shanghai 转换（RFC §2.3 明确）

### TC-F9 按钮置灰（余额不足）

- **类型**: UI e2e (Playwright)
- **位置**: tests/e2e/shop-ui-coin-balance.spec.ts (新建)
- **步骤**:
  - **Given**: child 金币 = 5, 商品 id=1 价格 10 金币, 已登录 child SPA, 打开 /shop
  - **When**: 页面加载完成 (等待 #shop-item-1 渲染)
  - **Then**:
    - 商品 card 的兑换按钮文案 = "🔒 还差 5 金币"
    - 按钮 `disabled` 属性存在
    - 按钮 computed style: `opacity: 0.5`, `cursor: not-allowed`
    - 点击按钮 → 不触发 POST /api/coins/exchange
- **断言**:
  - DOM: `[data-testid="exchange-btn-1"][disabled]` 存在, 文本匹配 `🔒 还差 5 金币`
  - Network: 没有 `/api/coins/exchange` 请求被发出 (用 page.on('request') 监听)
  - **API 校验**: 即使前端绕过, 用 `request.post('/api/coins/exchange', { item_id: 1 })` → 400 `insufficient_coins`
- **Edge case**:
  - **金币刚好够**: 金币 = 10, 按钮文案 = "🎁 兑换 (+10 分钟游戏时间)" (可点)
  - **金币 0**: 金币 = 0, 文案 = "🔒 还差 10 金币"
  - **金币 > 价格**: 金币 = 15, 文案正常, 兑换后金币 = 5

### TC-F10 按钮置灰（周次数用完）

- **类型**: UI e2e
- **位置**: tests/e2e/shop-ui-weekly-limit.spec.ts (新建)
- **步骤**:
  - **Given**: child 金币 = 100 (够), 本周 (week_of='2026-W24') 已兑换 3 次 (直接 INSERT shop_redemptions 或先跑 3 次 exchange API)
  - **When**: 打开 /shop
  - **Then**:
    - 兑换按钮文案 = "⏰ 本周已用 3/3 次，下周一重置"
    - 按钮 `disabled`
    - "本周剩余: 0/3 次" 显示
- **断言**:
  - DOM: `[data-testid="exchange-btn-1"][disabled]` 存在
  - DOM: `[data-testid="weekly-remaining"]` 文本 = "0/3 次"
  - **API 校验**: 用 API 直接 POST /api/coins/exchange → 429 `weekly_limit_reached`, response 含 `{ used: 3, limit: 3 }`
- **Edge case**:
  - **金币不足 + 周次数用完** (复合态): 显示哪个? 优先级 → "🔒 还差 X 金币" (金币问题优先, RFC §2.2 隐含)
  - **刚跨周** (TC-F8 + TC-X1): 时间推进后按钮恢复可点, 文案变正常

### TC-F11 兑换历史展示

- **类型**: UI e2e
- **位置**: tests/e2e/shop-ui-history.spec.ts (新建)
- **步骤**:
  - **Given**: child 本周 (week_of='2026-W24') 兑换过 2 次, 历史 (上周及更早) 共 5 次, 总共 7 条 shop_redemptions (status='consumed')
  - **When**: 打开 /shop
  - **Then**:
    - "本周兑换历史" 区域显示 2 条 (最新在上)
    - "历史兑换" 区域显示最近 30 条 (此处 5 条, 因为其他 2 条是本周)
    - 每条记录字段: 时间 (YYYY-MM-DD HH:mm Asia/Shanghai), 商品图标+名称, 消耗金币, 状态
- **断言**:
  - DOM: `[data-testid="week-history"] [data-testid="history-item"]` count = 2
  - DOM: `[data-testid="all-history"] [data-testid="history-item"]` count = 5
  - 第一条 (最新): 时间格式匹配 `/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/`, 文本含 "🎮" + "游戏时间 10 分钟" + "-10🪙"
  - 时间倒序: 第 1 条的 redeemed_at > 第 2 条的 redeemed_at
- **Edge case**:
  - **空状态**: child 从未兑换 → 两个区域都显示 "暂无兑换记录"
  - **历史超 30 条**: seed 31 条 → 只显示 30 条 (LIMIT 30)
  - **跨时区**: UTC 23:00 vs Asia/Shanghai 07:00 (次日) → 时间显示按 Asia/Shanghai 转换
  - **状态过滤**: shop_redemptions.status='revoked' (如果有撤销功能) → UI 不展示 (只显示 consumed)

### TC-F12 第 3 个 balance card 显示 + 跳转

- **类型**: UI e2e
- **位置**: tests/e2e/coin-balance-card.spec.ts (新建, 可合并到 smoke-child-main.spec.ts)
- **步骤**:
  - **Given**: child 已完成 F1 (金币 = 1), 打开 / (首页)
  - **When**: 页面加载完成 (等待 3 个 .balance-card 渲染)
  - **Then**:
    - 第 3 个 `.balance-card` 是 `.coins` (不是 `.placeholder`)
    - 第 3 个 card 图标 = "🪙", 标签 = "金币", 数字 = "1" (从 /api/coins/balance)
    - 第 3 个 card 有 `cursor: pointer`, hover 时 transform: translateY(-2px)
    - **不再是 fc0604b 灰色 placeholder** (无 `opacity: 0.45`, 无 `pointer-events: none`)
- **断言**:
  - DOM: `[data-testid="coins-card"]` 存在, 文本含 "金币" 和 "1"
  - DOM: 元素无 `.placeholder` class
  - CSS: getComputedStyle 第 3 个 card → cursor = 'pointer', backgroundImage 包含金色 gradient
- **Then** (跳转):
  - 点击第 3 个 card → URL 变为 /shop
  - 商店页加载 (等待 #shop-root 元素)
- **断言**:
  - URL: `page.url()` 匹配 `/\/shop$/`
  - Network: GET /api/shop/items 返回 200
- **Edge case**:
  - **金币为 0**: 第 3 个 card 仍显示 "🪙 0" (不隐藏)
  - **API 失败**: /api/coins/balance 500 → 第 3 个 card 显示 "--" + 错误 toast
  - **iPad Safari 真机**: 触摸点击 vs 桌面点击事件, 都应触发跳转 (参考 RFC §6.6 mobile 适配)

---

## 3. 额外测试用例（超过 F1-F12 范围）

> 覆盖 RFC §8 风险与边界 + 用户要求的 8 条 edge case。每条独立 TC，可单独 fail/pass。

### TC-X1 跨周重置：周日 23:59 兑换 → 周一 00:00 限额重置

- **类型**: integration
- **位置**: tests/unit/shop-exchange-week-reset-edge.test.ts (或合并到 TC-F8)
- **步骤**:
  - **Given**:
    - child user_id=2, 当前时间 = 2026-06-08 (周日, ISO week 2026-W23) 23:59:30 Asia/Shanghai
    - 本周 (W23) 已兑换 3 次 (用完 weekly_limit)
    - 金币 = 50
  - **When**:
    - **Step 1**: 确认 GET /api/coins/balance → weekly_remaining: 0, week_of: '2026-W23'
    - **Step 2**: 推进时间到 2026-06-09 (周一) 00:00:01 Asia/Shanghai (vi.setSystemTime)
    - **Step 3**: GET /api/coins/balance → weekly_remaining: 3, week_of: '2026-W24'
    - **Step 4**: POST /api/coins/exchange → 200, weekly_remaining: 2, week_of: '2026-W24'
- **断言**:
  - shop_redemptions 表 Step 4 新增 1 条 week_of='2026-W24'
  - W23 那 3 条不变, 不被改写 (历史保留, RFC §8.4)
  - 金币 = 50 - 10 = 40
- **Edge case**:
  - **差 1 秒**: 周日 23:59:59 vs 周一 00:00:00 → ISO week 翻转正确 (用 `Intl.DateTimeFormat` 验证)
  - **跨年**: W52 → W01 (e.g., 2026-12-28 周一 → 2027-01-04 周一)
  - **兑换时正好跨周**: 极端 case → 简化处理：用插入时的 week_of (RFC §4.4 spec)

### TC-X2 周次数 race：同时 2 个 POST /api/coins/exchange，第 4 个返回 429

- **类型**: integration
- **位置**: tests/unit/shop-exchange-race.test.ts (新建)
- **步骤**:
  - **Given**: child 金币 = 100, 本周 (W24) 已兑换 2 次 (shop_redemptions count = 2)
  - **When**:
    - **Step 1**: 用 `Promise.all` 并发发起 2 个 POST /api/coins/exchange 请求
    - **Step 2**: 验证结果: 1 个 200 OK (第 3 次成功), 1 个 429 weekly_limit_reached
  - **Then**:
    - shop_redemptions 本周累计 = 3 (D1 串行化保证)
    - 没有第 4 次写入 (race 后查 COUNT 应是 3)
- **断言**:
  - 并发响应: 1×200 + 1×429
  - DB: `SELECT COUNT(*) FROM shop_redemptions WHERE user_id=2 AND week_of='2026-W24' AND status='consumed'` = 3 (并发后)
  - score_events 没有新增第 4 条 coins=-10 (失败回滚)
- **Edge case**:
  - **3 个并发**: 当前 2 次已用 → 并发 3 次 → 1×200 + 2×429 (第 4/5 次被拒)
  - **D1 串行验证**: 用 miniflare 看 batch 执行顺序 (debug log 验证)
  - **前端 disabled**: 即使按钮在 race 中 disabled, 用户点 2 次 → 至少 1 个 429 (RFC §8.2 防护)

### TC-X3 跨周撤销：周一发 bonus → 周二撤销 → bonus 仍能找到并回收

- **类型**: integration
- **位置**: tests/unit/coin-bonus-cross-week-revoke.test.ts (新建)
- **步骤**:
  - **Given**:
    - 时间 = 2026-06-08 (周日) 23:59:00 Asia/Shanghai (W23 即将结束)
    - child 完成当天 3 个任务 → 发 +3 bonus (source_ref='2026-06-08:2', week_of='2026-W23')
    - 金币 = 4 (3 + 1 task, 或 3 tasks + 1 bonus 视 task 数量)
    - shop_items 表无商品
  - **When**:
    - **Step 1**: vi.setSystemTime 推进到 2026-06-09 (周一) 00:01:00 Asia/Shanghai (W24)
    - **Step 2**: PM 撤销 2026-06-08 的 TC (POST /api/admin/task-completions/<id>/revoke)
  - **Then**:
    - 新增 2 条 score_events: -1 (任务) + -3 (bonus 反向)
    - 反向 -3 bonus 的 source_ref = <原 bonus event_id>, reason='revoke:bonus:2026-06-08:2', week_of='2026-W24' (当前周)
    - 金币: SUM = 0 (净 0, 守恒)
- **断言**:
  - INV-2 检查: 同 source_ref='<原 bonus id>' 的 SUM(change_value) = 0 (+3 + -3 = 0)
  - 跨周查询: 即使原 bonus 在 W23, 撤销在 W24 → 仍能找到
  - audit_log 写一条 action='revoke_task_completion', details 含 coin_event_id + bonus_event_id
- **Edge case**:
  - **撤销时 W23 已结束**: 验证 week_of = W24 (操作周), 但 reason/source_ref 保留 W23 信息
  - **bonus 已多次反向**: 极端 case (撤销 + 重做 + 再撤销) → 每次 source_ref 不变, ±3 配对守恒
  - **跨月**: W23 是 6 月初, W24 仍在 6 月 → 跨月不跨周也要测

### TC-X4 bonus 重复触发：撤销后重新完成所有任务 → bonus 再发 +3

- **类型**: integration
- **位置**: tests/unit/coin-bonus-reissue-after-revoke.test.ts (新建) 或合并到 TC-F5
- **步骤**:
  - **Given**: TC-F4 状态 (金币 = 1, 已撤销 TC#1 + bonus, 当天已无 status='approved' 的 +3 bonus)
  - **When**:
    - **Step 1**: child 重新 POST /api/me/tasks/1/complete → +1 coins (金币 = 2)
    - **Step 2**: child 重新 POST /api/me/tasks/2/complete → +1 coins (金币 = 3)
    - **Step 3**: child 重新 POST /api/me/tasks/3/complete → +1 coins + +3 bonus (金币 = 7)
  - **Then**: bonus 再发 1 次, 同 source_ref='<today>:2' 的 +3 coins status='approved' = 1 条 (最后那条)
- **断言**:
  - score_events 中今天关于 bonus 的累计: +3 → -3 → +3 = 净 +3 (守恒)
  - 幂等检查通过: 反向 -3 后, 再发 +3 时 source_ref 没冲突 (因为前一条 +3 已被反向, 不存在 status='approved' 的同 source_ref +3)
  - INV-2 检查: 同 source_ref 的 ±3 配对: (+3 + -3 + +3) = +3 净
- **Edge case**:
  - **同一天内多次撤销 + 重做**: 撤销 TC#1 → 重做 → 再撤销 TC#2 → 重做 → bonus 每次都重新判定
  - **时间压缩**: 完成 → 撤销 → 完成 (秒级) → 不应有 deadlock 或 race
  - **DB 锁**: miniflare 单库串行 → 无死锁, 但要确认 (RFC §4.4 "D1 单库串行")

### TC-X5 历史 token_reward 保留：现有 type='game_time' 的 score_events 不被新逻辑影响

- **类型**: integration
- **位置**: tests/unit/coin-history-token-reward.test.ts (新建)
- **步骤**:
  - **Given**:
    - 手工 INSERT 历史数据 (RFC §8.4 提到的历史 token_reward 场景):
      ```sql
      INSERT INTO score_events (user_id, type, change_value, reason, status, submitted_by, source, source_ref, week_of)
        VALUES (2, 'game_time', 30, 'task:#1', 'approved', 'system', 'task', 'legacy-1', '2025-W30');
      INSERT INTO score_events (user_id, type, change_value, reason, status, submitted_by, source, source_ref, week_of)
        VALUES (2, 'game_time', 60, 'task:#2', 'approved', 'system', 'task', 'legacy-2', '2025-W31');
      ```
    - child user_id=2 当前金币 = 0 (新系统启用前的状态)
  - **When**:
    - **Step 1**: child 完成 1 个任务 (新系统启用后)
    - **Step 2**: GET /api/public/balance (或现有 game_time balance API) → 应返回 90 (30+60)
    - **Step 3**: GET /api/coins/balance → 应返回 1 (只算 type='coins')
  - **Then**:
    - 历史 game_time events 不变 (status='approved', week_of='2025-W30/31')
    - 新写的 +1 coins event 独立 (type='coins', source='task')
    - 两个账户互不干扰
- **断言**:
  - DB: `SELECT SUM(change_value) FROM score_events WHERE user_id=2 AND type='game_time' AND status='approved'` = 90 (历史 + 未来兑换 不混淆)
  - DB: `SELECT SUM(change_value) FROM score_events WHERE user_id=2 AND type='coins' AND status='approved'` = 1 (新系统)
  - tasks.token_reward 字段保留 (即使代码忽略)
- **Edge case**:
  - **migration 升级**: 跑 0007_coin_system.sql 后, 历史数据完整保留 (D1 表重建无数据丢失)
  - **查询聚合**: 用 `WHERE type IN ('game_time', 'coins')` 应返回所有余额 (向后兼容)
  - **撤销历史 task_completion**: 即使 task 是旧的, 撤销时只写反向 -1 coins (新逻辑), 不动历史 game_time event

### TC-X6 多孩隔离（未来扩展）：不同 user_id 金币余额独立

- **类型**: integration
- **位置**: tests/unit/coin-multi-user-isolation.test.ts (新建, 但 v1 可能 skip, 仅作 schema 验证)
- **步骤**:
  - **Given**:
    - 手工 seed 2 个 child user: user_id=2 (kid A) + user_id=3 (kid B)
    - kid A 金币 = 5, kid B 金币 = 3 (独立 score_events)
    - API 默认取当前 child (v1 是 id=2, RFC §8.5 提到)
  - **When**:
    - **Step 1**: kid A 完成 1 任务 → POST /api/me/tasks/1/complete (kid A 登录)
    - **Step 2**: GET /api/coins/balance (kid A) → 6
    - **Step 3**: GET /api/coins/balance (kid B 模拟登录) → 3 (没动)
  - **Then**: 各自余额独立, shop_redemptions 按 user_id 隔离
- **断言**:
  - DB: `SELECT SUM(change_value) FROM score_events WHERE user_id=2 AND type='coins'` = 6
  - DB: `SELECT SUM(change_value) FROM score_events WHERE user_id=3 AND type='coins'` = 3
  - DB: `SELECT COUNT(*) FROM shop_redemptions WHERE user_id=2` = A 的次数
  - 周限额也按 user_id: kid A 的 weekly_limit 不影响 kid B
- **Edge case**:
  - **bonus source_ref 隔离**: kid A 的 bonus source_ref='<date>:2', kid B 的 = '<date>:3' → 不会冲突
  - **v1 范围**: 这个 TC 是 schema 验证 + 预留测试, v1 UI 只显示 kid A, 实际跑可能因缺少多孩登录而 skip
  - **FK 完整性**: 删除 user → score_events 用 ON DELETE CASCADE? (看现有 schema, 应是 RESTRICT)

### TC-X7 兑换失败回滚：余额不足时 db.batch() 原子回滚，score_events 不留脏数据

- **类型**: integration
- **位置**: tests/unit/shop-exchange-atomicity.test.ts (新建)
- **步骤**:
  - **Given**:
    - child 金币 = 5, 商品价格 = 10
    - 监控 score_events 当前 COUNT (前置基线 N)
  - **When**: POST /api/coins/exchange { item_id: 1 } → 期望 400 `insufficient_coins`
  - **Then**:
    - score_events COUNT 仍是 N (无新写入)
    - shop_redemptions COUNT 不变
- **断言**:
  - DB: `SELECT COUNT(*) FROM score_events WHERE user_id=2` = N
  - DB: `SELECT COUNT(*) FROM shop_redemptions WHERE user_id=2` = 0
  - 金币余额不变 (5)
- **Edge case**:
  - **item 不存在** (id=999): 400 invalid_item_id, 无写入
  - **item 禁用** (is_active=0): 400 invalid_item_id, 无写入
  - **周次数用完**: 429 weekly_limit_reached, 无写入 (与 TC-F7 互补)
  - **db.batch 中途失败** (模拟第 2 条 SQL throw): 用 miniflare monkey-patch D1.prepare 模拟, 验证 batch 原子回滚
  - **网络中断**: client abort 后 server 应清理 (D1 batch 已结束, 无副作用)

### TC-X8 shop_redemptions 索引性能：大数据量（1000+ redemption）下周限额查询 < 50ms

- **类型**: integration + perf
- **位置**: tests/unit/shop-redemption-index-perf.test.ts (新建)
- **步骤**:
  - **Given**:
    - child user_id=2
    - seed 1000 条 shop_redemptions (跨多周, 但本周 = '2026-W24' 只有 3 条 consumed)
  - **When**:
    - **Step 1**: 执行周限额查询 SQL 100 次, 计时
      ```sql
      SELECT COUNT(*) FROM shop_redemptions
        WHERE user_id = 2 AND week_of = '2026-W24' AND status = 'consumed';
      ```
    - **Step 2**: 执行历史查询 100 次, 计时
      ```sql
      SELECT * FROM shop_redemptions
        WHERE user_id = 2 AND status = 'consumed'
        ORDER BY redeemed_at DESC LIMIT 30;
      ```
  - **Then**:
    - Step 1 平均耗时 < 50ms (命中 idx_redemptions_user_week)
    - Step 2 平均耗时 < 100ms (命中 idx_redemptions_user_redeemed)
- **断言**:
  - 用 `performance.now()` 在每个 query 前后计时, 计算平均 + p95
  - EXPLAIN QUERY PLAN 验证走索引:
    - Step 1: `USING INDEX idx_redemptions_user_week`
    - Step 2: `USING INDEX idx_redemptions_user_redeemed`
  - 不做表扫描 (SCAN TABLE)
- **Edge case**:
  - **不命中索引**: 故意写一个不带 user_id 的查询 → 验证 fallback 慢路径 (仅做对照, 不在 perf 范围)
  - **1000 条 vs 10000 条**: 跑 2 个量级, 看线性增长
  - **冷启动**: 第一次查询可能慢 (page cache), 排除第一次

---

## 4. 数据准备 (Seed 脚本)

> 用于 Integration + UI e2e 的快速 fixture 准备。脚本放在 `scripts/seed-coin-system-test.sh`，由 `tests/unit/*` / `tests/e2e/*` 在 `beforeAll` 调用。

### 4.1 脚本接口设计

```bash
# 用法
./scripts/seed-coin-system-test.sh [scenario]
# scenario: minimal | standard | history-heavy | cross-week | multi-week
# 默认: standard

# 输出 (stdout JSON)
{"pm_id":1,"child_id":2,"task_ids":[1,2,3],"item_id":1,"fixture":"standard"}
```

### 4.2 Standard 场景伪代码 (覆盖 F1-F5 + F6-F8 大部分)

```bash
#!/usr/bin/env bash
set -e

# 1. clean
wrangler d1 execute DB --local --command "DELETE FROM score_events; DELETE FROM task_completions; DELETE FROM audit_log; DELETE FROM shop_redemptions; DELETE FROM shop_items; DELETE FROM tasks WHERE id > 0;"

# 2. seed users (id=1 PM, id=2 child, 沿用 0001_initial)
# 假设已有: PM (id=1, pin=123654), Child (id=2, name='test-kid')

# 3. seed 3 active tasks (不同 category)
wrangler d1 execute DB --local --command "
  INSERT INTO tasks (id, name, category, is_active, sort_order, token_reward, created_at, updated_at)
  VALUES 
    (1, '刷牙', 'health', 1, 1, 0, unixepoch(), unixepoch()),
    (2, '整理书包', 'study', 1, 2, 0, unixepoch(), unixepoch()),
    (3, '阅读 20 分钟', 'study', 1, 3, 0, unixepoch(), unixepoch());
"

# 4. seed 1 shop_item (RFC §3.2 spec)
wrangler d1 execute DB --local --command "
  INSERT INTO shop_items (name, kind, cost_coins, reward_value, reward_type, description, icon, sort_order, weekly_limit)
  VALUES ('游戏时间 10 分钟', 'game_time', 10, 10, 'game_time', '用 10 金币兑换 10 分钟游戏时间', '🎮', 1, 3);
"

# 5. seed 5 天历史 (RFC §8.4 提到的历史 token_reward)
# 每天随机完成 0-3 个任务 + 1-2 次兑换
# (实际用 SQL 静态 seed, 不用真随机, 保证可复现)
wrangler d1 execute DB --local --file=./fixtures/coin-5day-history.sql

# fixtures/coin-5day-history.sql 内容 (示例, 5 天):
# - day1 (W22): 0 tasks, 0 exchange
# - day2 (W22): 2 tasks, 1 exchange
# - day3 (W22): 3 tasks + bonus, 0 exchange
# - day4 (W23): 1 task, 0 exchange  
# - day5 (W23): 3 tasks + bonus, 1 exchange

# 6. 输出 fixture 元数据
echo '{"pm_id":1,"child_id":2,"task_ids":[1,2,3],"item_id":1,"fixture":"standard","days_seeded":5}'
```

### 4.3 其他场景 (按需)

| Scenario | 用例 | 触发条件 |
|----------|------|---------|
| `minimal` | 只 seed users + 3 tasks + 1 item, 无历史 | TC-F1, F2, F3, F4, F5 (干净状态) |
| `standard` | minimal + 5 天历史 | 多数 TC 默认 |
| `history-heavy` | standard + 1000+ shop_redemptions | TC-X8 性能测试 |
| `cross-week` | minimal + 周日 23:59 兑换数据 | TC-X1, TC-F8 |
| `multi-week` | minimal + 跨 3 周历史 | TC-F8 周限额隔离 |
| `multi-user` | minimal + 2 个 child | TC-X6 (v1 预留) |
| `legacy-token` | minimal + 旧 game_time events | TC-X5 |

### 4.4 关键 fixture 文件

```
scripts/
├── seed-coin-system-test.sh           # 主入口 (调用 wrangler d1 execute)
├── fixtures/
│   ├── coin-minimal.sql                # users + 3 tasks + 1 item
│   ├── coin-5day-history.sql           # 5 天混合历史
│   ├── coin-1000-redemptions.sql       # 性能测试用
│   ├── coin-cross-week.sql             # W23/W24 边界
│   └── coin-legacy-token-rewards.sql   # 历史 type='game_time' 数据
└── clean-coin-test-db.sh               # 反向: 清理 (可独立跑)
```

### 4.5 与现有 scripts/clean-test-db.sh 集成

```bash
# 复用现有清理逻辑, 追加 coin 表
# scripts/clean-test-db.sh
DELETE FROM score_events;       -- 已有
DELETE FROM task_completions;   -- 已有
DELETE FROM audit_log;          -- 已有
DELETE FROM tasks;              -- 已有
DELETE FROM shop_redemptions;   -- NEW
DELETE FROM shop_items;         -- NEW (会重新 seed)
```

### 4.6 ID 分配约定 (避免测试间冲突)

| 表 | ID 范围 | 说明 |
|----|---------|------|
| users | 1=PM, 2=child, 3+=其他测试用户 | 已有约定 |
| tasks | 1-10=标准, 11+=扩展场景 | 已有约定 |
| shop_items | 1=默认商品, 2+=扩展 | NEW |
| score_events | 自动递增 | 已有 |
| shop_redemptions | 自动递增 | NEW |

测试间 ID 复用通过 `clearAllData()` 保证 (沿用现有 pattern)。
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
# Coin System M2 — Test Regression Report

**日期:** 2026-06-11
**作者:** Code Agent
**状态:** 报告给 PM + Qual Agent 决策
**M2 commits:** ab89a1e (task complete), 231c8a3 (task revoke)

---

## 1. 验证结果总览

| 验证项 | 结果 | 备注 |
|--------|------|------|
| `npx tsc --noEmit` (src/) | ✅ 0 错误 | 跟我 M2 改动相关 |
| `npx tsc --noEmit` (含 e2e tests/) | ❌ pre-existing 失败 | 跟 M2 无关,e2e 缺 dom lib + unit 类型问题 |
| `npx vitest run tests/unit/me-tasks-complete.test.ts` | ❌ 3 fail / 5 pass | stale 假设 |
| `npx vitest run tests/unit/admin-task-revoke.test.ts` | ❌ 1 fail / 5 pass | stale 假设 |
| `npx vitest run` (全 unit baseline) | ❌ 4 fail / 203 pass | 只 M2 影响的 2 个文件 |
| `npx vitest run` (其他 22 文件) | ✅ 22 pass | 无 M2 引入的新 fail |

**结论:** 4 个 fail **全部是 test stale 假设,不是 src bug**。按 PM 委托 §关键约束:
> 测试错(测试用了 stale 假设)→ 这是 PM 工作流: 由 qual-agent 修 tests/(你只 report,不自己改)
> 不写 tests/ — feihao 2026-06-11 明确规则:测试代码由 qual-agent 写,不是 CC

---

## 2. 4 个 fail 详细分析

### Fail #1 / #3 (me-tasks-complete.test.ts: 371 / 460)
**Test 名:** `happy path: 201 with response shape and all 3 batch statements executed` / `new_balance reflects the awarded tokens when starting from a non-zero balance`
**Fail 原因:** `expect(body.new_balance).toEqual({...})` strict equality
- 期望: `{ game_time: 15, pocket_money: 0 }` / `{ game_time: 20, pocket_money: 12 }`
- 实际: 多出 `coins: 1` key (因为 M2 加了 +1 coin event,computeBalance 把 'coins' 加进 group by)

**Stale 假设:** M2 之前 score_events 没有 'coins' type,balance 只有 game_time + pocket_money。

**修法 (给 Qual):**
```typescript
// option A: 用 objectContaining 放宽
expect(body.new_balance).toMatchObject({ game_time: 15, pocket_money: 0 });
expect(body.new_balance.coins).toBe(1);

// option B: 把 'coins' 加进 Balance type 期望
expect(body.new_balance).toEqual({ game_time: 15, pocket_money: 0, coins: 1 });
```
推荐 B,跟 `src/db/types.ts` Balance type 实际结构一致(v3 已经是 3 个 account)。

---

### Fail #2 (me-tasks-complete.test.ts: 433)
**Test 名:** `revoked completion today does NOT block re-completion (only active counts)`
**Fail 原因:** `expect(lastBatch).toHaveLength(3)`
- 期望: 3 batch statements
- 实际: 4 (M2 加了 +1 coin event)

**Stale 假设:** M2 之前 batch 3 个 (legacy event + completion + audit);M2 改成 4 个 (+1 coin 在 audit 前)。

**修法 (给 Qual):**
```typescript
expect(lastBatch).toHaveLength(4);  // legacy + completion + +1 coin + audit
expect(lastBatch[0].query).toMatch(/^INSERT INTO\s+score_events/i);
expect(lastBatch[1].query).toMatch(/^INSERT INTO\s+task_completions/i);
expect(lastBatch[2].query).toMatch(/^INSERT INTO\s+score_events/i);  // +1 coin
expect(lastBatch[2].query).toMatch(/coins/i);  // 验证是 coin event
expect(lastBatch[3].query).toMatch(/^INSERT INTO\s+audit_log/i);
```

---

### Fail #4 (admin-task-revoke.test.ts: 418)
**Test 名:** `happy path: updates both rows, writes audit, returns new_balance`
**Fail 原因:** `expect(batchStatements).toHaveLength(3)`
- 期望: 3 batch statements
- 实际: 4 (M2 加了 -1 coin event)

**Stale 假设:** 同 Fail #2,只是 revoke 端 (UPDATE × 2 + audit → UPDATE × 2 + -1 coin + audit)。

**修法 (给 Qual):** 同 Fail #2 模式:
```typescript
expect(batchStatements).toHaveLength(4);
expect(batchStatements[2].query.toUpperCase()).toMatch(/^INSERT INTO\s+SCORE_EVENTS/);
expect(batchStatements[2].query).toMatch(/coins/i);
expect(batchStatements[2].params[2]).toBe(-1);  // change_value=-1
```

---

## 3. M2 设计的 2 个 clarification (给 PM 决策)

### Clarification A: 旧 token_reward 事件保留 (RFC §8.4)
**当前 M2 实施:** task complete **既写 legacy game_time/pocket_money event,也写 +1 coin event**。
**RFC §1.5 期望:** "❌ 移除:tasks.token_reward 字段不再写入 game_time score_event(v3 兼容开关关闭)"

**冲突:** RFC §1.5 说"v3 兼容开关关闭",RFC §8.4 又说"历史 token_reward 事件保留不动"。M2 实施理解为 **新 task 仍写双 event (legacy + coin)**,跟 §8.4 "历史保留" 一致;§1.5 "v3 关闭"是后续 M 的事(可能是 M3 兑换 API 完成后再切)。

**如果 PM 想要严格执行 §1.5**,需要决定:
- (A) M2 改成 "只写 +1 coin,不写 legacy event" — 这会让 me-tasks-complete.test.ts 的 new_balance.game_time 不再涨,现有 test 4 个全部 stale 之外还要新加 2 个新 fail (legacy event 不再写,test 期望有 legacy event)。
- (B) 维持 M2 当前实施 (双 event 并存) — 现有 test 只剩 4 个 stale 假设需修。

**推荐 B** (current M2),因为:
- "响应格式向后兼容"(PM 委托 §关键约束 #5)更易满足
- 现有 child UI 显示的 balance card (game_time/pocket_money) 不需要立即重构
- 后续 v4 切换 (关 legacy) 单独做 Module

### Clarification B: audit_log.target_event_id 语义变化
**M2 之前:** `audit_log.target_event_id` 指向 awarded score_event (legacy game_time/pocket_money event)
**M2 之后:** `audit_log.target_event_id` 指向 +1 coin event (M2 task complete)

**含义:** audit 审计员看 "child 完成任务" 行为,现在指向 +1 coin event 不是 legacy event。这语义重定义在 RFC §1.5/§4.6 没明说,但 RFC §5.1 步骤 (5) "返回 { task_completion, coins_balance, bonus_awarded }" 暗示 coin 是新 reward 主体。

**如果 PM 想保留原语义** (audit target = legacy event),需要:
- 改 me/tasks.ts 的 audit_log 写:`target_event_id=completion.awarded_event_id` (原行为)
- 这样 batch 里 audit 在 awarded event (row 0) 之后,+1 coin 之前,`last_insert_rowid()` 自然指向 row 0

但目前 M2 batch 顺序是 [legacy event, completion, +1 coin, audit],`last_insert_rowid()` 指向 +1 coin event (row 2)。要改回原语义,需要把 audit 移到 +1 coin 之前 — 但这又破坏 RFC §4.6 "task_completion 在 batch 第一个 INSERT"的写法。

**推荐维持 M2 当前语义** (audit target = +1 coin event),因为:
- v3 模型 "奖励" 主体是 coin
- audit details JSON 已经包含 task_id / task_name 上下文,审计员能从 details 找到 legacy event

---

## 4. 行动项

**Code Agent (CC) 已完成:**
- ✅ commit ab89a1e: 4 个新 build* helper + me/tasks.ts task complete endpoint
- ✅ commit 231c8a3: admin/task-completions.ts task revoke endpoint
- ✅ typecheck src/ 干净
- ✅ 全 unit baseline: 4 fail / 203 pass (只 M2 影响 2 个 file)

**PM 决策 (待):**
- [ ] Clarification A: 维持双 event 并存 (B) 还是切到只 +1 coin (A)?
- [ ] Clarification B: audit target 指向 +1 coin (M2 当前) 还是 legacy event (原行为)?

**Qual Agent 任务 (待):**
- [ ] 修 me-tasks-complete.test.ts 3 个 fail (Fail #1, #2, #3)
- [ ] 修 admin-task-revoke.test.ts 1 个 fail (Fail #4)
- [ ] 跑通 M5 e2e spec 验证 F1-F5 (RFC §2.3 acceptance)

**不在本报告范围 (后续 M):**
- M3: 商店 API (exchange + 周限额) — Coin System M2 不涉及
- M4: child UI 第 3 个 balance card — Coin System M2 不涉及
- M5: e2e spec 写 — Qual Agent 负责

---

## 5. 验证命令 cheat sheet

```bash
# typecheck (src/ 干净)
npx tsc --noEmit 2>&1 | grep -E "^src/" | head -5
# 期望: 空输出

# M2 影响 2 个文件的 unit test
npx vitest run tests/unit/me-tasks-complete.test.ts tests/unit/admin-task-revoke.test.ts
# 期望: 4 fail (见 §2 详细)

# 全 unit baseline
npx vitest run
# 期望: 4 fail (M2 影响) / 203 pass

# e2e (需要 wrangler pages dev 启动,不在本报告范围)
npx wrangler pages dev ./public --port 8787 --d1=DB --local &
npx playwright test tests/e2e/ui-child-task-complete.spec.ts --reporter=line
```

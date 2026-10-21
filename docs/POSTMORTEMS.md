# 产品缺陷归档 (POSTMORTEMS)

> 与 `INCIDENTS.md` 区分: 那份是 CI 自动写的 deploy/backup 失败记录; 这份是**产品逻辑 bug**
> (影响对用户的金币/打卡语义), 按发现日期倒序。
> 格式沿用 `INCIDENTS.md` 的 4 段式 (Symptom / Root cause / Fix / Recovery)。

## 2026-10-21 — 编辑任务时生效日被静默重置为"每天" (P0, 已修待部署)
- **Commit**: `ea7e64e`
- **Symptom**: admin 编辑一个 `active_days=[6,7]`(仅周末) 的任务, 表单显示 7 天全勾; 不改直接保存 → 生效日被放宽成每天。
- **Root cause**: `GET /api/admin/tasks` 返回 D1 原始行, `active_days` 是 JSON TEXT 字符串; 前端预填 `Array.isArray(t.active_days)` 恒 false → fallback `[1..7]`。me/ public/ 路由都解析了, 唯独 admin GET 漏了。由 CC 文档审计 (E-9) 发现, PM 验证为真。
- **Fix**: `src/routes/admin/tasks.ts` GET 路由解析后返回; `parseActiveDays` 从 `coin.ts` 导出复用。回归测试 2 its (JSON text → 数组 / NULL+junk → null)。
- **Recovery**: 已修。**生产在此修复前编辑过任务且保存的, 生效日可能已被静默放宽** — 需 PM 在 admin 里抽查各任务生效日。

## 2026-10-21 — 清空当天打卡把已撤销行也扣了金币 (P0, 已上线)
- **Commit**: `58027df`
- **Symptom**: PM 点"清空当天打卡"后, 当天里**已撤销**的任务也被扣 1 枚 🪙, 余额比实际少。
- **Root cause**: reset-day 初版对当天每一行都写 -1。但已撤销行的 +1 在当初 revoke 时已经以 -1 回退过, 再写一次就是双倍扣。
- **Fix**: `src/routes/admin/task-completions.ts` — 只有删除前 `status='active'` 的行才写 -1; revoked 行只做 snapshot + delete + audit。
- **Recovery**: 已修。对历史被多扣的日期, 需人工核对 `score_events` (`source_ref LIKE 'revoke:task:%'`) 与 `deleted_records` 快照里的删除前 status。**哪些生产日期被多扣 — 未核实, 需查生产 D1**。

## 2026-10-20 — 非生效日任务永远卡住 +3 bonus (P1, 已上线)
- **Commit**: `c4f51d1`
- **Symptom**: 配了"仅工作日"生效日的任务, 到了周末就再也无法拿到"全部完成 +3", 提示条一直灰着。
- **Root cause**: `isAllTasksCompleted()` 按 `is_active=1` 全量判定, 把非生效日(不可能完成)的任务也算进了分母。
- **Fix**: 改为先算 dueToday 集合 (`is_active=1` 且 `active_days` 空/含今天) 再判定; 同步修正 progress 分母与小孩端 hint。
- **Recovery**: 已修。已发出的 +3 不受影响 (不回溯)。

## 2026-10-20 — 打卡 toast 显示错误的金币数 (P1 kid-facing, 已上线)
- **Commit**: `3b477c1`
- **Symptom**: 孩子打卡后弹 `+5 🪙 到账`, 但余额只加了 1 —— 小孩会觉得"钱被吞了"。
- **Root cause**: toast 用响应里的 `token_awarded`, 而那是遗留字段 `tasks.token_reward` (信息性); 实际入账是统一 +1。
- **Fix**: 改为固定文案 `+1 🪙 到账`, 有 bonus 时追加 `今日全部完成 +3 🪙！`。
- **Recovery**: 已修。**同类问题仍在日历视图**: `public/app.js` 打卡日历 day-detail 里 `+${c.token_reward} 🪙` 仍显示遗留数字 — 已随本轮文档回填一并修复 (见 commit)。

## 2026-10-21 — status=all 单测跨午夜必红 (P2, 已修)
- **Commit**: `de89a45`
- **Symptom**: `tests/unit/admin-task-completions-list.test.ts` 的 `status=all` 用例 00:00 之后必红。
- **Root cause**: 用例没传 `date=`, 走服务端默认 `todayShanghai()`, 而 fixture 写死 `completed_date: '2026-10-20'`。午夜一过默认日期变成 10-21, 查不到行。
- **Fix**: 用例显式传 `date=2026-10-20`。
- **Recovery**: 已修。**教训**: 凡依赖 `todayShanghai()` 默认值的单测, 必须显式钉住 `date=` 参数。

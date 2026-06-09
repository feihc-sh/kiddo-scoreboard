# Kiddo Scoreboard — 功能点 ↔ 测试项 全映射矩阵

> 一张大表看清"业务规则 / UI 功能 / 测试覆盖"三件套。
> 给 agent / 用户看: **每个功能点有没有测, 测了什么, 还有什么 gap。**

**最后更新**: 2026-06-09
**总览**: PRD §3 (6 业务规则) + §5 (8 流程) = **15 业务侧功能点** ↔ TEST_PLAN §3 (15 UI 功能) ↔ 24 unit + 52 e2e = **76 测试文件** (v2.2 baseline + 2 P0 + 1 P1 regression, post-#28+#29+#17 step)
**最新 Qual 报告**:
- `QUAL_REPORT_2026-06-09-p0-admin-hard-delete-fk.md` (P0 永久删除 FK 约束, #28)
- `QUAL_REPORT_2026-06-09-p0-revoke-event-sync.md` (P0 撤销 event 不同步 child UI, #29)
- `QUAL_REPORT_2026-06-09.md` (P1 PM task edit field prefill, #17)
---

## 📊 表 A: PRD 业务规则 × 测试覆盖 (6 业务规则)

| PRD § | 业务规则 | 关键实现 | TEST_PLAN § | unit spec | e2e spec | 覆盖率 |
|---|---|---|---|---|---|---|
| **3.1** | 双账户模型 (game_minutes / pocket_money) | `utils/balance.ts` + `score_events.target_account` | 3.10, 3.11 | `balance.test.ts` `public-balance.test.ts` | `flow-exchange.spec.ts` `flow-new-user-day.spec.ts` | ✅ 100% |
| **3.2** | 扣分规则 (双账户维度) | `routes/admin/events.ts :: POST /:id/approve` | 3.3, 3.4 | `admin-events-actions.test.ts` | `ui-admin-pending.spec.ts` `flow-deduct-revoke.spec.ts` | ⚠️ 95% — event 撤销不同步 child UI (新 spec RED, 2026-06-09) |
| **3.3** | 奖励机制 (周额度发工资) | `routes/admin/weekly-grant.ts` | 3.8 | `admin-weekly-grant.test.ts` | `flow-weekly-payout.spec.ts` `ui-admin-grant.spec.ts` | ✅ 100% |
| **3.4** | 任务系统 (CRUD + 完成 + 撤销) | `routes/admin/tasks.ts` + `routes/me/tasks.ts` | 3.5, 3.11 | `admin-tasks-config.test.ts` `me-tasks-complete.test.ts` `public-tasks.test.ts` | `ui-admin-tasks.spec.ts` `ui-child-task-complete.spec.ts` `ui-admin-emoji-picker.spec.ts` `flow-task-lifecycle.spec.ts` **`ui-admin-revoke-event-sync.spec.ts`** ⚠️ NEW (P0, event 撤销 → child UI, 2026-06-09) | ⚠️ 95% — event 撤销 child UI 路径未覆盖 |
| **3.12** | 准时上床 (self-lockout 任务类型, v2.1) | `tasks.cutoff_time` + `tasks.is_self_lockout` | 3.14 | (覆盖在 me-tasks-complete.test.ts) | `sleep-lockout.spec.ts` `ui-child-main.spec.ts` | ✅ 100% |
| **3.5** | 边界 case (软删/审计/锁 + **硬删 v2.2**) | `utils/audit.ts` + `auth/lockout.ts` + `utils/deleted-records.ts` + `routes/admin/events.ts` + `routes/admin/task-completions.ts` + `routes/admin/deleted-records.ts` | 3.1, 3.6, **3.15** | `lockout.test.ts` `audit.test.ts` `deleted-records.test.ts` `admin-events-hard-delete.test.ts` `admin-task-completions-hard-delete.test.ts` | `flow-pm-lockout.spec.ts` `smoke-admin-audit.spec.ts` **`ui-admin-hard-delete.spec.ts`** **`ui-admin-hard-delete-fk.spec.ts`** ⚠️ NEW (P0, FK 约束, 2026-06-09) | ⚠️ 95% — FK 路径未覆盖 (新 spec RED 待 PM 修) |

| **业务规则侧覆盖率**: **6/6 = 100%** ✅ (业务侧 OK; 已知 1 P0 bug: 硬删 FK 路径, 新 spec RED)
**gap (已补)**: PRD 3.5 新增硬删 (v2.2) — 物理删 event/completion + `deleted_records` snapshot + audit log, 全部由 §3.15 e2e + 2 unit spec 覆盖。
**gap (待补)**: PRD 3.5 硬删 FK 路径 — `task_completions.awarded_event_id → score_events.id` 的 FK 约束导致硬删 event 失败 (500)。新增 `ui-admin-hard-delete-fk.spec.ts` (3 case, 1 通过/2 RED) 等 PM 修。

---

## 📊 表 B: PRD 交互流程 × 端点 × 测试 (8 流程)

| PRD § | 流程 | 触发者 | 涉及端点 | e2e spec |
|---|---|---|---|---|
| **5.1** | 首次填名字 (替代"改名字") | 儿子 | `PATCH /api/me/profile` | `ui-child-firsttime.spec.ts` `smoke-child-firsttime.spec.ts` |
| **5.2** | 完成任务 | 儿子 | `POST /api/me/tasks/:id/complete` | `ui-child-task-complete.spec.ts` `smoke-child-task-complete.spec.ts` `flow-task-lifecycle.spec.ts` |
| **5.3** | PM 撤销任务完成 | PM | `POST /api/admin/task-completions/:id/revoke` | `flow-task-lifecycle.spec.ts` (含撤销) |
| **5.4** | PM 配置任务 (CRUD) | PM | `POST/PUT/DELETE /api/admin/tasks` | `ui-admin-tasks.spec.ts` `smoke-admin-tasks.spec.ts` `ui-admin-emoji-picker.spec.ts` |
| **5.5** | 儿子提交 (申请/扣分) | 儿子 | `POST /api/me/events` | `ui-child-submit-happy.spec.ts` `ui-child-submit-edge.spec.ts` `smoke-child-submit.spec.ts` |
| **5.6** | PM 审批 | PM | `POST /api/admin/events/:id/approve\|reject\|revoke` | `ui-admin-pending.spec.ts` `smoke-admin-pending.spec.ts` `flow-deduct-revoke.spec.ts` |
| **5.7** | 双账户兑换 | PM | `POST /api/admin/exchange` | `ui-admin-exchange.spec.ts` `smoke-admin-exchange-grant.spec.ts` `flow-exchange.spec.ts` |
| **5.8** | 周额度发放 | PM | `POST /api/admin/weekly-grant` | `ui-admin-grant.spec.ts` `flow-weekly-payout.spec.ts` |

**交互流程侧覆盖率**: **8/8 = 100%** ✅ (每流程都有专属 e2e spec)

---

## 📊 表 C: TEST_PLAN UI 功能 × 实际 spec (14 UI 功能)

| TEST_PLAN § | UI 功能 | Smoke | Happy | Edge | 实际 e2e spec (按类型) |
|---|---|:---:|:---:|:---:|---|
| **3.1** | PM Login | ✓ | ✓ | ✓ | `smoke-admin-login.spec.ts` `admin-login.spec.ts` `ui-admin-login.spec.ts` `flow-pm-lockout.spec.ts` |
| **3.2** | PM Dashboard Shell | ✓ | — | — | `smoke-admin-shell.spec.ts` `smoke-admin-dashboard.spec.ts` `ui-admin-dashboard-shell.spec.ts` `admin-dashboard.spec.ts` |
| **3.3** | PM Pending Events | ✓ | ✓ | ✓ | `smoke-admin-pending.spec.ts` `ui-admin-pending.spec.ts` `event-approval.spec.ts` |
| **3.4** | PM All Events | ✓ | ✓ | — | `smoke-admin-all-events.spec.ts` `ui-admin-all-events.spec.ts` `admin-extras.spec.ts` |
| **3.5** | PM Task Config (CRUD) | ✓ | ✓ | ✓ | `smoke-admin-tasks.spec.ts` `ui-admin-tasks.spec.ts` `ui-admin-emoji-picker.spec.ts` `ui-admin-tasks-edit-prefill.spec.ts` (regression: v2.1 fields prefill, see QUAL_REPORT_2026-06-09) `task-system.spec.ts` |
| **3.6** | PM Audit Log | ✓ | ✓ | — | `smoke-admin-audit.spec.ts` `ui-admin-audit.spec.ts` |
| **3.7** | PM Exchange | ✓ | ✓ | ✓ | `smoke-admin-exchange-grant.spec.ts` `ui-admin-exchange.spec.ts` `exchange-grant.spec.ts` |
| **3.8** | PM Weekly Grant | ✓ | ✓ | — | `ui-admin-grant.spec.ts` `flow-weekly-payout.spec.ts` |
| **3.9** | Child First-time Flow | ✓ | ✓ | — | `smoke-child-firsttime.spec.ts` `ui-child-firsttime.spec.ts` |
| **3.10** | Child Main Page | ✓ | ✓ | — | `smoke-child-main.spec.ts` `ui-child-main.spec.ts` `child-ui.spec.ts` `ui-child-progress-bars.spec.ts` |
| **3.11** | Child Task Complete | ✓ | ✓ | — | `smoke-child-task-complete.spec.ts` `ui-child-task-complete.spec.ts` |
| **3.12** | Child Event Submit | ✓ | ✓ | ✓ | `smoke-child-submit.spec.ts` `ui-child-submit-happy.spec.ts` `ui-child-submit-edge.spec.ts` |
| **3.13** | Child Recent Events | ✓ | — | — | `ui-child-events.spec.ts` `smoke-child-recent.spec.ts` |
| **3.14** | Child Sleep Lockout (v2.1) | ✓ | ✓ | ✓ | `sleep-lockout.spec.ts` `ui-child-main.spec.ts` (含 cutoff 行为) |
| **3.15** | Admin Hard Delete (v2.2) | ✓ | ✓ | ✓ | `ui-admin-hard-delete.spec.ts` (smoke + 2 happy) |

**UI 功能覆盖率**: **15/15 = 100%** ✅

---

## 📊 表 D: 跨功能流程 (6 个 flow)

| Flow | spec 文件 | 涉及功能 | 价值 |
|---|---|---|---|
| **A: PM Lockout Flow** | `flow-pm-lockout.spec.ts` | 3.1 登录 + 边界 | 防暴力破解 |
| **B: Task Lifecycle Flow** | `flow-task-lifecycle.spec.ts` | 5.2 + 5.3 (完 → 撤) | 任务完整生命周期 |
| **C: New User Day Flow** | `flow-new-user-day.spec.ts` | 5.1 首次填名 + 3.1 余额 | 新用户体验 |
| **D: Deduct & Revoke Flow** | `flow-deduct-revoke.spec.ts` | 5.5 + 5.6 (扣 → 撤) | 完整审计追踪 |
| **E: Exchange Flow** | `flow-exchange.spec.ts` | 5.7 双账户兑换 | 余额正确性 |
| **F: Weekly Payout Flow** | `flow-weekly-payout.spec.ts` | 5.8 周发工资 | 周额度机制 |
| **G: Admin Hard Delete Flow** (v2.2) | `ui-admin-hard-delete.spec.ts` | 3.15 (删 → 灰显 → 再打卡) | 物理删 + 审计 + 业务恢复 |
| **H: PM Task Edit Prefill** (v2.3, 2026-06-09 regression) | `ui-admin-tasks-edit-prefill.spec.ts` | 3.5 (编辑 → 8 字段回填) | 防止 v2.1 cutoff/self_lockout 字段在编辑时被清空 (QUAL_REPORT_2026-06-09) |

**跨流程覆盖率**: 7/7 = **100%** ✅ (每流程 1 spec, walk 完整)

---

## 📊 表 E: 单元测试覆盖 (22 个)

### Auth 模块 (3)
- `pin.test.ts` — PBKDF2 100k 验 ✅
- `session.test.ts` — JWT 生成/解析 ✅
- `lockout.test.ts` — 5 次/15min 锁 ✅

### 公开 API (4)
- `public-user.test.ts`
- `public-balance.test.ts`
- `public-events.test.ts`
- `public-tasks.test.ts` (含 today-status, progress)

### 儿子端 API (3)
- `me-profile.test.ts` (改名)
- `me-events-submit.test.ts` (提交)
- `me-tasks-complete.test.ts` (完成/撤销)

### PM 端 API (10)
- `admin-auth.test.ts` (登录)
- `admin-events-actions.test.ts` (审批/拒绝/撤销/改分)
- `admin-tasks-config.test.ts` (任务 CRUD)
- `admin-task-revoke.test.ts`
- `admin-task-completions-list.test.ts`
- `admin-audit-log.test.ts`
- `admin-exchange.test.ts`
- `admin-weekly-grant.test.ts`
- `admin-events-hard-delete.test.ts` (v2.2)
- `admin-task-completions-hard-delete.test.ts` (v2.2)

### Utils (5)
- `week.test.ts` (时区 + ISO 周)
- `balance.test.ts` (余额计算)
- `audit.test.ts` (审计写入)
- `deleted-records.test.ts` (v2.2 snapshot 写入 + JSON 序列化)
- (Me-events-submit 等覆盖)

**单元测试总数**: 24 文件 / ~135 用例 (v2.2 baseline)

---

## 📊 表 F: E2E 测试分布 (48 个)

| 类别 | 数量 | spec 文件 |
|---|---:|---|
| Smoke (页面 + 关键元素) | 18 | `smoke-*.spec.ts` |
| UI Admin | 11 | `ui-admin-*.spec.ts` (含 v2.2 `ui-admin-hard-delete.spec.ts` + v2.3 `ui-admin-tasks-edit-prefill.spec.ts`) |
| UI Child | 7 | `ui-child-*.spec.ts` |
| Flow (跨功能) | 6 | `flow-*.spec.ts` |
| Misc / 边界 | 7 | `admin-*.spec.ts` `event-approval.spec.ts` `task-system.spec.ts` `public-api.spec.ts` `hello.spec.ts` `ui-task-and-segbtn.spec.ts` `child-ui.spec.ts` `admin-extras.spec.ts` `exchange-grant.spec.ts` `admin-dashboard.spec.ts` |
| v2.1 专测 | 1 | `sleep-lockout.spec.ts` |
| 诊断 (非测试) | 1 | `_diag-cookie.spec.ts` (跳过) |

---

## 🔍 覆盖 GAP 分析 (还有哪里没测到)

| Gap | 影响 | 建议 |
|---|---|---|
| **PM 锁账户后网络中断** (PRD 3.5) | 低 (5 次已锁, 第 6 次请求也不影响) | 加 1 个 e2e, mock 网络断开 |
| **DST/夏令时边界** (PRD 3.5) | 中 (中国无 DST, 实际不会触发) | 跳过 (无业务影响) |
| **同一 task 2 个儿子同时完成** (并发) | 中 (家庭用户, 实际不会) | 加 1 个 unit (锁) |
| **D1 写入失败回滚** | 低 (CF 99.9% SLA) | 跳过 (D1 内部已处理) |
| emoji 选择器 20 类的全分类覆盖 | 低 (只测了核心 5 个) | 加 1 个 e2e, 遍历 4 类 |
| **.env 路径/Home 重定向 cron bug** | 中 (已发现, PM 修复) | 加 1 个 shell 集成测试 |
| **PM Task Edit 不回填 v2.1 字段** (2026-06-09) | **中 (P1)** — PM 编辑 sleep task 时丢 cutoff/lockout 设置 | ✅ **已加 regression spec `ui-admin-tasks-edit-prefill.spec.ts`** (RED, 待 PM 修) |
| **数据导入/导出** | 无 (v2 不做) | PRD §9.5 标注 skip |

| **总 gap** | 8 项, 5 项可 skip, 2 项已加 (PM Task Edit Prefill regression 2026-06-09), 1 项建议加 (并发 emoji) |

---

## 📈 测试统计汇总

| 维度 | 数量 |
|---:|---|
| 业务规则 (PRD §3) | 6 |
| 交互流程 (PRD §5) | 8 |
| UI 功能 (TEST_PLAN §3) | 15 |
| 跨功能流程 (TEST_PLAN §跨) | 7 |
| 业务侧功能点总数 (去重) | **15** |
| unit 测试文件 | 24 |
| e2e spec 文件 | 49 |
| **测试文件总数** | **73** |
| 测试用例 (估算) | ~212+ |
| **覆盖率** | **15/15 = 100%** ✅ |
| **当前状态** (2026-06-09) | **205 pass + 2 pre-existing flaky + 1 NEW regression fail (待 PM 修 startEditTask)** ⚠️ |

---

## 🛠 怎么用这份矩阵

### 新功能开发流程 (agent 必读)
1. 在 `PRD.md` 加 §X 业务规则 (若新规则)
2. 在 `TEST_PLAN.md` 加 §3.X UI 功能 + Smoke/Happy/Edge 三组
3. 在本表 A/B/C 对应位置加 1 行 (实际 spec 文件)
4. TDD: 先写 unit test → 后写代码 → 再写 e2e
5. 跑 `npm test` 全过 → 开 PR

### Bug 修复流程 (agent 必读)
1. 看本表 D (跨流程) / C (UI) 找现有覆盖
2. 若没覆盖 → 加 1 个 regression spec (避免重犯)
3. 修代码 → 跑 spec → 开 PR
4. 在本表对应位置加 1 行 "regression: ..."

### 用户验收流程
1. iPad 4G/5G 实测新功能
2. 走本表 B 找到对应流程 (5.1~5.8)
3. 不符合 → 提 issue, 引"PRD §X.Y"
4. PM 整理成新 NIGHTLY-TODO Item

---

**版本**: v2.2 (2026-06-08)
**维护**: 每加 1 个功能点 → 同步加 3 处 (PRD/TEST_PLAN/本文档)

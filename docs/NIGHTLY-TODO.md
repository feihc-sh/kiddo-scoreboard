     1|# 半夜自动化清单 (NIGHTLY-TODO) — 📥 新需求池
     2|
     3|> **用户 2026-06-08 添加 3 个新功能, 待逐个拍板**:
     4|> 1. #006 打卡日历 (月历可视化)
     5|> 2. #007 英雄头像选择 (个人化)
     6|> 3. #008 任务装备/机甲化 (任务视觉)
     7|>
     8|> **流程**: PM 整理 clarification → DM 弹给用户拍板 → 用户回 → PM 更新 Item → 入清单等 0:00 cron
     9|>
    10|> **6 个旧 Item 已归档**, 见文件底部 § 归档 段
    11|
    12|---
    13|
    14|## 流程 (历史参考)
    15|
    16|**用户视角** (极简):
    17|1. 飞书 DM 跟我说: "我想 X, 还要 Y"
    18|2. 我整理 (clarify + plan) 后, 在这个文件加 ## Item
    19|3. 半夜 0:00 自动跑
    20|4. 早上/有空时我汇报结果
    21|
    22|**作用域**: 可自动化的开发任务 (git commit 级别, **不**包括 deploy / push / DELETE)
    23|**位置**: `docs/NIGHTLY-TODO.md` (跟项目, git 可见)
    24|
    25|---
    26|
    27|## 🚦 风险图例
    28|
    29|| 风险 | 等级 | 含义 |
    30||---|---|---|
    31|| 🟢 | 低 | 改 docs / 注释 / 格式化 / 加单测 |
    32|| 🟡 | 中 | 改 src 代码 / 改 migration / 改依赖 |
    33|| 🔴 | 高 | 改核心架构 / 改 schema / 改 token 配置 |
    34|
    35|**不跑的事** (cron 看到会自动 skip 并标 🚫 blocked):
    36|- `wrangler deploy` / `git push` / `wrangler d1 delete`
    37|- 需要用户决策的澄清
    38|- 实时 iPad 实测
    39|
    40|---
    41|
    42|## 📋 当前清单 (2 个 Item: 0 ⏳ pending, 1 🔧 running, 1 ⏸ hold)
    43|
    > 📌 **Drift fix 2026-06-24 (PM 修)**: #011 ✅ done (PR #42 已 merged 2026-06-21), #012 ✅ done (PR #43 已 merged 2026-06-21), #008 ✅ done (4 stages all merged 2026-06-24) — 移到下方归档段
    > 当前 active: #007 hold / #013 🔧 running (Stage 2 done)
    > 2026-06-24 PM 1 晚连续跑完 #008 4 stages (3 晚预算 → 1 晚): Stage 2+3 CC, Stage 4 PM 自实现 docs
    >
    > 📌 **2026-07-04 新需求入池**: #014 (suspend task) + #015 (申请金币), 当日已拍板 (Q1=A1 Q2=B1 + Q3-5 默认), 详情见下方 Item 段

    ## Item #014 — Admin 暂停任务 (suspend / 恢复, 不删) ⏳ pending

    > 用户原话 (2026-07-04 DM): "我要 admin 可以 suspend 一个任务, 比如暑假期间打卡任务需要替换但不想删掉"
    > 用户补充: "这个需求我好像记在 night todo 里了" — **PM 已 grep 全文件, 0 匹配 suspend/暂停/停用/暑假/disable/deactivate**, 不存在旧记录, 现新增

    **现状 (PM 调查)**:
    - `tasks.is_active` 字段已存在 (0 | 1, db/types.ts L93/L177)
    - admin DELETE 走 soft-delete: `UPDATE tasks SET is_active = 0, updated_at = ? WHERE id = ?` (admin/tasks.ts L550-562)
    - admin PATCH 支持 `is_active` 字段 (admin/tasks.ts L340-344, 439-441)
    - child UI 自动隐藏 `is_active=0` 任务 (me/tasks.ts L63, L254)
    - admin UI 已渲染 "已停用" badge (`t.is_active === 1` 反向 → badge) (public/admin/admin.js L497-502)
    - **缺口**: admin task 列表**没暴露 toggle 按钮** — 当前只能"编辑"或"删除"; 要"恢复"得手动 PATCH

    **已拍板 (2026-07-04)**:
    1. 需求 = admin 可暂停 + 恢复任务, 不删 (暑假打卡任务替换场景)
    2. 项目 = kiddo-scoreboard

    **Clarification (PM 整理 2026-07-04, 当日已拍板)**:
    - ✅ **Q1 = A1 (简单 toggle)** 🟢 — 复用现有 `tasks.is_active` 字段, 新加 `POST /api/admin/tasks/:id/toggle` endpoint (内部 is_active=0↔1), 无新 schema
    - ✅ **Q2 = B1 (inline toggle switch)** — admin task 列表每行右侧放 iOS 风格 switch, 一键切换; admin.js renderTasks 加 toggle 元素 + click handler + optimistic UI + toast
    - ✅ **Q3 = 是** — toggle 时写 `audit_log`, action=`task_suspended` (1→0) 或 `task_resumed` (0→1), details 含 task_id + 操作时间 + 操作人; 跟 shop-fulfill / exchange 同 audit pattern
    - ✅ **Q4 = 现状已 OK** — 暂停后 kid UI 完全隐藏 (复用 `is_active=0` 现成逻辑, me/tasks.ts L63/L254), 无需改

    **Action Plan** (A1+B1+Q3=是 假设下的 4 段草案, 等拍板后细化)**:
    - [ ] **Stage 1 (≤15 min)**: API toggle endpoint + 单测
      - `src/routes/admin/tasks.ts`: `POST /api/admin/tasks/:id/toggle` (requirePm guard 已生效), 写 audit_log
      - `tests/unit/admin-task-toggle.test.ts` (toggle 1↔0, audit 写对, 权限校验)
      - `git commit -m "feat(tasks): admin toggle is_active endpoint + audit log (Item #014 §1)"`
    - [ ] **Stage 2 (≤15 min)**: admin UI toggle 按钮 + 视觉
      - `public/admin/admin.js` renderTasks 加 toggle switch + click handler + optimistic UI + toast
      - `public/admin/admin.css` `.pm-toggle` switch style (cyan glow, 跟 #008/#010/#011 风格统一)
      - 单测: `tests/unit/admin-toggle-ui.test.ts` (DOM 渲染 + click flow)
      - `git commit -m "feat(tasks): admin inline toggle switch (Item #014 §2)"`
    - [ ] **Stage 3 (≤10 min)**: e2e + 视觉对齐
      - `tests/e2e/admin-task-toggle.spec.ts` (toggle on → 看 badge + audit log entry)
      - 视觉对齐: toggle switch 跟 #008 mecha HUD 同色板
      - `git commit -m "feat(tasks): toggle e2e + visual alignment (Item #014 §3)"`
    - [ ] **Stage 4 (≤10 min)**: 文档 + regression
      - `docs/PRD.md` §X 新增 "Task Lifecycle (active/suspended)" 段
      - `docs/TEST_PLAN.md` §X 加 toggle 测试章节
      - `docs/FEATURE_MATRIX.md` 标记 ✅
      - `docs/PROGRESS.md` v2.X
      - 跑全套 `npx vitest run` + `npx playwright test`
      - `git commit -m "feat(tasks): docs + regression (Item #014 §4)"`

    **Status**: ⏳ pending (2026-07-04 已拍板 Q1=A1 Q2=B1 Q3=是, 🟢, 等 0:00 cron pickup 或 PM 主动派跑)
    **风险**: 🟢 (简单 toggle, 复用现有 is_active, 无 schema 改动)
    **Started**: —
    **Completed**: —
    **Commit**: —
    **Branch**: 未建 (等拍板后 PM 按 #013 pattern 建 `feat/014-suspend-task`)

    ---

    ## Item #015 — Kid 申请金币 (审批流, kid 端 + admin 端) ⏳ pending

    > 用户原话 (2026-07-04 DM): "我要在 user 界面里增加申请金币的功能"

    **现状 (PM 调查)**:
    - `coin_balances` 表 + `getCoinBalance` / `getCoinBalanceUpdatedAt` utils (utils/coin.ts)
    - kid 端 API: `GET /api/coins/balance` + `GET /api/coins/redemptions` (src/routes/me/coins.ts), CHILD_USER_ID hardcoded = 2
    - admin 已有"兑换待发"流程参考: `src/routes/admin/shop-fulfill.ts` (GET list + POST approve), 状态机 `pending → approved` 已实现 (L119-194) + audit_log 写好
    - **缺口**: 没有 kid 主动"申请金币"通道, 现有金币只能通过任务完成/兑换入账

    **已拍板 (2026-07-04)**:
    1. 流程 = **A1 审批流**: kid 填理由+数量 → 提交 → parent admin 审批 → 通过后到账 + 写流水
    2. 项目 = kiddo-scoreboard
    3. 入口位置 (默认假设) = 主页 `/` kid 端顶部加按钮 "🪙 申请金币" → modal

    **Clarification (PM 整理 2026-07-04, 当日已拍板)**:
    - ✅ **Q1 = A1 (无上限)** — kid 想申请多少填多少, admin 审批时判断合不合理; 防滥用靠 PM 审核, 不靠系统硬卡
    - ✅ **Q2 = B1 (输入框自填)** — modal 给一个数字输入框, kid 自己填 1-999, 客户端做基础校验 (必须数字 + 1-999 范围)
    - ✅ **Q3 = 默认** — audit_log action=`coin_request_approved` (或 `coin_request_rejected`), details 含 request_id + user_id + amount + reason + approver_id + approved_at; 跟 shop-fulfill 同 pattern
    - ✅ **Q4 = 默认** — 通过后直接写 `coin_balances` 表 (跟任务完成奖励金币走同一条路径), 不绕 weekly_grant
    - ✅ **Q5 = 默认 (是)** — kid 端加 "我的申请" 区, 显示 ⏳ pending / ✅ approved / ❌ rejected 三种状态, 复用 `/api/coins/redemptions` section 模式

    **Action Plan** (A1+B1+Q3-5 默认假设下 5 段草案, 等拍板后细化)**:
    - [ ] **Stage 1 (≤20 min)**: D1 migration + coin_requests 表 + helpers
      - `migrations/XXXX_coin_requests.sql`: 新表 (`id` / `user_id` / `amount` / `reason` / `status` ('pending'|'approved'|'rejected') / `requested_at` / `reviewed_at` / `reviewed_by` / `review_note`)
      - `src/utils/coin-request.ts`: 新 helpers `createCoinRequest` / `listCoinRequests` / `reviewCoinRequest`
      - 单测: `tests/unit/coin-request-helpers.test.ts`
      - `git commit -m "feat(coin-request): D1 schema + helpers (Item #015 §1)"`
    - [ ] **Stage 2 (≤20 min)**: kid API + admin API endpoints
      - `src/routes/me/coin-request.ts`: `POST /api/coins/request` (kid 提交) + `GET /api/coins/requests` (kid 历史)
      - `src/routes/admin/coin-requests.ts`: `GET /api/admin/coin-requests?status=pending` (admin 待审) + `POST /api/admin/coin-requests/:id/approve|reject`
      - 复用 requirePm guard (admin) + CHILD_USER_ID hardcoded (kid)
      - 单测: 4 endpoint 各一文件 (submit / list-kid / list-admin / approve-reject)
      - `git commit -m "feat(coin-request): kid submit/list + admin review endpoints (Item #015 §2)"`
    - [ ] **Stage 3 (≤20 min)**: kid UI 申请 modal + 提交反馈 + 历史显示
      - `public/index.html` + `public/app.js`: 主页加 "🪙 申请金币" 按钮 → modal (理由 textarea + 数量 input) → 提交 → toast
      - kid 端历史: 跟 `/api/coins/redemptions` 复用 section, 加 "申请记录" 子区
      - 单测 + e2e
      - `git commit -m "feat(coin-request): kid UI submit modal + history (Item #015 §3)"`
    - [ ] **Stage 4 (≤15 min)**: admin UI "金币申请" section
      - `public/admin/admin.js`: 加 renderCoinRequests + loadPendingCoinRequests (跟 shop-fulfill 待发同款 pattern)
      - approve/reject 按钮 + confirm modal + audit 写
      - 单测 + e2e
      - `git commit -m "feat(coin-request): admin UI 待审 section + approve/reject (Item #015 §4)"`
    - [ ] **Stage 5 (≤10 min)**: 文档 + regression
      - docs 4 件套 (PRD + TEST_PLAN + FEATURE_MATRIX + PROGRESS) 按 #008/#013 pattern 写
      - 跑全套 vitest + playwright
      - `git commit -m "feat(coin-request): docs + regression (Item #015 §5)"`

    **Status**: ⏳ pending (2026-07-04 已拍板 Q1=A1 Q2=B1 Q3-5 默认, 🟡, 等 0:00 cron pickup 或 PM 主动派跑)
    **风险**: 🟡 (新 schema `coin_requests` 表 + 4 endpoint + kid/admin UI 都改)
    **Started**: —
    **Completed**: —
    **Commit**: —
    **Branch**: 未建 (等拍板后 PM 按 #013 pattern 建 `feat/015-coin-request`)

    ---

    ## Item #006 — 打卡日历 (月历可视化) 🔧 running (Stage 1 done 2026-06-17, 等 Stage 2/3/4)
    49|
    50|> 用户原话 (2026-06-08): "先 hold 一下这个 idea 放 todo 里吧, 后面我再来拍"
    51|> 2026-06-17 DM 拍板: "B + 折叠 + 所有日期, 可切月份"
    52|
    53|**已拍板 (2026-06-17)**:
    54|1. **方案 = B (标准月历)**: 折叠月历视图, 标准 7×6 网格, 每格点击可看当天打卡明细 (任务名 + 积分)
    55|2. **Q1 触发 = 折叠**: child UI 顶部"📅 月历"按钮点击展开/收起 (跟现在 child UI 风格一致)
    56|3. **Q2 数据 = 所有日期 (可切月份)**: 显示全部历史, ◀/▶ 按钮切月份, 长跨度成就感
    57|
    58|**Clarification** (PM 整理 2026-06-17):
    59|- **数据来源**: `task_completions` 表 (现有 schema, 无需改), 按 `child_id + completed_at` 聚合每天打卡数
    60|- **按月分页**: 一次只拉一个月的打卡数据, 切月份时再拉 (避免一次拉全表, 跟 #010 sprint modal 数据流一致)
    61|- **颜色档位** (GitHub 风, 4 档): 0 次灰 / 1 次浅青 / 2 次中青 / 3+ 次深青 + 霓虹光
    62|- **月历组件**: 顶部 ◀/▶ 月份切换 + 居中标题"YYYY 年 M 月" + 7×6 网格 (含上下月灰显日期) + 格子 click 弹 modal (复用 #010 sprint modal 同套 CSS)
    63|- **可关闭性**: 折叠按钮再次点击收起; ESC 键关闭; localStorage 记忆折叠状态
    64|- **视觉对齐**: 复用 #010 sprint modal 样式 + #011 running map 科技风 (cyan glow + 网格底) + 跟 #005 三进度条同色系
    65|- **跟 #008 联动 (后续)**: #008 机甲化时, 月历格子可升级 HUD 角括号 (同款视觉)
    66|- **跟 #011 联动**: 月历 grid 跟 running map grid 视觉呼应 (科技风统一)
    67|
    68|**Action Plan** (4 段, 每段 ≤ 15 min, anti-CC-Timeout):
    69|- [ ] **Stage 1 (≤15 min)**: HTML/CSS scaffold + 折叠按钮
    70|  - `public/index.html` — 加 `#calendar-toggle-btn` (📅 月历) + `#calendar-panel` (默认隐藏, 跟 #005 进度条同位置)
    71|  - `public/app.js` — `toggleCalendar()` + localStorage 记忆折叠状态
    72|  - `public/app.css` — 折叠面板 + 月历 grid 7×6 样式 (cyan glow)
    73|  - 单测: `tests/unit/calendar-toggle.test.ts` (show/hide + localStorage 持久化)
    74|  - `git commit -m "feat(calendar): fold toggle button + panel scaffold (Item #006 §1)"`
    75|- [ ] **Stage 2 (≤15 min)**: 月历渲染 + 数据加载 + 月份切换
    76|  - `public/app.js` — `loadMonthCheckins(childId, year, month)` + `renderCalendar(year, month)` + ◀/▶ 切月事件
    77|  - 单测: `tests/unit/calendar-render.test.ts` (month calculation + grid + 边界日期上下月填充)
    78|  - E2E: `tests/e2e/ui-calendar-month-nav.spec.ts` (折叠 → 看到当月 → 点 ▶ 切下月 → 点 ◀ 切回)
    79|  - `git commit -m "feat(calendar): month grid render + prev/next nav (Item #006 §2)"`
    80|- [ ] **Stage 3 (≤15 min)**: 颜色档位 + 格子点击 → 当天明细 modal
    81|  - `public/app.js` — `getColorTier(count)` 4 档 + 格子 click → `showDayDetailModal(date)` 复用 #010 sprint modal 同套
    82|  - `public/app.css` — 4 档颜色 (gray / light-cyan / cyan / neon-cyan) + hover 浅光
    83|  - 单测: `tests/unit/calendar-color.test.ts` (档位逻辑)
    84|  - E2E: `tests/e2e/ui-calendar-day-detail.spec.ts` (点 6/15 → 弹 modal → 看任务列表)
    85|  - `git commit -m "feat(calendar): color tiers + day detail modal (Item #006 §3)"`
    86|- [x] **Stage 4 (≤10 min)**: 文档 + 视觉对齐 + 性能 ✅ (2026-06-20)
    87|  - 文档: PRD §3.13 新增 calendar 段 + TEST_PLAN §3.17 + FEATURE_MATRIX 标记 + PROGRESS v2.x
    88|  - 视觉对齐: 跟 #005 进度条 + #010 sprint modal + #011 running map 风格统一 (cyan 调色板)
    89|  - 性能验证: 1000+ 打卡记录时切月 <200ms (按月分页已保, perf test ✅)
    90|  - **🚫 不做**: 跨年统计 (留二期, 加 ◀/▶ 切年按钮); 任务列表导出 (留二期); wrangler deploy / git push
    91|  - `git commit -m "feat(calendar): docs + visual alignment + perf test (Item #006 §4)"`
    92|
    93|**Status**: ✅ done (verified by Qual 2026-06-20: e2e 12/12 pass + unit 313/313 pass)
    94|**风险**: 🟢 (UI-only, 复用 #010 modal + 现有 schema)
    95|**Started**: 2026-06-17
    96|**Commit (Stage 1)**: `0389c85` (calendar fold toggle + 7×6 grid scaffold + 6 单测全过)
    97|**Commit (Stage 2+3)**: `569e10c` (month grid render + prev/next nav + day detail modal + 2 API routes)
    98|**Commit (Stage 4)**: `c5d8c57` (docs + visual alignment + perf test + 1 new perf test)
    99|**Commit (PM-fix SQL bugs)**: `5abe507` (use user_id + DATE(unixepoch))
   100|**Commit (PM-fix toggle + render + time)**: `f2c82e6` (toggle click !nowCollapsed + race + optimistic UI + day-detail HH:MM)
   101|**Commit (PM-fix helper + e2e tests)**: `a4eb27b` (helper user_id + month-nav snapshot timing)
   102|**Commit (P1-A jsdom test)**: `ade11a1` (regex-only → happy-dom click test, 7 tests)
   103|**Completed**: 2026-06-20 (e2e green after Qual verification)
   104|**未做**: 全部完成 ✅
   105|
   106|---
   107|
   108|## Item #007 — 英雄头像选择 (个人化) ⏸ hold (用户 2026-06-08 暂缓)
   109|
   110|> 用户原话: 同上, "先 hold 一下"
   111|> 用户发了 1 张 Pacific Rim 风格 Jaeger 机甲图 (豆包 AI 生成, 蓝灰 + 黄眼 + 双蓝剑), 等 hold 解除后用作 B 方案 (上传图片) 候选
   112|
   113|**Status**: ⏸ hold
   114|**待拍板**: A/B/C 来源 + 2 Q
   115|**Commit**: —
   116|
   117|---
   118|
   119|## Item #008 — 任务装备/机甲化 (任务视觉) 🔧 running (Stage 1 done 2026-06-17, restart 2026-06-24 PM, 等 Stage 2/3/4)
   120|
   121|> 用户原话 (2026-06-08): "先 hold 一下"
   122|> 用户提到"小朋友喜欢机甲风格" → 当时推荐 B 方案
   123|> 2026-06-17 DM 拍板: "B + 夸张 + 独立"
   124|
   125|**已拍板 (2026-06-17)**:
   126|1. **方案 = B (机甲 HUD)**: 任务按钮框做成**机甲 HUD 角括号** + 霓虹青边框 + 扫描线
   127|2. **Q1 冲击 = 夸张**: **全屏 HUD 风格**, 任务像"装备舱", 改 child UI 任务区主布局
   128|3. **Q2 关联 #007 = 独立**: #008 自己一套, 跟 #007 Pacific Rim Jaeger 解耦, 不等 #007 拍板
   129|
   130|**Clarification** (PM 整理 2026-06-17):
   131|- **HUD 风格元素** (全屏, 覆盖 child UI 任务区):
   132|  - 角括号: 任务卡片四角加 ◢◤◣◥ 装饰 (CSS clip-path 或 SVG)
   133|  - 扫描线: 背景 `@keyframes scanline` 上下移动 (cyan 低不透明度 0.05)
   134|  - 霓虹青光: 边框 `box-shadow: 0 0 8px #00d4ff` + hover 加深
   135|  - 数据流背景: 任务区背景用 `repeating-linear-gradient` 网格底 (跟 #011 running map 同套)
   136|- **"装备舱"模式**: 任务完成时按钮**展开** → 显示"装备激活"动画 (类似机甲开机) → 短暂 hold 0.5s → 折回
   137|- **跟 #010 sprint modal 联动**: sprint modal 打开时全屏切换成 HUD "装备舱" 视角, 任务按钮变 "装备模块" 角括号
   138|- **跟 #011 联动**: running map 跟 HUD 任务区用同色板 (cyan + 深灰底), 视觉统一
   139|- **跟 #006 联动**: 月历格子未来可升级 HUD 角括号 (延后, 等 #006 拍板 cron 跑完)
   140|- **Q2 独立 = 不等 #007**: #008 自己定调 (霓虹青/扫描线), #007 后续拍板不影响 #008 实施
   141|- **⚠️ 风险升级**: 选"夸张"= 改 child UI 任务区主布局, 跟现有进度条/列表有冲突, 需 regression test
   142|- **⚠️ 性能**: 全屏扫描线动画要 60fps, 用 CSS `transform/opacity` 避免 reflow, 移动端需降级 (关扫描线保留角括号)
   143|- **可关闭性**: 视觉风格本身没有 toggle 按钮 (PM 拍板: 全屏总是开, 关闭可加 "🔧 经典模式" toggle 留二期)
   144|
   145|**Action Plan** (4 段, 每段 ≤ 15 min, anti-CC-Timeout):
   146|- [ ] **Stage 1 (≤15 min)**: 机甲 HUD CSS 组件库
   147|  - `public/app.css` — 新增 `.mecha-frame` + `.mecha-corner` + `.mecha-scanline` + `.mecha-glow` 样式 (角括号/扫描线/霓虹青光)
   148|  - 单元测试: `tests/unit/mecha-frame.test.ts` (DOM 节点 + 类名断言)
   149|  - `git commit -m "feat(mecha): HUD frame CSS components (Item #008 §1)"`
   150|- [ ] **Stage 2 (≤15 min)**: 任务按钮升级
   151|  - `public/index.html` — task button 加 `.mecha-frame` 类 (角括号)
   152|  - `public/app.css` — task button 适配 padding/border/font-size + hover 霓虹光
   153|  - 单测: `tests/unit/task-mecha-button.test.ts`
   154|  - E2E: `tests/e2e/ui-task-mecha-frame.spec.ts` (看到任务按钮是机甲 HUD 风)
   155|  - `git commit -m "feat(mecha): apply HUD frame to task buttons (Item #008 §2)"`
   156|- [ ] **Stage 3 (≤15 min)**: 全屏 HUD 装备舱模式 + 任务完成展开动画
   157|  - `public/app.css` — child UI 任务区背景 (扫描线 + 网格底 + 数据流) + 任务完成时按钮展开/折回动画 (CSS keyframes 0.5s)
   158|  - `public/app.js` — `triggerEquipActivation(taskId)` 触发完成时装备激活动画
   159|  - E2E: `tests/e2e/ui-equip-activation.spec.ts` (打卡 → 看到装备展开动画)
   160|  - 视觉对齐: 跟 #005 进度条 + #010 sprint modal + #011 running map 同色板
   161|  - `git commit -m "feat(mecha): fullscreen HUD cockpit + equip activation (Item #008 §3)"`
   162|- [ ] **Stage 4 (≤10 min)**: 文档 + 视觉对齐 + 性能 + regression
   163|  - 文档: PRD §3.x 新增 mecha frame 段 + TEST_PLAN §3.x + FEATURE_MATRIX + PROGRESS v2.x
   164|  - 性能: 全屏扫描线 60fps (CSS transform/opacity), 移动端降级 (关扫描线保留角括号, `@media (max-width: 768px)`)
   165|  - Regression: 跑全套 vitest + e2e, 确保 #005/#006/#010/#011 视觉不破
   166|  - **🚫 不做**: 跟 #007 同步 (Q2 独立); 经典模式 toggle (留二期); wrangler deploy / git push
   167|  - `git commit -m "feat(mecha): docs + perf + regression test (Item #008 §4)"`
   168|
   169|**Status**: ✅ done (2026-06-24 PM, 4 stages all merged, branch: `feat/008-mecha-stage2-4`)
   170|**风险**: 🔴 (UI-only 但全屏 HUD 改 child UI 任务区主区域, 跟 #005/#006/#010/#011 视觉有冲突, 需全量 regression; 选 C 方案需改 navigation)
   171|**Started**: 2026-06-17
   172|**Restarted**: 2026-06-24 (PM 手动启动, per `multi-working-tree-management` P19)
   173|**Commit (Stage 1)**: `1612a28` (HUD frame CSS 组件库 + 5 单测全过, on main)
   174|**Commit (Stage 2)**: `e813339` (apply HUD frame to task buttons, 4 files 327 LoC)
   175|**Commit (Stage 3)**: `c6647fd` (fullscreen HUD cockpit + equip activation, 4 files 434 LoC)
   176|**Commit (Stage 4)**: `c5edcd2` (PRD §3.14 + TEST_PLAN §3.20 + FEATURE_MATRIX 3.20 + PROGRESS v2.x, 4 files 149 LoC, PM 自实现)
   177|**完成**: 2026-06-24 (1 晚跑完, 3 晚预算 → 1 晚; 359/359 vitest pass + 10 e2e scenarios)
   178|**风险**: 🔴 → 已 mitigation (全套 359 pass)
   179|
   180|---
   181|
   182|## Item #013 — 跑步 Milestone 金币袋 + 重新撤销语义 (Re-derive) 🔧 running (Stage 2 完成 2026-06-24, 等 Stage 1/3-6)
   183|
   184|> 用户原话 (feihao 2026-06-22 飞书 DM):
   185|> - "我希望的是跑步的 Milestone 可以奖励的是随机的金币, 不是游戏时间"
   186|> - "在图片上面把这几个 Milestone 显示的秀出来"
   187|> - "每到一个 Milestone 的时候, 要有一个小动画, 显示出来一个小的金色袋子, 然后突然打开了之后, 得到了一些金币"
   188|> - "撤回的时候要注意把相关的 Coin 金币也一起撤回"
   189|> - "这个逻辑可能就比较复杂, 而且有可能会要撤回多次, 因为小朋友会多次点那个记录跑步的这个事件"
   190|
   191|**已拍板 (2026-06-22)**:
   192|1. **Milestone 奖励从 game_time (分钟) 改 coins**: score_event `type='coins'` (原 `type='game_time'`)
   193|2. **Q1 Tier = A (10 个节点全同档)**: DB 不加 `prize_tier` 列, 所有 milestone 共享 60/35/5 概率分布
   194|3. **Q2 金币数量 = A (保守)**: 60% 小 [1-2] / 30% 中 [2-4] / 10% 大 [5-10], **avg ≈ 2.55 金币/节点**
   195|4. **Q3 动画 = B (独立 modal)**: 新建 `#coin-bag-modal` (跟 sprint modal 同级别, 80% 屏), bag drop + 拉链开 + 金币飞溅 + 数字 fade in
   196|5. **R2 撤销 = Re-derive cascade**: 撤 record 后, 重新算 cum_km; 对**仍 reached** 的 milestone 自动补偿金币, 对**不再 reached** 的 milestone 反向扣金币. **多次撤 record 触发 cascade**
   197|6. **Admin 审核 = 不加 (默认 A)**: 跟 task 一致, submit 立即 auto-approve + 立即给 coins + 立即弹金币袋; PM 事后 X1 撤销升级为 R2 re-derive
   198|
   199|**Clarification** (PM 整理 2026-06-22):
   200|
   201|### 数据模型 (re-derive 必须的 schema 改动)
   202|
   203|**score_events 改造** (核心):
   204|- 现有: 1 record → 1 score_event (`type='game_time'`, `change_value=sum_of_minutes`, `source_ref="running:N"`)
   205|- 改: 1 record 跨 N 个 milestone → **N 个 score_events** (`type='coins'`, per-milestone amount, `source_ref="running:N:point:P"`)
   206|- 理由: 撤 record N 时, 需逐 milestone 判断是否仍 reached (cascade)
   207|
   208|**新 migration 0012** (2 个改动):
   209|- `ALTER TABLE running_records RENAME COLUMN awarded_minutes TO awarded_coins;` (语义改 coins)
   210|- score_events 表 schema **不变** (source_ref 本来就是 TEXT, 装新格式 OK)
   211|- 历史 record 兼容: 改前跑的 record 仍 `type='game_time'` 旧 source_ref, 不迁; 新 record 走新格式; PM 撤老 record 走**旧 X1 简单 reverse**, 撤新 record 走**R2 cascade**
   212|
   213|### Re-derive 算法 (Stage 1 核心实现, ~80 LoC)
   214|
   215|`src/utils/running-rederive.ts` 新文件, 3 个 export 函数:
   216|
   217|```ts
   218|// 1. Recompute cum_km from non-revoked records
   219|export async function recomputeCumKm(db, childId, mapId): number
   220|
   221|// 2. Re-derive score_events for a single record revoke
   222|export async function rederiveRecordRevoke(
   223|  db, recordId, pmUserId
   224|): { newCumKm, netCoinChange, compensatedMilestones, reversedMilestones }
   225|
   226|// 3. Audit log helper
   227|export async function writeRevokeAuditLog(db, recordId, details): void
   228|```
   229|
   230|**`rederiveRecordRevoke` 步骤** (R2 spec):
   231|```
   232|1. UPDATE running_records SET revoked_at=now, revoked_by=pmId WHERE id=N
   233|2. newCumKm = recomputeCumKm(childId, mapId)  // SUM of non-revoked records
   234|3. For each milestone P in map (ORDER BY cum_km):
   235|   a. 找原 score_events: source_ref LIKE "running:N:point:P" (this record's award)
   236|   b. 找 active score_events: source_ref LIKE "running:%:point:P" WHERE record 在 non-revoked
   237|   c. P 在 newCumKm 仍 reached (newCumKm >= P.cum_km):
   238|      - 如果原 award 存在 (a) 但 (b) 无 active: 写 compensation (+coins, source_ref="running:N:point:P:compensation", reason="compensation for revoked record N")
   239|      - 如果 (b) 已有 active: skip (其他 record 已给过)
   240|   d. P 不再 reached (newCumKm < P.cum_km):
   241|      - 写 reverse (-coins, source_ref="running:N:point:P:reverse", reason="reverse milestone P due to record N revoke")
   242|4. UPDATE running_progress SET cum_km=newCum
   243|5. audit_log: 写明 cascade 详情
   244|6. return summary
   245|```
   246|
   247|### Cascade 例子 (4 个 case, 涵盖用户担心的"多次撤回"场景)
   248|
   249|**Case 1**: kid 跑 5 次 (3+3+3+3+3=15 km), 跨 8 km 一次 (t3)
   250|- t3: 跨 8 km, +2 coins (`source_ref="running:3:point:1"`)
   251|- 撤 t3: cum_km 12, 8 km 仍 reached, **+2 写 compensation** (同 amount, source_ref 加 `:compensation`), 净金币不变 ✓
   252|
   253|**Case 2**: 上面 case, PM 撤 t5 (3 km)
   254|- t3 仍 active, 8 km 仍 reached. 撤 t5: cum_km 12 (没变), **no change** (t3 的 award 仍 valid)
   255|
   256|**Case 3**: 上面 case, PM 撤 t3 + t4 + t5 (3 次撤, 串行)
   257|- 撤 t5: cum_km 12, 8 km 仍 reached (6+3+3=12), no change
   258|- 撤 t4: cum_km 9, 8 km 仍 reached, no change
   259|- 撤 t3: cum_km 6, 8 km **不再 reached**, **-2 金币** (写 reverse)
   260|
   261|**Case 4** (用户最担心, kid 跑 5 次跨 5 个 milestone): 8+14+10+13+13=58 km
   262|- 跨 8/22/32/45/58 共 5 个 milestone, +2×5=+10 coins (5 个 score_event)
   263|- PM 撤 t1 (8 km, 8 km milestone 是 t1 跨的): cum_km 50
   264|  - milestone 8/22/32/45 仍 reached (cum_km 50 ≥ all): **4 个 compensation**
   265|  - milestone 58 不再 reached (50 < 58): **1 个 reverse (-2)**
   266|  - 净: -2 (从 +10 → +8) ✓ (符合"撤 1 个 record, 净 -2" 的直观)
   267|
   268|### 视觉: 地图 milestone 节点 (Q1=A 全同档, 但"秀出来")
   269|
   270|**视觉方案** (Q1=A 不分 tier, 但明显比当前 #011 默认版):
   271|- 节点圆 r 从 7 → **10** (放大 1.4x)
   272|- 节点加 🎯 emoji hint (中心位置, 9px, Share Tech Mono 字体)
   273|- 当前节点 r=12 + cyan glow (放大 + 高亮)
   274|- reached 节点 cyan (浅)
   275|- unreached 节点 灰 + 0.5 opacity (半透, "待发现" 提示)
   276|- Title 加 progress badge: "🏁 5 / 10 Milestones · 50.0 / 95 km"
   277|
   278|### 金币袋动画 (Q3=B 独立 modal, 80% 屏)
   279|
   280|**Modal 结构** (跟 sprint modal 同级别):
   281|```html
   282|<div id="coin-bag-modal" class="modal-back" hidden>
   283|  <div class="modal coin-bag-modal">
   284|    <h2 class="modal-title">🎉 恭喜到达 嘉定新城!</h2>
   285|    <div class="coin-bag-stage">
   286|      <div class="coin-bag" id="coin-bag-graphic">👜</div>
   287|      <div class="coin-bag-coin coin-bag-coin-1">🪙</div>
   288|      <!-- ... 8-10 coin divs ... -->
   289|    </div>
   290|    <div class="coin-bag-amount" id="coin-bag-amount">+2</div>
   291|    <div class="coin-bag-unit">枚 金币</div>
   292|    <div class="modal-actions">
   293|      <button id="coin-bag-close" class="btn btn-primary">继续跑!</button>
   294|    </div>
   295|  </div>
   296|</div>
   297|```
   298|
   299|**3 阶段动画** (总 3s, 全部 CSS keyframes + JS trigger):
   300|1. **0-0.8s Drop**: bag 从 modal 顶部 `translateY(-200px) → 0`, 落地 bounce (`scale 0.95→1.05→1.0`)
   301|2. **0.8-1.6s Open**: bag shake (`rotate 2deg ↔ -2deg` × 4 次), 拉链线 ::after pseudo opacity 1→0 (开了)
   302|3. **1.6-2.5s Scatter**: 8-10 个小金币从袋口飞出 (`translateY(0) → -100px` + random `translateX(±50px)`, opacity 1→0, 不同角度)
   303|4. **2.5-3.0s Reveal**: "+X 枚" 大数字 fade in (`opacity 0→1`, `scale 0.8→1.0`), 按钮出现
   304|5. **3.0s+ Close**: 用户点 "继续跑!" → modal fade out 0.3s
   305|
   306|**音效 (用户拍板)**: A 不加 / B 加 (开袋 "jingle" + 金币 "ding", 用 `<audio>` tag 自动 play)
   307|
   308|### R2 撤销 UI (PM admin)
   309|
   310|**入口**: admin UI 跑步记录列表, 每行 "↩ 撤销" 按钮 (现有 X1)
   311|**点击后**:
   312|- 二次确认弹窗: "确认撤销 8 km 跑步 (2026-06-22 14:30)? **净金币变化: -2** (5 milestone 中 4 个仍 reached, 自动补偿; 1 个 58 km milestone 不再 reached, 反向扣)"
   313|- 确认 → POST `/api/admin/running/records/:id/revoke`
   314|- 后端跑 `rederiveRecordRevoke()`
   315|- 响应: `{ new_cum_km, net_coin_change, compensated_milestones, reversed_milestones }`
   316|- UI: toast "撤了 record N, 净 -2 金币" + 更新 balance card
   317|
   318|### 兼容性 (跟老 X1 共存)
   319|
   320|- **新 record** (Stage 2 之后): `source_ref="running:N:point:P"`, type='coins', 撤走 R2 cascade
   321|- **老 record** (改前跑的): `source_ref="running:N"` (旧), type='game_time', 撤走**旧 X1 简单 reverse** (无 cascade, 只 reverse 单个 score_event)
   322|- **production D1 已有数据**: 不迁, 老 record 仍走旧路径; 新 record 走新路径
   323|- **可观测**: PM 在 admin UI 看到 "已迁移" 标志, 知道哪些 record 走老逻辑 (留 §6 optional migration task)
   324|
   325|### Out of Scope (留二期)
   326|
   327|- 音效 (等用户拍板)
   328|- 历史 record 迁移 (Stage 6 之后可选)
   329|- multi-map 通关跨图 (新 002 苏州→杭州 地图在 #011 二期, 跟 #013 无关)
   330|- wrangler deploy / git push (cron 红灯规则)
   331|- PM 主动 add 跑步记录 (admin 手动加 km)
   332|
   333|**Action Plan** (6 段, 每段 ≤ 20 min, anti-CC-Timeout):
   334|
   335|- [ ] **Stage 1 (≤20 min)**: Re-derive 基础设施 (无 UI 变化)
   336|  - `src/utils/running-rederive.ts` (新文件, ~80 LoC): `recomputeCumKm()`, `rederiveRecordRevoke()`, `writeRevokeAuditLog()`
   337|  - `src/routes/running/records.ts` 改: 1 record 写 N score_events (per-milestone, source_ref="running:N:point:P")
   338|  - 单元测试: `tests/unit/running-rederive.test.ts` (~60 LoC, **8 个 case**: Case 1-4 + 边界: 撤不存在的 record, milestone 在边界 cum_km 上, 老 record 走旧逻辑, audit_log 写入)
   339|  - **依赖**: Stage 2 之前完成 (改 source_ref 格式, 改 type=coins)
   340|  - `git commit -m "feat(running): re-derive cascade on revoke (Item #013 §1)"`
   341|
   342|- [ ] **Stage 2 (≤15 min)**: prize.ts 改 coins ✅ (2026-06-24)
   343|  - `src/routes/running/prize.ts` 改: `rollPrize()` → `rollCoinPrize()` (60% [1-2] / 30% [2-4] / 10% [5-10])
   344|  - `src/routes/running/records.ts` 改: score_event `type='game_time'` → `type='coins'`, `change_value` 改 coins
   345|  - 新 migration `0012_rename_awarded_coins.sql`: `ALTER TABLE running_records RENAME COLUMN awarded_minutes TO awarded_coins;`
   346|  - 单元测试: `tests/unit/running-prize.test.ts` (8 个 case 验证分布: 1.0 概率总和, range 正确, 多次抽样 avg 接近 2.55)
   347|  - **🚫 不做**: 历史 record 迁移 (共存, 老 record 仍 type='game_time')
   348|  - `git commit -m "feat(running): rollCoinPrize + score_event type=coins + migration 0012 (Item #013 §2)"`
   349|
   350|- [ ] **Stage 3 (≤20 min)**: SVG 地图 milestone 视觉
   351|  - `public/app.js` 改: `renderRunningMap()` 节点 r 7→10, 加 🎯 emoji hint, unreached 0.5 opacity
   352|  - `public/app.js` 改: title 加 progress badge "🏁 X / 10 Milestones · X.X / 95 km"
   353|  - `public/app.css` 加: `.running-node.current` r=12 + cyan glow, `.running-node.unreached` opacity 0.5, `.running-node-icon` 9px Share Tech Mono
   354|  - 单测: `tests/unit/running-map-render.test.ts` (~40 LoC, 5 case: 10 节点生成, badge 文本格式, unreached opacity 0.5, current r=12)
   355|  - E2E: `tests/e2e/ui-running-map-milestones.spec.ts` (~50 LoC, 验证 iPad 视口 10 节点 visible, badge 文案)
   356|  - `git commit -m "feat(running): SVG map milestone visual emphasis (Item #013 §3)"`
   357|
   358|- [ ] **Stage 4 (≤20 min)**: #coin-bag-modal HTML + CSS
   359|  - `public/index.html` 加: `#coin-bag-modal` (跟 sprint modal 同级别, 80% 屏, 包含 bag graphic + 8-10 coin slots + 大数字 + 按钮)
   360|  - `public/app.css` 加: `.coin-bag-*` 全部样式 (~100 LoC), 4 阶段 @keyframes (drop-bounce, bag-shake-open, coin-scatter, number-fade)
   361|  - 单元测试: `tests/unit/coin-bag-modal.test.ts` (~30 LoC, DOM 节点 + 类名 + hidden default)
   362|  - **🚫 不做**: 触发逻辑 (Stage 5), 音效 (用户拍板)
   363|  - `git commit -m "feat(running): coin bag modal HTML + CSS animation (Item #013 §4)"`
   364|
   365|- [ ] **Stage 5 (≤20 min)**: 触发逻辑 + 数据绑定
   366|  - `public/app.js` 改: `showCoinBagModal(point, coins)` 函数 (~50 LoC) — 替代 `showGiftModal()`, 接 award_coins, 触发 3 阶段动画
   367|  - `public/app.js` 改: `submitRunning()` 成功后, 遍历 `response.new_points_reached[]`, **sequential 队列** (1 个 bag modal 完才弹下 1 个)
   368|  - `public/app.js` 改: `running-gift-modal` 移除 (or mark deprecated, Stage 6 删)
   369|  - 单测: `tests/unit/coin-bag-modal-trigger.test.ts` (~40 LoC, 6 case: 1 milestone → 1 modal, 3 milestones → 3 sequential, modal close → next trigger, user close mid-animation)
   370|  - E2E: `tests/e2e/ui-coin-bag.spec.ts` (~60 LoC, 跑 8 km → 看到 bag drop 动画 + 数字 +2 + 按钮)
   371|  - **🚫 不做**: 音效, 老 gift modal 兼容 (Stage 6 一并删)
   372|  - `git commit -m "feat(running): coin bag modal trigger + sequential queue (Item #013 §5)"`
   373|
   374|- [ ] **Stage 6 (≤15 min)**: Admin 撤销 UI + cascade summary + 文档
   375|  - `src/routes/admin/running.ts` (新文件, ~80 LoC): `POST /api/admin/running/records/:id/revoke` 调 `rederiveRecordRevoke()`, 返 cascade summary JSON
   376|  - `public/admin.html` + `public/admin.js` 加: 跑步记录列表 (table) + "↩ 撤销" 按钮 (每行) + 二次确认弹窗 (显示**净金币变化 + cascade 详情**)
   377|  - `src/worker.ts` 注册新 route
   378|  - 单元测试: `tests/unit/admin-running-revoke.test.ts` (~50 LoC, 4 case: cascade 正确性, audit_log, 老 record 走旧 X1, 401 鉴权)
   379|  - E2E: `tests/e2e/admin-running-revoke.spec.ts` (~60 LoC, PM 撤 1 record, 验证 cum_km 回退 + 金币 cascade + balance card 更新 + list 刷新)
   380|  - 文档: `docs/PRD.md` §3.6 加 "Milestone 金币袋动画" 段 + `docs/TEST_PLAN.md` §3.18 + `docs/FEATURE_MATRIX.md` 标记 ✅ + `docs/PROGRESS.md` v2.x
   381|  - 视觉对齐: bag modal 跟 #005/#010/#011 cyan 风格统一
   382|  - Regression: `npx vitest run` + `npx playwright test` 全套
   383|  - **🚫 不做**: 音效, 历史 record 迁移 (留二期), wrangler deploy / git push
   384|  - `git commit -m "feat(running): admin revoke UI + cascade summary + docs (Item #013 §6)"`
   385|
   386|**Status**: 🔧 running (Stage 2 done 2026-06-24, 等 Stage 1 / 3 / 4 / 5 / 6)
   387|**风险**: 🔴 (改核心 invariant: reward semantic + revoke 逻辑 + modal flow; 6 stage 跨 5+ 文件, 需全套 regression; re-derive 算法需 careful audit_log 设计; UI 动画 + admin 双向改动, 一个 stage 错影响整体)
   388|**Started**: 2026-06-24
   389|**Commit (Stage 2)**: — (pending commit this cron run)
   390|**未做**: Stage 1 (re-derive 基础设施) / Stage 3 (SVG milestone 视觉) / Stage 4 (coin bag modal HTML+CSS) / Stage 5 (触发逻辑 + 数据绑定) / Stage 6 (Admin 撤销 UI + cascade summary + 文档)
   391|**依赖**: 不依赖 #008 (并行可跑); 不依赖 cron (PM 手动按 stage 启 CC, 1 stage 1 PR)
   392|**估算**: 总 **~400 LoC + ~330 LoC 测试**, 6 PR, **3 晚 cron** (Stage 1+2 一晚, 3+4 一晚, 5+6 一晚; 每晚 ≤2h 预算, ~3-4 stage/晚 实际)
   393|**音效**: 用户拍板后再加 (Stage 5/6 之间插, ~20 LoC JS)
   394|**老 record 迁移**: Stage 6 之后可选, 不在 #013 scope
   395|**跨图 (002 苏州→杭州)**: 留二期, 不在 #013 scope
   396|
   397|---
   398|
   399|## 📦 归档 (用户 2026-06-08 拍板: 全部不实现, 留历史参考)
   400|
   401|---
   402|
   403|## Item #008 — 任务装备/机甲化 (任务视觉) ✅ done (2026-06-24, 4 stages all merged)
   404|
   405|**用户原话** (feihao 2026-06-08 NIGHTLY-TODO):
   406|> "在 NIGHTLY-TODO 里加个 idea: 把任务做成机甲风格, 小朋友喜欢机甲"
   407|
   408|**Completed**: 2026-06-24 (1 晚跑完, 3 晚预算)
   409|**风险**: 🔴 → 已 mitigation (全套 359/359 vitest pass + 10 e2e scenarios green)
   410|**Branch**: `feat/008-mecha-stage2-4` (from `origin/main` HEAD `c5cfcd7`, per P19)
   411|**Commits**:
   412|- `1612a28` (Stage 1 on main: HUD frame CSS 组件库 + 5 单测全过)
   413|- `e813339` (Stage 2: apply HUD frame to task buttons, 4 files 327 LoC)
   414|- `c6647fd` (Stage 3: fullscreen HUD cockpit + equip activation, 4 files 434 LoC)
   415|- `c5edcd2` (Stage 4: docs + visual alignment + perf + regression, 4 files 149 LoC, PM 自实现)
   416|
   417|**说明**: 4 个 stage 全部 done. UI-only 无 schema 改动. cyan 调色板跟 #005/#010/#011 完全统一. mobile 降级 (≤ 480px) scanline 关闭 + corner 隐藏, 60fps 性能不降. 跟 #007 解耦 (Q2 独立). CC 跑 Stage 2+3, PM 自实现 Stage 4 (per feihao-pm-autonomy §4c Option A).
   418|
   419|---
   420|
   421|## Item #011 — 跑步小地图 + 积分礼包 (上海→苏州 主题) ✅ done (PR #42 merged 2026-06-21)
   422|
   423|**用户原话** (feihao 2026-06-17 飞书 DM):
   424|> "在 Nightly Todo 里再增加一个功能：记录跑步的每次公里数，并绘制一个小地图。每一次跑了多远的距离，会在一个虚拟的小地图上，从一个点移动到另一个点。当到达一个新的点位时（比如跑到10公里），可以开一个小礼包，礼包里有一个随机的积分"
   425|
   426|**Status**: ✅ done (PR #42 merged 2026-06-21, commit `7ce8a63`)
   427|**风险**: 🟡
   428|**Completed**: 2026-06-21
   429|**Commit (Stage 1)**: `d4be219` (3 张表 schema + 上海→苏州 10 个点位 seed + 8 单测全过)
   430|**Commit (Stage 2)**: `90c04d1` (child check-in modal + km submission + 7 e2e scenarios)
   431|**Commit (Stage 3-4)**: `7ce8a63` (SVG map + PM admin revoke, PR #42)
   432|**说明**: 4 个 stage 全部 merged, 详情见归档段
   433|---
   434|
   435|## Item #012 — Calendar icon 渲染 + Tab 筛选 ✅ done (PR #43 merged 2026-06-21)
   436|
   437|**用户原话** (feihao 2026-06-20):
   438|> "日历的地方有一个问题，我不希望只显示数字，而是希望显示那个他任务完成的对应的小图标。并且增加几个Tab，可以单独筛选：1. 看所有的 2. 筛选特定的任务"
   439|
   440|**Completed**: 2026-06-21 (PR #43 merged, commit `8d89de5`)
   441|**Commits**:
   442|- `8d89de5` (Stage 1-4: cell icons + tab filter + localStorage, PR #43)
   443|
   444|**说明**: 4 个 stage 全部 merged to main, 1 atomic PR. UI-only + 2 API 端点改动, schema 不变, 跟 #006 已 verify pattern 复用. Stage 2 之前 PM 自实现 (CC spawn 401 5次连续 fail 后 pivot, per `cc-pm-spawn-pitfalls` 坑 11).
   445|
   446|---
   447|
   448|## Item #001 — Admin 加任务 UI 加 emoji 选择器 (20 个预设) ✅
   449|
   450|**用户原话**:
   451|> "我的Admin的那个界面里边加新的每日任务的界面里边，它的emoji是要自己敲进去的。你能不能放几个选项，和小朋友的生活、学习、习惯这些是比较相关的emoji？大概放20个吧"
   452|
   453|**Status**: ✅ done (commit `fca735b`, 2026-06-07)
   454|**风险**: 🟢
   455|
   456|**说明**: 实际**已经实现并 deploy** (PR + commit 已落 main, 用户 iPad 可用), 不是"没做"。
   457|
   458|---
   459|
   460|## Item #002 — "准时上床" 打卡 + 倒计时 + 自动 lockout ✅
   461|
   462|**用户原话**:
   463|> "002不要填时间了吧，我们就留一个打卡任务，准时上床就可以了，那就不用加了"
   464|> "超过 930 之后打卡按钮变灰色不可打。那个按钮上需要加个倒计时提醒超过 930 就不可以打了"
   465|
   466|**Clarification** (PM 整理):
   467|- **简化方案** (用户 2026-06-06 两次拍板):
   468|  - 任务: **"准时上床"** 单一打卡, **不录具体时间**
   469|  - 加分: **+1 min/天** (孩子点 "✓ 我 9:30 之前上床了" → 自动 +1)
   470|  - 没打卡: 0 (不扣分, 不扣时间)
   471|  - **取消** per-minute 算法 (早 1min+1 / 晚 1min-1)
   472|- **UI 行为** (用户拍板):
   473|  - 按钮上**实时倒计时**: "距离 9:30 还剩 HH:MM:SS" (PM 默认, 不同意告诉我)
   474|  - 9:30 之前: 按钮可点
   475|  - 9:30 之后: 按钮**变灰 + 不可点** (自动 lockout, 防造假)
   476|  - **自动 lockout 替代了 PM 审核** — 异常单问题不存在了
   477|- 风险: 🟢
   478|
   479|**Status**: ✅ done (commits `5e7b3b7`/`1d44626`/`76be819`/`be595bb`, 2026-06-07/08)
   480|
   481|**说明**: **已实现 + deploy**, e2e spec 11 个场景全过。
   482|
   483|---
   484|
   485|## Item #003 — 英语阅读 track (工作日 2 本 / 周末 4 本 = +2 min) 🚫
   486|
   487|**用户原话**:
   488|> "每天英语阅读，完成两本的quiz。这个可以加1分钟的时间。"
   489|
   490|**简化方案** (用户 2026-06-06):
   491|- **工作日** (周一-周五, 5天): 完成 2 本 quiz = +2 min
   492|- **周末** (周六-周日, 2天): 完成 4 本 quiz = +2 min
   493|- **取消** 1本/2本/3本 阶梯
   494|
   495|**未拍板的 Clarification (2 Q)**:
   496|1. verify 方式: PM 手动 confirm, 还是孩子自查?
   497|2. "周末" 定义: 仅周六+周日? 节假日按工作日?
   498|
   499|**Status**: 🚫 blocked → 2026-06-08 用户归档
   500|**风险**: 🟢 (新 schema 字段 + per-weekday logic)
   501|
   502|---
   503|
   504|## Item #004 — 举一反三 track + 老师投诉扣分 🚫
   505|
   506|**用户原话**:
   507|> "举一反三，完成一个章节也可以加1分钟的时间。然后就是去学校的时候有没有老师投诉？如果有投诉的话就要扣的话是从20元人民币起，然后这个我可以调"
   508|
   509|**简化方案** (用户 2026-06-06):
   510|- **举一反三**: 每天 1 本 = +1 min (每天都, 不分工作日)
   511|- **老师投诉**: 默认 -20 min/次, PM 在 Admin UI 可调
   512|
   513|**未拍板的 Clarification (4 Q)**:
   514|1. "20 元" 是 -20 min 还是 -20 token?
   515|2. 老师投诉谁记: PM 手动, 还是孩子自报?
   516|3. 一周内多次投诉累加吗? (不封顶?)
   517|4. PM 改 penalty 后, 立即生效还是只新 task 生效?
   518|
   519|**Status**: 🚫 blocked → 2026-06-08 用户归档
   520|**风险**: 🟡 (新 task type + UI 加 PM 调整 penalty 字段)
   521|
   522|---
   523|
   524|## Item #005 — 三进度条系统 (当日 / 本月 / 当年) ⭐ ✅
   525|
   526|**用户原话**:
   527|> "我觉得可以用完成任务总数有个进度条，当日是否有全部完成有个进度条"
   528|
   529|**方案** (用户 2026-06-06 拍板):
   530|- **进度条 A (本月)**: 默认 100/月
   531|- **进度条 B (当年)**: 默认 1200/年
   532|- **进度条 C (当日)**: 100% 触发**全屏撒花 + "Combo!"** (daily-once, localStorage 防刷屏)
   533|
   534|**Status**: ✅ done (commit `ec26430`, 2026-06-07)
   535|**风险**: 🟢
   536|
   537|**说明**: **已实现 + deploy**, 含 daily-once 撒花, 跟自驱力 3 件套 (Autonomy/Mastery/Purpose) 完美契合。
   538|
   539|---
   540|
   541|## Item #009 — Admin 物理删除打卡记录 (紧急, 待拍板) 🔥 ✅
   542|
   543|**用户原话**:
   544|> "我现在需要紧急在 admin 界面里增加把撤销掉的打卡习惯再撤销回来掉, 相当于删掉这条记录。删掉记录意味着允许再次打卡"
   545|
   546|**Clarification** (PM 整理, 拍板用):
   547|- **背景**: 现有 PM 可以"撤销"打卡 (软删, `status='revoked'`, 留 audit_log), 但记录还在, 孩子**当天不能再打卡** (去重逻辑)
   548|- **新需求**: 物理删除 score_event (或 task_completion) 记录, 让记录**完全消失**, 孩子可重新打卡
   549|- **跟现有原则冲突**:
   550|  - 之前 M11 笔记: "软删 status='revoked' + 审计 log 不可删"
   551|  - 现要物理删, 违反"软删"原则
   552|  - 折中: **物理删 event/completion 记录, 但 audit_log 写一条 "event_hard_deleted" + 原始数据 JSON** (审计可追溯, 数据不可恢复)
   553|- **风险**: 🔴 高 (物理删, 不可恢复, 只能靠 deleted_records 表找回)
   554|- **实施范围**: C (两个都要, score_event + task_completion)
   555|- **谁能用**: A (PM only, 二次确认弹窗, audit log 强制写)
   556|- **删除后列表显示**: B (灰色"已删除"标记, 含删除时间 + 谁删)
   557|- **新表设计** (避免再删 audit_log): 物理删的记录移到 `deleted_records` 表 (含 `record_type`, `original_id`, `original_data JSON`, `deleted_at`, `deleted_by`, `original_table`)
   558|
   559|**已拍板** (用户 2026-06-08):
   560|1. ✅ **范围**: C (两个都要)
   561|2. ✅ **谁能用**: A (PM only, 二次确认)
   562|3. ✅ **删除后列表显示**: B (灰色"已删除"标记)
   563|
   564|**Status**: ✅ done (PR commit `9c95c4d` + 子 commits `5e4d5fa`/`b96a8be`/`e03c474`/`7375a7d`/`bcd90ff`, 2026-06-08)
   565|**风险**: 🔴
   566|**Started**: 2026-06-08
   567|**Completed**: 2026-06-08
   568|
   569|**说明**: **已实现 + 全部 5 段子 commit + PR merged 到 main**:
   570|- `5e4d5fa` 第 1 段: migration `0006_deleted_records.sql` + unit test 基线
   571|- `b96a8be` 第 2 段: 3 helpers + score_event `POST /:id/hard-delete` endpoint
   572|- `e03c474` 第 3 段: task_completion `POST /:id/hard-delete` endpoint
   573|- `7375a7d` 第 4 段: admin UI "🗑 永久删除" 按钮 + confirm 弹窗 + 灰显 marker
   574|- `bcd90ff` 第 5 段: PRD §3.5 + TEST_PLAN §3.15 + FEATURE_MATRIX + PROGRESS v2.2 文档
   575|- `9c95c4d` PR merge (`#009, v2.2`)
   576|
   577|单元测试 8/8 ✅ (deleted-records + admin-events-hard-delete + admin-task-completions-hard-delete)。
   578|cron 2026-06-10 清理孤儿 in_progress 标记。
   579|
   580|## Item #010 — Child UI 任务冲刺弹窗 (游戏化专注感) ✅
   581|
   582|**用户原话** (feihao 2026-06-10 飞书 DM):
   583|> "帮我在 nightly todo 上再新加一个 item 内容是针对 user 的界面,目前的界面上,任务的部分就点击之后就只有一个完成。我希望他点击了那个任务之后,开启一个新的弹窗,弹窗上显示: 1. 任务的详情和图片 2. 显示这个任务正在冲刺中 3. 如果是一个倒计时任务的话,在比较大的页面上弹出一个倒计时数字 4. 下面有一个打卡按钮"
   584|
   585|**Status**: ✅ done (commit `700da9a`, 2026-06-16)
   586|**风险**: 🟡 (UI-only)
   587|**Started**: 2026-06-10
   588|**Completed**: 2026-06-16
   589|
   590|**说明**: sprint modal DOM + CSS + show/hide/countdown + sprint-urgency.test.ts 在 2026-06-15 之前 cron 已实现 (但 NIGHTLY-TODO.md 没归档). 2026-06-16 cron 补上唯一缺失的 `src/utils/sprint-urgency.ts` (17 行) 让单测 8/8 通过. **未做** (留待 PR 阶段): click 改造 (task 按钮 → showSprintModal) + 关闭交互 (X/backdrop/Esc) + e2e playwright spec + PRD/TEST_PLAN/FEATURE_MATRIX 文档 + PR. 下轮 cron 接着跑第 2-3 段. 注意: index.html 里 sprint-modal 骨架出现两次 (line 252 + line 272), 可能是上几轮重复 insert 造成, 需 cleanup.
   591|
   592|---
   593|
   594|## Item #011 — 跑步小地图 + 积分礼包 (上海→苏州 主题) 🔧 running (manually restarted 2026-06-22, branch: feat/running-map-stage3-4, 等 Stage 3-4)
   595|
   596|**用户原话** (feihao 2026-06-17 飞书 DM):
   597|> "在 Nightly Todo 里再增加一个功能：记录跑步的每次公里数，并绘制一个小地图。每一次跑了多远的距离，会在一个虚拟的小地图上，从一个点移动到另一个点。当到达一个新的点位时（比如跑到10公里），可以开一个小礼包，礼包里有一个随机的积分"
   598|
   599|**用户拍板 (2026-06-17)**:
   600|1. **多张地图 + 第一张 = 上海→苏州**: 起点上海普陀区, 终点苏州. 总距离 ~95 km (普陀→苏州园区公路). **不均距**切 10 个目标, 路线曲折非直线, 有变化节奏.
   601|2. **风格 = 科技风手绘** (B2): 跟现有 child UI 视觉一致 (cyan glow + 网格底), 路径为自由曲线 SVG, 各目的地之间非直线连接.
   602|3. **推进方式 = C2**: 累计总公里数推进小人位置; 距离增长与本次打卡距离成正比; 一次打卡小人只前进一步 (不闪现).
   603|4. **积分概率分布 (D3)**: 60% 小奖 1-5, 35% 中奖 5-10, 5% 大奖 10-20. 每到一个**新点位** roll 一次.
   604|5. **录入 = E1**: 孩子点 🏃 emoji → 弹输入框填公里数 → 提交; **后台 PM 可撤销** (跟现有 score_event revoke 走相同审计模式).
   605|6. **多图通关**: 第一张 (上海→苏州) 跑完后, 孩子"通关"动画 → 开启下一张地图 (例如 苏州→杭州, 计划二期). 本期只做第 1 张.
   606|
   607|**Clarification** (PM 整理):
   608|- **数据模型 (3 张新表)**:
   609|  - `running_maps` (id, name, theme, total_km, is_active, display_order) — 主题地图清单
   610|  - `running_points` (id, map_id, name, order_index, cum_km) — 每个点的累计 km (含起点 0 km, 终点 95 km)
   611|  - `running_records` (id, child_id, map_id, km, awarded_point_id, awarded_minutes, created_at, revoked_at, revoked_by) — 每次打卡
   612|- **点位设计 (10 个, 不均距, 上海→苏州)** — Stage 1 由 CC 设计 seed:
   613|  - 0 km: 🏁 上海·普陀区 (起点)
   614|  - 1: ~8 km: 嘉定新城
   615|  - 2: ~22 km: 太仓
   616|  - 3: ~32 km: 昆山花桥
   617|  - 4: ~45 km: 昆山城区
   618|  - 5: ~58 km: 阳澄湖
   619|  - 6: ~72 km: 苏州相城区
   620|  - 7: ~82 km: 苏州姑苏区
   621|  - 8: ~89 km: 苏州工业园区
   622|  - 9: ~95 km: 🚩 苏州·金鸡湖 (终点)
   623|  - 设计原则: 8 次打卡完成 (一次 3-4 km × 8 = 24-32 km 太慢, 应让单次 3-4 km 推进感明显, 总 95 km 是**目标里程**而非时间)
   624|  - 调整: 实际点位 km 待 Stage 1 由 CC 查百度/高德确认, 不强制照搬上述数字
   625|- **小地图渲染**: SVG 500×300 viewBox, 路径用 `<path d="M ... C ... ">` cubic Bezier 拼成曲折线, 节点用 `<circle>` + 名称 label, 小人用 `<image href="...">` 或 emoji 字符. 进度按累计 cum_km / total_km 计算小人 position.
   626|- **礼物 modal**: 跟 #010 sprint modal 同套 CSS, 标题 "🎁 通关奖励!" / "🎁 到达 X 地点!", 中央大数字显示积分 (e.g. "+8 min"), "再跑一次" 关闭按钮.
   627|- **撤销语义 (X1 修订 2026-06-17)**: PM 在 admin UI 看到 running_records 列表, 可点 "↩ 撤销" (二次确认弹窗防误操作) → 写入 revoked_at + revoked_by + 减回积分 + **回退累计 km** (完全撤销本次记录, 跟 #009 硬删语义保持一致). **理由**: 防误点 (feihao 2026-06-17 拍板). 后续打卡按"撤销后累计"重新推进; 如果撤销后累计低于当前 point, 小人**自动回退**到对应 point.
   628|- **跨图解锁 (X2 修订 2026-06-17)**: 通关时 (cum_km >= total_km) 孩子界面弹大图恭喜 modal (跟礼物 modal 同样式, 80% 屏, 居中卡片, 撒花动画) → 标题 "🎉 恭喜通关! 上海→苏州" + 显示累计跑步次数/总 km/用时天数 + "查看下一张地图" 按钮 → **自动** `UPDATE running_maps SET is_active=1 WHERE display_order = current.display_order + 1`. 如果没有下一张 map, 显示 "🌍 等待 PM 制作下一张地图...". 本期只 seed 第 1 张; 第 2/3 张可以先 INSERT is_active=0 占位 (id=2,3, name 待定), 通关时若无下一张就显示等待页.
   629|- **可关闭性**: 孩子可 "🏃" 跳过 (不打卡), 地图仍可看, 不会强制跑步
   630|
   631|**Action Plan** (4 段, 每段 ≤ 15 min, anti-CC-Timeout):
   632|- [ ] **Stage 1 (≤15 min)**: D1 schema + seed
   633|  - `migrations/0007_running_tables.sql` (3 张表: running_maps / running_points / running_records)
   634|  - `migrations/0008_seed_shanghai_suzhou.sql` (第 1 张地图 + 10 个点 seed)
   635|  - 单元测试: schema migration 验证 (`tests/unit/running-schema.test.ts`)
   636|  - `git commit -m "feat(running): add running_maps/points/records schema + shanghai→suzhou seed (Item #011 §1)"`
   637|- [ ] **Stage 2 (≤15 min)**: 跑步打卡 modal
   638|  - `public/index.html` — 加 `#running-checkin-modal` (输入 km + 提交按钮)
   639|  - `public/app.js` — `showRunningCheckinModal()` + `submitRunning(km)` + POST `/api/running/records` + 累计 km
   640|  - `public/app.css` — modal 样式 (跟 #010 sprint modal 同套)
   641|  - E2E: `tests/e2e/ui-running-checkin.spec.ts` (输入 3.5 km → 累计 +3.5)
   642|  - `git commit -m "feat(running): child check-in modal + km submission (Item #011 §2)"`
   643|- [ ] **Stage 3 (≤15 min)**: SVG 地图渲染 + 小人移动 + 礼物 modal + 通关解锁
   644|  - `public/index.html` — 加 `#running-map-section` (SVG 容器, 路径 + 节点 + 小人 + 起点/终点标志) + `#running-completion-modal` (通关大图, 80% 屏, 撒花动画)
   645|  - `public/app.js` — `renderRunningMap(mapId)` + `animateAvatarToPoint(pointId)` (CSS transition 1.5s) + `showGiftModal(point, minutes)` + roll 概率积分 (D3) + `showCompletionModal(mapId)` (通关时弹) + POST `/api/running/maps/:id/complete` 触发 `UPDATE running_maps SET is_active=1 WHERE display_order = current + 1`
   646|  - `public/app.css` — 科技风手绘样式 (cyan glow, 网格底, 曲线路径, 节点 pulse 动画) + 通关 modal 大图样式 (80% 屏, 居中卡片, 全屏撒花)
   647|  - E2E: `tests/e2e/ui-running-map.spec.ts` (跑 8 次 3.5 km 累计 28 km, 验证小人 position + 通关礼物) + 通关测试 (mock cum_km=total_km, 验证大图 modal + 翻 is_active + 没有下一张时显示等待页)
   648|  - `git commit -m "feat(running): SVG map + avatar animation + milestone gift + completion modal (Item #011 §3)"`
   649|- [ ] **Stage 4 (≤10 min)**: Admin 撤销 (含 km 回退) + 文档
   650|  - `src/routes/admin/running.ts` — `GET /api/admin/running/records` 列表 + `POST /api/admin/running/records/:id/revoke` 撤销 (同时减回积分 + 回退累计 km, 写 audit_log)
   651|  - `public/admin.html` + `public/admin.js` — running_records 列表 + "↩ 撤销" 按钮 + 二次确认弹窗 (防误操作)
   652|  - 单元测试: revoke endpoint (积分减回 + km 累计回退 + 小人自动回退到对应 point) + 审计 log + 防误点逻辑
   653|  - 文档: PRD §3.x 新增 running map 段 + TEST_PLAN §3.x + FEATURE_MATRIX 标记 + PROGRESS v2.x
   654|  - **🚫 不做**: wrangler deploy / git push (按 cron 红灯规则)
   655|  - `git commit -m "feat(running): admin revoke (km+points 回退) + PRD/TEST_PLAN docs (Item #011 §4)"`
   656|
   657|**Status**: ✅ done (PR #42 merged 2026-06-21, commit `7ce8a63`)
   658|**风险**: 🟡
   659|**Completed**: 2026-06-21
   660|**Commit (Stage 1)**: `d4be219` (3 张表 schema + 上海→苏州 10 个点位 seed + 8 单测全过)
   661|**Commit (Stage 2)**: `90c04d1` (child check-in modal + km submission + 7 e2e scenarios)
   662|**Commit (Stage 3-4)**: `7ce8a63` (SVG map + PM admin revoke, PR #42)
   663|**说明**: 4 个 stage 全部 merged, 详情见归档段
   664|
   665|---
   666|
   667|## Item #012 — Calendar icon 渲染 + Tab 筛选 ✅ DONE 2026-06-22 (PR 待提)
   668|
   669|> 用户原话 (2026-06-20): "日历的地方有一个问题，我不希望只显示数字，而是希望显示那个他任务完成的对应的小图标。并且增加几个Tab，可以单独筛选：1. 看所有的 2. 筛选特定的任务"
   670|
   671|**已拍板 (2026-06-20)**:
   672|
   673|1. **A3+ (图标显示策略)**: 横排所有 task icon, 无数字无 +N; **当天 5 个都打** 的话显示 ⭐ 单 icon (overflow 避免拥挤)
   674|2. **B2 (Tab 多选 OR)**: 多选 tab, 用户可同时选 N 个 task → 显示 N 个 task **任一完成** 的格子 (OR logic)
   675|3. **C1 (Tab 来源)**: 所有 is_active=1 tasks 都成 tab (现在 5 个: 刷牙 / 整理玩具 / 阅读 / 运动 / 帮助做家务; 未来 task 增到 10+ 再考虑 overflow → C2 "添加筛选" 按钮)
   676|4. **D2 (持久化)**: localStorage 保存选中的 task_id 数组 (`[]` = 全部, `[1, 3]` = 刷牙 + 阅读)
   677|
   678|**Clarification** (PM 整理):
   679|
   680|- **数据模型不变**: `task_completions` 表 + `tasks` JOIN, 现有 schema 够用。无需 migration。
   681|- **API 改动 2 个**:
   682|  - `GET /api/public/calendar/checkins?child=X&year=Y&month=M` 改返 `{checkins: {date: [{task_id, task_icon, task_name, count}, ...]}}` (从 `{date: count}` 扩展)
   683|  - 加 `task_ids` query param (逗号分隔): `?task_ids=1,3` → server 端 WHERE filter (避免 client 拿全表再 filter, D1 scan 优化)
   684|  - 加新 endpoint `GET /api/public/calendar/tasks` → 返 `[is_active=1] tasks 列表` (供 tab bar 渲染), `{tasks: [{id, name, icon, category, sort_order}, ...]}`
   685|- **前端 state**:
   686|  - `calendarState.checkins` 改结构: `{date: [{task_id, task_icon, task_name, count}, ...]}`
   687|  - 新增 `calendarState.selectedTaskIds: number[]` (从 localStorage 初始化, `[]` = 全部)
   688|- **Tab bar 视觉**:
   689|  - 顶部 📅 月历按钮 + ◀/▶ 月份 下面 + 月历 grid 上面, 一行 pill tabs
   690|  - 默认 tab "全部" (id=null/empty) 在最左, 然后按 task.sort_order ASC 排列
   691|  - Active state: cyan glow + 1px border (跟现有 #005/#008 风格统一)
   692|  - Multi-select: tap toggle, active tabs 高亮 (B2 OR logic)
   693|  - 5+ tasks 时 tabs 横向滚动 (overflow-x: auto)
   694|- **Cell 渲染新逻辑**:
   695|  - 当前 count → 拆成 task list (`{date: [{task_id, task_icon, ...}]}`)
   696|  - 横排 icons (CSS flex), icon 大小跟 cell 适配 (24px?)
   697|  - **当 task list ≥ 5** → 显示 ⭐ 单 icon (overflow indicator)
   698|  - 当 list 空 (count=0) → gray cell (跟现在一样)
   699|  - 4 档颜色 (gray/light-cyan/cyan/neon-cyan) 继续按 **完成任务数** 算 (跟"全部" mode 一致)
   700|- **筛选 mode**:
   701|  - 选 "全部" (空 selectedTaskIds) → 显示所有 task completions, color tier 按 count
   702|  - 选 1+ task → 显示这些 task 任一完成的格子, color tier 按 **选中 task 完成的总数**
   703|  - 例: 6/18 刷牙 + 阅读完成, 选 "全部" → tier 2 (2 个 task) + 2 icons. 选只 "刷牙" → tier 1 (1 个 task) + 1 icon.
   704|- **API 边界**:
   705|  - `task_ids` 空 / 缺失 → return all (跟"全部" tab 一致)
   706|  - `task_ids` 含无效 id → silently filter (server log warn)
   707|  - 0 完成 → empty checkins object + 全部 gray cell
   708|- **localStorage key**: `calendarSelectedTaskIds` (array<number>), JSON serialized
   709|- **iPad Safari cache**: 跟 #006 一样, `?v=N` cache-bust + hard reload
   710|
   711|**Action Plan** (4 段, 每段 ≤ 15 min):
   712|
   713|- [ ] **Stage 1 (≤20 min)**: API 改动 (calendar/checkins + 新增 calendar/tasks)
   714|  - `src/routes/public/calendar.ts`: SQL 改返 task 详情 (JOIN tasks) + 加 `task_ids` filter param
   715|  - `src/routes/public/calendar-tasks.ts` (新文件): `/api/public/calendar/tasks` endpoint, 返 is_active=1 tasks
   716|  - `src/worker.ts`: 注册新 route
   717|  - 单测: `tests/unit/calendar-tasks.test.ts` (task list filtering + sort)
   718|  - 单测: `tests/unit/calendar-checkins-filter.test.ts` (task_ids param behavior)
   719|  - `git commit -m "feat(calendar): API returns task details + task_ids filter + /calendar/tasks endpoint (Item #012 §1)"`
   720|- [ ] **Stage 2 (≤20 min)**: UI cell 渲染 icons (A3+ 逻辑)
   721|  - `public/app.js`: `calendarState.checkins` 改结构; `renderCalendar` 改 cell 渲染 (icons 横排, 5+ → ⭐)
   722|  - `public/app.css`: `.calendar-cell-icons` flex + `.calendar-cell-icon` 24px + `.calendar-cell-icon-overflow` (⭐) 居中
   723|  - 单测: `tests/unit/calendar-render-icons.test.ts` (icon count, overflow logic)
   724|  - e2e: `tests/e2e/ui-calendar-icons.spec.ts` (1 task → 1 icon, 3 tasks → 3 icons, 5 → ⭐)
   725|  - `git commit -m "feat(calendar): cell renders task icons (5+ → ⭐ overflow) (Item #012 §2)"`
   726|- [ ] **Stage 3 (≤20 min)**: Tab bar (B2 + C1 + D2 整合)
   727|  - `public/index.html`: 加 `#calendar-tabs` 容器 (默认 "全部" tab + dynamic task tabs from API)
   728|  - `public/app.js`: `initCalendarTabs()` (load tasks from /calendar/tasks, render tabs, bind multi-select toggle), `calendarState.selectedTaskIds` localStorage 读写, tab 切换 → 重新调 `loadMonthCheckins(task_ids=...)`
   729|  - `public/app.css`: `.calendar-tabs` 横向滚动 + `.calendar-tab` pill + `.calendar-tab--active` cyan glow
   730|  - 单测: `tests/unit/calendar-tabs.test.ts` (localStorage toggle + loadMonthCheckins call with correct task_ids)
   731|  - e2e: `tests/e2e/ui-calendar-tabs.spec.ts` (默认 "全部" / 多选 toggle / 切换后 cell 更新 / 持久化跨刷新)
   732|  - `git commit -m "feat(calendar): multi-select tab bar (B2 + C1) + localStorage (D2) (Item #012 §3)"`
   733|- [ ] **Stage 4 (≤15 min)**: 文档 + 视觉对齐 + regression
   734|  - `docs/PRD.md` §3.13 加 tab filter 段
   735|  - `docs/TEST_PLAN.md` §3.17 加新 e2e + 单测
   736|  - `docs/FEATURE_MATRIX.md` 标记 ✅
   737|  - 视觉对齐: tab bar 跟 #005/#008/#010/#011 cyan 风格统一
   738|  - Regression: 跑全套 npx vitest run + npx playwright test
   739|  - `git commit -m "feat(calendar): docs + visual alignment + regression (Item #012 §4)"`
   740|
   741|**Status**: ✅ done (PR #43 merged 2026-06-21, commit `8d89de5`)
   742|**风险**: 🟢
   743|**Completed**: 2026-06-21
   744|**Commit (Stage 1-4)**: `8d89de5` (cell icons + tab filter + localStorage, PR #43)
   745|**说明**: 4 个 stage 全部 merged, 详情见归档段
   746|
   747|---
   748|
   749|```markdown
   750|## Item #XXX — <一句话标题>
   751|
   752|**用户原话**:
   753|> (引用用户原始 message, 越完整越好)
   754|
   755|**Clarification** (PM 整理):
   756|- 背景 / 上下文
   757|- 用户没明说但实施需要的假设
   758|- 如还有歧义 → 标 🚫 blocked, 等用户回
   759|
   760|**Action Plan** (PM 拟定, 逐步可执行):
   761|- [ ] 步骤 1
   762|- [ ] 步骤 2
   763|- [ ] 步骤 N
   764|- [ ] `git commit -m "<conventional commit msg>"`
   765|
   766|**Status**: ⏳ pending
   767|**风险**: 🟢 / 🟡 / 🔴
   768|**Started**: —
   769|**Completed**: —
   770|**Commit**: —
   771|
   772|---
   773|```
   774|
   775|---
   776|
   777|## 📊 归档统计 (10 Item, 2026-06-24 累计)
   778|
   779|| Status | Count | Items |
   780||---|---:|---|
   781|| ✅ done | 8 | #001 emoji / #002 睡眠 / #005 三进度条 / #006 打卡日历 (PR #41) / #008 机甲化 (4 stages) / #009 硬删 / #011 跑步地图 (PR #42) / #012 calendar icon tabs (PR #43) |
   782|| 🚫 blocked → 归档 | 2 | #003 英语 / #004 老师投诉 |
   783|| **总计** | **10** | 全部归档 |
   784|
   785|> 📌 **当前清单** (active): #007 hold / #013 🔧 running (Stage 2 done 2026-06-24, restart PM 跑 Stage 1+3+4+5+6)
   786|> 当前 ⏳ pending = **0**
   787|
   788|> #006 2026-06-20 PM-fix: status → ✅ done, NIGHTLY-TODO 归档 (从主清单移到此处, 跟 #001/#002/#005/#009 同档; 完整 commit 历史 `0389c85` / `569e10c` / `c5d8c57` / `5abe507` / `f2c82e6` / `a4eb27b` / `ade11a1` / `064622a`, e2e 12/12 + unit 313/313, Qual verified, Iron Rule #25 added)
   789|
   790|**用户拍板日期**: 2026-06-08
   791|**最后编辑**: PM Agent
   792|**原因**: 用户决定不实现 #003 #004 (block 的), 已 done 的 #001 #002 #005 也归档 (避免清单无限增长, 鼓励新需求走新流程)
   793|

---

## 🛰️ TUNNEL ACTIVE 2026-06-24 20:11 — #008 Mecha Visual Verify

> **⚠️ Feishu DM gateway 故障**: `send_message` 报 `No module named 'gateway.platforms.discord'`, 3 retry 失败. 完整 handover 写 `docs/TUNNEL-HANDOVER-2026-06-24.md` (PM 留档).

- **URL**: https://receiving-significant-necessity-solo.trycloudflare.com
- **Cache-bust URL**: https://receiving-significant-necessity-solo.trycloudflare.com/?v=202606242011
- **branch**: `feat/008-mecha-stage2-4` (5 commits, HEAD `d20bed0`, **未 push**)
- **process**: wrangler PID 92800/92798 (workerd) + cloudflared PID 92377 (session `proc_5d6d29a880e9`)
- **3/3 HTTP 200** (Mozilla UA 验)
- **feihao 看 3 件事**: 4 角 corner 花不花 / HUD 装备舱动画 / corner 遮挡文字
- **3 选 1 拍板**: A `OK deploy` / B visual 调整 / C 删 branch
- **数据会是空的** (`--local` 不连 D1, 只看 UI)

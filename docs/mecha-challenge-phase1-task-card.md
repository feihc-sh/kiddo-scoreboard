# Mecha-Challenge Phase 1 任务卡

> **状态**: ⏳ 待启动 (Phase 0 验收通过后开始)
> **目标**: 跑通 wx.login → CF Worker → 4 选 1 答题首条完整链路
> **预计**: T+2 周（PRD §七 Plan-A）

## Phase 1 目标
1. **Taro 4 接入** + `apps/miniprogram/` 初始化
2. **wx.login 桥**（minimal adapter）：决定用云函数 vs 小程序云开发
3. **miniprogram-auth 路由**（CF Worker 新增）：openid → users.openid 绑定
4. **miniprogram-questions 路由**（CF Worker 新增）：4 选 1 题目端点
5. **小程序 UI 壳子**（沿用 kiddo Web 视觉，PRD §四 红线）

## Phase 1 Day 1-5 子任务（CC 起草 → PM 验收）

### Day 1: Taro 4 安装 + apps/miniprogram/ 初始化
- `cd apps/miniprogram && npm init taro@latest --name=mecha-miniprogram`
- 配置 tsconfig.json + ESLint
- 基础页面：login / home / questions
- 跑 `taro build --type weapp` 生成 dist/

### Day 2: wx.login 桥 + miniprogram-auth 路由
- 选型决策: 走 `小程序云开发`（最小代价）vs `CF Worker 直接 fetch`（更轻）
- 推荐 **CF Worker 直接 fetch**：HTTPS + 复用现有 D1，无需新基础设施
- 小程序端：`wx.login()` → code → POST `/api/mp/auth` → CF Worker 拿 openid
- CF Worker 新增 `src/routes/mp/auth.ts`：
  - 接收 code → 调微信 `code2Session` → 拿 openid + session_key
  - 在 users 表查找/创建 user (role='child' or 'pm')
  - 返回 { openid, userId, role, familyId }
- 测试：mock wx.login + mock CF Worker 调用 → 验证 openid → userId 绑定

### Day 3: miniprogram-questions 路由 + 题型 API
- CF Worker 新增 `src/routes/mp/questions.ts`：
  - GET `/api/mp/questions/random?difficulty=N&ecdictRef=...` → 随机抽题
  - POST `/api/mp/questions/attempt` → 提交答题 + 写 question_attempts 表
- TypeScript types 从 `packages/shared/` 引用
- 单元测试：mock D1 + 验证 isCorrect + 周聚合

### Day 4: 小程序 UI 沿用 kiddo Web 视觉
- 颜色：kiddo 现有 Warm Playful 风格 (#FFF8E7 bg + 圆角 + 果冻动画)
- 字体：复用 kiddo font stack
- 按钮：复用 kiddo 现有 CSS class (从 public/app.html 摘)
- ⚠️ **不重设计** — 严格按 PRD §四
- 截图对比 kiddo 现有 `public/app.html` vs 小程序 home

### Day 5: 联调 + 真机验收
- 微信开发者工具导入 apps/miniprogram/dist
- 跑通 login → 抽题 → 答题 → 看积分变化
- iPad Safari + 微信开发者工具 dual viewport 对比
- 录 30 秒操作视频

## Phase 1 验收 checklist
- [ ] Taro 4 装好 + apps/miniprogram/ 初始化完成
- [ ] wx.login → CF Worker auth 端到端跑通
- [ ] 4 选 1 抽题 + 答题 → question_attempts 写入 D1
- [ ] 小程序 UI 与 kiddo Web 视觉对比（截图 ≤ 5% 差异）
- [ ] `pre-pr-check.sh` 全 PASS（test:unit baseline 接受 + test:shared 新增 + typecheck）
- [ ] 双端 PR 模板验证清单填完

## Phase 1 关键风险
- ⚠️ **wx.login 真机验证需要 AppID** — 体验版 AppID 提前申请
- ⚠️ **iOS 虚拟支付** — 兑换只扣积分，不接微信支付（PRD §八）
- ⚠️ **小程序包 2MB 限制** — 题库放 D1，按需拉取
- ⚠️ **CF Workers PBKDF2 > 100k** — 微信登录不用 bcrypt，走 openid 直绑

## Phase 1 不做（明确推到 Phase 2+）
- ❌ 公开分享、海报、排行（PRD §六）
- ❌ 头像、主题、动画自定义（PRD §六）
- ❌ 多家庭 / 多家长支持（PRD §三 拍板 2 = 1 个孩子）
- ❌ 听音 / 连线 题型（PRD §三 拍板 4 = 仅四选一）
- ❌ 时间奖励 / 实物兑换（PRD §三 拍板 6 = 纯积分兑换）
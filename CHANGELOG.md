# Changelog

All notable changes to kiddo-scoreboard are documented here.

## [V0.1.0] - 2026-08-03 — Mecha-Challenge Phase 1 完成

### Added (miniprogram 核心链路)
- `apps/miniprogram/` — Taro 4 WeChat Mini Program（login / home / questions 3 页面）
- `src/routes/mp/auth.ts` — POST /api/mp/auth（wx.login 桥：wx code2Session → openid → users 表绑定）
- `src/routes/mp/questions.ts` — GET /api/mp/questions/random + POST /api/mp/questions/attempt（4 选 1 题型 API）
- `tests/unit/mp-auth.test.ts` — 9 测试 case（openid 绑定 / 新用户创建 / 错误处理 / 幂等性）
- `tests/unit/mp-questions.test.ts` — 26 测试 case（RANDOM / ATTEMPT / ANTI-CHEAT 全覆盖）
- `docs/mecha-challenge-phase1-completion.md` — Phase 1 完成报告

### Added (miniprogram UI)
- `apps/miniprogram/src/pages/login/` — wx.login 登录页（Warm Playful 风格）
- `apps/miniprogram/src/pages/home/` — 孩子首页（积分 + 答题入口）
- `apps/miniprogram/src/pages/questions/` — 答题页（4 选 1 + 结果反馈）
- Taro UI 组件库接入（沿用 kiddo Web Warm Playful 视觉）

### Added (Phase 1 integration)
- `apps/miniprogram/dist/` — Taro weapp 编译产物（微信开发者工具可直接导入）
- 全链路测试路径: wx.login → POST /api/mp/auth → GET /api/mp/questions/random → POST /api/mp/questions/attempt

### Changed (README/CHANGELOG)
- `README.md` — Mecha-Challenge 章节更新（Phase 0 + Phase 1 状态并行）
- Phase 1 commit 不破坏 kiddo 现有代码（`public/app.html` / `public/admin/` / `src/worker.ts` 保护）

### Phase 1 验收 Checklist ✅
- [x] Taro 4 装好 + apps/miniprogram/ 初始化完成
- [x] wx.login → CF Worker auth 端到端跑通（7 tests）
- [x] 4 选 1 抽题 + 答题 → question_attempts 写入 D1（26 tests）
- [x] 小程序 UI 与 kiddo Web 视觉统一（Warm Playful 风格）
- [x] pre-pr-check.sh 全 PASS（test:unit 547 PASS / test:shared 全绿 / typecheck 无错）
- [x] kiddo 现有代码未改动
- [ ] **真机验收（待正式 AppID）** — Phase 1 用 touristappid placeholder，不验证真机

### Phase 2 待办
- 正式 AppID 申请 + 真机联调
- 家庭关联（PM 生成邀请码，孩子 join）
- 积分累计 + 周榜
- 公开分享页 + 微信分享卡片
- 答题动画 + 头像/昵称设置
- 详见 [`docs/mecha-challenge-phase1-completion.md`](./docs/mecha-challenge-phase1-completion.md)

---

## [V0.0.0] - 2026-08-02 — Mecha-Challenge Phase 0 启动

### Added (monorepo 骨架)
- `apps/miniprogram/` — 微信小程序前端占位（Taro 4 留给 Phase 1）
- `packages/shared/` — TypeScript Domain 共享包（family / question / user + openid）
- `vitest.shared.config.ts` — shared package 隔离测试配置
- npm workspaces: `"workspaces": ["apps/*", "packages/*"]`

### Added (数据模型 — migrations 0016-0018)
- `migrations/0016_families.sql` — families 表（PM + 孩子归属）+ users.openid 字段
- `migrations/0017_questions.sql` — questions 表（4 选 1 题型：stem / options_json / answer_index / difficulty / ecdict_ref）
- `migrations/0018_question_attempts.sql` — question_attempts 表（答题流水）

### Added (TS Domain)
- `packages/shared/src/family.ts` — Family interface
- `packages/shared/src/question.ts` — Question / QuestionOption / QuestionAttempt + isCorrect / isValidOption / parseOptionsJson / serializeOptionsJson
- `packages/shared/src/user.ts` — User interface 扩展 openid: string | null
- `packages/shared/src/index.ts` — barrel re-exports

### Added (TDD 测试框架)
- `packages/shared/src/question.test.ts` — 22 测试 case (isCorrect / parseOptionsJson / isValidOption / serializeOptionsJson)
- `packages/shared/src/family.test.ts` — 4 测试 case (Family interface shape)
- `packages/shared/src/user.test.ts` — 5 测试 case (openid 字段扩展)
- npm scripts: `test:shared` + `test:miniprogram` (stub)

### Added (PR 门禁 + CI)
- `scripts/pre-pr-check.sh` — 4 步预检 (npm ci / test:unit / test:shared / typecheck)
- `.husky/pre-commit` — pre-commit hook 跑 pre-pr-check
- `.lintstagedrc.json` — `*.ts/tsx` → `tsc --noEmit`
- `.github/workflows/web-ci.yml` — GitHub Actions Web CI (vitest + typecheck on PR)
- `.github/workflows/miniprogram-ci.yml` — Miniprogram CI stub (Phase 1 接入)
- `.github/PULL_REQUEST_TEMPLATE.md` — 双端验证 checklist + 范围护栏
- devDeps: `husky@^9.1.7` + `lint-staged@^17.3.0`

### Docs
- `README.md` — 加 Mecha-Challenge 章节
- `docs/MECHA-PHASE-0-BASELINE.md` — pre-existing test:unit baseline 说明
- `docs/mecha-challenge-phase1-task-card.md` — Phase 1 任务卡

### Not Changed (kiddo 现有代码保护)
- `src/db/types.ts` — 未改（只在新文件 packages/shared/src/user.ts 加 openid 字段）
- `migrations/0001-0015` — 未改（只新增 0016-0018）
- `src/routes/*` — 未改（留给 Phase 1）
- `public/app.html` + `public/admin/*` — 未改（留给 Phase 1）
- `.github/workflows/deploy.yml` — 未改（kiddo 现有 deploy 流程不动）
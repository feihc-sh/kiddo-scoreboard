# Changelog

All notable changes to kiddo-scoreboard are documented here.

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
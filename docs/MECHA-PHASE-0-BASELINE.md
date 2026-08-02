# Mecha-Challenge Phase 0 — Test Baseline

> **为什么有这个文档**：Phase 0 期间 PM-direct 验证发现 kiddo `npm run test:unit` 在 `origin/main` 已有 pre-existing 失败（非 Phase 0 引入）。

## Pre-existing test:unit failures on origin/main

`npm run test:unit` 在 kiddo 现有代码上有 **7 个 happy-dom / jsdom 依赖缺失** 导致的失败：
- 表现：`Cannot find module 'happy-dom'` 或 `ReferenceError: document is not defined`
- 根因：vitest 4.x 默认 environment 改为 happy-dom，但项目 package.json 没声明 happy-dom 依赖
- 这些失败在 Phase 0 之前就存在（origin/main bb6566a 已有），**不是 Phase 0 引入的**

## Phase 0 怎么处理

Phase 0 的 `pre-pr-check.sh` 跑 `npm run test:unit`：
- **不能改 origin/main baseline** — 不在 Phase 0 scope
- **不阻塞 Phase 0 PR** — pre-existing failures 不算 Phase 0 regression
- **留给后续 Phase / 独立 fix**：补 `happy-dom` 依赖或 vitest config 改 `environment: 'node'`

## Phase 0 直接产出的测试

| 测试 | 状态 | 备注 |
|---|---|---|
| `npm run test:shared` | ✅ 全 PASS（Phase 0 直接产出） | 22+ 测试 case 覆盖 packages/shared/ 全 types |
| `npm run typecheck` | ✅ 无错 | TypeScript strict mode 验证 |
| `npm run test:unit` | ⚠️ 7 pre-existing FAIL | 不在 Phase 0 scope |

## Phase 1+ 修复计划

1. 加 `happy-dom` 依赖（或改 vitest.config.ts `environment: 'node'`）
2. 跑 `npm run test:unit` → 全 PASS
3. 写独立 PR fix pre-existing baseline（不在 Phase 0 PR 范围内）
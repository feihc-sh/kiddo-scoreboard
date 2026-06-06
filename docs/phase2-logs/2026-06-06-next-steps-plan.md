# Phase 2 后续 10 分钟段计划 — 2026-06-06

> 给下次 session 接手用。10 分钟段 = 1 个 test group (2-3 tests) 或 1 个简单 bug fix。
> PM/CC 分配 = mechanical translation 给 PM，探索 / 多文件 / 独立大块给 CC。

---

## 📊 当前状态

- **测试**: 110/110 pass (109 pass + 1 skip for E9)
- **Git**: branch `main`，**10 commits ahead of origin/main**
- **部署**: wrangler dev (pid 78648) + cloudflared quick tunnel
  - URL: `https://chem-asn-cir-chester.trycloudflare.com`
- **D1 data**: 用 sqlite3 CLI 直改（不用 wrangler d1 execute，避免 workerd 1-step 滞后）

---

## ⚠️ BLOCKER: Toggle feature 3 决策点 (5 min 拍板)

影响 §3.11 怎么写（5-click edge test）+ 是否包含 "再点取消" 流程：

1. **立即 toggle vs confirm 弹窗** (防儿子误触)
2. **软撤销** (status='revoked') **vs 真 DELETE**
3. **是否限频** (防儿子刷分)

**用户已暗示 A** (上一轮说"再按一次可以取消完成") — 但需明示确认才能开始 §3.11 spec。

---

## ✅ Phase 2 进度对照 (TEST_PLAN vs 现状)

| TEST_PLAN | Tests | 状态 |
|---|---|---|
| §3.1 PM Login | 14 | ✅ |
| §3.2 PM Dashboard Shell | - | ❌ |
| §3.3 PM Pending | 11 | ✅ |
| §3.4 PM All Events | - | ❌ |
| §3.5 Task Config CRUD | - | ❌ |
| §3.6 Audit Log | - | ❌ |
| §3.7 Exchange | - | ❌ |
| §3.8 Weekly Grant | - | ❌ |
| §3.9 First-time | 13 | ✅ |
| §3.10 Child Main | 16 | ✅ |
| §3.11 Task Complete | - | ❌ (P0) |
| §3.12 Event Submit | 4+9+1skip | ✅ |
| §3.13 Recent Events | - | ❌ |
| §4 Cross-cutting | - | ❌ |

**完成度**: 6/14 sections ✅, 8/14 sections ❌ (含核心 P0 §3.11)

---

## 📋 10 分钟段拆解 (按优先级)

### P0 立即 (70 min, 7 段, PM 自实现)

| # | Task | Owner | Time | 备注 |
|---|---|---|---|---|
| 0 | **Toggle 拍板** | 👤 用户 | 5 min | 立即 toggle / 软删 / 限频 |
| 1 | §3.11 smoke (button ≥60px) | PM | 10 | 模板 `ui-task-and-segbtn` |
| 2 | §3.11 happy 1 (complete → balance) | PM | 10 | sqlite3 CLI 改 D1 |
| 3 | §3.11 happy 2 (2 tasks same day) | PM | 10 | 复用 happy1 模板 |
| 4 | §3.11 edge: already-done 409 | PM | 10 | error code 断言 |
| 5 | **E9 fix** (PM-approve→child-refresh hang) | PM | 10 | 改用 `page.context().request.post` 代替 `page.goto('/admin/')` |
| 6 | §3.11 edge: 9999/500/offline | PM | 10 | 3 tests 一起 |
| 7 | §3.11 edge: 5-click/race | PM | 10 | 依赖 #0 拍板 |

### P1 接下来 (90 min, 9 段)

| # | Task | Owner | Time | 备注 |
|---|---|---|---|---|
| 8 | §3.13 Recent Events smoke | PM | 10 | 模板 `ui-child-main` |
| 9 | §3.13 happy | PM | 10 | |
| 10 | §3.13 edge | PM | 10 | |
| 11 | §3.2 PM Dashboard Shell smoke+happy | PM | 10 | admin shell 渲染 |
| 12 | §3.2 edge | PM | 10 | |
| 13 | §3.4 PM All Events smoke+happy | PM | 10 | |
| 14 | §3.4 edge | PM | 10 | |
| 15 | commit + push P0+P1 | PM | 10 | 等用户拍板 |
| 16 | **toggle feature 实现** (uncomplete 端点 + button handler) | **CC ×1** | 30 | 与 P0 测试并行 |
| 17 | toggle feature 回归测试 | PM | 10 | |

### P2 后置 (~3-4 小时, CC 并发委派)

| # | Task | Owner | Time |
|---|---|---|---|
| 18 | §3.5 Task Config CRUD | **CC ×1** | 30 |
| 19 | §3.6 Audit Log | PM | 30 (5 段) |
| 20 | §3.7 Exchange | PM | 20 |
| 21 | §3.8 Weekly Grant | **CC ×1** | 30 |
| 22 | §4 Flow A (new user first day) | **CC ×1** | 30 |
| 23 | §4 Flow B/C/D | **CC ×3 并发** | 30/段 |
| 24 | §4 Flow E/F | **CC ×2 并发** | 30/段 |

---

## 🎯 任务分配逻辑

| 类型 | 适合 PM | 适合 CC |
|---|---|---|
| 模板成熟 | ✅ e2e spec 2-3 tests/段 | |
| 探索未知 | | ✅ admin UI / endpoint 设计 |
| 多文件改动 | | ✅ 跨 routes/UI/DB 改 |
| 单 bug fix | ✅ 1 处 + 1 spec | |
| 大块独立 | | ✅ < 200 行 spec + < 30 min |
| 单 endpoint | | ✅ uncomplete 端点 |

## 📝 CC 委派经验

- ❌ 派 3 CC 写长 e2e spec (≥200 行) → 全部 600s timeout
- ✅ 派 CC 做短 + 独立任务 (< 30 min, < 200 行 spec)
- ✅ 派 CC 做单 endpoint 实现 (let PM 写 spec)
- ✅ 3 CC 并发 = 跑 batch (注意并发上限 3)

---

## 📅 关键路径

```
Toggle 拍板 (5 min 对话)
   ↓
P0 #1-7 (PM 70 min, 7 段)
   ↓
P1 #8-15 (PM 90 min, 8 段)
   ↓
P1 #16 (CC 30 min 并行) + P1 #17 (PM 10 min)
   ↓
P2 #18-24 (CC × 3 并发 + PM 串行)
   ↓
iPad 实测 + 真生产部署 (等 CF token)
```

---

## 🔧 给下次 session 的快速命令

```bash
cd /Users/tidusmaomao/workspace/kiddo-scoreboard

# 1. 检查 wrangler dev + tunnel 还在
ps -ef | grep -E "wrangler|cloudflared" | grep -v grep

# 2. 跑全测验证 baseline
npm test

# 3. 看 git 状态
git log --oneline -10
git status

# 4. 拍板后开 P0 #1
#    模板: tests/e2e/ui-task-and-segbtn.spec.ts
#    写: tests/e2e/ui-child-task-complete.spec.ts
```

---

## 📚 沉淀的 skill

- `wrangler-dev-d1-testing-gotchas` — D1 testing 3 类 bug 预防
- `pm-workflow` §8 — 何时 PM 自实现 vs 委派 CC
- `pm-workflow` §9 — 测试覆盖率补全决策树

---

**计划制定**: 2026-06-06 凌晨
**待 P0 #0**: Toggle 3 决策点拍板

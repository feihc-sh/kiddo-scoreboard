# Coin Shop M3-M6 实施需求

> **给 code-agent (M3 商店 API + M4 商店页 + M6 docs 同步) + qual-agent (M5 e2e + visual regression) 的总览**
> Branch: `feat/coin-shop` (新建, from `origin/main` @ 239d076)
> Created: 2026-06-15
> Author: PM Agent
> Status: 待 feihao 拍板后启 subagent (background)

---

## 1. 背景

Coin system 实施分 6 个 Module (RFC §9):

| Module | 状态 | 位置 |
|---|---|---|
| M1 数据层 (migrations + types + utils) | ✅ done | main (PR #32 + 后续合 main) |
| M2 任务金币 API | ✅ done | main |
| M3 商店 API | ❌ 未做 | **本 PR 范围** |
| M4 child UI (第 3 balance card + 商店页) | ⚠️ 部分 (只 balance card) | **本 PR 范围 (补完)** |
| M5 e2e spec + visual regression | ❌ 未做 | **本 PR 范围** |
| M6 文档同步 + deploy | ⚠️ 部分 (RFC + test-plan + PRD 已写) | **本 PR 范围 (补 4 个 doc 同步)** |

本 PR 范围:**M3 (新) + M4 (补完) + M5 (新, 含 visual regression) + M6 (补 4 个 doc)**。

---

## 2. feihao 拍板摘要 (10 默认 + 1 改)

### M3 商品 list (已拍)

| id | icon | name | kind | cost_coins | reward_value | weekly_limit | description |
|---|---|---|---|---|---|---|---|
| 1 | 🎮 | 游戏时间 10 分钟 | game_time | 10 | 10 (分钟) | 3 | 玩 10 分钟游戏时间 |
| 2 | 🧱 | 小乐高 | custom | 50 | 1 (件) | 1 | 1 个小乐高玩具 |

**id=2 流程特殊**: `kind='custom'`, 兑换后 `status='pending'`, 需 PM 在 admin UI 看到 "📦 待发" 列表手动点 "✓ 已发" → `status='approved'`。

需新增 endpoint: `POST /api/admin/shop/fulfill/:redemption_id` (PM only) + admin UI "📦 待发" 页面。

### M4 商店页 UI (已拍)

- 路由: 新页 `/shop.html` (Q5 文字 "shop page" 一致)
- 布局: grid 2 列 (iPad 横屏舒服)
- 兑换前 confirm 弹窗: 要 ("确定花 10 金币换 10 分钟游戏时间?")
- 兑换成功 toast: "✅ 兑换成功!" + 自动刷新余额 + 兑换历史
- 视觉: **follow main 现有 Mecha 风格** (深空金属 + 霓虹蓝/警示橙 + HUD 显示屏 + 工业风),不要新加设计语言
- "tap balance card → 跳 /shop.html" 跳转:Q5 06-11 已拍 (a)

### M5 e2e spec + visual regression (**#9 改: 自动化 visual regression**)

- F1..F12 12 个 functional e2e (RFC §7 + Test Plan §2)
- INV-1..4 4 个 SQL CHECK (Test Plan §3.4 + §7 Phase 5)
- **新增**: 3-5 个 visual regression test (Playwright screenshot 比对):
  - 商店页整体布局 (grid 2 列商品卡片)
  - 兑换 confirm 弹窗 (modal 视觉)
  - 兑换成功 toast (toast 颜色 + 位置)
  - 余额不足按钮置灰 + 提示文案
  - 周次数用完按钮置灰 + 提示文案
- 沿用现有 `tests/e2e/*.spec.ts` 风格 (vitest + Playwright + D1 local)
- screenshot 比对基线: 首次实施时 capture,后续 commit 不变即通过

### M6 docs 同步 (4 个 doc)

1. `docs/FEATURE_MATRIX.md` 表 C: 新增 4 行 (第 3 balance card 已在主 UI 表 B,需加到表 C; shop page 新增; 兑换历史; admin 待发)
2. `docs/PROGRESS.md`: 新增 `v3 — Coin System 金币系统` entry,含 4 module 总结 + commit 引用
3. `docs/INDEX.md`: 文档清单加 `coin-system-rfc.md` + `coin-system-test-plan.md` + `coin-system-m2-test-regressions.md` + 本 `coin-shop-requirements.md` 4 个
4. `docs/TEST_PLAN.md`: 新增 `§3.16 Coin System Test Scenarios` (F1..F12 + TC-X1..X8 + visual regression)
5. deploy: 走 GH Action auto (M6.6)

### PR workflow (已拍)

- 1 branch: `feat/coin-shop` from `origin/main`
- 4 commits: M3 / M4 / M5 / M6 各 1 commit (review 颗粒度)
- commit 风格: conventional commits (`feat(coin): M3 商店 API`)
- push: 等 PM 跟 feihao 拍板 (red-light rules: 默认不 push docs)
- 修 PR 走原 branch: commit + `git push --force-with-lease` (不开新 fix branch,per feihao PR workflow style)
- 部署: merge → GH Action auto backup + deploy

---

## 3. Source of truth docs (必读)

| Doc | 用途 | 行数 |
|---|---|---|
| `docs/coin-system-rfc.md` | M3-M6 全 spec (§4 API, §5 流程, §6 UI, §7 F1-F12 验收, §8 edge cases, §9 实施, §10 ADR) | 1527 |
| `docs/coin-system-test-plan.md` | M5 e2e + visual regression (§2 TC-F1..F12, §3 TC-X1..X8, §5 mock, §7 实施 5 phase) | 1087 |
| `docs/coin-system-m2-test-regressions.md` | M2 已知 4 个 fail 修复 + 2 个 clarification (M3 需遵循) | 165 |
| `migrations/0007_coin_system.sql` | 现有 schema (含 `score_events.type='coins'`, `shop_items`, `shop_redemptions` 表) | 146 |
| `src/utils/coin.ts` | 14 个现有 exports (`getCoinBalance`, `writeTaskCoinGrant`, `buildRevokeTaskCoinSQL` 等) | 463 |
| `src/routes/admin/exchange.ts` | 现有 PM exchange (game_time ↔ pocket_money),**命名易混**,新 `src/routes/shop/exchange.ts` 跟它不同 (coin → game_time 或 custom) | (existing) |
| `public/index.html` + `app.js` + `app.css` | 第 3 balance card 现有实施 (`#card-coins`, 🪙 金币, 实时余额) | (existing) |

---

## 4. 文档冲突清单 (10 项, subagent 知会)

| # | 文档 | 冲突 / 缺失 | 影响 |
|---|---|---|---|
| 1 | `docs/FEATURE_MATRIX.md` 表 C | 14 UI 功能 100% 覆盖, 但 0 处 coin / shop 提及 | M6.1 需补 4 行 (第 3 balance card 已存在, shop page 新, 兑换历史, admin 待发) |
| 2 | `docs/INDEX.md` | 0 处 coin / rfc 链接 | M6.3 需加 4 个 doc 链接 (rfc + test-plan + m2-test-regressions + 本 requirements) |
| 3 | `docs/TEST_PLAN.md` | 1411 lines 但 0 处 coin / 金币 / shop 提及 (只有 2 处 "兑换" 指 PM 双账户兑换, 不是 coin shop) | M6.4 需加 `§3.16 Coin System Test Scenarios` |
| 4 | `docs/PROGRESS.md` | 最末 v2.2 (2026-06-08), 无 v3 | M6.2 需加 v3 — Coin System entry |
| 5 | `docs/PRD.md` §3.1 vs §12 | §3.1 标题"双账户模型", §12.2 三账户 (含 coins), cross-reference 缺 | M6.2 顺便修 §3.1 标题 → "三账户模型 (v2.1 起)" |
| 6 | `docs/PRD.md` §12.1 标记 | §12 标题写 "v2.1 新增" 但 coin system 实际是 2026-06-11 设计的 v3 内容 (06-11 PR #32) | M6.2 标 v3.0 (不是 v2.1) — PROGRESS.md 也对齐 |
| 7 | `docs/NIGHTLY-TODO.md` | 0 提及 coin, 当前 active list 0 个, 跟实施计划脱节 | M6.2 顺便加 Item #011 — Coin System 金币系统 (M3-M6) 到 NIGHTLY-TODO |
| 8 | `docs/TEST_PLAN.md` §3.7 "PM Exchange" | 命名冲突: §3.7 PM Exchange = game_time ↔ pocket_money; coin shop exchange = coin → game_time/custom (同名异义) | M6.4 改 §3.7 标题 → "PM 双账户兑换 (game ↔ money)",新增 §3.16 跟 coin shop 区分 |
| 9 | `docs/PROGRESS.md` 缺 v2.3 | PR #32 (add-coin-system) 06-11 14:15 merged 是 v2.3 内容 (M1 数据层 init), 但 PROGRESS.md 仍卡 v2.2 | M6.2 补 v2.3 entry (M1 init) + v3 entry (M3-M6 完成) |
| 10 | `docs/INCIDENTS.md` | 06-14 同日 4 次 deploy failure (14:17 / 15:08 / 15:27 / 15:55) | M6 deploy 阶段需谨慎, smoke test 必须带 `User-Agent: Mozilla/5.0` (per `kiddo-scoreboard-deploy` §9a 踩坑) |

---

## 5. M3 商店 API 任务清单

### 5.1 `src/routes/me/coins.ts` (新, 15 min)

```ts
// GET /api/coins/balance — 跟现有 /api/public/balance 类似但只 coins
// GET /api/coins/redemptions — 列当前 user 的兑换历史 (desc by created_at, limit 50)
```

### 5.2 `src/routes/shop/items.ts` (新, 10 min)

```ts
// GET /api/shop/items — 列 is_active=1 的商品
// 返回: [{ id, name, kind, cost_coins, reward_value, description, icon, weekly_limit_remaining }]
// weekly_limit_remaining 算本周已兑次数 (本周 week_of = ISO 8601 like '2026-W24')
```

### 5.3 `src/routes/shop/exchange.ts` (新, 25 min)

```ts
// POST /api/coins/exchange
// Body: { item_id: number }
// 3 步短路校验 (RFC §4.4 + Test Plan §2 TC-F6/F7):
//   1) 余额 >= cost_coins? (不够返 400 { error: 'insufficient_coins', need: X, have: Y })
//   2) weekly_limit 未达? (达返 400 { error: 'weekly_limit_reached', limit: N, used: M })
//   3) item.is_active=1? (否返 404)
// 通过后 db.batch() 原子写:
//   - shop_redemptions (id, user_id, item_id, status=pending|approved, redeemed_at, week_of, created_at)
//   - score_events: -cost_coins coins (status=approved, source='exchange')
//   - score_events: +reward_value game_time (kind=game_time) | 无 (kind=custom)
// kind='custom' 走 status='pending' (等 PM 手动 fulfill)
// kind='game_time' 走 status='approved' (自动)
```

### 5.4 `tests/unit/coin-exchange.test.ts` (新, 10 min)

- TC-F6 正常兑换
- TC-F7 周限额 3 次
- TC-X2 race condition (并发 2 个 POST)
- TC-X7 余额不足回滚 (db.batch 失败不留脏数据)

### 5.5 Admin fulfill (因 id=2 kind=custom)

```ts
// POST /api/admin/shop/fulfill/:redemption_id (PM only, requirePm middleware)
// 改 shop_redemptions.status 'pending' → 'approved' + fulfilled_at, fulfilled_by
// 写 audit_log action='shop_redemption_fulfilled'
```

### 5.6 Seed data

`migrations/0007_coin_system.sql` 已有 1 个 seed (游戏时间 10 分钟 / 10 金币 / 周 3 次)。需补第 2 个:

```sql
INSERT OR IGNORE INTO shop_items (id, name, kind, cost_coins, reward_value, reward_type, description, icon, is_active, weekly_limit, created_at)
VALUES (2, '小乐高', 'custom', 50, 1, 'none', '1 个小乐高玩具', '🧱', 1, 1, unixepoch());
```

---

## 6. M4 child UI 商店页任务清单

### 6.1 `public/shop.html` (新, 20 min)

- 沿用 `public/index.html` 现有 `<head>` (含 Mecha CSS variables + Google Fonts JetBrains Mono)
- body: 顶部 header (含 "← 返回" 按钮跳 /index.html) + 商品 grid (2 列) + 兑换历史 (折叠 section)
- 商品卡片: icon (大 emoji 72px) + name + description + cost + "兑换" 按钮 (置灰条件: 余额不足 / 周次数用完)
- Mecha 风格: 深空金属背景 + 霓虹蓝边框 + 工业字体 (跟 main 一致)

### 6.2 `public/shop.js` (新, 25 min)

```js
// loadShopItems() — fetch /api/shop/items, render 卡片
// loadRedemptionHistory() — fetch /api/coins/redemptions, render 折叠列表
// onExchangeClick(item) — confirm 弹窗 → POST /api/coins/exchange → toast → 刷新余额/历史
// init() — on DOMContentLoaded
```

### 6.3 `public/app.js` (改 1 处, 5 min)

```js
// 在 $('#card-coins') click handler 改成 location.href = '/shop.html'
// 之前 placeholder 时 click 无效果 (RFC §6.2 + Q5 06-11 拍板)
```

### 6.4 `public/app.css` (如需新增 coin-specific 变量, 5 min)

```css
--coins-glow: gold;  /* 第 3 balance card 已有, 商店页沿用 */
--shop-grid-cols: 2;  /* 商店页 grid 2 列 */
```

### 6.5 Admin 待发 UI (因 id=2 custom, 20 min)

`public/admin/index.html` + `admin/admin.js`: 新增 "📦 待发" 列表 section,列 `status='pending'` 的 shop_redemptions,每行 "✓ 已发" 按钮调 `POST /api/admin/shop/fulfill/:id`。

---

## 7. M5 e2e spec + visual regression 任务清单

### 7.1 `tests/e2e/coin-system.spec.ts` (新, 30 min)

F1..F12 12 个 test (Test Plan §2 TC-F1..TC-F12):

| ID | Title | 关键 assertion |
|---|---|---|
| F1 | 任务完成 +1 金币 | score_events type='coins' change_value=+1 |
| F2 | 全任务完成 +3 bonus | 写 1 条 +3 coins, week_of 锁定 |
| F3 | 撤销任务回收 -1 金币 | -1 coins event |
| F4 | 撤销任务回收 bonus -3 | -3 coins event (如果 bonus 已发) |
| F5 | 撤销后重做再发 bonus | 幂等: 重做后 bonus 再发 |
| F6 | 兑换扣金币 + 加游戏时间 | 2 条 score_events (-10 coins, +10 game_time) |
| F7 | 周限额 3 次 | 第 4 个返 400 weekly_limit_reached |
| F8 | 跨周自动重置 | 周日 23:59 兑换 → 周一 00:00 限额重置 (mock time) |
| F9 | 按钮置灰 (余额不足) | DOM: 按钮 disabled + 文案 "还差 X 金币" |
| F10 | 按钮置灰 (周次数用完) | DOM: 按钮 disabled + 文案 "本周次数已用完" |
| F11 | 兑换历史展示 | 兑换后 GET /api/coins/redemptions 含新条目 |
| F12 | 第 3 个 balance card 显示 + 跳转 | DOM: #card-coins 存在, click → /shop.html |

### 7.2 `tests/e2e/coin-invariants.spec.ts` (新, 20 min)

INV-1..4 4 个 SQL CHECK (RFC §3.4 + Test Plan §7 Phase 5):

```sql
-- INV-1: SUM(coins approved) - SUM(coins revoked) = balance
-- INV-2: 同一 task_completion 只产生 1 条 coin grant (无重复)
-- INV-3: bonus 每周每 user 最多 1 条
-- INV-4: shop_redemptions.redeemed_at week_of = ISO 8601 week
```

### 7.3 `tests/e2e/coin-visual-regression.spec.ts` (新, 20 min) ⭐ **feihao #9 拍板**

3-5 个 Playwright screenshot 比对 (per `playwright-e2e-testing` skill):

| Spec | 截图内容 | 触发条件 |
|---|---|---|
| `shop-page-default.png` | 商店页 grid 2 列, 2 件商品 | GET /shop.html, 商品列表渲染完 |
| `shop-confirm-modal.png` | 兑换 confirm 弹窗 | 点 "兑换" 按钮 → modal 显示 |
| `shop-insufficient-coins.png` | 余额不足按钮置灰 | child balance=5, 尝试换 10 金币商品 |
| `shop-weekly-limit-reached.png` | 周次数用完按钮置灰 | 本周已兑 3 次游戏时间, 第 4 次按钮置灰 |
| `shop-redemption-success.png` | 兑换成功 toast | 兑换成功后 toast + 刷新后余额 |

**实施细节**:
- 用 `await expect(page).toHaveScreenshot('xxx.png')` (Playwright 内置)
- 首次跑 capture 基线, 后续 commit 比对
- 容差: `maxDiffPixelRatio: 0.01` (1% 像素差异容许)
- 如有 UI 微调, 用 `npx playwright test --update-snapshots` 重新 capture

### 7.4 跑完整 e2e (M5 收尾)

```bash
npm run test:e2e  # 现有 48 个 + 新 ~20 个 = ~68 个
npm run typecheck  # 0 错
```

---

## 8. M6 docs 同步任务清单

### 8.1 `docs/FEATURE_MATRIX.md` 表 C (M6.1, 5 min)

新增 4 行 (按 UI 功能分类):

| TEST_PLAN § | UI 功能 | Smoke | Happy | Edge | 实际 e2e spec |
|---|---|---|---|---|---|
| **3.16.1** | Child Shop Page (v3) | ✓ | ✓ | ✓ | `coin-system.spec.ts` F9-F12 + `coin-visual-regression.spec.ts` |
| **3.16.2** | Child Balance Card 跳转 (v3) | ✓ | ✓ | — | `coin-system.spec.ts` F12 |
| **3.16.3** | Child 兑换历史 (v3) | ✓ | ✓ | — | `coin-system.spec.ts` F11 |
| **3.16.4** | Admin Shop Pending Fulfill (v3) | ✓ | ✓ | — | `coin-system.spec.ts` (admin 部分) + `coin-visual-regression.spec.ts` |

### 8.2 `docs/PROGRESS.md` (M6.2, 10 min)

新增 2 个 entry:

```markdown
## ✅ v2.3 — Coin System Init (M1 数据层 + 文档) — 2026-06-11
PR #32 add-coin-system: migrations 0007_coin_system.sql + src/utils/coin.ts + RFC + Test Plan + PRD §12
(实际 M1 done 在 v2.3, RFC §9 M1)

## ✅ v3 — Coin System 金币系统 (M2 + M3 + M4 + M5 + M6 完成) — 2026-06-XX
PR feat/coin-shop: M2 任务金币 API (合 main in v2.3) + M3 商店 API + M4 商店页 + M5 e2e + M6 docs
2 个商品: 🎮 游戏时间 10 分钟 (10 金币, 周 3 次) / 🧱 小乐高 (50 金币, 周 1 次, custom 流程)
测试: 12 functional + 4 SQL invariant + 5 visual regression = 21 新 test
```

### 8.3 `docs/INDEX.md` (M6.3, 3 min)

在 "📋 产品 & 需求" 区块加 4 行:

```markdown
- [coin-system-rfc.md](./coin-system-rfc.md) — 金币系统 RFC (v3 主 spec, 6 Module 实施分阶段)
- [coin-system-test-plan.md](./coin-system-test-plan.md) — 金币系统测试计划 (F1-F12 + TC-X1-X8 + visual regression)
- [coin-system-m2-test-regressions.md](./coin-system-m2-test-regressions.md) — M2 实施 4 个 fail 修复 + 2 clarification
- [coin-shop-requirements.md](./coin-shop-requirements.md) — M3-M6 实施需求 (feihao 拍板 + 冲突清单, 本 PR)
```

### 8.4 `docs/TEST_PLAN.md` (M6.4, 10 min)

新增 `§3.16 Coin System Test Scenarios` (F1..F12 + TC-X1..X8 + 5 visual regression):
- 同时把 §3.7 "PM Exchange" 标题改成 "PM 双账户兑换 (game ↔ money)" (消歧)
- 跨表 + Coverage Matrix 加 1 行

### 8.5 (deploy: 走 GH Action auto, M6.6 不需手动)

---

## 9. PR workflow (per feihao style)

- Branch: `feat/coin-shop` from `origin/main` @ 239d076 ✅ 已建
- Commits: 4 个 (M3 / M4 / M5 / M6 各 1)
  - `feat(coin): M3 商店 API + 商品 seed (2 件: 游戏时间 10 分钟 + 小乐高)`
  - `feat(coin-ui): M4 商店页 + 第 3 balance card 跳转 (Mecha 风格 follow main)`
  - `test(coin): M5 e2e + visual regression (12 functional + 4 SQL invariant + 5 visual)`
  - `docs(coin): M6 docs 同步 (FEATURE_MATRIX + PROGRESS + INDEX + TEST_PLAN)`
- 修 PR: commit + `git push --force-with-lease`, 不开新 fix branch
- 验收: code-agent 跑 typecheck + vitest unit pass; qual-agent 跑完整 e2e (48 + 21 = 69) + visual regression 5/5 pass
- Push: 等 PM 拍 (red-light default 不 push)
- 部署: merge → GH Action auto backup (c58a139f2c7c) + Pages deploy

---

## 10. 已知风险

| # | 风险 | 缓解 |
|---|---|---|
| 1 | 06-14 同日 4 次 deploy failure (INCIDENTS.md) | 部署前 smoke test 必带 `User-Agent: Mozilla/5.0` (per `kiddo-scoreboard-deploy` §9a); 必先 backup cron 跑通 |
| 2 | 2 个 pre-existing flaky in `me-tasks-complete.test.ts` (M2 已知) | 跟 M3-M6 无关, 单独 issue, 不阻塞本 PR |
| 3 | 2 个商品 icon 用 emoji (🎮 / 🧱) 在 iPad Safari 渲染可能不一致 | 沿用 main 已有 emoji (第 3 balance card 🪙) 渲染 OK, 不需额外 fallback |
| 4 | Visual regression baseline 首次 capture 在 iPad viewport (1180×820) 还是在 desktop (1280×720)? | 默认 iPad viewport (项目主战场), Playwright config 已设 `viewport: { width: 1180, height: 820 }` |
| 5 | Worktree 实施 vs 主 dir | 实施在主 dir `feat/coin-shop` branch (不开新 worktree per memory), 但 `kiddo-scoreboard-rebase-pr33` 临时 worktree 仍占位 (feihao 拍 "不管他" 留着) |
| 6 | `task_completions.awarded_event_id` FK (PR #28 P0 fix) | M3 exchange 不动 task_completions, 不影响, 但要 verify 现有 FK 没破 |
| 7 | weekly_limit SQL 性能 (TC-X8 1000+ redemption < 50ms) | 现有 `idx_score_events_week` 索引覆盖, 应 OK; 如不达标, 加 `idx_shop_redemptions_user_week` 复合索引 |

---

## 11. 委派 subagent 启动计划 (待 feihao 拍 "开始")

| Agent | Profile | 范围 | Worktree | ETA |
|---|---|---|---|---|
| **Code Agent** | `code-agent` | M3 (API) + M4 (UI) + M6 (docs) | 主 dir `feat/coin-shop` branch (已建) | ~75 min |
| **Qual Agent (Call Agent)** | `qual-agent` | M5 e2e + visual regression | `kiddo-scoreboard-clean` (per memory 常驻 dir) | ~60 min |

两个 agent 跑 background (PM 继续响应 feihao 其他任务, 不阻塞等结果)。

---

**Status**: 📋 文档就绪, 待 feihao 拍 "开始委派 subagent"。

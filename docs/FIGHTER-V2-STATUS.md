# Fighter V2 — 实现状态文档

> **本文档是 Fighter V2 的 Source of Truth。**
> 新 session 第一件事：读本文件，立刻知道当前状态、下一步、风险。
> **代码优先** — 如果本文档与 `public/fighter/v2/` 实际代码不一致，**以代码为准**，修本文档。

**最后核对**: 2026-07-20
**当前分支**: `feat/fighter-v2-rpg`
**入口 URL**: `/fighter/v2/fighter`（`.html` 会 308 到无扩展名）
**Source-of-truth 顺序**:
  1. `public/fighter/v2/*.js`（代码）
  2. 本文档（状态追踪）
  3. `HANDOVER-fighter-v2.md`（历史设计稿，见 §K 历史标记）

---

## A. 文档定位

| 项 | 值 |
|---|---|
| 文档性质 | 实现状态 + 交接文档 |
| 最后更新 | 2026-07-20 |
| 关联分支 | `feat/fighter-v2-rpg` |
| 入口 URL | `/fighter/v2/fighter`（canonical）|
| 旧设计稿 | `HANDOVER-fighter-v2.md`（历史，**有偏差**，见 §I）|
| localStorage key | `fighterV2Bank`（`utils.js:6`）|
| 主要代码 | `public/fighter/v2/`（11 个 JS + 1 个 HTML + 1 个 CSS）|

---

## B. 真实文件结构

```
public/fighter/v2/
├── fighter.html           72 行  — 主入口 HTML（3 个 view sections）
├── fighter.js           214 行 — 入口初始化 + view router
├── fighter.css         1919 行 — 所有样式
├── battle-scene.js       543 行 — Battle renderer（Hero/Monster sprites + HP bars + 飘字 + banner）
├── battle-controller.js   435 行 — 回合制状态机
├── combat.js             517 行 — 伤害公式 / 数值计算（pure functions）
├── skill-effects.js       350 行 — 3 技能实现 + VFX 动画
├── equipment.js          258 行 — 3 阶装备系统
├── shop-modal.js         380 行 — 装备店 modal
├── world-map.js          144 行 — Main menu scene（START/LEVELS/OPTIONS/QUIT）
├── stage-intro.js        157 行 — Stage intro screen
├── stages.js            217 行 — 5 World × 3 Stage 数据
└── utils.js             224 行 — localStorage helpers + DOM helpers

public/assets/fighter/v2/
├── ASSET-CATALOG.md              — 豆包 asset 清单（artifact，只读）
├── hero-idle.png / hero-attack.png / hero-hurt.png / hero-victory.png
├── monster-fungus.png / monster-worm.png / monster-dragon.png
└── equip-sword-bronze.png / equip-shield-wood.png / equip-potion-small.png

src/games/fighter/  (旧版逻辑，与 public/fighter/v2/ 无关)
├── assets.ts / economy.ts / items.ts / logic.ts / state.ts

tests/unit/fighter-v2/           (8 个 spec, Vitest node 环境)
tests/e2e/fighter-v2/            (3 个 spec, Playwright iPad 1024×768)
```

> **注意**：`src/games/fighter/` 是旧版纯逻辑代码，与 `public/fighter/v2/` 是**两个独立的 source-of-truth**，共享数据模型但实现不同。

---

## C. 当前真实用户流程

```
/fighter/v2/fighter 入口
         │
         ▼
┌──────────────────────────┐
│ Main Menu (world-map.js) │
│  START / LEVELS / QUIT  │
└───────────┬──────────────┘
            │ 点击 START 或 LEVELS
            ▼
┌──────────────────────────┐
│ Stage Intro (stage-intro.js) │
│  World X · 3 个 Stage 列表 │
│  点击 Stage → 进入战斗     │
└───────────┬──────────────┘
            │ 点击 Stage
            ▼
┌──────────────────────────┐
│ Battle Scene (battle-controller.js + battle-scene.js) │
│                                                │
│  [Hero's Turn]                                 │
│   → 显示 "HERO'S TURN!" banner                │
│   → ATTACK / SKILL / ITEM 按钮                │
│   → 执行 → 飘字动画                            │
│                                                │
│  [Monster's Turn]                             │
│   → 显示 "DRAGON PREPARES FIRE!" banner        │
│   → 怪物反击 → Hero HP -damage                │
│                                                │
│  循环直到：                                    │
│   • Hero HP = 0 → 💀 Defeat Modal → 重试/返回 │
│   • 所有怪物死亡 → ⭐ Victory Modal            │
│     → 还有 Stage → 自动进入下一 Stage          │
│     → Stage 全清 → ⚔️ Shop Modal → 返回地图   │
└────────────────────────────────────────────────┘
```

### 当前可达流程（重要）

```text
START / LEVELS → 固定进入 World 0 → 选择或连续挑战 1-1 / 1-2 / 1-3
→ World 0 clear → +15⭐ → Shop → 返回 Main Menu
```

- `handleStartGame()` 和 `handleLevels()` 都把 `worldIdx` 固定为 `0`。
- `handleWorldClick()` 没有被当前 Main Menu 调用；页面也没有 World 选择入口。
- World 1-2（代码索引 1-2，即多义虫/巨龙）已有 stage 数据，但**当前 UI 不可达**。
- Victory modal 选择“下一关”可在 World 0 内连续进入 1-2、1-3；若中途返回，未保存逐关通关状态。

### 计划中的目标流程（尚未打通）

```text
World 0 clear → World 1 → World 2 → World 3/4 deferred
```

---

## D. localStorage Schema

**Key**: `fighterV2Bank`（`utils.js:6`）

```js
{
  v: 2,                                       // schema version
  bank: {
    stars: 0,                                  // ⭐ 国库余额（长期持久）
  },
  session: {
    stars: 0,                                 // 当局 spendable；当前实现不会自动从 bank.stars 初始化
    worldIdx: 0,                               // 当前 World (0-4)
    stageIdx: 0,                               // 当前 Stage (0-2)
    currentMonsterIdx: 0,                      // 当前 stage 内怪物队列 index
  },
  hero: {
    hp: 100, maxHp: 100,
    mp: 100, maxMp: 100,
    atk: 10, def: 0,
    shieldBuff: 0, shieldBuffRounds: 0,        // 护盾 buff
    skillCooldowns: { fireball: 0, heal: 0, shield: 0 },  // 剩余 cd
  },
  equipment: {
    sword: 'none',    // 'none' | 'bronze' | 'silver' | 'gold'
    shield: 'none',
    potion: 'none',
  },
  progress: {
    worldsCleared: [],   // e.g. [0, 1] = World 1+2 cleared
  },
}
```

---

## E. 关卡 / 怪物 / 奖励数据

### World 定义（`stages.js:159-165`）

| World | 名称 | emoji | 怪物 | 解锁条件 | 状态 |
|---|---|---|---|---|---|
| 0 | 菌绿森林 | 🌲 | 懒词菌 | 默认开放 | ✅ 当前可达 |
| 1 | 多义虫巢穴 | 🐛 | 多义虫 | 完 World 0 | ⚠️ 数据已实现，UI 不可达 |
| 2 | 拼写巨龙洞穴 | 🐉 | 拼写巨龙 (boss) | 完 World 1 | ⚠️ 数据已实现，UI 不可达 |
| 3 | 法师高塔 | 🏰 | — | 完 World 2 | 🛑 deferred |
| 4 | 终极城堡 | 🏰 | — | 完 World 3 | 🛑 deferred |

### Stage 脚本（World 0-2 已实现）

| World | Stage ID | 怪物组合 | 总怪数 | 难度 |
|---|---|---|---|---|
| 🌲 菌绿森林 | 1-1 | 懒词菌 × 3 | 3 | ⭐ |
| | 1-2 | 懒词菌 × 4 | 4 | ⭐ |
| | 1-3 | 懒词菌 × 5 | 5 | ⭐ |
| 🐛 多义虫巢穴 | 2-1 | 多义虫 × 3 | 3 | ⭐ |
| | 2-2 | 多义虫 × 4 | 4 | ⭐ |
| | 2-3 | 多义虫 × 5 + 懒词菌 × 2 | 7 | ⭐⭐ |
| 🐉 巨龙洞穴 | 3-1 | 多义虫 × 4 + 懒词菌 × 2 | 6 | ⭐⭐ |
| | 3-2 | 多义虫 × 6 | 6 | ⭐⭐ |
| | 3-3 (BOSS) | 拼写巨龙 × 1 + 多义虫 × 3 | 4 | ⭐⭐⭐ |
| 🏰 法师高塔 | 4-1~4-3 | (空) | 0 | — |
| 🏰 终极城堡 | 5-1~5-3 | (空) | 0 | — |

### Monster 数值（`stages.js:171-175`）

| 怪物 | HP | ATK | DEF | 反击间隔 |
|---|---|---|---|---|
| 懒词菌 🍄 | 30 | 5 | 0 | 1 回合 |
| 多义虫 🐛 | 50 | 8 | 2 | 1 回合 |
| 拼写巨龙 🐲 | 100 | 20 | 5 | 1 回合 |

### ⭐ Economy

| 来源 | 数量 |
|---|---|
| Stage clear bonus | +5 ⭐ |
| World clear bonus | +15 ⭐ |

---

## F. 战斗 / 技能 / 装备规则

### 回合制流程（`battle-controller.js`）

```
[Hero's Turn]
  → 显示 "HERO'S TURN!" banner (1.5s)
  → 玩家选 action（ATTACK / SKILL / ITEM）
  → 执行动画 + 飘字

[Monster's Turn]
  → 显示 "DRAGON PREPARES FIRE!" banner (1.5s)
  → 怪物按 `max(1, atk - heroDef)` 反击
  → Hero HP -damage + flash 红

[Stage Clear Check]
  → 当前 monster HP ≤ 0 → 移至下一 monster
  → 所有 monster 全清 → +5⭐ → Victory Modal
  → 还有 Stage → 自动进入下一 Stage

[Defeat]
  → Hero HP ≤ 0 → 💀 Defeat Modal
  → 本局 0⭐ → 可重试或返回地图
```

### 3 固定技能（`combat.js:44-69`）

| 技能 | MP | Cooldown | 效果 | 代码位置 |
|---|---|---|---|---|
| 🔥 火球 | 30 | 5 回合 | -30 HP | `combat.js:45-52` |
| 💚 治愈 | 40 | 8 回合 | +30 HP（封顶 maxHp）| `combat.js:53-60` |
| 🛡️ 护盾 | 50 | 12 回合 | DEF +10 持续 5 回合 | `combat.js:61-69` |

### 法力系统

| 项 | 值 |
|---|---|
| Max MP | 100 |
| 起始 MP | 满（100）|
| 当前实际回复 | Hero turn 结束 +10，Monster turn 结束再 +10，即完整攻防循环最多 +20 MP；与旧 spec 的“每回合 +10”不一致 |

### Hero 数值（`combat.js:30-40`）

| 属性 | 值 |
|---|---|
| HP | 100 / 100 |
| MP | 100 / 100 |
| ATK | 10（+ 装备加成）|
| DEF | 0（+ shield buff + 装备加成）|

### 3 阶装备（`equipment.js:13-44`）

| 装备 | Bronze | Silver | Gold | 解锁条件 |
|---|---|---|---|---|
| ⚔️ 剑 | +5 ATK | +12 ATK | +25 ATK | Bronze 免费；Silver 清 World 0 后；Gold 清 World 1 后 |
| 🛡️ 盾 | +3 DEF | +8 DEF | +15 DEF | 同上 |
| 💊 药水 | +20 HP | +50 HP | +100 HP | 数据/商店已定义，但 ITEM 当前无效果 |

> ⚠️ **注意**：装备通过 `none`/`bronze`/`silver`/`gold` 区分。`autoEquipBronze()` 当前未被调用；免费 Bronze 在 UI 显示“已拥有”，但新状态仍是 `none`。

---

## G. 实现状态四列表

> 判定原则：文件/函数存在不等于用户可用；必须从当前 UI 可达，并有真实测试或浏览器验证。

### ✅ 已实现且当前可用

| 功能 | 文件 | 状态 |
|---|---|---|
| Main Menu 与 3-view router | `fighter.js` + `world-map.js` | ✅ 可进入主菜单、World 0 关卡页、战斗页 |
| World 0 三关数据与连续“下一关”流程 | `stages.js` + `battle-controller.js` | ✅ 可连续完成 1-1 → 1-2 → 1-3 |
| 基础攻击、怪物反击、胜利/失败 modal | `combat.js` + `battle-controller.js` + `battle-scene.js` | ✅ 浏览器可操作 |
| 伤害公式、HP/MP、飘字与回合 banner | `combat.js` + `skill-effects.js` | ✅ 基础路径可运行 |
| 装备/商店数据模型 | `equipment.js` + `shop-modal.js` | ✅ 商店 UI 与购买函数存在 |

### ⚠️ 部分实现 / 当前有功能缺口

| 功能 | 实际状态 | 证据 |
|---|---|---|
| World 1-2（多义虫/巨龙）| Stage 数据存在，但 Main Menu 永远传 `worldIdx: 0`，没有世界选择入口 | `fighter.js:98-109` |
| 3 技能 | `SKILL` 按钮只硬编码火球；治愈/护盾无 UI 入口 | `battle-scene.js:529-533` |
| 技能 cooldown | 定义和校验存在，但 `applySkill()` 从未写入 cooldown，实际始终为 0 | `combat.js:223-225` |
| ITEM / 药水 | 按钮会结束玩家回合，但 controller 没有 `item` 分支，药水不生效 | `battle-scene.js:536-540` + `battle-controller.js:152-165` |
| Bronze 装备 | `autoEquipBronze()` 未调用；商店把免费档显示为“已拥有”，状态仍可能是 `none` | `equipment.js:242-257` + `shop-modal.js:177-180` |
| 星星 economy | Stage/World 奖励同时加 bank + session；购买只扣 session，bank 不扣 | `battle-controller.js:293-305` + `equipment.js:155-168` |
| 关卡进度 | 只记录 `worldsCleared`，没有逐关完成状态；中途返回无法恢复到下一关 | `utils.js:29` + `stage-intro.js:136-145` |
| 核心 sprites | **不是"没裁帧"的问题 —— 这些 PNG 本来就是单图不是帧表** (2026-11-20/21 实测, 见 `public/assets/fighter/v2/ASSET-CATALOG.md`「真实画布布局」)。实测显示错的是**指错了文件**: Hero 槽位指向 `hero-attack.png` (实际是一把剑), 懒词菌指向 `monster-fungus.png` (实际是金发少年) | 2026-07-20 本地 iPad 1024×768 浏览器验证 + 2026-11-21 vision 复核 |
| 响应式布局 | Main Menu 的 QUIT 靠近底边；Battle 信息与城堡背景重叠 | 2026-07-20 本地浏览器截图 |

### ❌ 未实现

| 功能 | 说明 |
|---|---|
| 单词问答/教育闭环 | 当前战斗没有 vocab question、答题或学习反馈，名字是“单词战士”但玩法仍是纯点击战斗 |
| Options | 点击只显示“即将开放” toast |
| BGM / SFX | 没有音频资产与触发逻辑 |
| World 3-4（代码索引 3-4）| Stage 为空，显式 deferred |
| 可用的药水动作 | 数据和按钮存在，但没有实际效果 |

### 🛑 显式 Deferred（V3）

- World 3-4（法师高塔 / 终极城堡）与其 assets
- 每日任务 / 成就系统
- 怪物 AI / 移动路径
- 多语言 / 排行榜 / 后端同步

---

## H. 测试矩阵

### 单元测试（Vitest，node 环境）

**2026-07-20 真实运行结果**：`npx vitest run tests/unit/fighter-v2` → **6 files passed / 2 files failed；192 tests passed / 12 tests failed**。

**2026-11-22 复核（cron 实测，已全绿）**：同一命令 → **13 files passed / 0 failed；265 tests passed / 0 failed**。
下面的 2026-07-20 记录保留作历史对照；**当前 baseline = 13 files / 265 tests 全绿**（2026-11-14 成就墙分支合并 + 11-15/11-17/11-20/11-21 几轮修复把 `stage-intro` 的 `window` guard 和 `world-map` 的 API drift 都补齐了）。

- ~~`stage-intro.test.ts`：import 时 `window is not defined`，0 tests executed。~~ → ✅ 已修
- ~~`world-map.test.ts`：12 fail；测试仍期望 `isWorldUnlocked/getCurrentWorldIdx/allWorldsCleared` 从 `world-map.js` 导出，但 UI overhaul 后已不存在。~~ → ✅ 已修

| 文件 | 覆盖功能 |
|---|---|
| `tests/unit/fighter-v2/combat.test.ts` | 伤害公式、护甲计算、HP/MP 操作 |
| `tests/unit/fighter-v2/skills.test.ts` | 火球/治愈/护盾效果、冷却递减 |
| `tests/unit/fighter-v2/turn-resolver.test.ts` | 回合状态机、护盾持续 |
| `tests/unit/fighter-v2/equipment.test.ts` | 装备数据、tier lookup、购买 |
| `tests/unit/fighter-v2/shop.test.ts` | 商店逻辑、世界通关奖励 |
| `tests/unit/fighter-v2/stages.test.ts` | 15 关卡数据、WORLDS 元数据 |
| `tests/unit/fighter-v2/world-map.test.ts` | 世界解锁逻辑；✅ 已修 |
| `tests/unit/fighter-v2/stage-intro.test.ts` | 关卡描述生成；✅ 已修 |
| `tests/unit/fighter-v2/asset-tracking.test.ts` | 运行时 PNG 必须 git-tracked（11-15 加）|
| `tests/unit/fighter-v2/asset-sheet-guard.test.ts` | 素材是单图不是帧表 + 注释不许再宣称帧表（11-20 加）|
| `tests/unit/fighter-v2/battle-scene.test.ts` | Battle 渲染 |
| `tests/unit/fighter-v2/battle-scene-monster-advance.test.ts` | 多怪关卡推进 |
| `tests/unit/fighter-v2/shop-modal-icon.test.ts` | 商店图标语义（10-29 加）|

### E2E 测试（Playwright，iPad 1024×768）

| 文件 | 覆盖流程 | 依赖 |
|---|---|---|
| `tests/e2e/fighter-v2/battle.spec.ts` | 战斗导航、HP/MP、攻击、技能 | ❌ **类名不匹配**，测试当前**失败** |
| `tests/e2e/fighter-v2/shop.spec.ts` | 商店购买、星星扣除 | ⚠️ 需验证 |
| `tests/e2e/fighter-v2/world-map.spec.ts` | 世界节点、锁定状态 | ⚠️ 需验证 |

### Visual 测试

| 文件 | 覆盖功能 | tunnel 依赖 | 可靠性 |
|---|---|---|---|
| `scripts/visual-test-suite.mjs` | main-menu / battle-scene / defeated-lock / sequential-lock | **hardcoded tunnel**: `https://placing-cigarettes-adapters-kernel...trycloudflare.com` | ❌ 不可在 CI 运行 |
| 7 个 `verify*.mjs` | 调试截图 | 同上 tunnel | ❌ 一次性脚本 |

> ⚠️ **E2E battle.spec.ts 类名不匹配问题**：
> - 测试用 `.battle-hero__name`、`.battle-monster__title`、`#btn-fireball` 等
> - 实际实现用 `.dk-battle-*`、`.dk-character-*`、`#btn-attack/skill/item`
> - 测试当前**失败**，需更新或实现兼容层

### npm scripts

| 命令 | 用途 |
|---|---|
| `npm run test:unit` | `vitest run` — 单元测试 |
| `npm test` / `npm run test:e2e` | `playwright test` — E2E 测试 |
| `npm run test:visual` | `node scripts/visual-test-suite.mjs` — Visual 测试 |
| `npm run test:visual:main-menu` | main-menu suite |
| `npm run test:visual:battle-scene` | battle-scene suite |
| `npm run test:visual:defeated-lock` | defeated-lock suite |
| `npm run test:visual:sequential-lock` | sequential-lock suite |

---

## I. 已知风险和文档偏差

### 与 HANDOVER-fighter-v2.md 的偏差

| 项 | HANDOVER 描述 | 实际实现 | 风险 |
|---|---|---|---|
| localStorage key | `fighterV2Bank` | ✅ 一致（`utils.js:6`）| — |
| 文件结构 | 8 个 JS 模块 | 11 个 JS + 1 HTML + 1 CSS | 低 |
| 技能按钮 | HANDOVER 写 5 个 action 选择（ATTACK/🔥/💚/🛡️/💊）| 实际 3 按钮（ATTACK/SKILL/ITEM），SKILL 只触发火球，ITEM 无效果 | 高 |
| World 4-5（代码索引 3-4）| V2 launch | V3 deferred | 低 |
| BGM/SFX | P5 计划 | 未实现 | 低 |
| 装备等级 | HANDOVER 写"三阶" | 实际 `none/bronze/silver/gold`（四态）| 低 |

### ⚠️ E2E battle.spec.ts 类名不匹配

**问题**：`tests/e2e/fighter-v2/battle.spec.ts` 使用的选择器与实际 DOM 不匹配。

| 测试期望 | 实际实现 | 状态 |
|---|---|---|
| `.battle-hero__name` | `.dk-character-name` | ❌ |
| `.battle-monster__title` | `.dk-monster-info .dk-character-name` | ❌ |
| `#btn-fireball` | `#btn-skill` | ❌ |
| `.battle-banner` | `.dk-battle-banner` | ❌ |

**影响**：E2E battle 测试当前**失败**，需要：
1. 更新测试使用正确的 `dk-` 前缀选择器，或
2. 在 `battle-scene.js` 中添加兼容层

### 技术风险

| 风险 | 等级 | 缓解 | 完成方 |
|---|---|---|---|
| World 1-2 无 UI 入口，核心进度被锁在 World 0 | 🔴 P0 | 恢复 World selector / current-world routing，并做通关后跳转 | CC |
| SKILL 只会火球；ITEM 无效果且会浪费回合 | 🔴 P0 | 做技能选择层和药水动作；无可用药水时禁用 ITEM | CC |
| cooldown 永远不写入，MP 每完整循环恢复 +20 | 🔴 P0 | 统一 turn resolver，在一次 action 后写 cooldown 并只 regen 一次 | CC |
| Hero/monster/icon sprite 映射错误，白底和角色错位 | 🔴 P0 | 用已裁好的单帧 assets，按网络 + DOM + screenshot 三维验收 | UI Design + CC + Qual |
| Unit 6 files pass / 2 files fail（2026-07-20 记录）；**当前已全绿 13 files / 265 tests**（2026-11-22 实测）| 🟢 P0 已解 | 单测 baseline 已绿；E2E selector drift 仍待处理 | CC + Qual |
| 星星 bank/session 双账不一致，购买不扣 bank | 🟡 P1 | 先拍板单一余额 source-of-truth，再补 economy tests | PM + CC |
| Visual 测试依赖 hardcoded tunnel | 🟡 P1 | 改为 `FIGHTER_BASE_URL`，默认 local URL | CC |
| `battle-controller.js` 使用旧选择器 | 🟡 P1 | `.battle-sprite--hero` 与新 `dk-` DOM 统一 | CC |

---

## J. Improve Backlog

### P0（先把“能完整玩”修通）

| # | Item | 用户价值 | 证据 | 建议改法 | 完成方 |
|---|---|---|---|---|---|
| P0-1 | **打通 World 0 → 1 → 2 进度** | 不会通完第一世界后永远回到 1-1 | START/LEVELS 固定 `worldIdx: 0`，`handleWorldClick()` 未使用 | Main Menu 加 World 选择/当前世界；通关后写并进入下个世界 | CC |
| P0-2 | **让 3 技能和药水真的可选、可用** | 6 岁孩子看到什么就能点什么，不会被假按钮骗 | SKILL 硬编码 fireball；ITEM 无 controller 分支 | 技能抽屉显示火球/治疗/护盾、MP/CD；药水按装备档治疗；不可用时 disabled | UI Design + CC |
| P0-3 | **修正 cooldown + MP 回合规则** | 战斗数值可预测，有策略而不是无限火球 | cooldown 未赋值；一轮 regen 两次 | 建单一 `resolvePlayerAction()`；技能使用时设 CD；每完整回合只 regen 一次 | CC |
| P0-4 | **修正战斗 sprites 与布局** | 角色不再“骑士=剑、怪物=骑士”，画面能让孩子理解 | 2026-07-20 iPad 实测出现错误角色、白底、背景压住信息 | 接已裁单帧 PNG；Hero/monster/action icon 分开；1024×768 screenshot 验收 | UI Design + CC + Qual |
| P0-5 | **恢复绿色测试基线** | 后续 CC 可安全迭代 | Unit 2 files fail / 12 tests fail；E2E selector drift | 修 `window` guard、world-map test 契约、battle selectors；记录真实基线 | CC + Qual |

### P1（产品价值与可维护性）

| # | Item | 用户价值 | 证据 | 建议改法 | 完成方 |
|---|---|---|---|---|---|
| P1-1 | **接入 4 选 1 单词题** | 让“单词战士”真正服务学习，而不是纯点攻击 | 当前没有 vocab question/答题反馈 | 每个 Hero action 前出 4 选 1；答对执行并奖励，答错给解释后仍可继续 | PM + Research + CC |
| P1-2 | **统一星星 economy** | 奖励、购买、HUD 数字一致 | 奖励同时加 bank/session，购买只扣 session | 选 bank 或 session 为唯一 spendable source；补 purchase/reload tests | PM + CC |
| P1-3 | **逐关进度与继续游戏** | 中途退出不会丢进度 | 只存 `worldsCleared` | 增加 `stagesCleared` / `currentUnlockedStage`，迁移 v2 state | CC |
| P1-4 | **中文化与 6yo 文案** | 孩子不用理解 START/LEVELS/ATTACK/ITEM | 主菜单和战斗大量英文 | 主按钮中文为主、英文小字为辅；“返回地图”改“返回主菜单” | Writing + UI Design + CC |
| P1-5 | **Visual suite 可复用** | 本地/CI/tunnel 都能跑同一套 | BASE URL hardcoded | `FIGHTER_BASE_URL ?? http://127.0.0.1:8787/...`；移除一次性脚本 | CC + Qual |
| P1-6 | **拆分 1919 行 CSS / 明确 V2 source-of-truth** | 降低视觉回归和双逻辑漂移 | CSS 单文件超大；`src/games/fighter/` 与 V2 并存 | 按 scene 拆 CSS；给旧逻辑加 legacy banner 或迁移/删除计划 | Code Architect + CC |

### P2（内容扩展）

| # | Item | 用户价值 | 证据 | 建议改法 | 完成方 |
|---|---|---|---|---|---|
| P2-1 | BGM / SFX 与静音开关 | 提升沉浸感且不打扰家长 | 当前 OPTIONS 与音频均未实现 | 先补静音/音量，再接 BGM + 关键 SFX | feihao (audio) + CC |
| P2-2 | World 3-4 完整内容 | 延长可玩时长 | `stages.js` 为空 | 先关卡脚本再资产，逐 World 发布 | PM + CC + UI Design |
| P2-3 | 每日任务 / 成就系统 | 提升长期粘性 | V3 deferred | 复用 scoreboard 任务/金币系统，避免新建平行货币 | PM + CC |

---

## K. CC 接手 Checklist

### Step 1: 进入项目 + 验证分支

```bash
cd /Users/tidusmaomao/workspace/kiddo-scoreboard
git status --short --branch
# 期望：在 feat/fighter-v2-rpg 分支，WIP 存在但不要清理
```

### Step 2: 读本文档

```
docs/FIGHTER-V2-STATUS.md — 快速了解当前状态
```

### Step 3: 找实际代码

```bash
# 入口文件
cat public/fighter/v2/fighter.html

# localStorage helpers（确认 key 是 fighterV2Bank）
cat public/fighter/v2/utils.js

# 战斗逻辑
cat public/fighter/v2/combat.js

# 关卡数据
cat public/fighter/v2/stages.js
```

### Step 3A: 按问题锁定文件范围

| 问题类型 | 默认可改 | 默认不要碰 |
|---|---|---|
| World 路由 / 关卡进度 | `fighter.js`, `world-map.js`, `stage-intro.js`, `stages.js`, `utils.js` | `combat.js`, `equipment.js` |
| 战斗规则 / 技能 / MP | `combat.js`, `battle-controller.js` + 对应 unit tests | Main Menu 资产与无关 CSS |
| 战斗视觉 / sprite | `battle-scene.js`, `fighter.css`, cropped runtime assets | `combat.js`, `stages.js` |
| 商店 / 装备 / 星星 | `equipment.js`, `shop-modal.js`, `battle-controller.js` + tests | `world-map.js` |
| 纯文案 / 中文化 | `world-map.js`, `stage-intro.js`, `battle-scene.js` | 战斗数值 |

- 开始前把 `git status --short` 保存到任务日志；结束后再跑一次，确保没有把 pre-existing WIP 带进任务。
- 不要直接 `Read` PNG/JPG 二进制；先读 `public/assets/fighter/v2/ASSET-CATALOG.md`，视觉内容用截图/图像工具验证。
- 视觉修复必须同时做 Network 200、DOM 非 0 尺寸、1024×768 screenshot 三维验证。

### Step 4: 运行测试

```bash
# 单元测试
npx vitest run tests/unit/fighter-v2/

# E2E 测试（注意 battle.spec.ts 当前失败）
npx playwright test tests/e2e/fighter-v2/

# Visual 测试（需要 tunnel 存在）
npm run test:visual
```

### Step 5: 启动本地预览

```bash
npm run dev
# 浏览器打开 http://localhost:8787/fighter/v2/fighter
```

### Step 6: 修改后验证

```bash
# 确保不破坏现有功能
npx vitest run tests/unit/fighter-v2/
npx playwright test tests/e2e/fighter-v2/

# 手动验证关键流程
# 1. Main menu 渲染
# 2. Stage 1-1 完整通关
# 3. World 1 Clear + Shop Modal
```

---

## L. 历史设计稿标记

> **HANDOVER-fighter-v2.md 处理**（2026-07-15）

`HANDOVER-fighter-v2.md` 是历史设计稿，存在以下偏差：

| 项 | HANDOVER 写的是 | 实际实现是 |
|---|---|---|
| localStorage key | `fighterV2Bank` | ✅ `fighterV2Bank`（一致）|
| 文件结构 | 8 个 JS 模块 | 11 个 JS + 1 HTML + 1 CSS |
| 技能按钮 | 5 个 action 选择 | 3 按钮；SKILL 只触发火球，ITEM 无效果 |
| BGM/SFX | P5 实现 | 未实现 |
| World 4-5（代码索引 3-4）| V2 launch | V3 deferred |

**Source of Truth 已改为 `docs/FIGHTER-V2-STATUS.md`**

---

*最后更新：2026-07-20*
*维护：任何 Fighter V2 代码改动后同步更新本文档*

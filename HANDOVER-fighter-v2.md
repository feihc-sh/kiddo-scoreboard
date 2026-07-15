# HANDOVER — Fighter V2 (Monument Valley-grade RPG) — 2026-07-15

> **新 session 第一件事**：扫一眼本文件 §9 完成方表 + §11 checklist，立刻知道下一步做什么。
> 中间设计讨论、`feihao 拍板`可回查当前 Feishu chat 或 `session_search("fighter v2 rpg")`。

---

## 1. TL;DR

- **V2 = V0 完整重写**（不是 incremental）。V0 fighter 整个弃用，public/fighter/* 全部替换。
- **方向**：Monument Valley 精致 RPG（feihao 2026-07-15 拍板方案 C）
- **核心玩法**：5 主题 World（Angry Birds 风格 path map）+ 回合制战斗（Q1=A）+ 自动法力回复 + 固定 3 技能 + 3 阶装备 RPG
- **风格**：Style C 像素 art（豆包生成）+ 主题色板 per World + BGM/SFX
- **目标**：6 岁 Lele 单 World 通关 1-3 min，5 World 累计 8-15 min
- **工作量**：10-14 天（5 Phase，PM 自治，按 feihao 2026-07-15 授权）

---

## 2. 路径与项目规则

| 项 | 值 |
|---|---|
| 项目本地 | `/Users/tidusmaomao/workspace/kiddo-scoreboard` |
| 远端 | `feihc-sh/kiddo-scoreboard.git` |
| 分支规则 | **main 不直 commit**，所有工作在 feature 分支（`feihao-pm-autonomy` §2） |
| 当前活跃分支 | `feat/fighter-v2-rpg`（基于 main `491f0b3` + V0 polish baseline `8b5824a`） |
| V2 代码路径 | `public/fighter/v2/{html, css, js}` + `public/assets/fighter/v2/{img, audio}`（V0 在 `public/fighter/`，不删） |

---

## 3. 美术锁定 — Style C (Pixel Art · 豆包) for V2

### 风格锚点 prompt（生所有 asset 必复用）

```
像素艺术风格 pixel art, sharp pixel edges 无抗锯齿, NES/SNES 复古色彩，
柔和顶光 (top-left)，isolated on pure white background，
no text no letters，child-friendly cute，
适合儿童教育RPG游戏
```

每张 prompt 末尾必加：`, pure white background, no text, no watermark`

### 10 张核心 asset（V2 launch 必需）→ 落 `public/assets/fighter/v2/`

| # | Asset | 落盘路径 | 豆包 prompt 主体 |
|---|---|---|---|
| 1 | Hero 站立 | `hero-idle.png` | hero character standing idle pose, blue cape, brave smile, sword at side |
| 2 | Hero 攻击 | `hero-attack.png` | hero character mid-attack slash, raised sword, dynamic action pose |
| 3 | Hero 受伤 | `hero-hurt.png` | hero character taking damage, surprised expression, slight lean back |
| 4 | Hero 胜利 | `hero-victory.png` | hero character victory pose, raised sword, cheering expression |
| 5 | 懒词菌 | `monster-fungus.png` | lazy vocabulary fungus monster, small green mushroom, sleepy droopy eyes, yawning |
| 6 | 多义虫 | `monster-worm.png` | polysemy worm monster, orange worm, floating meaning-symbol bubbles, confused look |
| 7 | 拼写巨龙 | `monster-dragon.png` | spelling dragon boss, large red dragon with alphabet letter scales (A B C), fierce but cute |
| 8 | 青铜剑 | `equip-sword-bronze.png` | bronze tier sword icon, simple brown blade with copper guard |
| 9 | 木盾 | `equip-shield-wood.png` | wooden tier shield icon, round wood with iron boss center |
| 10 | 小药水 | `equip-potion-small.png` | small health potion icon, tiny red flask with heart symbol |

### 20 张 V3 defer asset（V2 launch 后再生成）

- Hero 4 阶升级 + 2 boss 形态变体 = 6 张
- 5 World 主题背景 + 5 节点 icon = 10 张
- 3 技能 VFX icon = 3 张
- Silver/Gold tier 装备 = 6 张
- UI 装饰 (HP bar / mana bar / ⭐) = 4 张
→ 共 29 张，V3 再做。V2 launch 不需要。

### Asset 落地策略（API 失败 fallback）

- **首选**：豆包 Discord（feihao 手动跑）+ sips 裁水印（per `foreign-project-preview-tunnel` §asset-crop-mac.md）
- **fallback**：CSS emoji 占位（如果豆包也失败，P2 用 emoji 替代 + V3 再补）
- **路径规则**：所有 asset 必落 `public/assets/fighter/v2/`，文件名全小写 + kebab-case

### 加新 asset 的姿势
- 必复用上方 style anchor
- 颜色主题锁在暖色系（橙/金/棕/木）+ 功能色（蓝、紫、铁灰、红）
- **禁用 emoji · 写实 · 其他卡通风**

---

## 4. Fighter V2 Spec（核心范围 — 拍板版）

### ✅ 范围（V2 launch 包含）

- **5 主题 World** (Angry Birds-style path map)
- **回合制战斗**（Q1=A）
- **Hero + 3 怪物 + 5 关 × 3 stage = 15 关**
- **法力系统** + **3 固定技能**（fireball / heal / shield）
- **3 阶装备 RPG**（bronze / silver / gold 剑+盾+药水）
- **⭐ 国库** + 关卡奖励
- **World map UI** + Stage intro + Battle scene
- **BGM 1 首 + SFX 6 个**（P5 集成）
- **6yo 友好 UI**（HP/MP 大字 + 触控目标 ≥44pt + 中文文案）

### ❌ V2 不做（V3 defer）

- 每日任务 / 成就系统 / 排行榜
- 多账号 / 后端同步（localStorage only）
- 怪物 AI / 移动路径（怪物站桩）
- 多语言 i18n
- 复杂粒子特效（V2 简单 flash + 飘字，V3 升级）

### 5 主题 World 设计表

| # | World 名 | 主题色 | 主怪 | 主题 bg（V3）| Unlocked by |
|---|---|---|---|---|---|
| 1 | 菌绿森林 | #84cc16 绿 | 懒词菌 | 蘑菇森林 (V3) | 默认开放 |
| 2 | 多义虫巢穴 | #f97316 橙 | 多义虫 | 洞穴 (V3) | 完 World 1 |
| 3 | 拼写巨龙洞穴 | #dc2626 红 | 拼写巨龙 + 小怪 | 火山 (V3) | 完 World 2 |
| 4 | 法师高塔 | #7c3aed 紫 | 法师塔怪 (V3) | 法师塔 (V3) | 完 World 3 |
| 5 | 终极城堡 | #fbbf24 金 | 终极 boss (V3) | 城堡 (V3) | 完 World 4 |

> **注**：World 4-5 主题 bg 在 V3 补；V2 launch 3 个 World 已完整玩。

### Stage Script（5 World × 3 stage = 15 关）

| World | Stage | 怪物组合 | 总怪数 | HP 难度 |
|---|---|---|---|---|
| 1 菌绿森林 | 1-1 | 懒词菌 × 3 | 3 | ⭐ |
| | 1-2 | 懒词菌 × 4 | 4 | ⭐ |
| | 1-3 | 懒词菌 × 5 | 5 | ⭐ |
| 2 多义虫巢穴 | 2-1 | 多义虫 × 3 | 3 | ⭐ |
| | 2-2 | 多义虫 × 4 | 4 | ⭐ |
| | 2-3 | 多义虫 × 5 + 懒词菌 × 2 | 7 | ⭐⭐ |
| 3 巨龙洞穴 | 3-1 | 多义虫 × 4 + 懒词菌 × 2 | 6 | ⭐⭐ |
| | 3-2 | 多义虫 × 6 | 6 | ⭐⭐ |
| | 3-3 (BOSS) | 拼写巨龙 × 1 + 多义虫 × 3 | 4 | ⭐⭐⭐ |

> 保守数值（Q2 默认）：Hero HP 100/atk 10，单 stage 60-90s 通关，6yo 通关率 ≥ 80%。

### 回合制战斗系统（Q1=A）

**回合流程**：

```
[Hero's Turn]
  ↓ 显示 "⚔️ 你的回合" + 倒计时 5s（默认 action）
  ↓ 玩家选：⚔️ 攻击 / 🔥 火球 / 💚 治疗 / 🛡️ 护盾 / 💊 药水
  ↓ 选定 action → 执行动画（0.5s）→ 显示伤害/效果飘字

[Monster's Turn]
  ↓ 显示 "👾 敌人回合" + 倒计时 3s
  ↓ 怪物反击（按 atk - def）→ Hero HP -damage → flash 红
  ↓ 检查死亡 / 继续

[Stage Clear Check]
  ↓ 当前 stage 怪物全清 → +stage bonus ⭐ → 显示 Stage Clear modal
  ↓ 下一 stage 自动 spawn → "你的回合" 重启
```

**回合制 vs Auto-battle 决策**：Q1=A 回合制，理由：
1. Dragon's Keep Quest 风格参考（feihao 提供截图）
2. 6yo 不慌，每回合清晰看到"我做了什么"
3. 视觉化（"你的回合" / "敌人回合" banner）比 auto-battle 的连续动画更适合教育
4. 实现复杂度类似（setState + setTimeout 切换回合）

### Hero 数值表（保守默认）

| 属性 | 值 |
|---|---|
| HP | 100 / 100 |
| MP | 100 / 100 |
| ATK | 10 |
| DEF | 0（shield 加成）|
| Hero 反伤间隔 | N/A（回合制，无反击）|

### Monster 数值表

| 怪物 | HP | ATK | DEF | 反伤间隔 |
|---|---|---|---|---|
| 懒词菌 | 30 | 5 | 0 | 1 回合 |
| 多义虫 | 50 | 8 | 2 | 1 回合 |
| 拼写巨龙 (boss) | 100 | 20 | 5 | 1 回合 |

### 3 固定技能（Q3=A）

| Skill | MP cost | 效果 | Cooldown | 解锁 |
|---|---|---|---|---|
| 🔥 火球 (Fireball) | 30 | 选中怪物 -30 HP，飘字 "-30" 火焰色 | 5 回合 | World 1 开始就有 |
| 💚 治疗 (Heal) | 40 | Hero HP +30（封顶 maxHp），飘字 "+30" 绿色 | 8 回合 | World 1 开始就有 |
| 🛡️ 护盾 (Shield) | 50 | Hero def +10 持续 5 回合（buff），飘字 "🛡️ +10" 蓝色 | 12 回合 | World 1 开始就有 |

### 法力系统

| 项 | 值 |
|---|---|
| Max MP | 100 |
| 起始 MP | 满（100）|
| Regen | +10 MP / 回合（每个回合结束 +10）|
| 战斗外 regen | 不适用（战斗外 world map 不消耗 MP）|

### 3 阶装备 RPG（Q3 配套）

| 装备 | Bronze 阶 | Silver 阶 | Gold 阶 | 解锁 |
|---|---|---|---|---|
| ⚔️ 剑 | +5 ATK | +12 ATK | +25 ATK | Bronze World 1 默认；Silver World 2 clear 后；Gold World 3 clear 后 |
| 🛡️ 盾 | +3 DEF | +8 DEF | +15 DEF | 同上 |
| 💊 药水 | +20 HP | +50 HP | +100 HP | 同上（战斗外用 1 次） |

**升级流程**：通关后回 world map → 装备店 → 买下一阶（消耗 ⭐）→ 装备生效。

### ⭐ 国库 + Economy（Q4=A 整局 reset）

| 来源 | 数量 |
|---|---|
| 答对 1 简单词（Vocab quiz hook） | +1 ⭐ |
| 答对 1 难词 | +2 ⭐ |
| Stage clear bonus | +5 ⭐ |
| World clear bonus | +15 ⭐ |
| 无伤 world bonus | +50% ⭐ |

- **国库余额**（长期持久）→ `localStorage["fighterV2Bank"]`
- **当局余额**（单局 spendable）→ 进战斗时 = 国库余额，战役结束结算回国库（V0 行为）
- **失败重生**：当局 ⭐ 全部归国库，从当前 stage 重打（不退回 world map）

### localStorage V2 Schema

```js
{
  v: 2,                                       // schema version (migrate from V0)
  bank: {
    stars: 0,                                  // 长期国库
  },
  session: {
    stars: 0,                                  // 当局 spendable
    worldIdx: 0,                               // 当前 World (0-4)
    stageIdx: 0,                               // 当前 Stage (0-2 within world)
    currentMonsterIdx: 0,                       // 当前 stage 内怪物队列
  },
  hero: {
    hp: 100, maxHp: 100,
    mp: 100, maxMp: 100,
    atk: 10, def: 0,
    shieldBuff: 0, shieldBuffRounds: 0,         // 当前护盾 buff
    skillCooldowns: { fireball: 0, heal: 0, shield: 0 },  // 剩余 cd
  },
  equipment: {
    sword: 'none',    // 'none' | 'bronze' | 'silver' | 'gold'
    shield: 'none',
    potion: 'none',
  },
  progress: {
    worldsCleared: [],   // e.g. [0, 1] = World 1-2 cleared
  },
}
```

---

## 5. UI 布局设计

### 5.1 World Map Scene

```
┌─────────────────────────────────────────────────────┐
│ ⭐ 国库: 125                                        │  ← 顶部 HUD
├─────────────────────────────────────────────────────┤
│                                                     │
│   🌲 菌绿森林 (cleared ✓)                          │
│      ↓                                             │
│   🐛 多义虫巢穴 (current)                          │
│      ↓                                             │
│   🐉 巨龙洞穴 (locked 🔒)                          │
│                                                     │
│  [点击 current node 进入 stage select]              │
└─────────────────────────────────────────────────────┘
```

> **§3.5 placeholder**: world map 实际视觉（Angry Birds path + 主题背景）feihao 即将提供参考图；P2 dispatch 时如未到位，PM 用 emoji + 路径线 fallback。

### 5.2 Stage Select / Intro Scene

```
┌─────────────────────────────────────────────────────┐
│ World 1 · 菌绿森林                                  │
├─────────────────────────────────────────────────────┤
│  Stage 1-1: 懒词菌 × 3                              │
│  [开始战斗]                                          │
└─────────────────────────────────────────────────────┘
```

### 5.3 Battle Scene (回合制)

```
┌─────────────────────────────────────────────────────┐
│  ⚔️ Hero (回合 3)        ⭐ 国库: 125                │
│  ❤️ 100/100 HP            💎 80/100 MP               │
│  🗡️ 青剑                🔥 5 cd  💚 8 cd  🛡️ 12 cd  │
├─────────────────────────────────────────────────────┤
│                                                     │
│         [Monster: 懒词菌 × 1/3]                      │
│         [Monster HP bar: 30/30]                     │
│                                                     │
├─────────────────────────────────────────────────────┤
│ ⚔️ 你的回合                                          │  ← 当前回合 banner
│ [⚔️ 攻击] [🔥 火球 30💎] [💚 治疗 40💎] [🛡️ 护盾 50💎] [💊 药水] │
└─────────────────────────────────────────────────────┘
```

每回合切换时显示 "👾 敌人回合" banner 1s，再切回 "⚔️ 你的回合"。

### 5.4 Stage Clear / World Clear Modal

```
┌─────────────────────────────────────────────────────┐
│ 🎉 Stage 1-1 通关！                                  │
│                                                     │
│ 击败懒词菌 × 3                                      │
│ +5 ⭐                                                │
│                                                     │
│ [下一关 →]                                          │
└─────────────────────────────────────────────────────┘
```

### 5.5 Defeat Modal

```
┌─────────────────────────────────────────────────────┐
│ 💀 失败了                                           │
│                                                     │
│ 你的 HP 归零了                                      │
│ 本局获得 0 ⭐（已结算回国库）                       │
│                                                     │
│ [重新开始]                                          │
└─────────────────────────────────────────────────────┘
```

### 5.6 Equipment Shop Modal (World clear 后触发)

```
┌─────────────────────────────────────────────────────┐
│ ⚔️ 装备店 (World 1 cleared)                        │
│  ⭐ 当前: 30                                        │
├─────────────────────────────────────────────────────┤
│  剑 🗡️ [青铜 +5ATK] 购买 10⭐                       │
│  盾 🛡️ [木 +3DEF]   购买 8⭐                        │
│  药水 💊 [小 +20HP]  购买 5⭐                       │
└─────────────────────────────────────────────────────┘
```

---

## 6. BGM / SFX 列表（P5 集成）

| 类型 | 文件 | 来源建议 |
|---|---|---|
| BGM 主战斗 | `public/assets/fighter/v2/audio/bgm-battle.mp3` | Royalty-free（如 freesound.org 8-bit battle loop）|
| SFX 攻击 | `sfx-attack.wav` | sword slash 短音 |
| SFX 火球 | `sfx-fireball.wav` | fire swoosh |
| SFX 治疗 | `sfx-heal.wav` | bell chime |
| SFX 护盾 | `sfx-shield.wav` | metal clang |
| SFX 怪物击 | `sfx-monster-hit.wav` | squish pop |
| SFX 胜利 | `sfx-victory.wav` | fanfare 3s |
| SFX 失败 | `sfx-defeat.wav` | sad trombone 2s |

**P5 fallback**：如果 feihao 没时间找 audio，P5 dispatch 时先用 silent + Web Audio API synthesized beep placeholder。

---

## 7. 技术栈与数据模型

### 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| HTML5 渲染 | Canvas + DOM 混合 | Hero PNG → DOM `<img>`；Monster sprite → DOM `<img>`；战斗动画用 Canvas |
| JS 框架 | **Vanilla JS**（无 Alpine / Vue / React）| V2 重写，无 V0 包袱，state machine 简单 |
| 状态管理 | 单一 `gameState` 对象 + `setState(newState)` immutable update | V0 pattern 复用 |
| 持久化 | `localStorage["fighterV2Bank"]` | 无后端，纯前端 |
| 音频 | Web Audio API | BGM loop + SFX trigger |

### 文件结构

```
public/fighter/v2/
├── fighter.html           # 主入口
├── fighter.css            # 主题色 + layout + 动画
├── fighter.js             # game loop + state machine + 渲染
├── combat.js              # 回合制战斗逻辑（pure functions）
├── world-map.js           # world map scene
├── shop.js                # 装备店 modal
├── stages.js              # 5 World × 3 stage 脚本表
├── equipment.js           # 3 阶装备定义 + 升级流
└── utils.js               # localStorage helpers + 动画 helper
```

### Tests (per cc-pm-spawn-pitfalls verify SOP)

```
tests/unit/fighter-v2/
├── combat.test.ts         # 回合制战斗数学（damage / heal / shield）
├── stage.test.ts          # 5 World × 3 stage 脚本
├── equipment.test.ts      # 3 阶装备 + 升级
└── economy.test.ts        # ⭐ 结算 + bank persistence

tests/e2e/fighter-v2/
├── battle.spec.ts         # 完整 1-1 通关
├── world-clear.spec.ts    # World 1 通关 + 装备店
└── defeat.spec.ts         # 失败重生流
```

---

## 8. 路线图（5 Phase，10-14 天，PM 自治）

按 feihao 2026-07-15 授权："开始进行后面的 phase 就不需要问我了，完成后开 tunnel 让 qual agent 以玩家身份验收"

| Phase | 天数 | Deliverable | 完成方 | 验收 |
|---|---|---|---|---|
| **P1 Spec + Asset** | Day 1 | HANDOVER-fighter-v2.md（本文档）+ 10 张核心 asset 落盘 | PM (spec) + feihao (豆包) | PM verify |
| **P2 World Map + Stage Intro** | Day 3-4 | world map scene + stage select + theme colors | CC 委派 | CC unit + PM browser_vision |
| **P3 Combat V2 + 法力 + 3 技能** | Day 5-7 | 回合制战斗 + 法力 regen + 3 技能 + damage 飘字 + 回合 banner | CC 委派 | CC unit + e2e + PM browser_vision |
| **P4 装备 RPG + 升级** | Day 8-10 | 3 阶装备 + 装备店 modal + 升级流 | CC 委派 | CC unit + e2e |
| **P5 BGM/SFX + Polish + Final Verify** | Day 11-14 | BGM loop + SFX 6 个 + 飘字动画 + Stage 1-1 端到端 verify | CC 委派 + Qual Agent | CC 全套 + Qual 玩家验收 |

> **每个 Phase 后必跑**：
> 1. CC 自验：unit test 必绿 + e2e 必绿
> 2. PM verify：browser_vision 截图 + console state 检查
> 3. 完整 regression（前 Phase 不破）

---

## 9. 完成方表（实时状态表 — 拍板时 all ⏳，启动后 ✅/⏳/❌）

| 任务 | 状态 | 完成方 |
|---|---|---|
| **P1 Spec + Asset** | | |
| HANDOVER-fighter-v2.md（本文档） | ✅ done | PM |
| 10 张核心 asset 豆包生成 + 落盘 | ⏳ todo | feihao (豆包) |
| V0 fighter.js/.html/.css 标记 deprecated | ⏳ todo | PM |
| **P2 World Map + Stage Intro** | ⏳ todo | CC |
| World map scene（5 node path） | ⏳ todo | CC |
| Stage select modal | ⏳ todo | CC |
| 主题色板 per world（CSS variables） | ⏳ todo | CC |
| World map 视觉参考图（feihao 提供） | ⏳ todo | feihao |
| **P3 Combat V2 + 法力 + 3 技能** | ⏳ todo | CC |
| 回合制 state machine | ⏳ todo | CC |
| Hero/Monster 数值 + 伤害公式 | ⏳ todo | CC |
| 法力 regen + 3 技能 + cooldown | ⏳ todo | CC |
| Damage 飘字 + 回合 banner | ⏳ todo | CC |
| Monster 反击 + 死亡流 | ⏳ todo | CC |
| **P4 装备 RPG** | ⏳ todo | CC |
| 3 阶装备数据 + 升级流 | ⏳ todo | CC |
| 装备店 modal（购买 UI）| ⏳ todo | CC |
| 装备属性 apply 到 hero | ⏳ todo | CC |
| **P5 BGM/SFX + Polish + Verify** | ⏳ todo | CC + feihao |
| BGM 1 首 + SFX 6 个 asset | ⏳ todo | feihao |
| Web Audio API 集成 | ⏳ todo | CC |
| 飘字动画 + 命中 flash | ⏳ todo | CC |
| 端到端 Stage 1-1 通关 verify | ⏳ todo | Qual Agent |
| **Final — Tunnel + Qual Verify** | ⏳ todo | PM |
| 开 cloudflared tunnel | ⏳ todo | PM |
| Dispatch Qual Agent 玩家验收 | ⏳ todo | PM |
| **V3 defer** | 🛑 deferred | |
| 每日任务 / 成就系统 | 🛑 deferred | V3 |
| World 4-5 + 20 张剩余 asset | 🛑 deferred | V3 |
| 怪物 AI / 移动路径 | 🛑 deferred | V3 |
| 多语言 / 排行榜 / 后端同步 | 🛑 deferred | V3 |

---

## 10. V3 Backlog（deferred 列表）

- **每日任务**：每日登录 / 完成 1 关 / 收集 50⭐ 等
- **成就系统**：第一次胜利 / 不死通关 / 装备全 gold / 击杀 100
- **World 4-5**：法师高塔 + 终极城堡
- **20 张 V3 asset**：boss 变体 + 主题 bg + silver/gold tier + skill VFX + UI 装饰
- **怪物 AI / 移动**：boss 蓄力技、monster 移动路径
- **多语言 i18n**
- **排行榜 / 后端同步**（cloudflare D1 + Hono API）
- **复杂粒子特效**（当前 P5 简单 flash + 飘字）

---

## 11. 接手 Checklist（新 session 5 min 开场）

```bash
# Step 1: 进项目 + 验证清洁
cd /Users/tidusmaomao/workspace/kiddo-scoreboard
git status && git branch --show-current
# 期望：clean + 在 feat/fighter-v2-rpg 分支

# Step 2: 读本文件 + 当前 Feishu chat + skill pointers
# skill pointers:
#   feihao-pm-autonomy     (§2 main 不直 commit, §3a 1-2 word 拍板, pitfall-19 autonomous mode)
#   free-claude-code-cli-args  (CC dispatch SOP)
#   cc-pm-spawn-pitfalls   (per-stage verify + visual regression mandatory)
#   feihao-visual-feedback (美术 style 拍板规则)
#   foreign-project-preview-tunnel  (§asset-crop-mac.md — sips 裁水印 SOP)

# Step 3: 看当前阶段状态
# 读 §9 完成方表 — 看哪 Phase 在跑

# Step 4: 接 Phase 任务
# 按 §8 路线图 + §9 完成方表 — dispatch CC 或 feihao 跑豆包
# 完成后跑 Pn verify (per cc-pm-spawn-pitfalls 8+2 步)

# Step 5: Final — 启动 tunnel + Qual Agent 验收
```

---

## 12. Reference

- **本会话回查**：`session_search(query="fighter v2 rpg kiddo 2026-07-15")` — 找 feihao 拍板对话 + Dragon's Keep Quest 参考图
- **V0 spec**：本仓库 `HANDOVER-tower-defense-2026-07-14.md` — V0 spec 风格模板（本文档 9 sections 模仿）
- **V0 代码**：本仓库 `public/fighter/*` — V0 弃用代码，可作 V2 视觉 baseline（已 commit `8b5824a` polish）
- **Skill pointers**：
  - `feihao-pm-autonomy` — feihao 拍板规则 + PM 自治模式（pitfall-19）
  - `free-claude-code-cli-args` — CC dispatch SOP + 401/hang 解药
  - `cc-pm-spawn-pitfalls` — per-stage verify + visual regression mandatory
  - `feihao-visual-feedback` — 美术 style 拍板规则
  - `foreign-project-preview-tunnel` — `references/asset-crop-mac.md` — sips 裁水印 SOP
  - `apikey-image-gen` — Hermes image gen API（V2 launch fallback 仅当豆包失败）
- **外部参考**：Dragon's Keep Quest（feihao 提供截图）— 回合制 + HP/MP bar + ATTACK/SKILL/ITEM 三按钮

---

End of handover. 2026-07-15, PM-for-claude session.
# Fighter V2 Sprite Asset Catalog

> **目的**：让 PM / CC 不用 vision_analyze 每张图,直接 grep 本文件就知道每个 sprite 是什么、什么风格、什么用途、怎么用。
>
> **生成时间**: 2026-07-16T07:35:00Z
> **Backend**: `pollinations.ai image API (model=flux, nologo=true)` — feihao 原 prompt 是豆包格式, 豆包 API 未接, 改用 pollinations-flux 兜底。prompt 已翻译成英文。
> **Style**: pixel art / NES-SNES palette / chibi / white bg / **256x256 单帧**
> **Count**: 10 sprites 全部 verified OK
> **Verify**: OCR clean + watermark removed + bg pure white + unique_colors > 10000
>
> ⚠️ **重要**:
> 1. **CC 不要 Read PNG 文件** (Tip 16 context overflow, base64 会爆 context)
> 2. **onerror fallback pattern** 必用: `<img src="/fighter/v2/xxx.png" onerror="this.outerHTML='<span>...</span>'" />` (per `shop-modal.js:132`)
> 3. **Naming 错位** (pollinations-flux 没 100% 按 prompt 生成, 实际 PNG 跟文件名不一致, 见下面 note)
> 4. ⚠️ **这些 PNG 不是 sprite sheet** (2026-11-20 cron 实测更正) — 每个 1788×1968 文件是**一整张单独 sprite 画在大白底上**, 没有帧网格、没有可裁的帧。详见下方「🖼️ 真实画布布局」一节。**不要再 crop frame (0,0)**

---

## 📦 文件清单 (10 张 sprite + 2 个 metadata)

| 文件 | 实际类型 | 画布 layout | bytes | 命名错位 |
|---|---|---|---|---|
| `hero-idle.png` | single sprite on white canvas | 1788×1968 单图, 内容 bbox 77%×91% | 1652795 | ✅ 实际是 hero idle |
| `hero-attack.png` | single sprite on white canvas | 1788×1968 单图, 内容 bbox 87%×83% | 1340364 | ⚠️ **实际是一把独立的剑** (金黄剑身 + 棕色剑柄), 不是 hero |
| `hero-hurt.png` | single image (JPEG 字节, .png 后缀) | 256×256 | 9035 | ✅ 实际是 hero hurt |
| `hero-victory.png` | single image (JPEG 字节, .png 后缀) | 256×256 | 10180 | ✅ 实际是 hero victory |
| `monster-fungus.png` | single sprite on white canvas | 1788×1968 单图, 内容 bbox 85%×90% | 1684339 | ⚠️ **实际是金发少年 hero 举剑**, 不是蘑菇 |
| `monster-worm.png` | single sprite on white canvas | 1788×1968 单图, 内容 bbox 90%×86% | 1465813 | ✅ 实际是 orange worm |
| `monster-dragon.png` | single sprite on white canvas | 1788×1968 单图, 内容 bbox 88%×89% | 1696187 | ⚠️ **实际是金发少年 hero 举剑** (蓝披风, 不是 dragon) |
| `equip-sword-bronze.png` | single sprite on white canvas | 1788×1968 单图, 内容 bbox 72%×82% | 1268354 | ⚠️ **实际是 red potion** (不是 sword) |
| `equip-shield-wood.png` | single sprite on white canvas | 1788×1968 单图, 内容 bbox 90%×88% | 1820090 | ✅ **实际是 round wooden shield** (唯一名字对得上的 equip 素材) |
| `equip-potion-small.png` | single sprite on white canvas | 1788×1968 单图, 内容 bbox 92%×95% | 1790678 | ⚠️ **实际是 chibi hero 举剑** (不是 potion) |

> **Naming 错位 (pollinations-flux 跑错)**:
> - `monster-dragon.png` prompt 是 "large red dragon with alphabet letter scales" 但生成出来是金发少年 hero (跟 hero-idle 几乎一样)
> - `equip-sword-bronze.png` prompt 是 sword 但生成出来是 red potion
> - `equip-potion-small.png` prompt 是 potion 但生成出来是 chibi hero 举剑
> - **结论**: 不要凭文件名相信内容, 用 manifest prompt_role 字段
>
> ⚠️ **本节内容描述于 2026-11-21 cron 独立 vision 复核后更正** (2026-11-20 那版把
> `equip-shield-wood.png` 和 `equip-potion-small.png` 的内容写反了)。**layout 不变**
> (仍是单图不是帧表), **只改「画的是什么」**。复核证据 3 重独立来源互相印证:
> ① 本轮 cron 对 8 张素材做的 montage vision 实测;
> ② 2026-10-29 commit `ee6ae5d` 的 `public/fighter/v2/shop-modal.js:132-139` 注释
>    (当时逐张 vision 验证过, 内容与本轮结论完全一致);
> ③ `docs/FIGHTER-V2-STATUS.md:293` 的 2026-07-20 iPad 实测记录
>    ("实测 Hero 显示剑、懒词菌显示骑士")。

---

## 🎨 Sprite 详细描述 (manifest prompts + 实际 vision_analyze 2026-07-17)

### Hero (4 张)
- **`hero-idle.png`** — Kid RPG hero standing idle pose, blue cape, brave smile, sword at side
  - 实际视觉: **金发少年战士**, 蓝衣 + 棕带 + 金扣 + **蓝披风** + 持剑, 16/32-bit RPG 像素艺术 (像 Octopath Traveler / Zelda 风格)
  - 用途: main menu 骑士 / 战斗 hero 待机帧
  - 1788×1968 单图画布 (非 sprite sheet), 内容 bbox 77%×91%

- **`hero-attack.png`** — Hero mid-attack slash, raised sword, dynamic action pose
  - ⚠️ **实际视觉是一把独立的剑** (金黄剑身 + 棕色剑柄), **不是举剑的少年**
  - ⚠️ **这正是 2026-07-20 iPad 实测 "Hero 显示剑" 的根因** ——
    `battle-scene.js` 的 `KNIGHT_IMG` 指向 `/assets/fighter/v2/hero-attack.png`,
    所以战斗里 hero 槽位显示的是一把剑 (P0, 见 FIGHTER-V2-STATUS.md §D)
  - 用途: **不可用作 hero 待机/攻击帧**; 修法 = `KNIGHT_IMG` 改指 `hero-idle.png`
  - 1788×1968 单图画布 (非 sprite sheet)

- **`hero-hurt.png`** — Hero taking damage, surprised expression, slight lean back
  - 实际格式: **JPEG (256×256)** (其他 hero 都是 PNG)
  - 用途: 战斗 hero 受击帧
  - bytes 9035 (远小于 PNG, JPEG 压缩)

- **`hero-victory.png`** — Hero victory pose, raised sword, cheering expression
  - 实际视觉: **棕发少年战士**, 紫色裤 + 胜利举剑+拳 + 16-bit RPG
  - 用途: main menu 骑士备选 / 战斗胜利帧
  - 实际格式: **JPEG (256×256)**

### Monster (3 张)
- **`monster-fungus.png`** — Lazy vocabulary fungus, small green mushroom, sleepy droopy eyes, yawning
  - ⚠️ **实际视觉是金发少年 hero 举剑** (不是绿色蘑菇) —— 2026-07-20 iPad 实测记录
    ("实测 Hero 显示剑、懒词菌显示骑士") 与 2026-11-21 vision 复核互相印证
  - 用途: **不可直接当懒词菌用**; 当前 `battle-scene.js` 的 `MONSTER_FUNGUS_IMG`
    指向它 → Stage 1-2 战斗里显示的是骑士而不是蘑菇 (P0, 见 FIGHTER-V2-STATUS.md §D)
  - 1788×1968 单图画布 (非 sprite sheet)

- **`monster-worm.png`** — Polysemy worm, orange worm, floating meaning-symbol bubbles, confused look
  - ✅ 实际视觉: **橙色虫子** (头顶带问号气泡) —— 名字对得上
  - 用途: 战斗 monster 多义虫 (Stage 3-4)
  - 1788×1968 单图画布 (非 sprite sheet)

- **`monster-dragon.png`** — Spelling dragon boss, large red dragon with alphabet letter scales (A B C), fierce but cute
  - ⚠️ **naming 错位** — 实际视觉是**金发少年 hero 举剑** (蓝披风, 白衬衫), 不是 dragon
  - 用途: 如果要用 dragon, 不可用此图; 实际是 hero 重复 sprite
  - 1788×1968 单图画布 (非 sprite sheet)

### Equip (3 张, 都是 tier icons)
- **`equip-sword-bronze.png`** — Bronze tier sword icon, simple brown blade with copper guard
  - ⚠️ **naming 错位** — 实际视觉是**红色药水** (红瓶 + 白标签 + 红心 + 木塞), 不是 sword
  - 用途: **如果 equip icon 需要 potion 视觉用此图**; 不要用做 sword icon
  - 1788×1968 单图画布 (非 sprite sheet)

- **`equip-shield-wood.png`** — Wood tier shield icon, round wood shield with iron boss center
  - ✅ **实际视觉是圆形木盾** (木板 + 铁箍 + 中央铁钉) —— **3 张 equip 素材里唯一名字对得上的**
  - 用途: 可用作 shield icon 视觉
  - 1788×1968 单图画布 (非 sprite sheet)

- **`equip-potion-small.png`** — Small red health potion icon, tiny flask with heart symbol
  - ⚠️ **naming 错位** — 实际视觉是**举剑欢呼的 chibi 少年**, 不是 potion
  - 用途: **不可用作 potion icon**; `shop-modal.js` 因此改用 V1 的
    `/assets/fighter/equip-potion.png` (见 `shop-modal.js:152-154`)
  - 1788×1968 单图画布 (非 sprite sheet)

---

## 🖼️ 真实画布布局 (1788×1968 = 单图, 不是 7×6 帧网格)

> ⚠️ **本节于 2026-11-20 由 cron 实测重写**。旧版本这里写的是
> 「7×6 网格 / 每帧 256×328 / 第一帧 = crop(0, 0, 256, 328)」—— **那是错的**。
> 真相: 每个文件是**一整张 sprite 画在大白底上**, 没有帧网格。

**实测方法** (3 种独立方法互相印证):
1. **像素分析**: 计算非白像素的 content bbox + 7×6 网格占用率
2. **Vision 复核**: 直接看 `hero-idle.png` — 画面上是**一个**完整角色 (金发少年 + 蓝衣 + 红披风 + 持剑), 周围是空白, 没有任何重复帧
3. **变异测试**: 造一张**真** 7×6 帧表 (把 hero-idle 缩放平铺 42 格) 喂给同一个判定 → 被正确**拒绝**

**实测数据** (内容 bbox = 非白像素的外接矩形):

| 文件 | 内容 bbox 宽% | 内容 bbox 高% | 左上 256×328 格非白占比 |
|---|---:|---:|---:|
| `hero-idle.png` | 77.0% | 90.8% | 0.0% (整格空白) |
| `hero-attack.png` | 87.2% | 83.0% | 0.0% (整格空白) |
| `monster-fungus.png` | 84.7% | 89.6% | 0.0% (整格空白) |
| `monster-worm.png` | 90.3% | 85.5% | 0.0% (整格空白) |
| `monster-dragon.png` | 88.4% | 89.0% | 0.0% (整格空白) |
| `equip-sword-bronze.png` | 71.9% | 81.5% | 0.0% (整格空白) |
| `equip-shield-wood.png` | 89.8% | 88.3% | 0.0% (整格空白) |
| `equip-potion-small.png` | 92.4% | 94.5% | 24.4% (**内容溢出格边界** = 同一张大主体的局部, 不是独立帧) |

**判定不变式** (已被 `tests/unit/fighter-v2/asset-sheet-guard.test.ts` 固化):
> 对每个 asset: 左上 256×328 格**要么整格空白**, **要么**其中的内容**触及该格右/下边界**
> (说明它是大主体被切出来的一片, 不是自成一格的帧) —— 且整体 content bbox ≥ 55% 画布宽高。

**为什么不能 crop**:
- 真帧表: crop(0,0,256,328) 得到一个**完整角色**, 周围留白一致, 相邻格是同角色的不同动作
- 实际文件: crop(0,0,256,328) 得到**大片空白** (7/8 资产) 或 **主体的一块碎片** (equip-potion-small)

**正确的做法 — 用 PIL 按 content bbox 自动裁**:
```python
from PIL import Image
import numpy as np

def crop_to_content(src, dst, pad=4):
    im = Image.open(src).convert("RGBA")
    arr = np.array(im)
    white = (arr[:, :, 0] > 235) & (arr[:, :, 1] > 235) & (arr[:, :, 2] > 235)
    ys, xs = np.where(~white)
    x0, x1 = max(0, xs.min() - pad), min(arr.shape[1], xs.max() + pad)
    y0, y1 = max(0, ys.min() - pad), min(arr.shape[0], ys.max() + pad)
    im.crop((x0, y0, x1, y1)).save(dst, "PNG", optimize=True)
```
→ 自动得到**贴紧主体**的透明底 sprite, 跟 `public/fighter/v2/knight.png` (256×256, 已贴紧) 的做法一致。

⚠️ **不要用 `sips -c`** — sips 行为不稳 (会截中间空白区域), 用 Python PIL 精确裁 content bbox。

## ✅ Asset-Swap Wiring Pattern (per `shop-modal.js:132`)

```html
<img
  class="dk-knight"
  src="/fighter/v2/hero-idle.png"
  alt="骑士"
  onerror="this.outerHTML='<div class=&quot;dk-knight-fallback&quot;>🦸</div>'"
  style="image-rendering: pixelated; width: 80px; height: auto;"
/>
```

**关键**:
1. **`image-rendering: pixelated`** 让像素艺术 crisp 不模糊
2. **`onerror` fallback** 到 emoji div — PNG 加载失败 (404/network) 时不破图
3. **`width: 80px; height: auto`** 保持 aspect ratio (256:328 ≈ 0.78)
4. **绝对路径** `/fighter/v2/hero-idle.png` (不要 `hero-idle.png` 相对, 之前有 wrangler path bug)

**CSS 必须加**:
```css
.dk-knight, .dk-dragon {
  image-rendering: pixelated;  /* 保持像素艺术 crisp */
  image-rendering: crisp-edges; /* Safari fallback */
}
```

---

## 🛡️ 实战 Pitfalls (Stage 1-1.5 经验)

| Pitfall | 修复 | 来源 |
|---|---|---|
| CC `Read` PNG → base64 → context overflow → "Invalid request" | **不要 Read PNG**, 写 metadata catalog (本文件) 代替 | cc-pm-spawn-pitfalls Tip 16 |
| CC 写 SVG inline 自画简陋 | 让 CC grep 本 catalog, 直接 `<img src="/fighter/v2/hero-idle.png">` | Stage 1 CC fail |
| Wrangler `href="fighter.css"` 相对路径解析成 `/fighter/v2/fighter/fighter.css` → fallback JAGER | 改绝对路径 `href="/fighter/v2/fighter.css"` | Stage 1 fix |
| `.dk-main-menu { display: flex }` override `.fighter-view { display: none }` → main menu 永远 visible | **不要在 .dk-main-menu 写 display**, 继承 `.fighter-view.active` | Stage 1.5 side-effect |
| `position: absolute; inset: 0` + `min-height: 100%` 在 Safari WebKit 让 % height 不 propagate | 改 `position: relative + flex: 1` | Stage 1.5 root cause |
| `sips -c 328 298` 截到空白/碎片 | 用 Python PIL 按 **content bbox** 裁 (见「真实画布布局」一节) | 2026-11-20 cron 实测更正 |

---

## 📝 Use Cases (已知用法)

| 用途 | 用哪个 sprite | 备注 |
|---|---|---|
| Main menu 骑士 | `hero-idle.png` 按 content bbox 裁 | PIL 裁主体, 不要裁固定坐标 |
| Main menu 红龙 | ✅ **已有真龙**: `public/fighter/v2/dragon.png` (951×963, 红色字母龙, 已 git-tracked) | 不在 `public/assets/fighter/v2/` 里, 别去 assets 目录找 |
| Main menu 城堡 BG | ✅ **已有**: `public/fighter/v2/castle.png` (400×200, 已 git-tracked) | 同上 |
| Main menu 草地 FG | ✅ **已有**: `public/fighter/v2/grass.png` (400×60, 已 git-tracked) | 同上 |
| 战斗 hero 待机 | `hero-idle.png` | 单图 1788×1968, 按 content bbox 裁 |
| 战斗 hero 攻击 | ⚠️ `hero-attack.png` **实际是一把剑** (不是举剑的少年) | 跟 knight.png 是不同文件, 需视觉复核后再用 |
| 战斗 hero 受击 | `hero-hurt.png` (256×256 JPEG) | 注意 JPEG 格式 |
| 战斗 hero 胜利 | `hero-victory.png` (256×256 JPEG) | 棕发少年举剑 ✅ |
| 战斗 monster 懒词菌 | ⚠️ `monster-fungus.png` **实际是金发少年 hero**, 不是蘑菇 | P0 — 当前战斗 Stage 1-2 会显示骑士 |
| 战斗 monster 多义虫 | ✅ `monster-worm.png` (橙色虫子) | 单图, 按 content bbox 裁 |
| 战斗 boss 拼写巨龙 | ⚠️ `monster-dragon.png` 实际是 hero, 不可用 | 用 `public/fighter/v2/dragon.png` 替代 |
| Shop 铜剑 icon | ❌ `equip-sword-bronze.png` 实际是 potion, 不可用 | shop 已改用 V1 `/assets/fighter/equip-sword.png` |
| Shop 木盾 icon | ⚠️ `equip-shield-wood.png` **实际是圆形木盾** (名字对得上) | 可用; shop 目前统一走 V1 图标 |
| Shop 小药水 icon | ❌ `equip-potion-small.png` 实际是 chibi hero, 不可用 | shop 已改用 V1 `/assets/fighter/equip-potion.png` |

---

## 🚧 待办 (后续 stage 需补的 sprite)

1. **真 dragon sprite (在 assets 目录)** — `monster-dragon.png` 位置放的是 hero, 若要保留
   "拼写巨龙" boss 需要重新生成。⚠️ 但 main menu 的红龙**已经有**:
   `public/fighter/v2/dragon.png` (951×963, 红色字母龙, 已 git-tracked) —— 别重复生成
2. **真 sword icon (在 assets 目录)** — `equip-sword-bronze.png` 实际是 potion。
   ⚠️ 但 shop 已改用 V1 `/assets/fighter/equip-sword.png` (名字对得上, 已 tracked) —— 别重复生成
3. **真 potion icon (在 assets 目录)** — `equip-potion-small.png` 实际是 chibi hero。
   ⚠️ 但 shop 已改用 V1 `/assets/fighter/equip-potion.png` (已 tracked) —— 别重复生成
4. **真 mushroom sprite** — `monster-fungus.png` 实际是金发少年 hero, 而 battle-scene.js
   的 `MONSTER_FUNGUS_IMG` 正指向它 → Stage 1-2 战斗显示骑士 (P0)。需要重新生成蘑菇素材
5. **HP/MP bar fill** — 可拉伸 200×16 红/蓝填充 (战斗 UI 用)
6. **Button icon** — 32×32 sword/fire/potion (战斗 ATTACK/SKILL/ITEM 用); 注意
   `battle-scene.js` 的 `ATTACK_ICON_IMG` / `ITEM_ICON_IMG` 目前都指向
   `equip-potion-small.png` (实际是 chibi hero) → ATTACK/ITEM 按钮图标也是错的

> ✅ **Castle / Grass 已有, 不用再生成**: `public/fighter/v2/castle.png` (400×200) +
> `public/fighter/v2/grass.png` (400×60), 2026-11-15 commit `3d56720` 已 commit 进 git
> (之前是"只在某台机器上、CI fresh checkout 全部 404")。

---

## 🔗 关联文件

- `asset-mapping.json` — backup PNG name → official spec name mapping (per Tip 16 fallback)
- `_manifest.json` — 生成时 pollutions-flux 的 metadata + prompts (ground truth, 跟实际 PNG 内容有偏差)
- `backup/` + `backup-cropped/` — 原始 backup 目录 (per Tip 16, 防止 source PNG 丢失)
- `shop-modal.js:132` — 已用 onerror fallback 模式的 reference impl

---

**最后更新**: 2026-11-21 by cron (实测更正 2 轮 — ① 2026-11-20: 这些 PNG 是单图不是帧表,
旧版「7×6 网格 / 每帧 256×328」的说法已删除; ② 2026-11-21: 「画的是什么」一节经独立
vision 复核更正 3 处 — `equip-shield-wood.png` 实际是木盾、`equip-potion-small.png` 实际是
chibi hero、`hero-attack.png` 实际是一把剑、`monster-fungus.png` 实际是金发少年)

**历史**: 2026-07-17 by PM (feihao 反馈 "你每一次图片都要重新识别", 决定写 catalog 防止重复)

# kiddo-scoreboard 成就系统 Spec v1.1 (Zelda 神殿风定稿)

状态: 视觉已定稿 (D1 ✓), 已派单
日期: 2026-10-28 初稿 / 2026-11-09 D1 定稿 (feihao 拍板 A1: 以 Zelda 神殿风为设计模板)
派单: worktree `kiddo-scoreboard-achievements` @ branch `feature/achievements-v1` (base origin/main 4d61739)

## 0. 视觉定稿 (D1 → feihao 2026-11-09 A1)

**设计模板 = `docs/design/zelda-achievement-wall-reference.html`** (feihao 从 Downloads 认可的 Zelda TotK 神殿风成就墙, 46KB 单文件)。
**奖牌本体 = `docs/design/medal-template-v3.html`** (金属雕刻 v3, feihao 2026-10-28 过审, 5 档色表)。
两者合体: Zelda 墙提供 **页面框架/卡片/氛围**, medal v3 提供 **奖牌本体质感**。

### 0.1 必须复刻的 Zelda 墙设计基因 (逐条对照参考文件)

| # | 基因 | 参考实现 (reference.html) | 本项目落地 |
|---|---|---|---|
| G1 | 暗色神殿底色 | body bg `#0b0e14` + 双 radial-gradient (金色顶部光晕 + 蓝色左下微光) + 32px 砖纹 SVG overlay (opacity .45) | 同款背景, 直接搬 |
| G2 | 金色主题色系 | `zelda.gold #f3c959 / lightGold #fff2b8 / darkGold #a8791c / bronze #694715` + 辅助 sheikah 蓝 `#00e5ff` 点缀 | 保留金色系 (与 medal v3 金属色板同族), sheikah 蓝降级为低频点缀 (进度条高光/粒子) |
| G3 | 字体三件套 | Cinzel (标题衬线) + MedievalSharp (副题) + Noto Sans SC (中文正文) | 同款; Google Fonts CDN 引入 |
| G3a | 页面标题栏 | Triforce SVG 徽标 + 大标题 + 副题小字 + 右侧总进度条卡 (trophy icon + 进度 %) | 标题改为「成就神殿」, 徽标换成奖杯/星币主题 SVG; 总进度条保留同款样式 |
| G4 | 已解锁卡片 | 3px 金边 `#f3c959` + 三层 box-shadow (投影+金色外发光 20px+内发光 18px) + hover 加亮 (边框 `#fff4c2`, 外发光 35px) | 同款, 用于「已获得」奖牌卡 |
| G5 | 锁定卡片 | 灰石边 `#2d3748` + `grayscale(85%) opacity(.8)` + 内阴影; hover 部分恢复 `grayscale(25%)` | 同款, 用于「未获得」奖牌卡 (灰石神秘感 = 想解锁的冲动) |
| G6 | 卡片四角装饰 | corner-tl/tr/bl/br 绝对定位 10px L 形金角 (解锁) / 石灰色 (锁定) | 同款 |
| G7 | 粒子背景层 | canvas 40 粒子金/蓝上浮, requestAnimationFrame | 同款 (低 CPU, 手机可跑) |
| G8 | 8-bit 音效 | Web Audio 合成: unlock=E5→G#5→B5→E6 方波琶音, lock=锯齿降频, click=短方波; 右上音效开关 | 同款合成器; unlock 音效在奖牌揭晓时播 |
| G9 | 筛选 tab + 搜索框 | 全部/已解锁/未解锁 三 tab (选中态金色渐变) + 带放大镜搜索框 | 同款; tab 扩为 全部/学习/生活/技能/已解锁/未解锁 (组维度来自 §1) |
| G10 | 详情弹窗 | 圆形发光头像位 + 分类徽章 + 双语标题 + sheikah 分割线 + 描述卡 + 状态区 + 脚注 | 同款结构; 头像位放 medal v3 奖牌 SVG; 脚注改 GROUP / AWARD ID |
| G11 | 进度条 | 金色三段渐变 + 内嵌白色 pulse-glow 动画层 | 同款 |
| G12 | 角色像素画 | 内嵌像素 SVG (克洛格/卢比兔等) | **不搬** — 奖牌位用 medal v3 生成器按 (奖项, 档位) 实时渲染 |
| G12a | 稀有度徽章 | Common/Uncommon/Rare/Legendary 四档 | 改为铁/铜/银/金/王者五档 (§1 牌级), 徽章色随档位 |

### 0.2 奖牌本体 (medal v3 金属雕刻, 已过审)

- 生成函数 `medalSVG({tier, name})`: 512×512 SVG, 同一 `<text>` 画两遍 (底层亮色 translateY(2.5) + 上层深槽色) = 刻槽感
- 5 档色表: 铁=枪银灰 / 铜=古铜 / 银=亮银 / 金=金 / 王者=暗金+虹彩点缀
- 哑光古金 3-stop 渐变 + `feTurbulence` 颗粒 6%, 象牙面凹进环, 偏移第二圆盘投影, bail 挂环
- 模板在 `docs/design/medal-template-v3.html` — **移植时保留全部质感参数**, 只调字号自适应
- 卡片尺寸下奖牌缩到 ~140px 圆位, 弹窗 160px 圆位

### 0.3 氛围文案 (神殿语气)

- 页面标题: 「成就神殿」+ 副题「ACHIEVEMENT SANCTUARY · 专心致志, 收藏每一枚荣誉」
- 空状态: 「神殿尚未发现符合条件的记录」
- 弹窗解锁态: 「已获得 (Unlocked)」; 锁定态: 「未解锁 — 继续努力, 小骑士!」

## 1. 体系结构

三组 × 五级牌 × 赛季制:

- **组**: 学习组 / 生活组 / 技能组
- **牌级** (每级不同金属质感): 铁 → 铜 → 银 → 金 → 王者
- **赛季**: seasons 表。S1 = 四年级上学期 (至学期末)。赛季结束: 成就墙归档到「上赛季」视图, 计数清零, 新赛季重新攒 (H2)
- **展示**: 独立成就页 `public/achievements.html` (C2, 参照 shop.html 先例), 含当前赛季墙 + 上赛季归档 tab

## 2. 奖项清单

| 组 | 奖项 | 发放 | 等级规则 |
|---|---|---|---|
| 学习 | 语文默写全对 | admin 直发对应牌 (G2) | 次数档 E1: 1铁/3铜/5银/8金/10王者 |
| 学习 | 英语默写全对 | 同上 | 同上 |
| 学习 | 测评得优 | 同上 | 同上 |
| 生活 | 自律生活 | **自动**: 连续全卡 N 天 | 天数档 (默认 2/4/8/15/30 = 铁铜银金王者, 可调) |
| 生活 | 创新家务奖 | admin 发, 单发无等级, 可多次 | 每次平发 |
| 技能 | 读完一本长篇中文小说 | admin 直发对应牌 (G2+F1) | 本数档 E1: 1铁/3铜/5银/8金/10王者 |
| 技能 | 完成一首新曲子演奏 | 同上 | 首数档同上 |
| 技能 | 通关一个新游戏 | 同上 | 个数档同上 |

注: G2 = admin 自己判断到档后直接发对应等级牌, 系统不做学习/技能组计数器。
次数档 (1/3/5/8/10) 作为 admin 端提示文案展示 ("铜牌 = 累计 3 次"), 不强制。

## 3. 系统日志 + 撤销 (feihao 明确要求)

- 每次发放/撤销 → `audit_log` (复用 logAudit 惯例, action: `achievement_grant` / `achievement_revoke`)
- 撤销: `POST /api/admin/achievement-awards/revoke`, body `{award_id, confirm:true}` (destructive 必带 confirm 门, R9)
- 撤销 = 状态翻转 (active→revoked) + **对称烧掉该次铸造的代币** (见 §5) + audit。恢复(restore)本批不做, 撤销后可重发。

## 3a. Zelda 墙功能映射说明 (与参考文件的差异清单)

参考文件是**独立 demo** (localStorage 切换解锁态, reset 按钮)。本项目是**生产系统**, 差异:

| 参考文件功能 | 本项目落地 |
|---|---|
| 点击卡片 → 弹窗 → 「切换状态」按钮手动解锁/锁定 | **不搬** — 解锁态由 `GET /api/public/achievements?user_id=` 服务端数据驱动, 无手动切换 |
| header「重置成就」按钮 | **不搬** — 生产系统无重置; 赛季切换由 seasons 机制管理 |
| localStorage 存档 | **不搬** — 数据来自 D1 (achievement_awards 表), 页面只读 (音效偏好除外) |
| 音效开关 | 保留 (默认开, localStorage 记忆偏好) |
| 搜索/筛选/粒子/弹窗 | 保留 (纯前端, 数据不变) |
| 12 个动物成就 + rarity | 换成本项目 8 奖项 × 5 档 + 组维度 (§2) |

## 4. 徽章生成

- 参数化 SVG 生成器: (奖项名, 描述, 牌级) → 512×512 固定尺寸, 无图片存储
- **样式: medal v3 金属雕刻 (§0.2), Zelda 墙只提供页面框架** — 定稿 ✓
- 牌级 → 金属色板: 铁=枪银灰 / 铜=古铜 / 银=亮银 / 金=金 / 王者=金+虹彩点缀
- 例: 「语文默写全对奖」· 描述「获得一次语文默写全对」

### 4a. 徽章生成器移植细节 (medal-template-v3.html → public/medals.js)

- 模板里的 `medalSVG({tier, name})` 是 IIFE 内嵌在 HTML 里的; 移植时提取为独立模块 `public/medals.js` (ESM), export `medalSVG` + `TIER_COLORS`
- 保留: 3-stop 渐变 / feTurbulence 颗粒 / 双层 text 刻槽 / 象牙面凹进环 / 偏移圆盘投影 / bail 挂环 / 字号自适应
- UI 尺寸: 卡片圆位 ~140px, 弹窗 ~160px (SVG viewBox 512, 自适应缩放)
- **输出为 string** (innerHTML 注入), 与 Zelda 墙 SVGS 字典注入方式一致

### 4b. 移植自检 (PM 验收用, 对齐 R18 参数化验证法)

1. **DOM 断言**: 每档渲染后容器内 svg 元素数 = 1, text 元素 ≥ 2 (刻槽双层), 无零尺寸 (getBoundingClientRect w/h > 0)
2. **五档区分度**: 沿每枚奖牌中轴纵向扫描 PIL dominant 色 — 铁灰/古铜/亮银/金/暗金五组色明显不同 (R18 方法, 不用单点采样)
3. **无外部图片请求**: 渲染后 `performance.getEntriesByType('resource')` 过滤图片后缀 = 0 条 (纯 SVG)
4. 8 奖项 × 5 档 = 40 枚全渲染无 console.error
5. 手机 375px 视口下卡片 1 列 / 平板 2 列 / 桌面 4 列 (媒体查询生效)

## 5. 宠物代币钩子 (feihao 2026-10-28 新增, "后续宠物系统里用")

- **每次获得成就 → 铸造新代币**。宠物系统 (未来) 消费它
- 设计: 复用 `score_events` 账本, AccountType 加 `'pet_tokens'` (与 coins 同构); 余额走现有 balance 推导
- 铸造规则 (默认值, feihao 可否决): 铁牌+1 / 铜牌+2 / 银牌+3 / 金牌+5 / 王者+8 / 单发奖(创新家务)+1
- 幂等: `source_ref = 'achievement:award:<award_id>'` (R9/R10 惯例)
- 撤销对称: revoke 时写 `-N` 烧回, 双闸门 (只对 active 且未烧过的写)
- 展示: 成就页顶部显示代币余额 (命名默认「🌟 星币」, 宠物主题定后可改)
- **消费端 (宠物系统) 本批不做** — 只保证铸造侧从 day-1 落账, 历史可追溯

## 6. DB (migration 0021)

```sql
seasons(id, name, starts_on, ends_on, is_current)
achievements(id, grp, name, description, grant_mode, ladder_json, is_active, sort_order)
  -- grant_mode: 'admin_tier' | 'admin_flat' | 'auto_streak'
  -- ladder_json: {"iron":1,"bronze":3,"silver":5,"gold":8,"king":10} 等
achievement_awards(id, achievement_id, user_id, tier, season_id,
  status('active'/'revoked'), granted_by, granted_at, revoked_at, revoked_by)
```

## 7. API

- admin: `POST /api/admin/achievement-awards` (grant: achievement_id+tier+user_id)
- admin: `POST /api/admin/achievement-awards/revoke` (confirm 门)
- admin: `GET /api/admin/achievement-awards?status=all` (发放日志, 默认全部, 对齐 R8 教训)
- admin: `POST /api/admin/seasons` (创建新赛季: name, starts_on, ends_on; is_current 翻转原赛季) — API-only
- public: `GET /api/public/achievements?user_id=` (成就墙数据: 奖项全集 + 已获 + 赛季信息)

### 7a. public achievements 响应结构 (CC 实现基准)

```jsonc
// GET /api/public/achievements?user_id=2
{
  "season": { "id": 1, "name": "S1 · 四年级上学期", "starts_on": "2026-09-01", "ends_on": null },
  "achievements": [
    {
      "id": 1, "grp": "study", "name": "语文默写全对", "description": "获得一次语文默写全对",
      "grant_mode": "admin_tier",
      "ladder": { "iron": 1, "bronze": 3, "silver": 5, "gold": 8, "king": 10 },
      "award": null
    }
  ],
  "pet_tokens": 0
}
// award 非空时形如: { "tier": "bronze", "granted_at": "2026-11-09T12:00:00Z", "count": 3 }
// award = null 表示该奖项本赛季未解锁
```

### 7b. 字段语义细节

- `ladder` 从 ladder_json **服务端 parse 成对象再返回** (R11 教训: JSON TEXT 必须服务端 parse)
- `award.tier`: 该赛季该奖项**已获最高档**; 同档可重发 (G2 直发模式), `count` = 同档累计发放次数
- admin grant 端点允许同档重发; streak 自动引擎必须幂等 (见 §8)
- 归档 tab (非当前赛季): award 计算口径相同, season_id 换成对应赛季

## 8. 自动规则引擎 (自律生活)

- 挂钩 `me/tasks.ts /complete` §4.5 bonus 检查同构位置, best-effort 不回滚主流程
- 连续全卡天数 = 从 task_completions 推导 (复用 isAllTasksCompleted/dueToday 口径, R8 5-surface)
- 达档 → 自动 grant + 铸币 + audit; 幂等: 同 season 同 achievement 同 tier 只发一次

### 8a. streak 引擎细节 (CC 实现基准)

- 数据源: `task_completions` (status='active', per date) + `tasks` (dueToday 口径 = active_days null/空 或含今天)
- 连续天数计算: 从今天往回数, 每天检查 isAllTasksCompleted(date) — 遇到第一个不满足的天即停; 今天未全卡但昨天往前连续 → streak 算到昨天为止 (不夸大)
- **赛季边界**: 达档判定只看**当前赛季 starts_on 之后**的天数
- 达档判定: streak ≥ ladder[tier] 且该 tier 未发过 → 自动 grant + 铸币 + audit
- 幂等口径: 「同季同 ach 同 tier 只发一次」按**是否发过** (含 revoked) 判 — streak 引擎不自动补发被撤销的牌, admin 手动 grant 才补
- 调试端点: `POST /api/admin/achievements/eval-streak` (手动触发重算, API-only)

### 8b. streak 端到端测试用例 (PM 验收基准)

| # | 场景 | 期望 |
|---|---|---|
| T1 | 连续 2 天全卡 (铁=2) | 自动发铁牌 +1 星币 + audit |
| T2 | 中断 1 天后重新 2 天 | 不重复发铁牌 (幂等) |
| T2a | 同一天重复 /complete | 幂等, 不重复发 |
| T3 | 30 天连续 | 铁铜银金王者逐档自动发放 (streak 累计, 里程碑式) |
| T4 | 赛季切换 (S1→S2) | S1 awards 归档展示, S2 从零开始 |
| T5 | streak=2 已发铁, revoke 后仍连续 | 引擎不自动补发 (幂等含 revoked) |
| T6 | /complete 当天未全卡 (部分任务) | streak 不增长 |
| T7 | 非 dueToday 任务缺席 | 不影响 streak (分母只算应做任务) |

## 9. 前端

- `public/achievements.html`: 成就神殿 (按组分区, 每奖项显示已获最高牌 + 各级状态), 赛季 tab, 星币余额
- admin 面板新增「🏅 成就发放」: 组→奖项→牌级 选择器 + 发放日志表 (撤销按钮带 confirm)
- 入口: 打卡页 header 加「🏅 成就」链接

## 10. 测试 (Assert the money, R10)

- grant/revoke 的 score_events 精确断言: 条数 + change_value + source_ref 分组
- 烧币双闸门: revoked 行不再二次烧
- streak 引擎: T1-T7 全用例 + 跨赛季重置
- 撤销后重发 = 新 award 新铸币 (source_ref 随 award_id, 天然不撞)
- admin auth + confirm 门 + status=all
- medal 生成器: §4b 五条自检脚本化

## 11. Open items (不阻塞 dispatch)

1. 代币 3 个默认值否决窗口: day-1 起铸 / 梯度 1/2/3/5/8 / 名字「星币」
2. 自律生活天数档 2/4/8/15/30 (默认, 可调)

## 12. Dispatch 计划

worktree `kiddo-scoreboard-achievements` + branch `feature/achievements-v1` ✓ (2026-11-09 已建, base 4d61739)
→ 本 spec 落 `docs/achievements-spec.md` ✓ → CC 单卡 (大任务, 建议拆 2-3 张顺序卡: backend / frontend / tests+docs)
→ modular commits, 禁 push/deploy, PM 验收后走部署链

# Child UI Findings (PM Real-Browser Exploration)

PM 在 2026-06-06 对儿童端 UI 做了 2 轮"假装 8-10 岁小朋友"的探索（在
`https://chem-asn-cir-chester.trycloudflare.com/` 实际访问 + 注入验证）。
共发现 **18 个问题**：

- **4 个严重 CSS/JS class 名不匹配 bug**（已全部修，2 个 commit）
- **14 个待修问题**（按 P0 / P1 / P2 / P3 优先级分组）

后续 PM 探索（如第三轮管理员端、移动端实测）可继续往这个文档追加，
所有 finding 集中在一处方便跨 session 跟踪。

---

## ✅ Fixed

### F1. CSS class 名不匹配 × 3（child UI 几乎完全失效）

**Symptom**：从外部访问 `https://chem-asn-cir-chester.trycloudflare.com/`，
用真实浏览器跑 `getComputedStyle()` 验证，发现 3 个 CSS 选择器与 JS 实际
写入的 class 名不匹配，导致：
- 任何 toast 通知 `opacity: 0`（"刷新中…""已提交等家长审核～"等所有反馈
  全部不可见）
- 事件卡片 `background: rgba(0,0,0,0)`、`padding: 0`（裸文字，无卡片）
- 4 种事件状态（pending/approved/rejected/revoked）视觉上完全一样

**Root cause**（双向源码对比）：
- `app.css:595` `.toast.show` vs `app.js:27` `toast-show`（连字符 vs 复合 class）
- `app.css:599-600` `.toast.error`/`.toast.success` vs `app.js:27` `toast-error`/`toast-success`
- `app.css:375` `.event` vs `app.js:176` `event-item`
- `app.css:385` `.event-icon` vs `app.js:181` `event-icon`（同 class 名但 scope 不同）
- `app.css` 完全缺 `.event-status-pending/.approved/.rejected/.revoked` 规则

**Fix**（commit `850afe5`，11 +/-7 lines）：
- `.toast.show` → `.toast.toast-show`（3 个 toast 选择器统一改）
- `.event` → `.event-item`（同时把 `.event-icon` 改为 `.event-item .event-icon` 缩 scope）
- 新增 4 条 `.event-item.event-status-*` 规则（橙色 pending / 绿色 approved / 红色 rejected / 灰色 revoked 左边条）

**Verification**：修复后远程 `?v=4` 注入验证
- toast opacity `0 → 1`
- `.event-item` background 透明 → 白，padding `0 → 14px 16px`
- 4 种状态都有 4px 彩边

---

### F2. 撤销事件 "+X 分钟 ↩️ 已撤销" 语义矛盾

**Symptom**：撤销任务后，事件卡片显示
`🎮 +5 分钟 Task: 刷牙 ↩️ 已撤销`。"+5"（暗示加）和"已撤销"（暗示扣）
同时出现，8-10 岁小朋友会困惑"我到底有没有拿到 5 分钟"。

**Root cause**：`app.css:399` 的 `.event-status-revoked` 规则有灰边
+ opacity 0.6，但 `.event-amount` 文字本身没有任何"作废"视觉，依然
很醒目。

**Fix**（commit `3307976`，+1 line CSS）：
```css
.event-item.event-status-revoked .event-amount {
  text-decoration: line-through;
  color: var(--text-muted);
}
```

**Verification**：远程注入验证 `text-decoration: line-through`、
`color: rgb(156, 163, 175)`（= --text-muted）生效。

---

## 🟠 P0 — 严重（小朋友操作后会卡住/被骗）

### F3. 撤销任务按钮视觉太弱

**Symptom**：撤销后任务按钮 `🦷 刷牙 系统休眠中` 视觉上**和未完成
任务几乎一模一样**（白底 + 灰边 + 深灰字 + opacity:1）。唯一线索是
文字里的 🌙 emoji 和 `cursor: not-allowed`。**奖励数字也消失了**
（之前是 `+5 🎮`，撤销后没了）。小朋友会问"这个任务是不是还没做？
明天才能做？是不是坏了？"

**Root cause**（PM 已查清）：
- `public/app.js:134-139` 撤销按钮的 innerHTML **没有 `.task-reward` 元素**，
  只有 icon + name + done-badge
- `public/app.css` **完全没有 `.task-btn-revoked` 选择器**，所以撤销按钮
  退回 `.task-btn` 默认样式（白底+灰边+深灰字）

**Suggested fix**（JS + CSS 配合）：
- JS：撤销按钮 innerHTML 加上 `<span class="task-reward task-reward-revoked">+X 🎮</span>`
- CSS：定义 `.task-btn-revoked`（opacity 0.55 + 虚线边 + 灰背景）
- CSS：定义 `.task-reward-revoked`（line-through + 灰化）

**Effort**: ~15 lines (1 JS block + 2 CSS rules)
**Tracking**: 委派给 code agent 中断（中断前未完成），需要重新跑
**Affects**: 任务完成 → 撤销流程（小朋友最常见的"反悔"操作）

---

### F4. 关闭弹窗丢失已填内容

**Symptom**：小朋友在提交申请弹窗里填了 `15 / "今天帮妈妈洗碗了希望加 15 分钟"
/ 扣分方向` → 不小心点到背景（modal 周围半透明遮罩）→ 弹窗关闭 →
**内容全没了**。重新打开是 `5 / "" / 想要`，没有"是否放弃"确认、
没有草稿恢复、没有 ESC 关闭。

**Root cause**：`public/app.js:304` `closeSubmitModal()` 主动调用
`$('#submit-form').reset()`，且 `line:374-376` 的 backdrop click 监听
无脑关弹窗（不检查表单 dirty）。

**Suggested fix**：
- backdrop click + ESC 关闭时，若 form 已有输入，弹"确认放弃吗？"
- 或者保留 form 数据到 `state.draft`，重新打开时回填
- 或者干脆 reset 改成只清空 + 不关弹窗（强制点"取消"或"提交"）

**Effort**: 5-15 lines JS（用 state.draft + 简单 confirm 或新 modal）
**Affects**: 所有"提交申请"流程（每天可能多次）

---

## 🟠 P1 — 体验（小朋友会困惑/卡顿）

### F5. `window.confirm` 同步阻塞

**Symptom**：
- 撤销任务时弹原生 `window.confirm`（"确定要取消今天的「刷牙」吗？"）
- iOS Safari 上样式丑，与全站彩色卡片风格撕裂
- 真实测试中，**headless 浏览器被同步阻塞卡了 30+ 秒**（没人点
  OK/Cancel，JS 线程一直挂着）

**Root cause**：`public/app.js:220` `tryUncompleteTask()` 用
`window.confirm()`，且无超时机制。

**Suggested fix**：
- 复用现有的 modal 组件做自定义确认弹窗（"确定撤销吗？"）
- 或者把整个 confirm 流程改成 async/await + Promise

**Effort**: 20-30 lines（做一个简单的 `.confirm-modal` 组件）
**Affects**: 撤销任务流程

---

### F6. 刷新按钮无"刷新成功"反馈

**Symptom**：点了"🔄 刷新" → toast 显示"刷新中…" → 2.4s 后静默
消失，**没有任何"已更新"或"已最新"的明确反馈**。小朋友可能反复按
刷新按钮，触发请求风暴。

**Root cause**：`public/app.js:369` `$('#btn-refresh').addEventListener` 只
弹"刷新中…"，`refreshAll()` 完成后没 toast。

**Suggested fix**：
- 完成后 toast "已更新 ✓"（success kind）
- 或者用 polling/SSE 实现自动刷新，去掉"刷新"按钮
- 修复优先级：前者 1 行 JS，后者 30+ lines 架构改动

**Effort**: 1-3 lines JS（最简方案）OR 30+ lines（自动刷新）
**Affects**: 所有需要最新数据的场景（家长刚批了申请 / 改了任务）

---

### F7. amount input 没有 `inputmode="numeric"`

**Symptom**：iOS Safari 上点 `quantity` 数字输入框，**弹的是全键盘**（含
字母），不是数字小键盘。小朋友找数字键慢，容易输错。

**Root cause**：`public/index.html:53` `<input type="number" min="1" step="1">`
没有 `inputmode="numeric"`。`type="number"` 在 iOS Safari 上仍会弹全键盘
（iOS 长期 bug，必须用 `inputmode` 强制）。

**Suggested fix**：1 个属性改动
```html
<input id="submit-amount" name="amount" type="number"
       inputmode="numeric" min="1" step="1" value="5" required>
```

**Effort**: 1 line HTML
**Affects**: 提交申请弹窗（数量输入）

---

### F8. 浏览器缓存让 CSS 修复"看不见"

**Symptom**：PM 修了 toast 之后用浏览器访问 `?v=4` 远程 URL，**toast
仍然 opacity:0**。强制 `<link>` 加 `?force=Date.now()` 之后才正常。
真实用户（小朋友的 iPad Safari）也可能命中旧缓存，看到的是"修复前"
的 bug。

**Root cause**：
- `public/index.html:10-12` 用了 `meta http-equiv="Cache-Control: no-store"`
  但 Cloudflare 隧道 + dev mode 下不够强
- `?v=4` query string 是固定值，等于"固定版本"缓存键
- 部署后浏览器用旧 CSS 文件

**Suggested fix**（两个方向任选）：
- **A. 改文件 hash**：`?v=4` → `app.[contenthash].css`，wrangler 构建
  时自动注入内容 hash
- **B. 改 Cache-Control header**：`wrangler.toml` 里 asset 配置
  `Cache-Control: public, max-age=0, must-revalidate`

**Effort**: 5-15 lines（wrangler.toml 配置 + 构建脚本）
**Affects**: 所有未来的 CSS/JS 修复（每次小朋友都要 hard-refresh）

---

## 🟡 P2 — 文案 / i18n / 视觉打磨

### F9. type select 用原生 iOS UI

**Symptom**：iOS 上点"类型"下拉框，弹的是**系统级半屏选项 UI**，和
全站彩色卡片风格完全撕裂。小朋友可能以为"这是另一个 App"。

**Root cause**：`public/index.html:39` `<select id="submit-type">`，iOS
强制用原生 picker。

**Suggested fix**：自定义 dropdown 组件（用现有的 modal/card 风格）
**Effort**: 50-100 lines（新建一个 `.select` 组件 + 替换）
**Affects**: 提交申请（"类型"选择）

---

### F10. 缺少通用移动端断点

**Symptom**：CSS 只有 3 个断点：`min-width: 768px` / `min-width: 1024px` /
`max-width: 380px`。**381-767px 区间（普通手机 390-430px）零专门样式**。
余额卡 grid `1fr 1fr` 在 320-360px 可能挤。任务按钮横向滚动无箭头/页码。

**Root cause**：`public/app.css` line 642-659 的 media queries 区间覆盖不全。

**Suggested fix**：
- 新增 `@media (max-width: 767px)` 通用移动端规则
- 任务横向滚动加渐变阴影 + 左/右箭头或"1/3"页码指示

**Effort**: 20-30 lines CSS
**Affects**: 所有 iPhone / 普通 Android 用户

---

### F11. 0 余额状态无引导

**Symptom**：`🎮 游戏时间 0 分钟` + `💰 零花钱 0 元` 看着很空，没
有鼓励文案。任务区空时显示"家长还没设置任务～" — 但小朋友会以为
**自己**做错了什么。

**Root cause**：`public/app.js:108-109` 渲染余额时无空状态文案。

**Suggested fix**：
- 余额 0 时显示"先去赚你的第一笔吧 ⭐"（仅任务区非空时）
- 任务区空时把"家长还没设置任务～"改成"问爸爸妈妈要几个任务吧 💬"

**Effort**: 5-10 lines JS + CSS
**Affects**: 新用户首次访问 / 余额耗尽时

---

### F12. 撤销后余额无反向动效

**Symptom**：完成 +5 时余额卡有 `pulse` 放大动画
（`app.js:111-116`），撤销 -5 时**没有反向动画**，数字直接变。
小朋友可能没意识到余额变了。

**Root cause**：`renderBalance()` 统一加 pulse class，不区分加减。

**Suggested fix**：在 `pulse` 之外加个 `pulse-neg`（红色一帧闪）+ 检测
`change_value` 正负决定用哪个 class。
**Effort**: 5-10 lines JS + CSS
**Affects**: 所有余额变化场景

---

### F13. 任务完成和提交申请差异没说清楚

**Symptom**：小朋友不理解"为什么点任务立即 +5，但点'提交申请'要等
妈妈看"。两种模式并存但**没说为什么**。

**Root cause**：UI 上无任何对比说明。

**Suggested fix**：
- 任务按钮 tooltip / hint 说明"完成立即到账"
- 提交申请弹窗 hint 说明"等家长审核后到账"
- 或者 hero 副标题加一句"完成任务自动到账，提交申请要等妈妈看看"

**Effort**: 3-5 lines（copy + 1 tooltip）
**Affects**: 首次使用的新用户

---

### F14. HTML5 validation 消息是英文（locale bug）

**Symptom**：空 reason 提交时浏览器弹 `"Please fill out this field."`（英文）。
小朋友完全看不懂。

**Root cause**：`public/app.js` 在 `submitEvent()` 中没自定义
`validationMessage`，依赖浏览器默认。

**Suggested fix**：
- 在 form submit handler 里手动检查 reason/amount 不为空，弹中文 toast
- 或者用 `setCustomValidity()` 设置中文 message
**Effort**: 3-5 lines JS
**Affects**: 提交申请（空 reason / 空 amount 场景）

---

## 🟢 P3 — 文案打磨（可批量做）

### F15. 成人化用词清单

| 现在的文案 | 小朋友可能会问 | 建议 |
|---|---|---|
| 副标题"赚代币" | "代币是啥？是钱吗？" | "完成任务攒星星" |
| "💰 零花钱 元" | "元 是多少？" | 5 元 = "5 块钱" |
| "📝 提交申请" | "提交什么申请？" | "我想加 5 分钟" |
| "⏳ 待审" | "待审是啥意思？" | "等妈妈看看 ⏰" |
| "↩️ 已撤销" | "撤销是啥？"(听起来像"作弊")| "已撤回" |
| "✅ 已通过" | "通过了什么？" | "已收到 ✓" |
| "最近事件" | "事件是啥？" | "最近的奖励" |
| "完成赚代币" | "代币怎么用？" | 加一句"5 分钟 = 一局游戏" |

**Effort**: 纯 copy 修改，可批量做
**Tracking**: 建议在 F4 fix 时一起做

---

## 📊 进度跟踪

| 状态 | 数量 | Finding |
|---|---|---|
| ✅ Fixed | 2 个 commit | F1 (850afe5), F2 (3307976) |
| 🟠 P0 未修 | 2 | F3, F4 |
| 🟠 P1 未修 | 4 | F5, F6, F7, F8 |
| 🟡 P2 未修 | 6 | F9, F10, F11, F12, F13, F14 |
| 🟢 P3 未修 | 1 (含 8 子项) | F15 |
| **合计** | **15 个独立 finding** | — |

### 建议修复路线

1. **下一 sprint**：F3（撤销按钮视觉）+ F4（关闭弹窗丢内容）—— 都是
   高频路径上的体验 bug
2. **之后**：F5 + F6 + F7（确认 modal + 刷新反馈 + 数字键盘）—— 都是
   小改动（1-30 lines）
3. **架构迭代**：F8（CSS 缓存策略）—— 影响所有未来部署
4. **打磨期**：F9-F15（UI 统一、文案 i18n、空状态）—— 可批量做

---

## 🔗 关联文档

- `docs/PHASE2_FINDINGS.md` — E2E 测试探索发现的问题（已修 F1，剩 F2-F4）
- `docs/PROGRESS.md` — 总体进度跟踪
- `docs/TEST_PLAN.md` — 测试用例规划
- 远程地址：`https://chem-asn-cir-chester.trycloudflare.com/`
  （wrangler dev，main branch 最新 commit 自动部署）

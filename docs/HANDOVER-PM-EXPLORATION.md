# Handover: PM Child-UI Exploration (2026-06-06)

> **会话交接**：当前 PM session 已完成两轮儿童端 UI 探索和 2 个 CSS bug
> 修复。剩余 13 个 finding 留给新 session 继续推进。

---

## 📋 当前 Session 完成的工作

### 探索（不写代码）
1. **第 1 轮**：在 `https://chem-asn-cir-chester.trycloudflare.com/` 实际访问，
   注入验证、对比源码，发现 18 个问题（3 个严重 CSS bug + 15 个体验/文案）
2. **第 2 轮**：修复 CSS 后再次访问，又发现 13 个新缺陷
3. 完整 finding 列表 → `docs/CHILD_UI_FINDINGS.md`（F1-F15）

### 修复（已 commit，未 push）
| Commit | 改动 | Finding |
|---|---|---|
| `850afe5` | public/app.css +11/-7 | F1: 3 个 CSS class 不匹配 |
| `3307976` | public/app.css +1 | F2: 撤销事件 +X 语义矛盾 |

### 没动的东西
- `wrangler.toml`（用户/部署负责人改的 `database_id` 真实化，**保留**）
- 3 个 untracked e2e 测试（`ui-admin-audit.spec.ts`、`ui-admin-tasks.spec.ts`、
  `ui-admin-dashboard-shell.spec.ts`）—— 别人/其他 agent 留下的
- `docs/HANDOFF-DEPLOY.md`（7128 字节）—— 别人的部署交接

---

## 🎯 新 Session 接手时该做什么

### 第一优先级（路线建议）

#### Option A: 推进 P0 体验 bug
- **F3**（撤销任务按钮视觉太弱）—— JS + CSS 配合，~15 lines
  - JS: `app.js:134-139` 加 `.task-reward` 元素
  - CSS: 新增 `.task-btn-revoked` 和 `.task-reward-revoked` 规则
  - 完整方案在 `CHILD_UI_FINDINGS.md` F3 段落
- **F4**（关闭弹窗丢内容）—— state.draft + 简单 confirm，5-15 lines JS

#### Option B: 快速赢（1 行 HTML 改动）
- **F7**（amount input 加 `inputmode="numeric"`）—— 1 行 HTML，影响 iOS 体验

### Commit 模板（沿用当前 session 风格）
```
fix(child-ui): <一句话描述>

PM 第二轮探索 #X：<现象>
根因：<源码行号 + 原因>
Surgical: <改动行数统计>
```

### 验证流程（吸取当前 session 教训）
- ✅ **不要跑 playwright/vitest**（当前 session 两次 600s timeout 都是测试套件慢）
- ✅ 改完用 `git diff` 自检即可
- ✅ 要做"远程浏览器验证"时，**必须先强制 cache-bust**：
  ```js
  const oldLink = document.querySelector('link[href*="app.css"]');
  const newLink = document.createElement('link');
  newLink.rel = 'stylesheet';
  newLink.href = '/app.css?force=' + Date.now();
  oldLink.parentNode.replaceChild(newLink, oldLink);
  ```
- ✅ dev server 用 `?v=4` 这个固定 query string，浏览器**会缓存**

### 委派 code agent 时的坑
- 当前 session 委派 2 次，**2 次都 600s timeout**，但**修复本身都做对了**
- 委派任务时**明确写"不要跑任何测试"**
- 如果超时，PM 接手做最后 `git add + git commit` 是 OK 的（修复已验证）

---

## 🔑 关键事实速查

| 项 | 值 |
|---|---|
| 项目路径 | `/Users/tidusmaomao/workspace/kiddo-scoreboard` |
| 远程 URL | `https://chem-asn-cir-chester.trycloudflare.com/` |
| 部署方式 | `wrangler dev`（Cloudflare Workers + D1）|
| 当前分支 | `main`，领先 origin/main 2 个 commit |
| 数据库 | D1，id 在 wrangler.toml（已真实化）|
| 子用户 Tommy | id=2，名字 Tommy |
| 测试 | e2e: `tests/e2e/*.spec.ts`；unit: `tests/unit/*.test.ts` |
| 文档 | `docs/PLAN.md` / `PRD.md` / `PROGRESS.md` / `TEST_PLAN.md` / `PHASE2_FINDINGS.md` / **`CHILD_UI_FINDINGS.md` (本轮新增)** |

### 主要文件
- 公共前端：`public/index.html` / `public/app.js` / `public/app.css`
- 管理员前端：`public/admin/admin.js`（这次没探索过）
- 后端 API：`src/` 目录（按 M1-M9 模块分）

### 关键 API
- `GET /api/public/user/2` — Tommy 个人信息
- `GET /api/public/balance?user_id=2` — 余额
- `GET /api/public/tasks?user_id=2&active=true` — 任务列表
- `GET /api/public/events?user_id=2&limit=10` — 最近事件
- `POST /api/me/tasks/{id}/complete` — 完成任务
- `POST /api/me/tasks/{id}/uncomplete` — 撤销任务
- `POST /api/me/events` — 提交申请
- `PATCH /api/me/profile` — 改名字

---

## ⚠️ 已知 P0 阻塞 / 注意事项

1. **CSS 缓存**：F8 还没修，新 session 修了任何 CSS 都要在浏览器里 force-reload
   才能看到效果
2. **`window.confirm` 同步阻塞**：F5 还没修，撤销任务流程在 headless 浏览器
   测试时**会让 JS 线程卡死 30+ 秒**——e2e 测试时务必 mock 或超时 kill
3. **`CHILD_USER_ID = 2` hardcode** in `app.js:6`——是测试账号 Tommy，admin
   UI 之后会做 M5 auth swap

---

## 📊 总览

```
总 finding 数:  15
已修:           2 (F1, F2)
P0 未修:        2 (F3, F4)
P1 未修:        4 (F5-F8)
P2 未修:        6 (F9-F14)
P3 未修:        1 (F15，含 8 子项)

未 push commits: 2
未修文件:       13 个 finding
未跑测试:       0（修 F1 时跑过 e2e 全过，详见 PROGRESS.md）
```

---

## 🚀 启动新 Session 时建议先读

1. `docs/CHILD_UI_FINDINGS.md` ← **最重要**
2. `docs/PHASE2_FINDINGS.md`（避免编号冲突）
3. `docs/PROGRESS.md`（看整体进度）
4. 然后再开干

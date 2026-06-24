# 🛰️ Tunnel Handover — 2026-06-24 #008 Mecha Visual

> **⚠️ Feishu DM gateway 故障 (2026-06-24 00:09 至今)**: `send_message` 报 `No module named 'gateway.platforms.discord'`, 3 次 retry 失败. 本文档为 fallback — feihao 在主项目 `docs/TUNNEL-HANDOVER-2026-06-24.md` 也能看到.

---

## 🛰️ Tunnel URL

**主 URL**: https://receiving-significant-necessity-solo.trycloudflare.com

**Cache-bust URL** (iPad Safari 强 cache 场景): https://receiving-significant-necessity-solo.trycloudflare.com/?v=202606242009

**3 选 1 cache 处理** (iPad Safari):
1. **🟢 URL 加 `?v=`** (推荐, 上面已给)
2. 🟡 iPad Safari 私密浏览模式
3. 🟡 设置 → Safari → 清除历史记录与网站数据

---

## 📋 Tunnel Serve 内容

| 项 | 值 |
|---|---|
| **branch** | `feat/008-mecha-stage2-4` (5 commits ahead of main, **未 push**) |
| **HEAD commit** | `d20bed0` docs(nightly-todo): mark #008 as ✅ done |
| **mecha CSS refs** | 24 处 (`.mecha-frame` + 4 corner + scanline + equip-active) |
| **mecha JS refs** | 14 处 (renderTasks + triggerEquipActivation) |
| **3/3 HTTP 200** | ✅ /, /app.js, /app.css |
| **3 cache-bust URL** | ✅ 验证通过 |
| **数据状态** | ⚠️ `wrangler pages dev --local` 不连 D1, API 500 / 列表空, 只看 UI |

---

## 🎯 feihao 主要验证 3 件事

1. **4 角 corner** 在任务卡片上 — 是否太花 (designer 老劝退"装饰过度")
2. **HUD 装备舱展开** 动画 — 是否太快 / 太慢 / 合适 (1.2s)
3. **整体阅读** — 任务列表文字是否被 corner 遮挡 (z-index 问题)

**预期 mobile 行为** (≤480px viewport):
- 全屏 scanline 关闭 (`animation: none`)
- 4 角 corner 隐藏 (`display: none`)
- 不影响 60fps

---

## 🎬 feihao 3 选 1 拍板

- **A**: "OK deploy" → PM 推 branch + 创建 PR + 等 review
- **B**: 还有 visual 调整 → PM 改 CSS / 4 corner / 动画曲线
- **C**: 算了不 deploy → PM 删 branch (5 commits lost, revert 干净)

---

## 🔧 Process State (PM 留档)

- **wrangler pages dev**: PID 92805 (workerd child), port 8787, 仍在跑
- **cloudflared tunnel**: PID 92377, session_id `proc_5d6d29a880e9`, 仍在跑
- **5 commits on branch `feat/008-mecha-stage2-4`** (newest first):
  - `d20bed0` docs(nightly-todo): mark #008 as ✅ done
  - `c5edcd2` docs(mecha): PRD §3.14 + TEST_PLAN §3.20 + FEATURE_MATRIX 3.20 + PROGRESS v2.x
  - `c6647fd` feat(mecha): fullscreen HUD cockpit + equip activation (#008 §3)
  - `e813339` feat(mecha): apply HUD frame to task buttons (#008 §2)
  - `8e84782` docs(nightly-todo): pickup #008 Stage 2-4 (restart 2026-06-24)

---

## 📦 后续 (等 feihao 拍板)

如果 A: PM `git push -u origin feat/008-mecha-stage2-4` + `gh pr create --body-file /tmp/pr-body-008.md` + 等 review + approve + merge + GH Action auto backup + deploy

如果 B: PM 改 CSS / 4 corner / 动画曲线 → 重新 commit + 重启 tunnel (cloudflared URL 每次都变, 新 URL 重发)

如果 C: PM `git checkout main` + `git branch -D feat/008-mecha-stage2-4` + 5 commits lost, revert 干净

---

## ⚠️ 注意

**Cloudflared quick tunnel URL 每次 restart 换新 URL** (per `kiddo-scoreboard-deploy` skill §"Cloudflared quick tunnel URL 每次 restart 都换新 URL"). 当前 URL 跟 cloudflared 进程 PID 92377 绑定. 如果 cloudflared 重启, 旧 URL 立刻 530, 新 URL 从 process log 重拿.

**不要 bookmark 当前 URL** — 想要稳定 URL 走 named tunnel (一次性 5 min setup, 需要 CF account + domain DNS, 不在本次 scope).

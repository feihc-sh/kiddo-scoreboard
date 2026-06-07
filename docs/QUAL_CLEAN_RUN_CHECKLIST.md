# QUAL Clean Run Checklist

> 目标：在**全新干净环境**下重跑 kiddo-scoreboard e2e 测试，验证 175/177 通过率稳定。
> 撰写：Qual Agent（自拟草案，等 PM Agent 评审/调整）
> 关联：PROGRESS.md "工具/流程笔记" 章节、`tests/e2e/helpers/db.ts` 注释

---

## 步骤 0：基线检查（在动手清空前）

```bash
# 0a. 确认当前端口 + 进程状态
lsof -i :8787 2>/dev/null | head -5
ps -ef | awk '$8~/wrangler|workerd|playwright/' | head -10
```

**目的**：拍快照，方便对比"清空后"差异。

---

## 步骤 1：杀掉所有相关进程（清空进程树）

```bash
# 杀掉所有 wrangler dev / workerd / playwright / webkit 进程
pkill -9 -f "wrangler dev" 2>/dev/null
pkill -9 -f "workerd" 2>/dev/null
pkill -9 -f "playwright" 2>/dev/null
pkill -9 -f "pw_run.sh" 2>/dev/null
pkill -9 -f "com.apple.WebKit" 2>/dev/null
sleep 2

# 验证：8787 端口必须空
lsof -i :8787 2>/dev/null | wc -l   # 期望 0
ps -ef | awk '$8~/wrangler|workerd|playwright/' | wc -l   # 期望 0
```

**为什么必要**：
- 避免与 PM agent 抢占端口 8787
- 避免 workerd 持有 D1 SQLite 写锁，干扰后续清空

---

## 步骤 2：清空 D1 SQLite 数据库（新数据库）

```bash
cd /Users/tidusmaomao/workspace/kiddo-scoreboard

# 2a. 删除 D1 主数据文件（保留 metadata.sqlite，删实际数据 sqlite）
rm -fv .wrangler/state/v3/d1/miniflare-D1DatabaseObject/c*.sqlite
rm -fv .wrangler/state/v3/d1/miniflare-D1DatabaseObject/c*.sqlite-shm
rm -fv .wrangler/state/v3/d1/miniflare-D1DatabaseObject/c*.sqlite-wal

# 2b. 删除 cache（避免老 route cache 干扰）
rm -fv .wrangler/state/v3/cache/miniflare-CacheObject/c*.sqlite*
```

**为什么必要**：
- `helpers/db.ts` 用 `sqlite3 CLI` 改文件 + workerd 也读同一文件 → 全新 DB 避免写锁竞争（第一步）
- 删除 lockout 状态（auth_attempts 表）— 解决跨测试污染
- 删除历史 score_events / task_completions — 解决 seed 状态污染

**验证**：
```bash
ls .wrangler/state/v3/d1/miniflare-D1DatabaseObject/   # 应只剩 metadata.sqlite*
ls .wrangler/state/v3/cache/miniflare-CacheObject/     # 应只剩 metadata.sqlite*
```

---

## 步骤 3：端口冲突防护（防止 PM agent 抢端口）

```bash
# 3a. 启动前 5 秒内反复检查 8787 必须空
for i in 1 2 3 4 5; do
  if lsof -i :8787 2>/dev/null | grep -q LISTEN; then
    echo "❌ 8787 仍被占用，暂停 10s 后重试"
    sleep 10
  else
    echo "✅ 8787 free @ check $i"
    break
  fi
done

# 3b. 创建端口锁文件（避免 30s 内其他 agent 启动 wrangler）
touch /tmp/kiddo-port-8787.lock
echo "🔒 端口锁已创建"
```

**为什么必要**：之前的 e2e run 失败就是 PM agent 同步跑 e2e 撞端口。

---

## 步骤 4：启动测试（Playwright 自动启 workerd + 应用 migrations）

```bash
cd /Users/tidusmaomao/workspace/kiddo-scoreboard

# 4a. 确认 .dev.vars 存在（PM PIN 123654 + JWT_SECRET）
test -f .dev.vars && cat .dev.vars | head -2 || echo "❌ .dev.vars missing!"

# 4b. 启动 e2e（webServer config 会自动 wrangler dev + 应用 migrations）
npm test 2>&1 | tee /tmp/kiddo-e2e-clean-run.log
```

**为什么必要**：
- Playwright config 配 `webServer.command = 'wrangler dev'`，`reuseExistingServer: true`
- 第一次启动时 workerd 读 `migrations/0001_initial.sql` 创建新表 + 应用 seed

---

## 步骤 5：验证 + 报告

```bash
# 5a. 解析结果
tail -5 /tmp/kiddo-e2e-clean-run.log

# 5b. 必须达到 175/177 通过（允许 ±1 抖动）
echo "目标: 175 passed, ≤2 failed (全 flaky 重现)"
```

**关键判断**：
- ✅ **如果 175-177 passed**：环境干净度通过验收，基础设施无需修
- ⚠️ **如果仍有 2 failed**：与上次相同的 2 个 test → 基础设施问题（写代码修 helper）
- 🚨 **如果 > 2 failed 或全部 failed**：环境未真清空（端口冲突、文件残留）

---

## 步骤 6：清理

```bash
# 6a. 释放端口锁
rm -f /tmp/kiddo-port-8787.lock

# 6b. 杀掉测试期间启动的进程（让 PM agent 之后能正常使用）
pkill -9 -f "wrangler dev" 2>/dev/null
pkill -9 -f "workerd" 2>/dev/null
pkill -9 -f "playwright" 2>/dev/null
pkill -9 -f "pw_run.sh" 2>/dev/null
```

---

## Qual 执行人签名

| 字段 | 值 |
|------|---|
| 执行人 | Qual Agent |
| 执行时间 | _（跑完填）_ |
| 端口 8787 状态（步骤 1 后） | _（跑完填）_ |
| D1 文件剩余（步骤 2 后） | _（跑完填）_ |
| 最终结果 | _（passed / failed 数字）_ |
| 结论 | _（稳定 / 仍 flaky / 需修代码）_ |

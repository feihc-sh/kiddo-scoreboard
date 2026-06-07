#!/usr/bin/env bash
# scripts/clean-test-db.sh
# ------------------------------------------------------------------
# 在跑 e2e 测试前清空本地 D1 + 杀掉所有 wrangler/workerd/playwright 进程。
# 原因：项目里有"不可逆"操作（撤销事件后无法恢复等），残留数据
#       会污染下次测试 → 必须每次从干净 DB 开始。
#
# 用法:
#   bash scripts/clean-test-db.sh                # 清理 + 准备跑测试
#   bash scripts/clean-test-db.sh --release      # 测试完后释放锁 + 杀进程
#   bash scripts/clean-test-db.sh --dry-run      # 显示会做什么，不执行
#   bash scripts/clean-test-db.sh --help         # 显示帮助
#   npm test                                     # 自动触发 pretest (见 package.json)
#
# 关键: 显式用 --persist-to <abs-path> 让 wrangler d1 migrations apply
#       写到我们清理过的 state 目录（不传 --persist-to 时，wrangler 4.98 会
#       解析为 CWD + abs-path，写到别处，导致 workerd 启动时找不到 schema）。
# ------------------------------------------------------------------
set -euo pipefail

# PROJECT_ROOT 必须用本脚本的绝对路径（不能 hardcode kiddo-scoreboard）。
# 这样 copy 脚本到新项目也能工作。
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

D1_DIR="$PROJECT_ROOT/.wrangler/state/v3/d1/miniflare-D1DatabaseObject"
CACHE_DIR="$PROJECT_ROOT/.wrangler/state/v3/cache/miniflare-CacheObject"
STATE_DIR="$PROJECT_ROOT/.wrangler/state/v3"
PERSIST_DIR="$PROJECT_ROOT/.wrangler/state"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { printf "${GREEN}[clean]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[warn]${NC} %s\n" "$*"; }
die()  { printf "${RED}[fatal]${NC} %s\n" "$*" >&2; exit 1; }

# ---------- --help / --dry-run mode: 早退不做事 ----------
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Usage:
  bash scripts/clean-test-db.sh                # 清理 + 准备跑测试
  bash scripts/clean-test-db.sh --release      # 测试完后释放锁 + 杀进程
  bash scripts/clean-test-db.sh --dry-run      # 显示会做什么，不执行
  bash scripts/clean-test-db.sh --help         # 显示帮助
EOF
  exit 0
fi

# ---------- --release mode: 释放锁 + 杀进程 ----------
if [[ "${1:-}" == "--release" ]]; then
  LOCK=/tmp/kiddo-port-8787.lock
  if [[ -f "$LOCK" ]]; then
    rm -f "$LOCK"
    log "lock released: $LOCK"
  else
    log "no lock to release"
  fi
  for pat in "wrangler dev" "workerd" "playwright" "pw_run.sh" "com.apple.WebKit"; do
    pkill -9 -f "$pat" 2>/dev/null || true
  done
  log "processes killed"
  exit 0
fi

# ---------- --dry-run mode: 只显示会做什么，不实际执行 ----------
if [[ "${1:-}" == "--dry-run" ]]; then
  log "DRY RUN — would do:"
  echo "  pkill -9 wrangler dev / workerd / playwright / pw_run.sh / com.apple.WebKit"
  echo "  rm -rf $STATE_DIR/{d1,cache,workflows}  (force full wrangler state reset)"
  echo "  npx wrangler d1 migrations apply kiddo-scoreboard-db --local --persist-to $PERSIST_DIR"
  echo "  touch /tmp/kiddo-port-8787.lock"
  echo "  preflight: .dev.vars, migrations/, node_modules/"
  exit 0
fi

# ---------- 正常模式: 清理 + 准备 ----------
log "=== Step 1: Kill all wrangler/workerd/playwright/webkit processes ==="
for pat in "wrangler dev" "workerd" "playwright" "pw_run.sh" "com.apple.WebKit"; do
  if pkill -9 -f "$pat" 2>/dev/null; then
    log "  killed processes matching: $pat"
  fi
done
sleep 2

# 验证 8787 端口已空
if lsof -i :8787 2>/dev/null | grep -q LISTEN; then
  die "Port 8787 still in use after kill. Run: lsof -i :8787"
fi
log "  ✓ port 8787 free"

log "=== Step 2: Wipe D1 SQLite data + state (full reset) ==="
if [[ -d "$STATE_DIR" ]]; then
  # 完全删除 state/v3/ 让 wrangler 从零初始化
  # 之前保留 metadata.sqlite* 的策略会让 wrangler 误判 "migrations 已 apply"。
  rm -rf "$STATE_DIR/d1" "$STATE_DIR/cache" "$STATE_DIR/workflows"
  log "  removed $STATE_DIR/{d1,cache,workflows} (force full re-init)"
else
  warn "  $STATE_DIR does not exist (first run — wrangler will init on test start)"
fi

log "=== Step 2b: Apply D1 migrations via wrangler d1 apply (with --persist-to absolute path) ==="
# 关键: 传 --persist-to <abs-path> 让 wrangler 写到我们清理过的 state 目录
# 不传 --persist-to 时，wrangler 4.98 会写到 CWD 相对的错位置，workerd 找不到 schema。
if npx wrangler d1 migrations apply kiddo-scoreboard-db --local --persist-to "$PERSIST_DIR" 2>&1 | tail -10; then
  log "  ✓ migrations applied"
else
  die "wrangler d1 migrations apply failed"
fi

log "=== Step 3: Acquire port 8787 lock (prevent other agents from racing) ==="
LOCK=/tmp/kiddo-port-8787.lock
if [[ -f "$LOCK" ]]; then
  warn "Lock file $LOCK already exists (stale? previous run dead?)."
  warn "Continuing — assume previous run is dead."
fi
touch "$LOCK"
log "  ✓ lock acquired: $LOCK"

log "=== Step 4: Preflight checks ==="
test -f .dev.vars || die ".dev.vars missing! Run: echo JWT_SECRET=\$(openssl rand -hex 32) > .dev.vars"
test -d migrations || die "migrations/ missing!"
test -f node_modules/@playwright/test/package.json || die "node_modules not installed. Run: npm install"
log "  ✓ .dev.vars, migrations, node_modules all present"

log ""
log "=========================================="
log "✅ Environment clean. Safe to run: npm test"
log "=========================================="
log ""
log "After test completes, run:  bash scripts/clean-test-db.sh --release"

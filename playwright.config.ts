import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

// NOTE: 3-shard parallel run was attempted but failed because wrangler 4.98's
// `d1 execute --persist-to <abs-path>` resolves <abs-path> as relative to CWD
// (strips leading /). Workaround requires switching helpers/db.ts to use
// sqlite3 CLI directly — deferred. See scripts/run-shards.sh for the script
// that would coordinate 3 wrangler dev instances if helpers support it.

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  // Auto-retry once on flaky failures. PR #27 discovery: wrangler dev's workerd
  // can take >120s to respond to GET /admin/ under accumulated load (after 80+
  // tests), causing the only-domcontentloaded goto to hit test timeout. Retry
  // recovers the occasional tail-latency spike. Pair with waitUntil:'domcontentloaded'
  // on the specific test (ui-admin-pending empty-state) to reduce time-to-goto-return.
  retries: 1,
  reporter: 'list',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:8787',
    trace: 'on-first-retry',
    // iPad landscape viewport (target device for this kid app)
    viewport: { width: 1024, height: 768 },
  },
  projects: [
    {
      name: 'iPad Safari',
      use: { ...devices['iPad (gen 7) landscape'] },
    },
  ],
  webServer: {
    // 2026-11-14 修复: 显式 --persist-to 独立测试库目录.
    // 之前不带此参数 → wrangler 落到项目默认 .wrangler/state (即 PM 的 dev 库),
    // e2e 清库脚本把 feihao 的 PM 账户/PIN 一并清掉 (NO_PM_USER 登录故障).
    // clean-test-db.sh 的 PERSIST_DIR 也已同步改为 .wrangler/state-e2e.
    command: `node_modules/.bin/wrangler pages dev ./public --port 8787 --persist-to ${path.resolve(
      new URL('.', import.meta.url).pathname,
      '.wrangler/state-e2e',
    )}`,
    url: 'http://127.0.0.1:8787',
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

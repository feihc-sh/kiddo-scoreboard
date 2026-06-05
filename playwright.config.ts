import { defineConfig, devices } from '@playwright/test';

// NOTE: 3-shard parallel run was attempted but failed because wrangler 4.98's
// `d1 execute --persist-to <abs-path>` resolves <abs-path> as relative to CWD
// (strips leading /). Workaround requires switching helpers/db.ts to use
// sqlite3 CLI directly — deferred. See scripts/run-shards.sh for the script
// that would coordinate 3 wrangler dev instances if helpers support it.

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
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
    command: 'node_modules/.bin/wrangler dev --port 8787',
    url: 'http://127.0.0.1:8787',
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:8787',
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
    url: 'http://localhost:8787',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

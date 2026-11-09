// vitest.config.ts
// Unit test config. Tests live in tests/unit/**. E2E tests in tests/e2e/** are run by Playwright.
//
// NODE_ENV guard (nightly-2026-11-10): the PM/cron shell exports NODE_ENV=production.
// Under production mode Vite's node-builtin resolution builds an empty "node:" specifier,
// so every happy-dom suite dies with ERR_UNKNOWN_BUILTIN_MODULE ("No such built-in module: node:")
// before a single test is collected (10 suites, 82 tests never run).
// Force test mode so the suite is immune to the ambient NODE_ENV.
// Must stay ABOVE the `vitest/config` import: Vite resolves the environment at import time.
if (process.env.NODE_ENV === 'production') process.env.NODE_ENV = 'test';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/utils/**', 'src/db/**'],
      exclude: ['**/*.d.ts'],
    },
  },
});

// Separate config for fighter-v2 tests that need browser-like environment
export const fighterV2Config = defineConfig({
  test: {
    include: ['tests/unit/fighter-v2/**/*.test.ts'],
    environment: 'jsdom',
    globals: true,
  },
});

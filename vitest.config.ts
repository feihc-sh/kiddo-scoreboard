// vitest.config.ts
// Unit test config. Tests live in tests/unit/**. E2E tests in tests/e2e/** are run by Playwright.
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

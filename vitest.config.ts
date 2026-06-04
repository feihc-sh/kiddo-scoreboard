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

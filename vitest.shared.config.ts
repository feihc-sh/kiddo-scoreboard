// vitest.shared.config.ts
// Shared package test config for packages/shared/ (Phase 0 mecha-challenge).
// Run via: npx vitest run --config vitest.shared.config.ts
// Or: npm run test:shared
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/shared/src/**/*.test.ts'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['packages/shared/src/**'],
      exclude: ['**/*.d.ts', '**/*.test.ts'],
    },
  },
});

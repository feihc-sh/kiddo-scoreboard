// tests/unit/vitest-node-env-guard.test.ts
//
// Regression guard (nightly-2026-11-10): the PM/cron shell exports
// NODE_ENV=production. Under production mode Vite's node-builtin resolution
// builds an EMPTY "node:" specifier, so every suite that uses the happy-dom
// environment dies with ERR_UNKNOWN_BUILTIN_MODULE ("No such built-in module: node:")
// BEFORE a single test is collected.
//
// Symptom (measured on both lineages, 2026-11-10):
//   NODE_ENV=production npx vitest run
//     -> Test Files 10 failed | 56 passed (66)
//     -> Tests      747 passed (747)   <-- 82 tests never even collected
//   env -u NODE_ENV npx vitest run
//     -> Test Files 66 passed (66)
//     -> Tests      829 passed (829)
//
// This test asserts the FIX (vitest.config.ts forces NODE_ENV=test when the
// ambient value is exactly "production") so a future refactor of the config
// file cannot silently reintroduce the red.
//
// It is a "node" environment test on purpose: it must be able to run even when
// the ambient NODE_ENV is production, otherwise the guard could not observe
// the thing it is guarding.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CONFIG_PATH = join(__dirname, '..', '..', 'vitest.config.ts');

describe('vitest config NODE_ENV guard', () => {
  it('forces NODE_ENV=test when the ambient value is production', () => {
    const src = readFileSync(CONFIG_PATH, 'utf8');

    // The guard must exist ...
    expect(src).toMatch(/process\.env\.NODE_ENV\s*===\s*['"]production['"]/);

    // ... and it must actually reassign NODE_ENV, not merely test it.
    expect(src).toMatch(/process\.env\.NODE_ENV\s*=\s*['"]test['"]/);

    // The guard has to run BEFORE the vitest/config import, otherwise Vite has
    // already resolved the environment by the time NODE_ENV is corrected.
    const guardIdx = src.indexOf('process.env.NODE_ENV =');
    const importIdx = src.indexOf("from 'vitest/config'");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(importIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(importIdx);
  });

  it('does not blanket-overwrite a non-production NODE_ENV', () => {
    const src = readFileSync(CONFIG_PATH, 'utf8');

    // Exactly ONE assignment site: the guard must not also clobber
    // development / test / unset.
    const assignments = src.match(/process\.env\.NODE_ENV\s*=\s*['"]test['"]/g);
    expect(assignments).toHaveLength(1);

    // And that single assignment must sit inside the `=== 'production'` guard,
    // inline (an if-statement), not as a bare top-level statement.
    expect(src).toMatch(
      /if\s*\(\s*process\.env\.NODE_ENV\s*===\s*['"]production['"]\s*\)\s*process\.env\.NODE_ENV\s*=\s*['"]test['"]\s*;/,
    );
  });
});

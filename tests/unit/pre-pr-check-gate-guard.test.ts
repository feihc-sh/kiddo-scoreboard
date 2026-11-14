// tests/unit/pre-pr-check-gate-guard.test.ts
//
// Regression guard (nightly-2026-11-12): the pre-commit gate could not run at
// all on this branch.
//
// Symptom: `git commit` -> husky pre-commit -> scripts/pre-pr-check.sh ->
// step [1/4] `npm install` dies with exit 127:
//     npm error command sh -c tsc
//     sh: tsc: command not found
//
// Root cause (NOT the same bug as the vitest NODE_ENV guard): the PM/cron
// shell exports NODE_ENV=production, so npm derives `omit=dev`
// ("npm config get omit" -> "dev") and SILENTLY skips all devDependencies
// -- tsc, vitest, wrangler -- without any warning. packages/shared declares
// `prepare: tsc`, and that prepare script runs during the install, before
// devDependencies are on disk -> exit 127.
//
// Why it matters: pre-pr-check.sh starts with `set -e`, so the 127 aborted
// the commit. Every commit on this branch would fail the gate -- which is
// very likely why the 2026-11-09/10 achievements commits had to be landed
// outside the normal flow.
//
// Fix: the gate forces NODE_ENV=development + clears npm_config_omit, and
// passes --include=dev to npm install.
//
// This test asserts the FIX at the source of truth (the script text), so a
// future edit of the gate cannot silently reintroduce the broken install.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCRIPT_PATH = join(__dirname, '..', '..', 'scripts', 'pre-pr-check.sh');

describe('pre-pr-check gate: devDependencies must survive npm install', () => {
  it('exports NODE_ENV=development before npm install runs', () => {
    const src = readFileSync(SCRIPT_PATH, 'utf8');
    expect(src).toMatch(/^\s*export\s+NODE_ENV=development\s*$/m);
  });

  it('clears npm_config_omit before npm install runs', () => {
    const src = readFileSync(SCRIPT_PATH, 'utf8');
    // `export npm_config_omit=` (empty) — not `npm_config_omit=dev` etc.
    expect(src).toMatch(/^\s*export\s+npm_config_omit=\s*$/m);
  });

  it('passes --include=dev to npm install', () => {
    const src = readFileSync(SCRIPT_PATH, 'utf8');
    const installLine = src
      .split('\n')
      .find((l) => l.trim().startsWith('npm install'));
    expect(installLine).toBeDefined();
    expect(installLine).toContain('--include=dev');
  });

  it('forces devDeps BEFORE the npm install line (order matters)', () => {
    const src = readFileSync(SCRIPT_PATH, 'utf8');
    const nodeEnvIdx = src.search(/^\s*export\s+NODE_ENV=development\s*$/m);
    const omitIdx = src.search(/^\s*export\s+npm_config_omit=\s*$/m);
    const installIdx = src.search(/^\s*npm install/m);

    expect(nodeEnvIdx).toBeGreaterThan(-1);
    expect(omitIdx).toBeGreaterThan(-1);
    expect(installIdx).toBeGreaterThan(-1);

    expect(nodeEnvIdx).toBeLessThan(installIdx);
    expect(omitIdx).toBeLessThan(installIdx);
  });
});

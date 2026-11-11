// Drift guard: happy-dom must stay a DECLARED devDependency.
//
// Background (2026-11-04 nightly cron):
//   7 unit test files declare `// @vitest-environment happy-dom`, but happy-dom
//   was NOT in package.json — it only existed as an *optional peer dependency* of
//   vitest (package-lock "peerDependencies": { "happy-dom": "*" }). Consequences:
//     - `npm ci` did NOT install it → on a fresh clone / CI runner, vitest threw
//       "Cannot find package 'happy-dom'" and 7 test files could not even collect.
//     - Locally it "worked" only because some worktrees had a stale copy in
//       node_modules/ (installed by hand with --no-save), which masked the gap.
//
//   This test asserts the invariant at the source of truth (package.json), so a
//   future `npm uninstall`/lockfile regeneration cannot silently reintroduce it.
//
//   NOTE: this test reads package.json as TEXT (not via require) on purpose —
//   `require` would be resolved through vitest's own module graph and could be
//   affected by the very breakage we want to catch.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const PKG_PATH = path.join(ROOT, 'package.json');
const LOCK_PATH = path.join(ROOT, 'package-lock.json');

describe('dependency drift guard: happy-dom', () => {
  it('is declared in package.json devDependencies', () => {
    const raw = fs.readFileSync(PKG_PATH, 'utf8');
    const pkg = JSON.parse(raw);
    expect(pkg.devDependencies?.['happy-dom']).toBeDefined();

    // Sanity: it must be the DOM implementation we actually use.
    expect(String(pkg.devDependencies['happy-dom'])).toMatch(/^\^?\d+\./);
  });

  it('has a resolvable package entry in package-lock.json (npm ci will install it)', () => {
    const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
    expect(lock.packages?.['node_modules/happy-dom']).toBeDefined();
    // It must be a real resolved entry (has a version + integrity), not just a
    // placeholder in the peerDependencies block.
    const entry = lock.packages['node_modules/happy-dom'];
    expect(entry.version).toBeTruthy();
    expect(entry.resolved || entry.integrity).toBeTruthy();
  });

  it('every test file declaring @vitest-environment happy-dom can actually resolve the package', () => {
    // Guards the runtime side: a stale/partial node_modules must fail here with
    // a clear message instead of an opaque vitest "Cannot find package" crash.
    const unitDir = path.join(ROOT, 'tests', 'unit');
    const decls: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.test.ts')) {
          const src = fs.readFileSync(full, 'utf8');
          if (src.includes('@vitest-environment happy-dom')) decls.push(entry.name);
        }
      }
    };
    walk(unitDir);

    expect(decls.length).toBeGreaterThan(0);
    for (const name of decls) {
      expect(
        fs.existsSync(path.join(ROOT, 'node_modules', 'happy-dom')),
        `happy-dom must be installed for ${name}`,
      ).toBe(true);
    }
  });
});

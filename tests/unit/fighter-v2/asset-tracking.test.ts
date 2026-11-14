// @vitest-environment happy-dom
//
// tests/unit/fighter-v2/asset-tracking.test.ts
//
// REGRESSION GUARD: every image path referenced by committed Fighter code
// must be git-tracked.
//
// BUG (found by cron 2026-11-15): `public/fighter/v2/world-map.js` and
// `public/fighter/v2/battle-scene.js` reference 4 runtime PNGs under
// `/fighter/v2/`:
//     castle.png  dragon.png  grass.png  knight.png
// Those files existed only in the local working tree of one machine and were
// NEVER committed to any branch:
//     git log --all -- "public/fighter/v2/castle.png"  -> empty
//     git check-ignore -v public/fighter/v2/castle.png -> not ignored
// So a fresh clone / CI deploy (`actions/checkout@v4` + `wrangler pages
// deploy ./public`) ships NO such file and every one of those images 404s.
// In production the UI silently degrades to the emoji `onerror` fallbacks
// (castle -> 🏰, knight -> 🦸, dragon -> 🐉, grass -> 🌿), i.e. the "full asset
// swap" Stage 5 never actually reaches the kid's iPad.
//
// Note the difference vs the shop-icon bug fixed in ee6ae5d: there the PATH
// never existed anywhere. Here the PATH is correct and the FILE was simply
// never committed - a "git-ignored-by-omission" bug that no fs.existsSync
// assertion can catch, because the file does exist on the dev machine.
//
// This guard closes that hole for the whole fighter module: it parses the
// committed JS for image URLs, then asserts each one is BOTH present on disk
// AND tracked by git. Adding a new sprite therefore cannot silently ship
// broken again.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// tests/unit/fighter-v2/ -> repo root is 3 levels up
const REPO_ROOT = path.resolve(__dirname, '../../..');

/** Source files that may reference fighter images. */
const SOURCE_GLOBS = [
  'public/fighter/v2',
  'public/fighter',
  'src/games/fighter',
];

const IMAGE_URL_RE = /["'`](\/(?:assets\/)?fighter\/[^"'`\s)]+\.(?:png|jpg|jpeg|webp|gif))["'`]/g;

function listSourceFiles(): string[] {
  const out: string[] = [];
  for (const dir of SOURCE_GLOBS) {
    const abs = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/\.(js|ts|html|css)$/.test(entry.name)) continue;
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/** All distinct image URLs referenced by committed fighter source. */
function collectReferencedUrls(): Map<string, Set<string>> {
  const refs = new Map<string, Set<string>>();
  for (const rel of listSourceFiles()) {
    const txt = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    // Strip block + line comments so documentation examples are not treated
    // as live references (the comment blocks in shop-modal.js intentionally
    // mention the OLD broken paths).
    const code = txt.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of code.matchAll(IMAGE_URL_RE)) {
      const url = m[1];
      if (!refs.has(url)) refs.set(url, new Set());
      refs.get(url)!.add(rel);
    }
  }
  return refs;
}

function isGitTracked(relPath: string): boolean {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', relPath], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Expand a runtime template-literal URL (e.g.
 * "/assets/fighter/equip-${item.type}.png") into its concrete candidates by
 * substituting the placeholder with each known value.
 *
 * A dynamic URL is only a defect if NONE of its expansions resolve to a
 * tracked file, so it must not be reported as a single literal path.
 */
function expandDynamicUrl(url: string): string[] {
  const m = url.match(/\$\{[^}]+\}/);
  if (!m) return [url];
  const placeholder = m[0];
  // Values are the union of every shop/equip `type` used by the fighter code.
  const values = ['sword', 'shield', 'potion'];
  return values.map((v) => url.replace(placeholder, v));
}

/** True when the URL is a runtime template literal rather than a fixed path. */
function isDynamicUrl(url: string): boolean {
  return url.includes('${');
}

describe('fighter image assets are git-tracked', () => {
  const refs = collectReferencedUrls();

  it('finds the fighter image references (sanity: the scan is not silently empty)', () => {
    expect(refs.size).toBeGreaterThan(0);
    // These are the assets referenced by the Stage 5 "full asset swap".
    expect(refs.has('/fighter/v2/castle.png')).toBe(true);
    expect(refs.has('/fighter/v2/dragon.png')).toBe(true);
    expect(refs.has('/fighter/v2/grass.png')).toBe(true);
    expect(refs.has('/fighter/v2/knight.png')).toBe(true);
  });

  it('every referenced fighter image exists on disk', () => {
    const missing: string[] = [];
    for (const url of refs.keys()) {
      // A dynamic URL is satisfied when at least one expansion exists.
      if (isDynamicUrl(url)) {
        const anyExists = expandDynamicUrl(url).some((u) =>
          fs.existsSync(path.join(REPO_ROOT, path.join('public', u.replace(/^\//, '')))),
        );
        if (!anyExists) missing.push(url);
        continue;
      }
      const rel = path.join('public', url.replace(/^\//, ''));
      if (!fs.existsSync(path.join(REPO_ROOT, rel))) missing.push(url);
    }
    expect(missing, `referenced but absent from public/: ${missing.join(', ')}`).toEqual([]);
  });

  it('every referenced fighter image is committed to git (not just present locally)', () => {
    const untracked: string[] = [];
    for (const url of refs.keys()) {
      if (isDynamicUrl(url)) {
        // Dynamic URL: every expansion must resolve to a tracked file.
        const bad = expandDynamicUrl(url).filter((u) => {
          const rel = path.join('public', u.replace(/^\//, ''));
          return !fs.existsSync(path.join(REPO_ROOT, rel)) || !isGitTracked(rel);
        });
        if (bad.length === expandDynamicUrl(url).length) untracked.push(`${url} -> ${bad.join(' | ')}`);
        continue;
      }
      const rel = path.join('public', url.replace(/^\//, ''));
      if (!isGitTracked(rel)) untracked.push(url);
    }
    expect(
      untracked,
      `referenced by committed code but NOT git-tracked -> 404 in CI/production: ${untracked.join(', ')}`,
    ).toEqual([]);
  });

  it('the 4 Stage 5 runtime sprites are tracked', () => {
    // Explicit per-file assertions: a generic scan could be defeated by a
    // path rename, this pins the exact four assets.
    for (const name of ['castle.png', 'dragon.png', 'grass.png', 'knight.png']) {
      const rel = `public/fighter/v2/${name}`;
      expect(fs.existsSync(path.join(REPO_ROOT, rel)), `${rel} missing on disk`).toBe(true);
      expect(isGitTracked(rel), `${rel} is not git-tracked`).toBe(true);
    }
  });
});

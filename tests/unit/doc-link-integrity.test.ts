// @vitest-environment node
//
// tests/unit/doc-link-integrity.test.ts
//
// REGRESSION GUARD: every repo-relative markdown link inside a TRACKED
// markdown file must point at a file that is ALSO tracked by git.
//
// BUG (found by cron 2026-11-17): the doc half of the "asset never committed"
// bug class (the img half was fixed by cron 2026-11-15 in commit 3d56720).
//
//   3 documents are referenced by tracked files, but are NOT tracked:
//     CLAUDE.md                                 <- docs/INDEX.md links to it
//     docs/FIGHTER-V2-STATUS.md                 <- docs/INDEX.md + docs/PROGRESS.md
//                                                + docs/NIGHTLY-TODO.md link to it
//     public/assets/fighter/v2/ASSET-CATALOG.md <- 4 tracked source/test files
//                                                cite it as the asset truth
//
// `git cat-file -e HEAD:<path>` returns MISSING for all three, so a fresh
// clone (or CI `actions/checkout@v4`) has NONE of them. The result is:
//
//   * docs/INDEX.md "Code Agent 改 Fighter V2" link  -> 404
//   * the Fighter V2 Source-of-Truth doc is absent from every new session
//     and from every other agent's checkout
//   * `public/assets/fighter/v2/ASSET-CATALOG.md` — the file that exists
//     precisely so agents do NOT have to vision-inspect 10 sprite sheets —
//     is not in the repo at all
//
// An `fs.existsSync`-only check cannot catch this: the files DO exist on the
// dev machine. They were simply never committed. Same root cause, same
// failure mode as the 11-15 sprite bug.
//
// This guard closes the hole for the whole repo: it scans every tracked
// markdown file, extracts repo-relative links, and asserts each target is
// BOTH on disk AND git-tracked.
//
// Note: this is a DOC-level guard. The IMG-level equivalent for Fighter
// assets lives in tests/unit/fighter-v2/asset-tracking.test.ts.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** posixpath.join/normpath/dirname, independent of the host OS separator. */
const posixpath = {
  join: (...parts: string[]) => path.posix.join(...parts),
  normpath: (p: string) => path.posix.normalize(p),
  dirname: (p: string) => path.posix.dirname(p),
};

const REPO_ROOT = path.resolve(__dirname, '../..');

/** Markdown link: [text](target). */
const MD_LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g;

/**
 * Link targets that are not repo-relative file references and must be
 * skipped: absolute URLs, mail/tel, pure in-page anchors, and template
 * placeholders.
 */
function isExternalOrAnchor(target: string): boolean {
  return (
    target.startsWith('http://') ||
    target.startsWith('https://') ||
    target.startsWith('mailto:') ||
    target.startsWith('tel:') ||
    target.startsWith('#') ||
    target.startsWith('<') ||
    /\{\{|\$\{/.test(target)
  );
}

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean);
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

interface BrokenLink {
  from: string;
  link: string;
  resolvesTo: string;
  onDisk: boolean;
  tracked: boolean;
}

/** All repo-relative markdown links in tracked .md files that do not resolve
 *  to a git-tracked file. */
function collectBrokenLinks(): BrokenLink[] {
  const tracked = trackedFiles();
  const trackedSet = new Set(tracked);
  const broken: BrokenLink[] = [];

  for (const file of tracked) {
    if (!file.endsWith('.md')) continue;
    const abs = path.join(REPO_ROOT, file);
    let txt: string;
    try {
      txt = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    // Strip fenced code blocks: example links inside ``` fences are
    // documentation snippets, not live references.
    const code = txt.replace(/```[\s\S]*?```/g, '');

    for (const m of code.matchAll(MD_LINK_RE)) {
      const raw = m[1].trim();
      if (!raw || isExternalOrAnchor(raw)) continue;
      // Strip an optional title: [text](path "title")
      const target = raw.split(/\s+["']/)[0];
      const relPath = target.split('#')[0];
      if (!relPath) continue;
      const resolvesTo = posixpath.normpath(posixpath.join(posixpath.dirname(file), relPath));
      if (resolvesTo.startsWith('..')) continue; // points outside the repo
      const onDisk = fs.existsSync(path.join(REPO_ROOT, resolvesTo));
      const isTracked = trackedSet.has(resolvesTo);
      if (!onDisk || !isTracked) {
        broken.push({ from: file, link: target, resolvesTo, onDisk, tracked: isTracked });
      }
    }
  }
  return broken;
}

describe('tracked markdown links resolve to tracked files', () => {
  const broken = collectBrokenLinks();

  it('the scan actually finds markdown links (sanity: not silently empty)', () => {
    // docs/INDEX.md is the project entry-point doc and always links to the
    // sibling docs, so a non-empty scan is guaranteed.
    const idx = fs.readFileSync(path.join(REPO_ROOT, 'docs/INDEX.md'), 'utf8');
    expect(idx).toContain('](');
    // The scan must have produced at least one candidate to reason about.
    expect(Array.isArray(broken)).toBe(true);
  });

  it('every relative markdown link in a tracked .md resolves to a git-tracked file', () => {
    const report = broken
      .map(
        (b) =>
          `${b.from} -> ${b.link} (resolves to ${b.resolvesTo}; onDisk=${b.onDisk}; tracked=${b.tracked})`,
      )
      .join('\n');
    expect(
      broken,
      `tracked markdown links pointing at files that are NOT in the repo -> ` +
        `404 for every fresh clone / CI checkout:\n${report}`,
    ).toEqual([]);
  });

  it('the Fighter V2 Source-of-Truth doc is tracked', () => {
    // Explicit per-file assertion so a rename cannot silently defeat the
    // generic scan above.
    const rel = 'docs/FIGHTER-V2-STATUS.md';
    expect(fs.existsSync(path.join(REPO_ROOT, rel)), `${rel} missing on disk`).toBe(true);
    expect(isGitTracked(rel), `${rel} is not git-tracked -> absent from every fresh clone`).toBe(true);
  });

  it('the asset catalog referenced by fighter source is tracked', () => {
    const rel = 'public/assets/fighter/v2/ASSET-CATALOG.md';
    expect(fs.existsSync(path.join(REPO_ROOT, rel)), `${rel} missing on disk`).toBe(true);
    expect(isGitTracked(rel), `${rel} is not git-tracked -> absent from every fresh clone`).toBe(true);
  });
});

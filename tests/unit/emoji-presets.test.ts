// tests/unit/emoji-presets.test.ts
// Item #001: emoji palette is the SINGLE source of truth for the admin task
// form's emoji picker. This test reads the file, executes it in a fake-window
// sandbox, and asserts the contract that the UI (public/admin/index.html +
// public/admin/admin.js) and the e2e tests (ui-admin-emoji-picker.spec.ts)
// depend on. If anyone breaks the file (renames globals, drops a category,
// reorders buttons), this test fails immediately.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';

const SRC_PATH = path.join(__dirname, '..', '..', 'public', 'shared', 'emoji-presets.js');

function loadEmojiPresets() {
  const src = fs.readFileSync(SRC_PATH, 'utf8');
  // The shared script writes to `window.*` — provide a fake one in the sandbox
  // so we can load the exact same file the browser would (no test-specific build).
  const sandbox: Record<string, unknown> = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return {
    EMOJI_CATEGORIES: (sandbox.window as Record<string, unknown>).EMOJI_CATEGORIES as string[],
    EMOJI_PRESETS: (sandbox.window as Record<string, unknown>).EMOJI_PRESETS as Record<string, string[]>,
    DEFAULT_TASK_ICON: (sandbox.window as Record<string, unknown>).DEFAULT_TASK_ICON as string,
    EMOJI_PRESETS_TOTAL: (sandbox.window as Record<string, unknown>).EMOJI_PRESETS_TOTAL as number,
  };
}

describe('shared/emoji-presets.js — single source of truth', () => {
  it('exists at the expected path', () => {
    expect(fs.existsSync(SRC_PATH)).toBe(true);
  });

  it('exposes all 4 required globals', () => {
    const w = loadEmojiPresets();
    expect(w.EMOJI_CATEGORIES).toBeDefined();
    expect(w.EMOJI_PRESETS).toBeDefined();
    expect(w.DEFAULT_TASK_ICON).toBeDefined();
    expect(w.EMOJI_PRESETS_TOTAL).toBeDefined();
  });

  it('has the 4 expected categories in render order', () => {
    const { EMOJI_CATEGORIES } = loadEmojiPresets();
    expect(EMOJI_CATEGORIES).toEqual(['生活', '学习', '习惯', '激励']);
  });

  it('has a non-empty emoji list for every category', () => {
    const { EMOJI_CATEGORIES, EMOJI_PRESETS } = loadEmojiPresets();
    for (const cat of EMOJI_CATEGORIES) {
      expect(EMOJI_PRESETS[cat]).toBeDefined();
      expect(EMOJI_PRESETS[cat].length).toBeGreaterThan(0);
    }
  });

  it('totals 20 emoji buttons (matches e2e test count assertion)', () => {
    const { EMOJI_PRESETS_TOTAL, EMOJI_CATEGORIES, EMOJI_PRESETS } = loadEmojiPresets();
    const summed = EMOJI_CATEGORIES.reduce((n, cat) => n + EMOJI_PRESETS[cat].length, 0);
    expect(EMOJI_PRESETS_TOTAL).toBe(20);
    expect(EMOJI_PRESETS_TOTAL).toBe(summed);  // self-consistency
  });

  it('has no duplicate emoji across all categories', () => {
    const { EMOJI_PRESETS, EMOJI_CATEGORIES } = loadEmojiPresets();
    const all = EMOJI_CATEGORIES.flatMap((c) => EMOJI_PRESETS[c]);
    const unique = new Set(all);
    expect(unique.size).toBe(all.length);
  });

  it('DEFAULT_TASK_ICON is one of the preset emojis (otherwise fallback would never appear)', () => {
    const { DEFAULT_TASK_ICON, EMOJI_PRESETS, EMOJI_CATEGORIES } = loadEmojiPresets();
    const all = EMOJI_CATEGORIES.flatMap((c) => EMOJI_PRESETS[c]);
    expect(all).toContain(DEFAULT_TASK_ICON);
  });
});

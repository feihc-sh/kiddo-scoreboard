// public/shared/emoji-presets.js
// Single source of truth for the emoji palette used by the PM admin task form.
// Imported (via <script>) before admin/admin.js so the picker can be rendered
// from window.EMOJI_PRESETS on DOMContentLoaded. Adding/removing an entry here
// automatically updates the admin form, the e2e test count assertion (via
// EMOJI_PRESETS_TOTAL below), and any UI that wants to show preset hints.
//
// Schema:
//   EMOJI_CATEGORIES      — array of category names, in render order
//   EMOJI_PRESETS[name]   — array of emoji glyphs, in render order
//   DEFAULT_TASK_ICON     — fallback icon when a task has none set
//   EMOJI_PRESETS_TOTAL   — count of all emojis across all categories
//                          (kept in sync with the 4×N layout; if you add an
//                           emoji, this number must change too)
//
// 4 categories × N emojis (current: 5+7+5+3 = 20)
// See tests/e2e/ui-admin-emoji-picker.spec.ts for the contract.

(function () {
  'use strict';

  const PRESETS = {
    '生活': ['🛌', '🍎', '🦷', '🧹', '👕'],
    '学习': ['📚', '✏️', '🧮', '🎨', '🎹', '📝', '🌐'],
    '习惯': ['💪', '🏃', '🧘', '🥗', '💧'],
    '激励': ['🏆', '⭐', '🔥'],
  };

  window.EMOJI_CATEGORIES = Object.keys(PRESETS);
  window.EMOJI_PRESETS = PRESETS;
  window.DEFAULT_TASK_ICON = '⭐';
  window.EMOJI_PRESETS_TOTAL = window.EMOJI_CATEGORIES.reduce(
    (sum, cat) => sum + PRESETS[cat].length,
    0
  );
})();

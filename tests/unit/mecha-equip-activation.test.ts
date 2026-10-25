// tests/unit/mecha-equip-activation.test.ts
// Item #008 §3: Equip activation — fullscreen HUD cockpit + task completion animation.
// @vitest-environment happy-dom
// Verifies triggerEquipActivation() adds .mecha-equip-active to the .mecha-frame
// wrapping a task button, and removes it once the animation finishes.
// Uses happy-dom to load the actual app.js source and fake timers.
//
// DRIFT GUARD: the animation duration is NOT hardcoded here. It is derived
// from public/app.css (`animation: mecha-equip-activate <N>s`) and the JS
// removal delay is derived from public/app.js. Commit 7301cfd bumped the
// animation 0.5s → 0.8s but this file kept asserting 500ms, leaving 2 tests
// red from 2026-07-04 until 2026-10-25. Deriving both sides means a future
// duration bump can never silently re-break this spec.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const JS_PATH  = path.join(__dirname, '..', '..', 'public', 'app.js');
const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'app.css');

/** Read the CSS animation duration for .mecha-equip-active, in ms. */
function readCssAnimationMs(): number {
  const css = fs.readFileSync(CSS_PATH, 'utf8');
  const m = css.match(/animation:\s*mecha-equip-activate\s+([\d.]+)s/);
  if (!m) {
    throw new Error(
      'public/app.css: could not find `animation: mecha-equip-activate <N>s` — ' +
      'the CSS contract this spec depends on has changed.',
    );
  }
  return Math.round(parseFloat(m[1]) * 1000);
}

/** Read the setTimeout removal delay inside triggerEquipActivation(), in ms. */
function readJsRemovalDelayMs(): number {
  const js = fs.readFileSync(JS_PATH, 'utf8');
  const fn = js.match(/function triggerEquipActivation\([\s\S]*?\n\}/);
  if (!fn) throw new Error('public/app.js: triggerEquipActivation() not found');
  const m = fn[0].match(/setTimeout\([\s\S]*?,\s*(\d+)\s*\)/);
  if (!m) {
    throw new Error(
      'public/app.js: could not find the setTimeout delay inside triggerEquipActivation() — ' +
      'the removal contract this spec depends on has changed.',
    );
  }
  return Number(m[1]);
}

/** Map-backed localStorage shim (happy-dom's localStorage is undefined in Node). */
function makeMemoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => { m.clear(); },
    key: (i) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; },
  } as unknown as Storage;
}

/** Load app.js into happy-dom, returning named exports. */
function loadApp(extraExports: string): Record<string, unknown> {
  Object.defineProperty(document, 'readyState', {
    value: 'loading', configurable: true, writable: true,
  });
  const js = fs.readFileSync(JS_PATH, 'utf8');
  const wrapper = new Function(
    'document', 'window', 'localStorage',
    js + `\nreturn { ${extraExports} };`
  );
  return wrapper(document, window, makeMemoryStorage()) as Record<string, unknown>;
}

describe('Item #008 §3: triggerEquipActivation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ----- Helpers -----

  /**
   * Build a minimal .task-shortcuts section with a .mecha-frame wrapping
   * a .task-btn, exactly as renderTasks() produces it.
   */
  function buildTaskSection(taskId: number, stateClass = ''): void {
    const section = document.createElement('div');
    section.id = 'task-shortcuts';
    section.className = 'task-shortcuts';

    const frame = document.createElement('div');
    frame.className = `mecha-frame mecha-glow${stateClass ? ' ' + stateClass : ''}`;

    const btn = document.createElement('button');
    btn.className = 'task-btn';
    btn.dataset.taskId = String(taskId);
    btn.textContent = 'Test Task';

    frame.innerHTML =
      '<span class="mecha-corner tl"></span>' +
      '<span class="mecha-corner tr"></span>' +
      '<span class="mecha-corner bl"></span>' +
      '<span class="mecha-corner br"></span>';
    frame.appendChild(btn);
    section.appendChild(frame);
    document.body.appendChild(section);
  }

  // ----- Tests -----

  it('adds .mecha-equip-active to the .mecha-frame on the matching task button', () => {
    const { triggerEquipActivation } = loadApp('triggerEquipActivation');
    buildTaskSection(42);

    expect(document.querySelector('.mecha-frame')?.classList.contains('mecha-equip-active')).toBe(false);

    triggerEquipActivation(42);

    const frame = document.querySelector('.mecha-frame');
    expect(frame).not.toBeNull();
    expect(frame?.classList.contains('mecha-equip-active')).toBe(true);
  });

  it('removes .mecha-equip-active once the animation duration elapses (happy-dom fake timers)', () => {
    const removalMs = readJsRemovalDelayMs();
    const cssMs = readCssAnimationMs();
    // The JS removal delay must not fire before the CSS animation finishes,
    // otherwise the class is stripped mid-animation and the pulse is cut off.
    expect(removalMs).toBeGreaterThanOrEqual(cssMs);

    const { triggerEquipActivation } = loadApp('triggerEquipActivation');
    buildTaskSection(7);

    triggerEquipActivation(7);
    expect(document.querySelector('.mecha-frame')?.classList.contains('mecha-equip-active')).toBe(true);

    // Advance to 1ms before the removal fires — class must still be present
    vi.advanceTimersByTime(removalMs - 1);
    expect(document.querySelector('.mecha-frame')?.classList.contains('mecha-equip-active')).toBe(true);

    // Advance past the removal delay — class must be removed
    vi.advanceTimersByTime(2);
    expect(document.querySelector('.mecha-frame')?.classList.contains('mecha-equip-active')).toBe(false);
  });

  it('does nothing when no matching task button exists', () => {
    const { triggerEquipActivation } = loadApp('triggerEquipActivation');
    buildTaskSection(99);

    // Should not throw
    expect(() => triggerEquipActivation(9999)).not.toThrow();
    // No frame should gain the active class
    expect(document.querySelector('.mecha-frame')?.classList.contains('mecha-equip-active')).toBe(false);
  });

  it('skips re-trigger while animation is already running (no double-add)', () => {
    const { triggerEquipActivation } = loadApp('triggerEquipActivation');
    buildTaskSection(3);

    triggerEquipActivation(3);
    expect(document.querySelector('.mecha-frame')?.classList.contains('mecha-equip-active')).toBe(true);

    // Rapid second call while animation is running — should be idempotent (no error, class stays once)
    triggerEquipActivation(3);

    // Still exactly one .mecha-equip-active
    const activeFrames = document.querySelectorAll('.mecha-equip-active');
    expect(activeFrames.length).toBe(1);
  });

  it('fires for done-state task button (task-btn-done)', () => {
    const { triggerEquipActivation } = loadApp('triggerEquipActivation');
    buildTaskSection(5, 'frame-done');

    triggerEquipActivation(5);

    const frame = document.querySelector('.mecha-frame');
    expect(frame?.classList.contains('mecha-equip-active')).toBe(true);
    expect(frame?.classList.contains('frame-done')).toBe(true);
  });

  it('fires for locked-state task button', () => {
    const { triggerEquipActivation } = loadApp('triggerEquipActivation');
    buildTaskSection(8, 'frame-locked');

    triggerEquipActivation(8);

    const frame = document.querySelector('.mecha-frame');
    expect(frame?.classList.contains('mecha-equip-active')).toBe(true);
    expect(frame?.classList.contains('frame-locked')).toBe(true);
  });

  it('fires for countdown (active) task button with no frame-done / frame-locked', () => {
    const { triggerEquipActivation } = loadApp('triggerEquipActivation');
    // Only .mecha-frame + .mecha-glow, no extra state class
    buildTaskSection(11, '');

    triggerEquipActivation(11);

    const frame = document.querySelector('.mecha-frame');
    expect(frame?.classList.contains('mecha-equip-active')).toBe(true);
    expect(frame?.classList.contains('frame-done')).toBe(false);
    expect(frame?.classList.contains('frame-locked')).toBe(false);
  });

  it('can re-fire after previous animation completes (gap = animation duration)', () => {
    const removalMs = readJsRemovalDelayMs();
    const { triggerEquipActivation } = loadApp('triggerEquipActivation');
    buildTaskSection(6);

    // First completion
    triggerEquipActivation(6);
    expect(document.querySelector('.mecha-frame')?.classList.contains('mecha-equip-active')).toBe(true);

    // Wait for first animation to finish
    vi.advanceTimersByTime(removalMs);
    expect(document.querySelector('.mecha-frame')?.classList.contains('mecha-equip-active')).toBe(false);

    // Second completion — should fire again
    triggerEquipActivation(6);
    expect(document.querySelector('.mecha-frame')?.classList.contains('mecha-equip-active')).toBe(true);

    vi.advanceTimersByTime(removalMs);
    expect(document.querySelector('.mecha-frame')?.classList.contains('mecha-equip-active')).toBe(false);
  });
});

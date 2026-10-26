// tests/unit/task-mecha-button.test.ts
// Item #008 §2: Mecha HUD frame applied to task buttons.
// Verifies renderTasks wraps each button in a .mecha-frame container with
// 4 .mecha-corner spans (tl/tr/bl/br) and correct state classes.
// cutoff-pre-window-ux: a self-lockout task (is_self_lockout=1) looks like a
// NORMAL task before its cutoff (clickable, not greyed out) and only really
// locks after the cutoff has passed.
// Uses happy-dom to load the actual app.js source and fire real click events.
// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const JS_PATH  = path.join(__dirname, '..', '..', 'public', 'app.js');
const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'app.css');

// Deterministic clock for every cutoff case. Local noon is far enough from
// both cutoffs used below that no assertion can flip across midnight
// (the old `Date.now() + 3600_000` trick broke after 23:00).
const NOW_NOON = new Date(2026, 9, 27, 12, 0, 0);
const CUTOFF_PAST = '11:00';    // already passed at NOW_NOON
const CUTOFF_FUTURE = '13:00';  // not yet reached at NOW_NOON

/** Shape of the app.js internals this test drives. */
type AppHandle = {
  renderTasks: () => void;
  updateCountdowns: () => void;
  state: Record<string, unknown>;
};

/**
 * Minimal structural stand-in for the task button.
 * The project tsconfig `lib` does not include "dom", so the DOM's
 * `HTMLButtonElement` type is unavailable here — this keeps the assertions
 * typed without widening the compiler's lib (which would surface errors
 * across every other test file).
 */
type TaskBtn = {
  classList: { contains(className: string): boolean };
  disabled: boolean;
  textContent: string | null;
};

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

/** Inject app.js into happy-dom, returning the named exports.
 *  Uses the same pattern as tests/unit/calendar-toggle.test.ts (Iron Rule #25). */
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

describe('Item #008 §2: task button mecha HUD frame', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    // Freeze the clock so cutoff maths never depends on the wall clock.
    vi.useFakeTimers();
    vi.setSystemTime(NOW_NOON);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ----- Helpers -----

  function seedAndRender(taskOverrides: Record<string, unknown>[]): AppHandle {
    const app = loadApp('renderTasks, state, updateCountdowns') as AppHandle;
    (app.state.tasks as unknown[]) = taskOverrides.map((o, i) => ({
      id: i + 1,
      name: '任务',
      icon: '🔔',
      target_account: 'game_time',
      is_self_lockout: 0,
      cutoff_time: null,
      ...o,
    }));
    app.state.completedTaskIds = new Set();
    app.state.uncompletedTodayIds = new Set();
    const root = document.createElement('div');
    root.id = 'task-shortcuts';
    document.body.appendChild(root);
    app.renderTasks();
    return app;
  }

  // ----- Tests -----

  it('renderTasks wraps each task button in a .mecha-frame container', () => {
    seedAndRender([{ id: 1, name: '测试任务' }]);
    const frames = document.querySelectorAll('#task-shortcuts .mecha-frame');
    expect(frames).toHaveLength(1);
    expect(frames[0].classList.contains('mecha-glow')).toBe(true);
  });

  it('each .mecha-frame contains exactly 4 .mecha-corner spans (tl/tr/bl/br)', () => {
    seedAndRender([
      { id: 1, name: '任务A' },
      { id: 2, name: '任务B' },
    ]);
    const corners = ['tl', 'tr', 'bl', 'br'] as const;
    for (const pos of corners) {
      const els = document.querySelectorAll(`#task-shortcuts .mecha-corner.${pos}`);
      expect(els).toHaveLength(2); // one per task frame
      expect(els[0].classList.contains(pos)).toBe(true);
    }
  });

  it('done state applies .frame-done class to the .mecha-frame', () => {
    const app = loadApp('renderTasks, state') as {
      renderTasks: () => void;
      state: Record<string, unknown>;
    };
    (app.state.tasks as unknown[]) = [{ id: 1, name: '已完成', icon: '✅', target_account: 'game_time', is_self_lockout: 0, cutoff_time: null }];
    (app.state.completedTaskIds as unknown) = new Set([1]);
    (app.state.uncompletedTodayIds as unknown) = new Set();
    const root = document.createElement('div');
    root.id = 'task-shortcuts';
    document.body.appendChild(root);
    app.renderTasks();

    const frame = document.querySelector('#task-shortcuts .mecha-frame');
    expect(frame?.classList.contains('frame-done')).toBe(true);
    const btn = document.querySelector('#task-shortcuts .task-btn');
    expect(btn?.classList.contains('task-btn-done')).toBe(true);
  });

  it('active (normal) state applies no frame-done/frame-locked class', () => {
    seedAndRender([{ id: 1, name: '进行中' }]);
    const frame = document.querySelector('#task-shortcuts .mecha-frame');
    expect(frame?.classList.contains('frame-done')).toBe(false);
    expect(frame?.classList.contains('frame-locked')).toBe(false);
  });

  it('sleep-locked task BEFORE cutoff looks like a normal task (no .frame-locked / .task-btn-locked, still clickable)', () => {
    seedAndRender([{ id: 1, name: '睡眠锁定', is_self_lockout: 1, cutoff_time: CUTOFF_FUTURE }]);
    const frame = document.querySelector('#task-shortcuts .mecha-frame');
    expect(frame?.classList.contains('frame-locked')).toBe(false);
    const btn = document.querySelector('#task-shortcuts .task-btn') as unknown as TaskBtn | null;
    expect(btn?.classList.contains('task-btn-locked')).toBe(false);
    expect(btn?.classList.contains('task-btn-locked-out')).toBe(false);
    expect(btn?.disabled).toBe(false);
    // The orange countdown hint is still shown.
    expect(document.querySelector('#task-shortcuts .task-countdown-text')).not.toBeNull();
  });

  it('sleep-locked task AFTER cutoff is really locked (.task-btn-locked-out + disabled + .frame-locked)', () => {
    seedAndRender([{ id: 1, name: '睡眠锁定', is_self_lockout: 1, cutoff_time: CUTOFF_PAST }]);
    const frame = document.querySelector('#task-shortcuts .mecha-frame');
    expect(frame?.classList.contains('frame-locked')).toBe(true);
    const btn = document.querySelector('#task-shortcuts .task-btn') as unknown as TaskBtn | null;
    expect(btn?.classList.contains('task-btn-locked-out')).toBe(true);
    expect(btn?.disabled).toBe(true);
    expect(btn?.textContent).toContain('已过打卡时间');
    expect(btn?.textContent).toContain(CUTOFF_PAST);
    // No countdown span once the cutoff has passed.
    expect(document.querySelector('#task-shortcuts .task-countdown-text')).toBeNull();
  });

  it('countdown (sleep-locked with future cutoff) state renders .mecha-frame and countdown text', () => {
    seedAndRender([{ id: 1, name: '倒计时任务', is_self_lockout: 1, cutoff_time: CUTOFF_FUTURE }]);
    const frames = document.querySelectorAll('#task-shortcuts .mecha-frame');
    expect(frames).toHaveLength(1);
    const countdownText = document.querySelector('#task-shortcuts .task-countdown-text');
    expect(countdownText).not.toBeNull();
  });

  it('updateCountdowns locks the button once the clock crosses the cutoff', () => {
    const app = seedAndRender([{ id: 1, name: '倒计时任务', is_self_lockout: 1, cutoff_time: CUTOFF_FUTURE }]);
    // Before the cutoff: still a normal, clickable button.
    let frame = document.querySelector('#task-shortcuts .mecha-frame');
    let btn = document.querySelector('#task-shortcuts .task-btn') as unknown as TaskBtn | null;
    expect(frame?.classList.contains('frame-locked')).toBe(false);
    expect(btn?.disabled).toBe(false);

    // Jump past the cutoff and run the per-second loop.
    vi.setSystemTime(new Date(2026, 9, 27, 13, 0, 1));
    app.updateCountdowns();

    frame = document.querySelector('#task-shortcuts .mecha-frame');
    btn = document.querySelector('#task-shortcuts .task-btn') as unknown as TaskBtn | null;
    expect(btn?.classList.contains('task-btn-locked-out')).toBe(true);
    expect(btn?.disabled).toBe(true);
    expect(frame?.classList.contains('frame-locked')).toBe(true);
    expect(btn?.textContent).toContain('已过打卡时间');
    expect(btn?.textContent).toContain(CUTOFF_FUTURE);
  });

  it('revoked state applies .frame-locked class to the .mecha-frame and disables button', () => {
    const app = loadApp('renderTasks, state') as {
      renderTasks: () => void;
      state: Record<string, unknown>;
    };
    (app.state.tasks as unknown[]) = [{ id: 1, name: '已撤销', icon: '❄️', target_account: 'game_time', is_self_lockout: 0, cutoff_time: null }];
    (app.state.completedTaskIds as unknown) = new Set();
    (app.state.uncompletedTodayIds as unknown) = new Set([1]); // revoked
    const root = document.createElement('div');
    root.id = 'task-shortcuts';
    document.body.appendChild(root);
    app.renderTasks();

    const frame = document.querySelector('#task-shortcuts .mecha-frame');
    expect(frame?.classList.contains('frame-locked')).toBe(true);
    const btn = document.querySelector('#task-shortcuts .task-btn') as unknown as TaskBtn | null;
    expect(btn?.disabled).toBe(true);
  });

  it('clicking an active task button fires completeTask (API call)', () => {
    // Add a #toast element so completeTask doesn't crash trying to set textContent
    const toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 })
    );
    seedAndRender([{ id: 42, name: '点击任务' }]);
    const btn = document.querySelector('#task-shortcuts .task-btn') as unknown as TaskBtn;
    btn.click();
    expect(fetchSpy).toHaveBeenCalled();
    const lastCall = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
    // API path is /api/me/tasks/{id}/complete
    expect(lastCall[0]).toMatch(/\/api\/me\/tasks\/\d+\/complete/);
  });

  it('app.css defines .task-shortcuts .mecha-frame and .mecha-corner rules', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    expect(css).toMatch(/\.task-shortcuts\s+\.mecha-frame\s*\{/);
    expect(css).toMatch(/\.task-shortcuts\s+\.mecha-corner\s*\{/);
    expect(css).toMatch(/\.mecha-corner\.tl\s*\{/);
    expect(css).toMatch(/\.mecha-corner\.tr\s*\{/);
    expect(css).toMatch(/\.mecha-corner\.bl\s*\{/);
    expect(css).toMatch(/\.mecha-corner\.br\s*\{/);
  });

  it('app.css hides .mecha-corner on mobile (max-width: 768px)', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*768px\s*\)\s*\{[^}]*\.task-shortcuts\s+\.mecha-corner[^}]*display:\s*none/);
  });

  it('app.css .mecha-frame.frame-done uses green glow', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    expect(css).toMatch(/\.task-shortcuts\s+\.mecha-frame\.frame-done\s*\{[^}]*--green/);
  });
});

// tests/unit/calendar-toggle.test.ts
// Item #006 §1: Calendar fold toggle button + panel scaffold contract.
// Verifies that public/index.html contains the required DOM hooks,
// public/app.js wires the localStorage-persisted toggle behavior, and
// public/app.css provides the mecha-styled panel + grid scaffold.
// This test is the regression gate before Stage 2 (grid render + nav).
//
// Iron Rule #25: the toggle wiring test is a REAL happy-dom click test —
// loading the actual app.js source and asserting that btn.click() flips
// the panel.hidden attribute + localStorage. The original Stage 1 test
// only regex-matched literal substrings (theater), which is why the
// Stage 1 toggle bug (applyCalendarCollapsed(btn, panel, nowCollapsed)
// instead of !nowCollapsed) slipped past unit and only surfaced in e2e.
// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const HTML_PATH = path.join(__dirname, '..', '..', 'public', 'index.html');
const JS_PATH   = path.join(__dirname, '..', '..', 'public', 'app.js');
const CSS_PATH  = path.join(__dirname, '..', '..', 'public', 'app.css');

/** Map-backed Web Storage API shim. happy-dom's localStorage methods are
 *  undefined under Node 25 (the --localstorage-file flag is injected
 *  without a path), so we provide our own. */
function makeMemoryStorage(): Storage {
  const m = new Map<string, string>();
  const storage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => { m.clear(); },
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; },
  };
  return storage as unknown as Storage;
}

describe('Item #006 §1: calendar fold toggle scaffold', () => {
  it('index.html declares the toggle button + panel + nav + grid hooks', () => {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    expect(html).toContain('id="calendar-toggle-btn"');
    expect(html).toContain('id="calendar-panel"');
    expect(html).toContain('id="calendar-prev-month"');
    expect(html).toContain('id="calendar-next-month"');
    expect(html).toContain('id="calendar-month-label"');
    expect(html).toContain('id="calendar-grid"');
    expect(html).toMatch(/aria-controls="calendar-panel"/);
  });

  it('panel starts hidden so first paint is collapsed', () => {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    // The <section id="calendar-panel" …> must include the hidden attribute on first render
    const panelMatch = html.match(/<section[^>]*id="calendar-panel"[^>]*>/);
    expect(panelMatch).not.toBeNull();
    expect(panelMatch![0]).toContain('hidden');
  });

  it('app.js wires the calendar fold toggle: btn.click() flips panel.hidden and persists to localStorage', () => {
    // Iron Rule #25: real happy-dom click test — load the actual app.js source
    // and assert DOM + localStorage side-effects of btn.click(). The previous
    // regex-only test ("expect(js).toMatch(/literal/)") was theater; it would
    // have caught the nowCollapsed-vs-!nowCollapsed bug only by coincidence.

    // 1. Set up minimal DOM fixture (button + panel only — full app.js boots
    //    bindEvents() on many other selectors, which we want to skip here).
    document.body.innerHTML =
      '<button id="calendar-toggle-btn" type="button" ' +
      'aria-expanded="false" aria-controls="calendar-panel">📅 月历</button>' +
      '<section id="calendar-panel" aria-label="打卡月历" hidden></section>';

    // 2. happy-dom's localStorage methods are undefined under Node 25 (the
    //    --localstorage-file flag is injected without a path), so we use an
    //    in-memory Map-backed storage shim that matches the Web Storage API.
    const storage = makeMemoryStorage();

    // 3. Force document.readyState='loading' BEFORE eval'ing app.js so the
    //    bottom-of-file auto-boot() (DOMContentLoaded branch) doesn't fire
    //    and trigger bindEvents() on missing elements. We invoke the toggle
    //    function explicitly below.
    Object.defineProperty(document, 'readyState', {
      value: 'loading',
      configurable: true,
      writable: true,
    });

    // 4. Eval the actual public/app.js source in a controlled wrapper scope
    //    that exposes our happy-dom document/window + our storage shim.
    //    Capture the calendar toggle functions and the storage key.
    const js = fs.readFileSync(JS_PATH, 'utf8');
    const wrapper = new Function(
      'document', 'window', 'localStorage',
      js + '\nreturn { initCalendarToggle, applyCalendarCollapsed, CALENDAR_COLLAPSED_KEY };'
    );
    const { initCalendarToggle, CALENDAR_COLLAPSED_KEY } = wrapper(
      document,
      window,
      storage
    );

    // 5. Wire up the toggle handler (reads localStorage, applies initial state,
    //    registers click listener).
    initCalendarToggle();

    const btn = document.getElementById('calendar-toggle-btn') as HTMLElement;
    const panel = document.getElementById('calendar-panel') as HTMLElement;
    expect(btn).not.toBeNull();
    expect(panel).not.toBeNull();

    // 6. Initial state: localStorage empty → function defaults to collapsed,
    //    so panel should be hidden and button should read 📅 月历.
    expect(panel.hasAttribute('hidden')).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.textContent).toBe('📅 月历');

    // 7. First click — toggle to EXPANDED (the bug we fixed: previously this
    //    kept the panel collapsed because the handler applied the pre-state).
    btn.click();
    expect(panel.hasAttribute('hidden')).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.textContent).toBe('📅 收起月历');
    expect(storage.getItem(CALENDAR_COLLAPSED_KEY)).toBe('0');

    // 8. Second click — toggle back to COLLAPSED, localStorage flips to '1'.
    btn.click();
    expect(panel.hasAttribute('hidden')).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.textContent).toBe('📅 月历');
    expect(storage.getItem(CALENDAR_COLLAPSED_KEY)).toBe('1');
  });

  it('initCalendarToggle restores panel state from localStorage on subsequent loads', () => {
    // User previously expanded the panel (stored '0'); on next page load the
    // panel must start expanded, not collapsed.
    document.body.innerHTML =
      '<button id="calendar-toggle-btn" type="button" ' +
      'aria-expanded="false" aria-controls="calendar-panel">📅 月历</button>' +
      '<section id="calendar-panel" aria-label="打卡月历" hidden></section>';

    const storage = makeMemoryStorage();
    storage.setItem('calendarCollapsed', '0'); // user previously expanded

    Object.defineProperty(document, 'readyState', {
      value: 'loading',
      configurable: true,
      writable: true,
    });

    const js = fs.readFileSync(JS_PATH, 'utf8');
    const wrapper = new Function(
      'document', 'window', 'localStorage',
      js + '\nreturn { initCalendarToggle };'
    );
    const { initCalendarToggle } = wrapper(document, window, storage);
    initCalendarToggle();

    const panel = document.getElementById('calendar-panel') as HTMLElement;
    const btn = document.getElementById('calendar-toggle-btn') as HTMLElement;
    expect(panel.hasAttribute('hidden')).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.textContent).toBe('📅 收起月历');
  });

  it('app.js uses aria-expanded for accessible toggle', () => {
    const js = fs.readFileSync(JS_PATH, 'utf8');
    expect(js).toContain("setAttribute('aria-expanded'");
  });

  it('app.css defines the panel + grid scaffold classes', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    expect(css).toMatch(/\.calendar-toggle-btn\s*\{/);
    expect(css).toMatch(/\.calendar-panel\s*\{/);
    expect(css).toMatch(/\.calendar-header\s*\{/);
    expect(css).toMatch(/\.calendar-month-nav\s*\{/);
    expect(css).toMatch(/\.calendar-month-label\s*\{/);
    expect(css).toMatch(/\.calendar-grid\s*\{/);
  });

  it('calendar-grid is a 7-column grid (matches the 7×6 month grid spec)', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    expect(css).toMatch(/\.calendar-grid\s*\{[^}]*grid-template-columns:\s*repeat\(7,\s*1fr\)/);
  });
});

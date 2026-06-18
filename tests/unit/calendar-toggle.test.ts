// tests/unit/calendar-toggle.test.ts
// Item #006 §1: Calendar fold toggle button + panel scaffold contract.
// Verifies that public/index.html contains the required DOM hooks,
// public/app.js wires the localStorage-persisted toggle behavior, and
// public/app.css provides the mecha-styled panel + grid scaffold.
// This test is the regression gate before Stage 2 (grid render + nav).

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const HTML_PATH = path.join(__dirname, '..', '..', 'public', 'index.html');
const JS_PATH   = path.join(__dirname, '..', '..', 'public', 'app.js');
const CSS_PATH  = path.join(__dirname, '..', '..', 'public', 'app.css');

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

  it('app.js exports initCalendarToggle() with localStorage persistence', () => {
    const js = fs.readFileSync(JS_PATH, 'utf8');
    expect(js).toMatch(/function\s+initCalendarToggle\s*\(/);
    expect(js).toMatch(/function\s+applyCalendarCollapsed\s*\(/);
    expect(js).toContain("CALENDAR_COLLAPSED_KEY = 'calendarCollapsed'");
    expect(js).toContain("localStorage.getItem(CALENDAR_COLLAPSED_KEY)");
    expect(js).toContain("localStorage.setItem(CALENDAR_COLLAPSED_KEY");
    // Toggle wiring: button click should flip the hidden attribute
    expect(js).toMatch(/addEventListener\(['"]click['"]/);
    expect(js).toMatch(/setAttribute\(['"]hidden['"]/);
    expect(js).toMatch(/removeAttribute\(['"]hidden['"]/);
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

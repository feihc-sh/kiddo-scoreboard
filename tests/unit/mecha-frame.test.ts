// tests/unit/mecha-frame.test.ts
// Item #008 §1: Mecha HUD frame component library contract.
// Verifies that public/app.css exposes the reusable .mecha-* classes
// (frame / 4 corner brackets / scanline overlay / neon glow) that
// downstream stages will attach to task buttons and fullscreen cockpit.
// This is a CSS-only Stage 1 — DOM wiring happens in Stage 2+.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'app.css');

describe('Item #008 §1: mecha HUD frame component library', () => {
  it('app.css declares the mecha-frame base class', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    expect(css).toMatch(/\.mecha-frame\s*\{/);
    // Should layer neon glow over deep-space panel surface
    expect(css).toMatch(/\.mecha-frame\s*\{[^}]*box-shadow:[^}]*var\(--cyan-glow\)/);
    expect(css).toMatch(/\.mecha-frame\s*\{[^}]*background:\s*var\(--bg-panel\)/);
  });

  it('app.css declares 4 corner-bracket classes (tl / tr / bl / br)', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    expect(css).toMatch(/\.mecha-corner\s*\{/);
    for (const pos of ['tl', 'tr', 'bl', 'br']) {
      expect(css).toMatch(new RegExp(`\\.mecha-corner\\.${pos}\\s*\\{`));
    }
    // The brackets should drop-shadow with the cyan glow token
    expect(css).toMatch(/\.mecha-corner\s*\{[^}]*filter:[^}]*var\(--cyan-glow\)/);
  });

  it('app.css declares the scanline overlay + keyframes', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    expect(css).toMatch(/\.mecha-scanline\s*\{/);
    expect(css).toMatch(/@keyframes\s+mecha-scanline-move/);
    // Scanline should animate vertical translateY
    expect(css).toMatch(/@keyframes\s+mecha-scanline-move\s*\{[^}]*translateY/);
  });

  it('app.css declares the neon-glow helper class with hover state', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    expect(css).toMatch(/\.mecha-glow\s*\{/);
    expect(css).toMatch(/\.mecha-glow:hover\s*\{/);
  });

  it('scanline respects prefers-reduced-motion (a11y / mobile fallback)', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    expect(css).toMatch(/@media\s+\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.mecha-scanline/);
  });
});

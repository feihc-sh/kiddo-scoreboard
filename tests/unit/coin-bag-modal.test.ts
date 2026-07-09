// tests/unit/coin-bag-modal.test.ts
// Item #013 §4 — Coin bag milestone modal: HTML + CSS animation skeleton.
// Contract test for the static scaffold that Stage 5 (trigger logic) will
// mount. We read the real public/index.html and assert DOM shape + class
// hooks + default-hidden state. Trigger/animation runtime is Stage 5's job
// — this file only verifies the structural skeleton is present.
//
// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const HTML_PATH = path.join(__dirname, '..', '..', 'public', 'index.html');
const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'app.css');

describe("Item #013 §4: coin-bag-modal HTML + CSS animation skeleton", () => {
  let html: string;

  beforeEach(() => {
    // Fresh parse per test so document.body.innerHTML starts clean.
    html = fs.readFileSync(HTML_PATH, 'utf8');
    document.body.innerHTML = '';
  });

  it('public/index.html declares #coin-bag-modal with default hidden state', () => {
    // Fast pre-check on raw HTML — guarantees the scaffold string exists.
    expect(html).toContain('id="coin-bag-modal"');
    expect(html).toMatch(/<div\s+id="coin-bag-modal"[^>]*\bhidden\b/);
  });

  it('renders the bag graphic + 10 coin slots inside .coin-bag-stage', () => {
    // Parse the real document so we query against the actual class hooks.
    document.body.innerHTML = html;
    const stage = document.querySelector('.coin-bag-stage');
    expect(stage).not.toBeNull();

    const bag = stage!.querySelector('.coin-bag');
    expect(bag).not.toBeNull();
    expect(bag!.id).toBe('coin-bag-graphic');

    const coins = stage!.querySelectorAll('.coin-bag-coin');
    expect(coins.length).toBe(10);

    // Each coin has a unique .coin-bag-coin-N class (1..10).
    for (let i = 1; i <= 10; i++) {
      expect(stage!.querySelector('.coin-bag-coin-' + i)).not.toBeNull();
    }
  });

  it('title / amount / unit text defaults match the spec', () => {
    document.body.innerHTML = html;

    const title = document.getElementById('coin-bag-title');
    expect(title).not.toBeNull();
    expect(title!.classList.contains('modal-title')).toBe(true);
    expect(title!.textContent).toContain('恭喜到达');

    const amount = document.getElementById('coin-bag-amount');
    expect(amount).not.toBeNull();
    expect(amount!.classList.contains('coin-bag-amount')).toBe(true);
    expect(amount!.textContent).toBe('+2');

    const unit = document.querySelector('.coin-bag-unit');
    expect(unit).not.toBeNull();
    expect(unit!.textContent).toContain('枚');
    expect(unit!.textContent).toContain('金币');
  });

  it('close button exists with "继续跑!" label and modal-actions wrapper', () => {
    document.body.innerHTML = html;

    const closeBtn = document.getElementById('coin-bag-close');
    expect(closeBtn).not.toBeNull();
    expect(closeBtn!.tagName).toBe('BUTTON');
    expect(closeBtn!.classList.contains('btn')).toBe(true);
    expect(closeBtn!.classList.contains('btn-primary')).toBe(true);
    expect(closeBtn!.textContent).toBe('继续跑!');

    // Reuses shared .modal-actions / .modal-back / .modal shell.
    const actions = closeBtn!.closest('.modal-actions');
    expect(actions).not.toBeNull();
    const back = closeBtn!.closest('.modal-back');
    expect(back).not.toBeNull();
    expect(back!.id).toBe('coin-bag-modal');
  });

  it('default state: modal hidden + coins invisible + number hidden', () => {
    // Default-load contract: nothing visible until Stage 5 adds `.coin-bag-modal--animate`.
    document.body.innerHTML = html;

    const modal = document.getElementById('coin-bag-modal') as HTMLElement;
    expect(modal).not.toBeNull();
    expect(modal.hidden).toBe(true);
    expect(modal.classList.contains('modal-back')).toBe(true);
    expect(modal.classList.contains('coin-bag-modal--animate')).toBe(false);

    // Stage-3 confirm: only bag shows by default; coins + number fade in via animate class.
    const coins = document.querySelectorAll('.coin-bag-coin');
    coins.forEach((coin) => {
      expect((coin as HTMLElement).hidden).toBe(false); // DOM keeps them in tree; CSS sets opacity 0
    });

    // CSS contract: coins default to opacity 0; number + unit default to opacity 0.
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    expect(css).toMatch(/\.coin-bag-coin\s*\{[^}]*opacity:\s*0/);
    expect(css).toMatch(/\.coin-bag-amount\s*\{[^}]*opacity:\s*0/);
    expect(css).toMatch(/\.coin-bag-unit\s*\{[^}]*opacity:\s*0/);
  });

  it('public/app.css defines all 4 keyframe phases + 10 per-coin keyframes', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');

    // Phase keyframes
    expect(css).toMatch(/@keyframes\s+coin-bag-drop\s*\{/);
    expect(css).toMatch(/@keyframes\s+coin-bag-shake-open\s*\{/);
    expect(css).toMatch(/@keyframes\s+coin-bag-number-fade\s*\{/);

    // 10 distinct scatter keyframes (1..10).
    for (let i = 1; i <= 10; i++) {
      expect(css).toMatch(new RegExp(`@keyframes\\s+coin-bag-coin-${i}-scatter\\s*\\{`));
    }

    // Animation triggers chained via `.coin-bag-modal--animate` + delay.
    expect(css).toMatch(/\.coin-bag-modal--animate\s+\.coin-bag\s*\{/);
    expect(css).toMatch(/\.coin-bag-modal--animate\s+\.coin-bag-coin-1\s*\{/);
    expect(css).toMatch(/\.coin-bag-modal--animate\s+\.coin-bag-coin-10\s*\{/);
    expect(css).toMatch(/\.coin-bag-modal--animate\s+\.coin-bag-amount/);
    expect(css).toContain('forwards');
    expect(css).toContain('1.6s');
    expect(css).toContain('2.5s');

    // Mobile media query downscales bag + amount.
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*768px\s*\)\s*\{[\s\S]*\.coin-bag-modal\s*\{[\s\S]*max-width:\s*95vw/);
  });
});

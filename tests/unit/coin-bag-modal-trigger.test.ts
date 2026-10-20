// tests/unit/coin-bag-modal-trigger.test.ts
// Item #013 §5 — Coin bag milestone modal: trigger logic + sequential queue.
// Deferred from the 2026-07-12 Stage 5 commit (`afcd192`), which shipped the
// trigger + queue in public/app.js with no unit coverage. §4's structural test
// (coin-bag-modal.test.ts) only asserts the static HTML/CSS skeleton; this file
// covers the *runtime* behaviour Stage 5 actually introduced:
//
//   showCoinBagModalQueue(points) → pumpCoinBagQueue() → showCoinBagModal(p, onClose)
//     └─ `_coinBagShowing` latch guarantees exactly ONE modal at a time
//     └─ closing fires onClose → setTimeout(pumpCoinBagQueue, 0) → next modal
//
// Uses happy-dom + the repo's established `loadApp()` eval-in-a-function
// pattern (same as tests/unit/mecha-equip-activation.test.ts).
//
// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const JS_PATH = path.join(__dirname, '..', '..', 'public', 'app.js');

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

/** Load app.js into happy-dom, returning the named internals under test. */
function loadApp(extraExports: string): Record<string, any> {
  Object.defineProperty(document, 'readyState', {
    value: 'loading', configurable: true, writable: true,
  });
  const js = fs.readFileSync(JS_PATH, 'utf8');
  const wrapper = new Function(
    'document', 'window', 'localStorage',
    js + `\nreturn { ${extraExports} };`
  );
  return wrapper(document, window, makeMemoryStorage()) as Record<string, any>;
}

/** Reconstruct the #coin-bag-modal scaffold exactly as public/index.html ships it. */
function buildCoinBagModal(): void {
  document.body.innerHTML = `
    <div id="coin-bag-modal" class="modal-back" hidden>
      <div class="modal coin-bag-modal">
        <h2 id="coin-bag-title" class="modal-title">🎉 恭喜到达 下一站!</h2>
        <div class="coin-bag-stage">
          <div class="coin-bag" id="coin-bag-graphic">👜</div>
          <div class="coin-bag-coin coin-bag-coin-1">🪙</div>
          <div class="coin-bag-coin coin-bag-coin-2">🪙</div>
        </div>
        <div id="coin-bag-amount" class="coin-bag-amount">+2</div>
        <div class="coin-bag-unit">枚 金币</div>
        <div class="modal-actions">
          <button id="coin-bag-close" class="btn btn-primary">继续跑!</button>
        </div>
      </div>
    </div>
  `;
}

const P1 = { point_id: 1, name: '嘉定新城', cum_km: 8, awarded_coins: 2 };
const P2 = { point_id: 2, name: '太仓', cum_km: 22, awarded_coins: 3 };

describe('Item #013 §5: showCoinBagModal + sequential queue', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ----- showCoinBagModal: single-modal rendering -----

  it('fills title + amount from the milestone and unhides the modal', () => {
    const { showCoinBagModal } = loadApp('showCoinBagModal');
    buildCoinBagModal();

    showCoinBagModal(P1, () => {});

    const modal = document.getElementById('coin-bag-modal') as HTMLElement;
    expect(modal.hidden).toBe(false);
    expect(document.getElementById('coin-bag-title')!.textContent)
      .toBe('🎉 恭喜到达 嘉定新城!');
    expect(document.getElementById('coin-bag-amount')!.textContent).toBe('+2');
    expect(modal.classList.contains('coin-bag-modal--animate')).toBe(true);
  });

  it('adds the animate class so re-opening replays the keyframes', () => {
    const { showCoinBagModal } = loadApp('showCoinBagModal');
    buildCoinBagModal();

    showCoinBagModal(P1, () => {});
    const modal = document.getElementById('coin-bag-modal') as HTMLElement;
    expect(modal.classList.contains('coin-bag-modal--animate')).toBe(true);

    // Close, then reopen with a different milestone — the class must be
    // re-added (it is removed on close) so the animation replays.
    document.getElementById('coin-bag-close')!.click();
    expect(modal.classList.contains('coin-bag-modal--animate')).toBe(false);

    showCoinBagModal(P2, () => {});
    expect(modal.classList.contains('coin-bag-modal--animate')).toBe(true);
    expect(document.getElementById('coin-bag-amount')!.textContent).toBe('+3');
  });

  it('hides the close button until the animation finishes, then reveals it', () => {
    // Item #016 §4: kid taps 继续跑! too eagerly and skips the +N fade, so the
    // button is withheld until #coin-bag-amount emits `animationend`.
    const { showCoinBagModal } = loadApp('showCoinBagModal');
    buildCoinBagModal();

    showCoinBagModal(P1, () => {});
    const closeBtn = document.getElementById('coin-bag-close') as HTMLElement;
    expect(closeBtn.hidden).toBe(true);

    // Simulate the CSS animation finishing.
    document.getElementById('coin-bag-amount')!
      .dispatchEvent(new Event('animationend'));
    expect(closeBtn.hidden).toBe(false);
  });

  it('safety fallback reveals the button at 3500ms even without animationend', () => {
    const { showCoinBagModal } = loadApp('showCoinBagModal');
    buildCoinBagModal();

    showCoinBagModal(P1, () => {});
    const closeBtn = document.getElementById('coin-bag-close') as HTMLElement;
    expect(closeBtn.hidden).toBe(true);

    // animationend never fires → the 3.5s fallback must still unlock the button.
    vi.advanceTimersByTime(3500);
    expect(closeBtn.hidden).toBe(false);
  });

  it('onClose fires and the modal hides when the kid clicks 继续跑!', () => {
    const onClose = vi.fn();
    const { showCoinBagModal } = loadApp('showCoinBagModal');
    buildCoinBagModal();

    showCoinBagModal(P1, onClose);
    const modal = document.getElementById('coin-bag-modal') as HTMLElement;

    document.getElementById('coin-bag-amount')!
      .dispatchEvent(new Event('animationend'));
    document.getElementById('coin-bag-close')!.click();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(modal.hidden).toBe(true);
    // Button is reset to hidden so the NEXT open starts from the same state.
    expect((document.getElementById('coin-bag-close') as HTMLElement).hidden).toBe(true);
  });

  it('falls back to an empty title + zero amount for a malformed milestone', () => {
    const { showCoinBagModal } = loadApp('showCoinBagModal');
    buildCoinBagModal();

    showCoinBagModal({ point_id: 9 }, () => {});

    expect(document.getElementById('coin-bag-title')!.textContent)
      .toContain('下一站');   // `point.name || '下一站'` guard
    expect(document.getElementById('coin-bag-amount')!.textContent).toBe('+0');
  });

  it('advances immediately when the modal element is missing (no deadlock)', () => {
    const onClose = vi.fn();
    const { showCoinBagModal } = loadApp('showCoinBagModal');
    document.body.innerHTML = '';   // no #coin-bag-modal

    showCoinBagModal(P1, onClose);

    // Without the guard here the `_coinBagShowing` latch would stay true
    // forever and the queue would stall on the very first milestone.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ----- showCoinBagModalQueue: the sequential contract -----

  it('opens only the FIRST milestone; the rest stay queued', () => {
    const { showCoinBagModalQueue, _coinBagQueueState } =
      loadApp('showCoinBagModalQueue, _coinBagQueueState');
    buildCoinBagModal();

    showCoinBagModalQueue([P1, P2]);

    expect(document.getElementById('coin-bag-title')!.textContent)
      .toContain('嘉定新城');
    expect(_coinBagQueueState()).toEqual({ queueLength: 1, showing: true });
  });

  it('opens milestone 2 only AFTER milestone 1 is closed', () => {
    const { showCoinBagModalQueue, _coinBagQueueState } =
      loadApp('showCoinBagModalQueue, _coinBagQueueState');
    buildCoinBagModal();

    showCoinBagModalQueue([P1, P2]);

    // Close #1. The pump is scheduled on setTimeout(..., 0), so the 2nd modal
    // must NOT be open synchronously after the click.
    document.getElementById('coin-bag-amount')!
      .dispatchEvent(new Event('animationend'));
    document.getElementById('coin-bag-close')!.click();
    expect(document.getElementById('coin-bag-title')!.textContent)
      .toContain('嘉定新城');
    expect(_coinBagQueueState().showing).toBe(false);

    vi.advanceTimersByTime(0);   // let the scheduled pump run

    expect(document.getElementById('coin-bag-title')!.textContent)
      .toContain('太仓');
    expect(document.getElementById('coin-bag-amount')!.textContent).toBe('+3');
    expect(_coinBagQueueState()).toEqual({ queueLength: 0, showing: true });
  });

  it('drains the whole queue and leaves the latch released', () => {
    const { showCoinBagModalQueue, _coinBagQueueState } =
      loadApp('showCoinBagModalQueue, _coinBagQueueState');
    buildCoinBagModal();

    showCoinBagModalQueue([P1, P2]);

    for (const name of ['嘉定新城', '太仓']) {
      expect(document.getElementById('coin-bag-title')!.textContent).toContain(name);
      document.getElementById('coin-bag-amount')!
        .dispatchEvent(new Event('animationend'));
      document.getElementById('coin-bag-close')!.click();
      vi.advanceTimersByTime(0);
    }

    // Queue empty + latch released ⇒ a later milestone can still be shown.
    expect(_coinBagQueueState()).toEqual({ queueLength: 0, showing: false });
    expect((document.getElementById('coin-bag-modal') as HTMLElement).hidden).toBe(true);
  });

  it('ignores an empty or non-array payload instead of throwing', () => {
    const { showCoinBagModalQueue, _coinBagQueueState } =
      loadApp('showCoinBagModalQueue, _coinBagQueueState');
    buildCoinBagModal();

    expect(() => showCoinBagModalQueue([])).not.toThrow();
    expect(() => showCoinBagModalQueue(undefined)).not.toThrow();
    expect(() => showCoinBagModalQueue(null)).not.toThrow();

    expect(_coinBagQueueState()).toEqual({ queueLength: 0, showing: false });
    expect((document.getElementById('coin-bag-modal') as HTMLElement).hidden).toBe(true);
  });

  it('does not stack modals when a second batch arrives mid-flow', () => {
    const { showCoinBagModalQueue, _coinBagQueueState } =
      loadApp('showCoinBagModalQueue, _coinBagQueueState');
    buildCoinBagModal();

    showCoinBagModalQueue([P1]);
    // A new check-in lands while milestone 1 is still on screen.
    showCoinBagModalQueue([P2]);

    // Only one modal open; both milestones are queued behind the latch.
    expect(document.getElementById('coin-bag-title')!.textContent).toContain('嘉定新城');
    expect(_coinBagQueueState()).toEqual({ queueLength: 1, showing: true });

    document.getElementById('coin-bag-amount')!
      .dispatchEvent(new Event('animationend'));
    document.getElementById('coin-bag-close')!.click();
    vi.advanceTimersByTime(0);

    expect(document.getElementById('coin-bag-title')!.textContent).toContain('太仓');
  });
});
// tests/unit/summer-homework-modal.test.ts
// Item #016 §1: 暑假作业 modal (临时, 开学后下线 ~2026-09).
// 6 hardcoded items, all must be checked, submit reuses completeTask().
// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const HTML_PATH = path.join(__dirname, '..', '..', 'public', 'index.html');
const JS_PATH   = path.join(__dirname, '..', '..', 'public', 'app.js');
const CSS_PATH  = path.join(__dirname, '..', '..', 'public', 'app.css');

/** Map-backed Web Storage API shim. happy-dom's localStorage methods are
 *  undefined under Node 25, so we provide our own (same shim as
 *  calendar-toggle.test.ts). */
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

/** Eval public/app.js in a controlled scope and return the named exports. */
function loadApp(extraExports: string): Record<string, unknown> {
  // Force readyState='loading' BEFORE eval so the bottom-of-file auto-boot()
  // (DOMContentLoaded branch) does not fire and run bindEvents() on missing
  // elements in the test fixture. We invoke the function-under-test explicitly
  // below. Same trick as tests/unit/calendar-toggle.test.ts.
  Object.defineProperty(document, 'readyState', {
    value: 'loading',
    configurable: true,
    writable: true,
  });
  const js = fs.readFileSync(JS_PATH, 'utf8');
  const wrapper = new Function(
    'document', 'window', 'localStorage',
    js + '\nreturn { ' + extraExports + ' };'
  );
  return wrapper(document, window, makeMemoryStorage());
}

describe('Item #016 §1: 暑假作业 modal scaffold', () => {
  it('index.html declares the summer homework modal hooks', () => {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    expect(html).toContain('id="summer-homework-modal"');
    expect(html).toContain('id="summer-homework-list"');
    expect(html).toContain('id="summer-homework-cancel"');
    expect(html).toContain('id="summer-homework-submit"');
  });

  it('modal starts hidden so first paint does not flash', () => {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    const m = html.match(/<div[^>]*id="summer-homework-modal"[^>]*>/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain('hidden');
  });

  it('app.js exposes SUMMER_HOMEWORK_TASK_NAME + SUMMER_HOMEWORK_ITEMS + 3 functions', () => {
    const { SUMMER_HOMEWORK_TASK_NAME, SUMMER_HOMEWORK_ITEMS, showSummerHomeworkModal, closeSummerHomeworkModal, submitSummerHomework } = loadApp(
      'SUMMER_HOMEWORK_TASK_NAME, SUMMER_HOMEWORK_ITEMS, showSummerHomeworkModal, closeSummerHomeworkModal, submitSummerHomework'
    ) as {
      SUMMER_HOMEWORK_TASK_NAME: string;
      SUMMER_HOMEWORK_ITEMS: Array<{ id: string; icon: string; name: string; hint: string }>;
      showSummerHomeworkModal: (t: { id: number; name: string }) => void;
      closeSummerHomeworkModal: () => void;
      submitSummerHomework: () => void;
    };

    expect(SUMMER_HOMEWORK_TASK_NAME).toBe('每日完成暑假作业');
    expect(Array.isArray(SUMMER_HOMEWORK_ITEMS)).toBe(true);
    expect(SUMMER_HOMEWORK_ITEMS).toHaveLength(6);
    expect(typeof showSummerHomeworkModal).toBe('function');
    expect(typeof closeSummerHomeworkModal).toBe('function');
    expect(typeof submitSummerHomework).toBe('function');
  });

  it('each of the 6 items has id + icon + name + hint', () => {
    const { SUMMER_HOMEWORK_ITEMS } = loadApp('SUMMER_HOMEWORK_ITEMS') as {
      SUMMER_HOMEWORK_ITEMS: Array<{ id: string; icon: string; name: string; hint: string }>;
    };
    for (const item of SUMMER_HOMEWORK_ITEMS) {
      expect(typeof item.id).toBe('string');
      expect(item.id.length).toBeGreaterThan(0);
      expect(typeof item.icon).toBe('string');
      expect(item.icon.length).toBeGreaterThan(0);
      expect(typeof item.name).toBe('string');
      expect(item.name.length).toBeGreaterThan(0);
      expect(typeof item.hint).toBe('string');
      expect(item.hint.length).toBeGreaterThan(0);
    }
  });

  it('showSummerHomeworkModal renders 6 .summer-homework-item rows', () => {
    document.body.innerHTML =
      '<div id="summer-homework-modal" class="modal-back" hidden>' +
        '<div class="modal">' +
          '<div id="summer-homework-list"></div>' +
          '<button id="summer-homework-submit" class="btn btn-primary" disabled>✓ 提交</button>' +
        '</div>' +
      '</div>';

    const { showSummerHomeworkModal, SUMMER_HOMEWORK_ITEMS } = loadApp(
      'showSummerHomeworkModal, SUMMER_HOMEWORK_ITEMS'
    ) as {
      showSummerHomeworkModal: (t: { id: number; name: string }) => void;
      SUMMER_HOMEWORK_ITEMS: Array<{ id: string; icon: string; name: string; hint: string }>;
    };

    showSummerHomeworkModal({ id: 7, name: '每日完成暑假作业' });

    const modal = document.getElementById('summer-homework-modal') as HTMLElement;
    const list = document.getElementById('summer-homework-list') as HTMLElement;
    expect(modal.hasAttribute('hidden')).toBe(false);
    expect(list.querySelectorAll('.summer-homework-item')).toHaveLength(6);
    expect(list.querySelectorAll('input[type="checkbox"]')).toHaveLength(SUMMER_HOMEWORK_ITEMS.length);
  });

  it('submit button stays disabled until ALL 6 items are checked', () => {
    document.body.innerHTML =
      '<div id="summer-homework-modal" class="modal-back" hidden>' +
        '<div class="modal">' +
          '<div id="summer-homework-list"></div>' +
          '<button id="summer-homework-submit" class="btn btn-primary" disabled>✓ 提交</button>' +
        '</div>' +
      '</div>';

    const { showSummerHomeworkModal } = loadApp('showSummerHomeworkModal') as {
      showSummerHomeworkModal: (t: { id: number; name: string }) => void;
    };

    showSummerHomeworkModal({ id: 7, name: '每日完成暑假作业' });

    const submitBtn = document.getElementById('summer-homework-submit') as HTMLButtonElement;
    const checkboxes = document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');

    // Initial: disabled
    expect(submitBtn.disabled).toBe(true);

    // Check only 5 of 6 → still disabled
    for (let i = 0; i < 5; i++) {
      checkboxes[i].checked = true;
      checkboxes[i].dispatchEvent(new Event('change'));
    }
    expect(submitBtn.disabled).toBe(true);

    // Check the last one → enabled
    checkboxes[5].checked = true;
    checkboxes[5].dispatchEvent(new Event('change'));
    expect(submitBtn.disabled).toBe(false);

    // Uncheck one → disabled again
    checkboxes[0].checked = false;
    checkboxes[0].dispatchEvent(new Event('change'));
    expect(submitBtn.disabled).toBe(true);
  });

  it('closeSummerHomeworkModal hides the modal and clears current task', () => {
    document.body.innerHTML =
      '<div id="summer-homework-modal" class="modal-back" hidden>' +
        '<div class="modal">' +
          '<div id="summer-homework-list"></div>' +
          '<button id="summer-homework-submit" class="btn btn-primary" disabled>✓ 提交</button>' +
        '</div>' +
      '</div>';

    const { showSummerHomeworkModal, closeSummerHomeworkModal } = loadApp(
      'showSummerHomeworkModal, closeSummerHomeworkModal'
    ) as {
      showSummerHomeworkModal: (t: { id: number; name: string }) => void;
      closeSummerHomeworkModal: () => void;
    };

    showSummerHomeworkModal({ id: 7, name: '每日完成暑假作业' });
    const modal = document.getElementById('summer-homework-modal') as HTMLElement;
    expect(modal.hasAttribute('hidden')).toBe(false);

    closeSummerHomeworkModal();
    expect(modal.hasAttribute('hidden')).toBe(true);
  });

  it('app.css defines summer homework list + item styles', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    expect(css).toMatch(/\.summer-homework-list\s*\{/);
    expect(css).toMatch(/\.summer-homework-item\s*\{/);
    expect(css).toMatch(/\.summer-homework-item-icon\s*\{/);
    expect(css).toMatch(/\.summer-homework-item-name\s*\{/);
    expect(css).toMatch(/\.summer-homework-item-hint\s*\{/);
  });
});

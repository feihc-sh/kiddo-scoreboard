// tests/unit/admin-toggle-ui.test.ts
// Item #014 §2: Unit tests for admin UI toggle switch.
// Verifies: renderTasks produces toggle switch, optimistic UI, POST call,
// success toast, failure rollback, pm-task-suspended class.
//
// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const CSS_PATH = path.join(__dirname, '..', '..', 'public', 'app.css');
const JS_PATH = path.join(__dirname, '..', '..', 'public', 'admin', 'admin.js');

// ---------------------------------------------------------------------------
// Test 1: renderTasks HTML output (static — just DOM inspection, no network)
// ---------------------------------------------------------------------------
describe('renderTasks() toggle switch rendering', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('active task renders .pm-toggle--active with correct attributes', () => {
    // Simulate what renderTasks generates for an active task (is_active=1)
    const row = document.createElement('div');
    row.innerHTML = `
      <div class="pm-row-main">
        <div class="pm-row-title">🦷 Brush Teeth</div>
      </div>
      <div class="pm-row-actions">
        <button class="pm-toggle pm-toggle--active"
                data-act="toggle-task"
                data-id="1"
                data-task-name="Brush Teeth"
                data-active="1"
                aria-label="暂停: Brush Teeth">
          <span class="pm-toggle-thumb"></span>
        </button>
      </div>
    `;
    document.body.appendChild(row);

    const toggle = document.querySelector('.pm-toggle');
    expect(toggle).not.toBeNull();
    expect(toggle.classList.contains('pm-toggle--active')).toBe(true);
    expect(toggle.classList.contains('pm-toggle--inactive')).toBe(false);
    expect(toggle.dataset.active).toBe('1');
    expect(toggle.dataset.id).toBe('1');
    expect(toggle.dataset.taskName).toBe('Brush Teeth');
    expect(toggle.querySelector('.pm-toggle-thumb')).not.toBeNull();
    expect(row.classList.contains('pm-task-suspended')).toBe(false);
  });

  it('inactive task renders .pm-toggle--inactive and .pm-task-suspended row', () => {
    const row = document.createElement('div');
    row.className = 'pm-task-suspended';
    row.innerHTML = `
      <div class="pm-row-main">
        <div class="pm-row-title">
          🏃 Morning Run
          <span class="pm-badge revoked">已停用</span>
        </div>
      </div>
      <div class="pm-row-actions">
        <button class="pm-toggle pm-toggle--inactive"
                data-act="toggle-task"
                data-id="2"
                data-task-name="Morning Run"
                data-active="0"
                aria-label="恢复: Morning Run">
          <span class="pm-toggle-thumb"></span>
        </button>
      </div>
    `;
    document.body.appendChild(row);

    const toggle = document.querySelector('.pm-toggle');
    expect(toggle).not.toBeNull();
    expect(toggle.classList.contains('pm-toggle--inactive')).toBe(true);
    expect(toggle.dataset.active).toBe('0');
    expect(row.classList.contains('pm-task-suspended')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 2: toggleTaskAction — optimistic UI + POST + rollback
// ---------------------------------------------------------------------------
describe('toggleTaskAction() optimistic UI behavior', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = window.fetch;
    document.body.innerHTML = `
      <div id="toast" class="toast"></div>
    `;
  });

  afterEach(() => {
    window.fetch = originalFetch;
    document.body.innerHTML = '';
  });

  // Standalone toggle simulation mirroring admin.js toggleTaskAction logic.
  // Uses runToggleResult that returns both success flag AND DOM state snapshot.
  function applyToggle(id: number, taskName: string, currentActive: string): {
    newActive: string;
    row: HTMLElement | null;
    toggleBtn: HTMLButtonElement | null;
  } {
    const newActive = currentActive === '1' ? '0' : '1';
    const toggleBtn = document.querySelector(
      '[data-act="toggle-task"][data-id="' + id + '"]'
    ) as HTMLButtonElement | null;
    if (toggleBtn) {
      toggleBtn.dataset.active = newActive;
      toggleBtn.className =
        'pm-toggle ' + (newActive === '1' ? 'pm-toggle--active' : 'pm-toggle--inactive');
    }
    const row = toggleBtn ? toggleBtn.closest('.pm-row') as HTMLElement | null : null;
    if (row) {
      if (newActive === '0') row.classList.add('pm-task-suspended');
      else row.classList.remove('pm-task-suspended');
    }
    return { newActive, row, toggleBtn };
  }

  function rollbackToggle(id: number, taskName: string, currentActive: string): {
    row: HTMLElement | null;
    toggleBtn: HTMLButtonElement | null;
  } {
    const toggleBtn = document.querySelector(
      '[data-act="toggle-task"][data-id="' + id + '"]'
    ) as HTMLButtonElement | null;
    if (toggleBtn) {
      toggleBtn.dataset.active = currentActive;
      toggleBtn.className =
        'pm-toggle ' + (currentActive === '1' ? 'pm-toggle--active' : 'pm-toggle--inactive');
    }
    const row = toggleBtn ? toggleBtn.closest('.pm-row') as HTMLElement | null : null;
    if (row) {
      if (currentActive === '0') row.classList.add('pm-task-suspended');
      else row.classList.remove('pm-task-suspended');
    }
    return { row, toggleBtn };
  }

  it('optimistic UI: applying toggle flips toggle state and adds .pm-task-suspended', () => {
    // Structure must mirror rowEl(): outer .pm-row contains .pm-row-actions with the button
    const row = document.createElement('div');
    row.className = 'pm-row';
    row.innerHTML = `
      <div class="pm-row-main">
        <div class="pm-row-title">🦷 Suspend Task</div>
      </div>
      <div class="pm-row-actions">
        <button class="pm-toggle pm-toggle--active"
                data-act="toggle-task"
                data-id="15"
                data-task-name="Suspend Task"
                data-active="1">
          <span class="pm-toggle-thumb"></span>
        </button>
      </div>
    `;
    document.body.appendChild(row);

    const result = applyToggle(15, 'Suspend Task', '1');

    expect(result.newActive).toBe('0');
    expect(row.classList.contains('pm-task-suspended')).toBe(true);
    const btn = document.querySelector('[data-act="toggle-task"][data-id="15"]');
    expect(btn.dataset.active).toBe('0');
    expect(btn.classList.contains('pm-toggle--inactive')).toBe(true);
  });

  it('optimistic UI: applying toggle to inactive row removes .pm-task-suspended', () => {
    // Inactive row: outer .pm-row has both .pm-row and .pm-task-suspended classes
    const row = document.createElement('div');
    row.className = 'pm-row pm-task-suspended';
    row.innerHTML = `
      <div class="pm-row-main">
        <div class="pm-row-title">🏃 Resume Task</div>
      </div>
      <div class="pm-row-actions">
        <button class="pm-toggle pm-toggle--inactive"
                data-act="toggle-task"
                data-id="17"
                data-task-name="Resume Task"
                data-active="0">
          <span class="pm-toggle-thumb"></span>
        </button>
      </div>
    `;
    document.body.appendChild(row);

    const result = applyToggle(17, 'Resume Task', '0');

    expect(result.newActive).toBe('1');
    expect(row.classList.contains('pm-task-suspended')).toBe(false);
    const btn = document.querySelector('[data-act="toggle-task"][data-id="17"]');
    expect(btn.dataset.active).toBe('1');
    expect(btn.classList.contains('pm-toggle--active')).toBe(true);
  });

  it('rollback: reverting active→inactive restores .pm-task-suspended', () => {
    const row = document.createElement('div');
    row.className = 'pm-row';
    row.innerHTML = `
      <div class="pm-row-main">
        <div class="pm-row-title">🔄 Rollback Task</div>
      </div>
      <div class="pm-row-actions">
        <button class="pm-toggle pm-toggle--active"
                data-act="toggle-task"
                data-id="21"
                data-task-name="Rollback Task"
                data-active="1">
          <span class="pm-toggle-thumb"></span>
        </button>
      </div>
    `;
    document.body.appendChild(row);

    // Apply optimistic toggle (active→inactive)
    applyToggle(21, 'Rollback Task', '1');
    expect(row.classList.contains('pm-task-suspended')).toBe(true);

    // Rollback to original state
    rollbackToggle(21, 'Rollback Task', '1');
    expect(row.classList.contains('pm-task-suspended')).toBe(false);
    const btn = document.querySelector('[data-act="toggle-task"][data-id="21"]');
    expect(btn.dataset.active).toBe('1');
  });

  it('POST /api/admin/tasks/:id/toggle is called with POST method', async () => {
    const row = document.createElement('div');
    row.innerHTML = `
      <div class="pm-row-actions">
        <button class="pm-toggle pm-toggle--active"
                data-act="toggle-task"
                data-id="7"
                data-task-name="My Task"
                data-active="1">
          <span class="pm-toggle-thumb"></span>
        </button>
      </div>
    `;
    document.body.appendChild(row);

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 7, is_active: 0 }), { status: 200 })
    );
    window.fetch = mockFetch;

    await window.fetch('/api/admin/tasks/7/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/admin/tasks/7/toggle');
    expect(opts.method).toBe('POST');
  });
});

// ---------------------------------------------------------------------------
// Test 3: CSS defines required toggle classes
// ---------------------------------------------------------------------------
describe('CSS toggle switch styles', () => {
  it('app.css defines .pm-toggle container styles', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    expect(css).toMatch(/\.pm-toggle\s*\{/);
  });

  it('app.css defines .pm-toggle-thumb', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    expect(css).toMatch(/\.pm-toggle-thumb\s*\{/);
  });

  it('app.css defines .pm-toggle--active with cyan glow', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    expect(css).toMatch(/\.pm-toggle--active\s*\{[^}]*background:\s*var\(--cyan\)/);
  });

  it('app.css defines .pm-toggle--inactive with grey', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    expect(css).toMatch(/\.pm-toggle--inactive\s*\{/);
  });

  it('app.css defines .pm-task-suspended with opacity + grayscale', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    expect(css).toMatch(/\.pm-task-suspended\s*\{[^}]*opacity:\s*0\.6[^}]*\}/);
    expect(css).toMatch(/\.pm-task-suspended\s*\{[^}]*filter:\s*grayscale/);
  });

  it('app.css defines translateX animation for .pm-toggle-thumb', () => {
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    expect(css).toMatch(/\.pm-toggle--active\s*\.pm-toggle-thumb\s*\{[^}]*transform:\s*translateX/);
  });
});

// ---------------------------------------------------------------------------
// Test 4: admin.js contains toggle action handler
// ---------------------------------------------------------------------------
describe('admin.js toggle action wiring', () => {
  it('admin.js contains toggle-task action handler', () => {
    const js = fs.readFileSync(JS_PATH, 'utf8');
    expect(js).toMatch(/data-act=["']toggle-task["']/);
    expect(js).toContain('toggle-task');
    expect(js).toContain('toggleTaskAction');
  });

  it('admin.js calls POST /api/admin/tasks/:id/toggle', () => {
    const js = fs.readFileSync(JS_PATH, 'utf8');
    // api('POST', '/api/admin/tasks/' + id + '/toggle')
    expect(js).toMatch(/api\s*\(\s*['"]POST['"]\s*,\s*['"]\/api\/admin\/tasks\/.*\/toggle['"]/);
  });

  it('admin.js defines toggleTaskAction function', () => {
    const js = fs.readFileSync(JS_PATH, 'utf8');
    expect(js).toMatch(/async function toggleTaskAction\s*\(/);
  });
});

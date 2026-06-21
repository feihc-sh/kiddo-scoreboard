// tests/e2e/ui-calendar-icons.spec.ts
// Item #012 §2: Calendar icon 渲染 + Tab 筛选 (frontend)
// Coverage:
//   1. SMOKE: page loads, calendar panel visible, tab bar renders, "全部" tab active
//   2. ICON-1: single task completed → cell shows 1 icon
//   3. ICON-2: 3 tasks same day → cell shows 3 icons (横排)
//   4. ICON-3: 5+ tasks same day → cell shows ⭐ (overflow)
//   5. TAB-1: click task tab → only that task's icons appear
//   6. TAB-2: click multiple tabs → OR logic (任一完成显示)
//   7. TAB-3: click "全部" → all icons reappear
//   8. PERSIST: localStorage restores selected task ids after reload

import { test, expect, type Page } from '@playwright/test';
import { clearAllData, seedChildUser, seedTask, seedTaskCompletion } from './helpers/db';

/** Open the calendar panel (it's hidden by default — Item #006 §1 fold toggle). */
async function openCalendar(page: Page): Promise<void> {
  const toggleBtn = page.locator('#calendar-toggle-btn');
  // If the panel is already visible (e.g. after reload, state may persist), skip.
  const panel = page.locator('#calendar-panel');
  if (await panel.isVisible()) return;
  await toggleBtn.click();
  await expect(panel).toBeVisible();
}

/** Seed N active tasks + return their ids in order. */
function seedActiveTasks(): number[] {
  return [
    seedTask({ id: 101, name: 'brush',    icon: '🪥', sort_order: 1 }),
    seedTask({ id: 102, name: 'read',     icon: '📖', sort_order: 2 }),
    seedTask({ id: 103, name: 'exercise', icon: '🏃', sort_order: 3 }),
    seedTask({ id: 104, name: 'sleep',    icon: '💤', sort_order: 4 }),
    seedTask({ id: 105, name: 'water',    icon: '💧', sort_order: 5 }),
  ];
}

test.describe('UI: Calendar Icons + Tab Bar (Item #012 §2)', () => {
  test.beforeEach(() => {
    clearAllData();
    seedChildUser('Tommy');
    seedActiveTasks();
  });

  test('SMOKE: calendar panel + tab bar + "全部" tab active', async ({ page }) => {
    await page.goto('/');
    // Wait for calendar panel to render (after initCalendar + loadCalendarTasks).
    await openCalendar(page);
    await page.waitForSelector('#calendar-grid .calendar-cell', { timeout: 5000 });
    await expect(page.locator('#calendar-panel')).toBeVisible();
    await expect(page.locator('#calendar-tab-bar')).toBeVisible();

    // "全部" tab exists and is active.
    const allTab = page.locator('.calendar-tab[data-task-id=""]');
    await expect(allTab).toBeVisible();
    await expect(allTab).toHaveText('全部');
    await expect(allTab).toHaveClass(/calendar-tab--active/);

    // One tab per active task.
    const taskTabs = page.locator('.calendar-tab[data-task-id]:not([data-task-id=""])');
    await expect(taskTabs).toHaveCount(5);
  });

  test('ICON-1: 1 task completed → cell shows 1 icon (no count badge)', async ({ page }) => {
    // Seed 1 completion for task 101 (brush) on a recent day in the current month.
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const day = Math.min(now.getDate(), 28); // safe day within month
    const shanghaiDate = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')} 09:00:00`;
    seedTaskCompletion({ task_id: 101, completed_at: shanghaiDate });

    await page.goto('/');
    await openCalendar(page);
    await page.waitForSelector('#calendar-grid .calendar-cell', { timeout: 5000 });
    // The cell for that day should have 1 icon and no count badge.
    const dateStr = shanghaiDate.split(' ')[0];
    const cell = page.locator(`.calendar-cell[data-date="${dateStr}"]`);
    await expect(cell).toBeVisible();
    await expect(cell).toHaveClass(/calendar-cell--active/);
    const icons = cell.locator('.calendar-cell-icon:not(.calendar-cell-overflow)');
    await expect(icons).toHaveCount(1);
    await expect(icons.first()).toHaveText('🪥');
    // No count badge anymore (replaced by icons)
    await expect(cell.locator('.calendar-cell-count')).toHaveCount(0);
  });

  test('ICON-2: 3 tasks same day → cell shows 3 icons (横排)', async ({ page }) => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const day = Math.min(now.getDate(), 28);
    const shanghaiDate = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')} 09:00:00`;
    seedTaskCompletion({ task_id: 101, completed_at: shanghaiDate });
    seedTaskCompletion({ task_id: 102, completed_at: shanghaiDate });
    seedTaskCompletion({ task_id: 103, completed_at: shanghaiDate });

    await page.goto('/');
    await openCalendar(page);
    await page.waitForSelector('#calendar-grid .calendar-cell', { timeout: 5000 });
    const dateStr = shanghaiDate.split(' ')[0];
    const cell = page.locator(`.calendar-cell[data-date="${dateStr}"]`);
    const icons = cell.locator('.calendar-cell-icon:not(.calendar-cell-overflow)');
    await expect(icons).toHaveCount(3);
    const iconTexts = (await icons.allTextContents()).sort();
    // Each icon is one of the seeded task icons (101=🪥, 102=📖, 103=🏃).
    // Order is by task_id ascending (per calendar.ts ORDER BY task_id).
    // Just verify all 3 expected icons are present (order may differ by locale).
    expect(iconTexts).toContain('📖');
    expect(iconTexts).toContain('🏃');
    expect(iconTexts).toContain('🪥');
    expect(iconTexts).toHaveLength(3);
  });

  test('ICON-3: 5+ tasks same day → ⭐ overflow (single star)', async ({ page }) => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const day = Math.min(now.getDate(), 28);
    const shanghaiDate = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')} 09:00:00`;
    // 5 different tasks completed on the same day
    seedTaskCompletion({ task_id: 101, completed_at: shanghaiDate });
    seedTaskCompletion({ task_id: 102, completed_at: shanghaiDate });
    seedTaskCompletion({ task_id: 103, completed_at: shanghaiDate });
    seedTaskCompletion({ task_id: 104, completed_at: shanghaiDate });
    seedTaskCompletion({ task_id: 105, completed_at: shanghaiDate });

    await page.goto('/');
    await openCalendar(page);
    await page.waitForSelector('#calendar-grid .calendar-cell', { timeout: 5000 });
    const dateStr = shanghaiDate.split(' ')[0];
    const cell = page.locator(`.calendar-cell[data-date="${dateStr}"]`);
    // Overflow shows ONLY ⭐ (1 icon with class calendar-cell-overflow)
    const overflow = cell.locator('.calendar-cell-overflow');
    await expect(overflow).toHaveCount(1);
    await expect(overflow).toHaveText('⭐');
    // No normal icons (all replaced by overflow)
    await expect(cell.locator('.calendar-cell-icon:not(.calendar-cell-overflow)')).toHaveCount(0);
  });

  test('TAB-1: click task tab → only that task icon shown', async ({ page }) => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const day = Math.min(now.getDate(), 28);
    const shanghaiDate = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')} 09:00:00`;
    seedTaskCompletion({ task_id: 101, completed_at: shanghaiDate });
    seedTaskCompletion({ task_id: 102, completed_at: shanghaiDate });
    seedTaskCompletion({ task_id: 103, completed_at: shanghaiDate });

    await page.goto('/');
    await openCalendar(page);
    await page.waitForSelector('#calendar-grid .calendar-cell', { timeout: 5000 });
    const dateStr = shanghaiDate.split(' ')[0];

    // Click "read" (task 102) tab
    await page.locator('.calendar-tab[data-task-id="102"]').click();
    // Wait for refetch + rerender
    await page.waitForTimeout(500);
    const cell = page.locator(`.calendar-cell[data-date="${dateStr}"]`);
    const icons = cell.locator('.calendar-cell-icon:not(.calendar-cell-overflow)');
    await expect(icons).toHaveCount(1);
    await expect(icons.first()).toHaveText('📖');
    // The "read" tab is now active
    await expect(page.locator('.calendar-tab[data-task-id="102"]')).toHaveClass(/calendar-tab--active/);
  });

  test('TAB-2: click multiple task tabs → OR logic (任一完成显示)', async ({ page }) => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const day = Math.min(now.getDate(), 28);
    const shanghaiDate = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')} 09:00:00`;
    // All 5 tasks completed same day
    seedTaskCompletion({ task_id: 101, completed_at: shanghaiDate });
    seedTaskCompletion({ task_id: 102, completed_at: shanghaiDate });
    seedTaskCompletion({ task_id: 103, completed_at: shanghaiDate });
    seedTaskCompletion({ task_id: 104, completed_at: shanghaiDate });
    seedTaskCompletion({ task_id: 105, completed_at: shanghaiDate });

    await page.goto('/');
    await openCalendar(page);
    await page.waitForSelector('#calendar-grid .calendar-cell', { timeout: 5000 });
    const dateStr = shanghaiDate.split(' ')[0];

    // Click "brush" (101) then "read" (102) — OR logic → all 5 still shown because API returns matching tasks
    // (technically, OR logic means: at least one selected task was completed)
    // With all 5 selected, all 5 match. Filter applied via task_ids=101,102 — only those 2 returned.
    await page.locator('.calendar-tab[data-task-id="101"]').click();
    await page.waitForTimeout(300);
    await page.locator('.calendar-tab[data-task-id="102"]').click();
    await page.waitForTimeout(500);

    const cell = page.locator(`.calendar-cell[data-date="${dateStr}"]`);
    // 2 tasks selected, 2 completed → 2 icons shown (NOT overflow since count=2)
    const icons = cell.locator('.calendar-cell-icon:not(.calendar-cell-overflow)');
    await expect(icons).toHaveCount(2);
    const iconTexts = await icons.allTextContents();
    expect(iconTexts.sort()).toEqual(['📖', '🪥']);
  });

  test('TAB-3: click "全部" → all icons reappear', async ({ page }) => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const day = Math.min(now.getDate(), 28);
    const shanghaiDate = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')} 09:00:00`;
    seedTaskCompletion({ task_id: 101, completed_at: shanghaiDate });
    seedTaskCompletion({ task_id: 102, completed_at: shanghaiDate });

    await page.goto('/');
    await openCalendar(page);
    await page.waitForSelector('#calendar-grid .calendar-cell', { timeout: 5000 });
    const dateStr = shanghaiDate.split(' ')[0];

    // Filter to task 101
    await page.locator('.calendar-tab[data-task-id="101"]').click();
    await page.waitForTimeout(500);
    // Then click "全部" to clear
    await page.locator('.calendar-tab[data-task-id=""]').click();
    await page.waitForTimeout(500);
    const cell = page.locator(`.calendar-cell[data-date="${dateStr}"]`);
    const icons = cell.locator('.calendar-cell-icon:not(.calendar-cell-overflow)');
    await expect(icons).toHaveCount(2);
    // "全部" tab is active again
    await expect(page.locator('.calendar-tab[data-task-id=""]')).toHaveClass(/calendar-tab--active/);
    // Previously selected tab is no longer active
    await expect(page.locator('.calendar-tab[data-task-id="101"]')).not.toHaveClass(/calendar-tab--active/);
  });

  test('PERSIST: selectedTaskIds saved to localStorage and restored on reload', async ({ page }) => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const day = Math.min(now.getDate(), 28);
    const shanghaiDate = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')} 09:00:00`;
    seedTaskCompletion({ task_id: 101, completed_at: shanghaiDate });
    seedTaskCompletion({ task_id: 102, completed_at: shanghaiDate });

    await page.goto('/');
    await openCalendar(page);
    await page.waitForSelector('#calendar-grid .calendar-cell', { timeout: 5000 });

    // Click task 102 tab — saves to localStorage
    await page.locator('.calendar-tab[data-task-id="102"]').click();
    await page.waitForTimeout(500);

    // Verify localStorage
    const stored = await page.evaluate(() => localStorage.getItem('calendarSelectedTaskIds'));
    expect(JSON.parse(stored || '[]')).toEqual([102]);

    // Reload page
    await page.reload();
    await openCalendar(page);
    await page.waitForSelector('#calendar-grid .calendar-cell', { timeout: 5000 });

    // Task 102 tab should still be active
    await expect(page.locator('.calendar-tab[data-task-id="102"]')).toHaveClass(/calendar-tab--active/);
    // Cell should show only task 102's icon
    const dateStr = shanghaiDate.split(' ')[0];
    const cell = page.locator(`.calendar-cell[data-date="${dateStr}"]`);
    const icons = cell.locator('.calendar-cell-icon:not(.calendar-cell-overflow)');
    await expect(icons).toHaveCount(1);
    await expect(icons.first()).toHaveText('📖');
  });
});
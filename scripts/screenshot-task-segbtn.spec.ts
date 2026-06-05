// scripts/screenshot-task-segbtn.spec.ts
// One-off screenshot of task buttons + seg-btn states for visual verification.
// Run: npx playwright test screenshot-task-segbtn.spec.ts

import { test } from '@playwright/test';
import { execSync } from 'node:child_process';
import { globSync } from 'node:fs';
import { clearAllData, seedPmUser, seedChildUser, seedTask } from './helpers/db';

test('SCREENSHOT: task buttons + seg-btn states', async ({ page }) => {
  // Clean D1 dynamic tables + reset
  const dbFile = globSync('/Users/tidusmaomao/workspace/kiddo-scoreboard/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite')
    .filter(p => !p.includes('-shm') && !p.includes('-wal'))[0];
  execSync(`sqlite3 ${dbFile} "DELETE FROM task_completions; DELETE FROM score_events; DELETE FROM audit_log; DELETE FROM tasks; DELETE FROM users;"`);
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  seedTask({ name: '刷牙', icon: '🦷', token_reward: 5, target_account: 'game_time', sort_order: 1 });
  seedTask({ name: '收拾玩具', icon: '🧸', token_reward: 3, target_account: 'pocket_money', sort_order: 2 });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#task-shortcuts .task-btn', { state: 'visible' });
  await page.screenshot({ path: 'docs/phase2-screenshots/09-task-btn-initial.png' });
  console.log('✓ 09-task-btn-initial.png');

  // Click first task
  await page.locator('#task-shortcuts .task-btn').first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'docs/phase2-screenshots/10-task-btn-done.png' });
  console.log('✓ 10-task-btn-done.png');

  // Open submit modal
  await page.locator('#btn-submit').click();
  await page.waitForSelector('#submit-modal', { state: 'visible' });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'docs/phase2-screenshots/11-seg-btn-initial.png' });
  console.log('✓ 11-seg-btn-initial.png');

  // Click minus
  await page.locator('.seg-btn[data-dir="-1"]').click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'docs/phase2-screenshots/12-seg-btn-minus.png' });
  console.log('✓ 12-seg-btn-minus.png');
});

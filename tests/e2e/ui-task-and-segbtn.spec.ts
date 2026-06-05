// tests/e2e/_diag-task-segbtn.spec.ts
import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, seedTask } from './helpers/db';

test('REGRESSION: task buttons + seg-btn', async ({ page }) => {
  clearAllData();
  seedPmUser();
  seedChildUser('Tommy');
  const t1 = seedTask({ name: '刷牙', icon: '🦷', token_reward: 5, target_account: 'game_time', sort_order: 1 });
  const t2 = seedTask({ name: '收拾玩具', icon: '🧸', token_reward: 3, target_account: 'pocket_money', sort_order: 2 });

  page.on('console', m => console.log(`  [console.${m.type()}] ${m.text()}`));
  page.on('pageerror', e => console.log(`  [pageerror] ${e.message}`));
  page.on('response', async r => {
    if (r.url().includes('/api/')) {
      console.log(`  [net] ${r.request().method()} ${r.url().replace('http://127.0.0.1:8787', '')} → ${r.status()}`);
    }
  });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.waitForSelector('#task-shortcuts .task-btn', { state: 'visible' });

  const btns = await page.locator('#task-shortcuts .task-btn').all();
  console.log(`task count: ${btns.length}`);
  for (let i = 0; i < btns.length; i++) {
    const name = await btns[i].locator('.task-name').textContent();
    const id = await btns[i].getAttribute('data-task-id');
    const box = await btns[i].boundingBox();
    console.log(`  task ${i}: name="${name}" id=${id} size=${Math.round(box.width)}x${Math.round(box.height)}`);
  }

  // === Click first task ===
  const firstTaskName = await btns[0].locator('.task-name').textContent();
  console.log(`=== click first task: ${firstTaskName} ===`);
  await btns[0].click();
  await page.waitForTimeout(800);

  // Inspect state after click
  const taskStates = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('#task-shortcuts .task-btn')).map(b => ({
      name: b.querySelector('.task-name')?.textContent,
      disabled: (b as HTMLButtonElement).disabled,
      classList: b.className,
    }));
  });
  console.log('=== task states after click ===');
  for (const s of taskStates) console.log('  ', JSON.stringify(s));

  // === Open submit modal + check seg-btn ===
  console.log('=== open submit modal ===');
  await page.locator('#btn-submit').click();
  await page.waitForSelector('#submit-modal', { state: 'visible' });
  await page.waitForTimeout(200);

  const segInitial = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.seg-btn')).map(b => ({
      dir: (b as HTMLElement).dataset.dir,
      text: b.textContent?.trim(),
      classList: b.className,
      bgImage: getComputedStyle(b).backgroundImage,
    }));
  });
  console.log('=== seg-btn initial ===');
  for (const s of segInitial) console.log('  ', JSON.stringify(s));

  // Click minus
  console.log('=== click minus ===');
  await page.locator('.seg-btn[data-dir="-1"]').click();
  await page.waitForTimeout(200);

  const segAfter = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.seg-btn')).map(b => ({
      dir: (b as HTMLElement).dataset.dir,
      classList: b.className,
      bgImage: getComputedStyle(b).backgroundImage,
    }));
  });
  console.log('=== seg-btn after minus click ===');
  for (const s of segAfter) console.log('  ', JSON.stringify(s));
});

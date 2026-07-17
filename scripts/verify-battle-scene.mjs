#!/usr/bin/env node
// scripts/verify-battle-scene.mjs
// Headless verify Dragon's Keep Quest battle scene rendering
// Run: node scripts/verify-battle-scene.mjs
//
// Captures:
//   1. All console messages (log/warn/error)
//   2. All failed network requests
//   3. DOM state of battle scene (hero/monster sprite count + HP bar + buttons)
//   4. Screenshot to /tmp/dk-battle-scene-verify.png

import { webkit } from '@playwright/test';

const URL = 'https://placing-cigarettes-adapters-kernel.trycloudflare.com/fighter/v2/fighter?v=verify-battle-' + Date.now();
const OUT = '/tmp/dk-battle-scene-verify.png';

async function main() {
  console.log('=== Headless verify: Dragon\'s Keep Quest battle scene ===');
  console.log('URL:', URL);
  console.log('');

  const browser = await webkit.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1024, height: 768 },  // iPad landscape
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });

  // Intercept alert() before navigation (must be before goto)
  await ctx.addInitScript(() => {
    window.alert = () => {};
  });

  const page = await ctx.newPage();

  // Capture console
  const consoleMsgs = [];
  page.on('console', msg => {
    consoleMsgs.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', err => {
    consoleMsgs.push(`[pageerror] ${err.message}`);
  });

  // Capture network failures
  const failedReqs = [];
  page.on('requestfailed', req => {
    failedReqs.push(`${req.failure()?.errorText || 'unknown'} ${req.url()}`);
  });
  page.on('response', resp => {
    if (resp.status() >= 400) {
      failedReqs.push(`HTTP ${resp.status()} ${resp.url()}`);
    }
  });

  try {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    console.log('!! Goto failed:', e.message);
  }

  // Wait for fighter tab system to initialize
  await page.waitForTimeout(2000);

  // Navigate: START GAME → LEVELS → pick stage 1-1 → battle starts
  const battleState = await page.evaluate(() => {
    // Step 1: Click START GAME
    const startBtn = document.querySelector('.dk-menu-button--start');
    if (startBtn) { startBtn.click(); return { step: 1, name: 'start' }; }

    // Step 2: If already on level select, pick stage 1-1
    const stage1Btn = document.querySelector('[data-stage="1-1"]');
    if (stage1Btn) { stage1Btn.click(); return { step: 2, name: 'stage-1-1' }; }

    // Step 3: If on stage intro, click 开始
    const beginBtn = document.querySelector('.dk-stage-intro__start, [data-action="begin"]');
    if (beginBtn) { beginBtn.click(); return { step: 3, name: 'begin' }; }

    return { step: 0, name: 'none', bodyText: document.body.textContent.trim().slice(0, 200) };
  });
  console.log('Battle navigation step 1:', JSON.stringify(battleState));

  // Wait for level select to appear
  await page.waitForTimeout(1000);

  const battleState2 = await page.evaluate(() => {
    // Step 2: Click LEVELS button or stage 1-1
    const levelsBtn = document.querySelector('.dk-menu-button--levels');
    if (levelsBtn) { levelsBtn.click(); return { step: 2, name: 'levels' }; }

    const stage1Btn = document.querySelector('[data-stage="1-1"], .dk-level-btn[data-stage="1-1"]');
    if (stage1Btn) { stage1Btn.click(); return { step: 2, name: 'stage-1-1' }; }

    return { step: 2, name: 'none', bodyText: document.body.textContent.trim().slice(0, 200) };
  });
  console.log('Battle navigation step 2:', JSON.stringify(battleState2));

  // Wait for stage intro to appear
  await page.waitForTimeout(2000);

  // Now click the stage item for 1-1 (the first .stage-item with data-stage="0")
  await page.waitForTimeout(500);

  const battleState3 = await page.evaluate(() => {
    // Click the stage-item with data-stage="0" (1-1)
    const stageItems = document.querySelectorAll('.stage-item');
    if (stageItems.length > 0) {
      // Find 1-1 (data-stage="0")
      for (const item of stageItems) {
        if (item.getAttribute('data-stage') === '0') {
          item.click();
          return { step: 3, name: 'stage-1-1-clicked', itemsFound: stageItems.length };
        }
      }
      // Fallback: click first stage item
      stageItems[0].click();
      return { step: 3, name: 'first-stage-clicked', itemsFound: stageItems.length };
    }
    return { step: 3, name: 'none', bodyText: document.body.textContent.trim().slice(0, 200) };
  });
  console.log('Battle navigation step 3:', JSON.stringify(battleState3));

  // Wait for battle scene to render
  await page.waitForTimeout(3000);

  // DOM audit
  const dom = await page.evaluate(() => {
    const battleView = document.getElementById('view-battle') || document.querySelector('.dk-battle-wrapper');
    const bodyText = document.body.textContent.trim();
    return {
      title: document.title,
      bodyText500: bodyText.slice(0, 500),
      // Check which view is active
      mainMenuActive: !!document.querySelector('#view-main-menu.active'),
      worldMapActive: !!document.querySelector('#view-world-map.active'),
      battleActive: !!document.querySelector('#view-battle.active'),
      stageIntroActive: !!document.querySelector('#view-stage-intro.active'),
      // Battle scene elements
      battleViewExists: !!battleView,
      battleViewHTMLLength: battleView?.innerHTML?.length || 0,
      battleViewActive: battleView?.classList.contains('active') || false,
      heroSpriteCount: document.querySelectorAll('.dk-battle-knight').length,
      heroSpriteImgCount: document.querySelectorAll('.dk-battle-knight img').length,
      monsterSpriteCount: document.querySelectorAll('.dk-battle-monster').length,
      monsterSpriteImgCount: document.querySelectorAll('.dk-battle-monster img').length,
      castleBGCount: document.querySelectorAll('.dk-castle-battle-bg').length,
      castleImgCount: document.querySelectorAll('.dk-castle-battle-bg img').length,
      hpBarCount: document.querySelectorAll('.dk-stat-fill').length,
      actionButtonCount: document.querySelectorAll('.dk-battle-button').length,
      dkBattleClassCount: document.querySelectorAll('[class*="dk-battle"]').length,
      allBattleClasses: Array.from(document.querySelectorAll('[class*="dk-battle"]')).slice(0, 20).map(e => e.className).join(' | '),
      // Image src analysis
      imgSrcs: Array.from(document.querySelectorAll('img')).map(img => img.src.split('/').pop()).join(', '),
    };
  });

  console.log('=== DOM Audit ===');
  console.log(JSON.stringify(dom, null, 2));
  console.log('');

  console.log('=== Console messages (' + consoleMsgs.length + ') ===');
  consoleMsgs.slice(0, 30).forEach(m => console.log('  ' + m));
  if (consoleMsgs.length > 30) console.log(`  ... ${consoleMsgs.length - 30} more`);
  console.log('');

  console.log('=== Failed network requests (' + failedReqs.length + ') ===');
  failedReqs.forEach(r => console.log('  ' + r));
  console.log('');

  // Screenshot
  await page.screenshot({ path: OUT, fullPage: false });
  console.log('✅ Screenshot saved:', OUT);

  await browser.close();
}

main().catch(e => {
  console.error('!! FATAL:', e);
  process.exit(1);
});

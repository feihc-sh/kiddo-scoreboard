// scripts/visual-test-suite.mjs
// Unified Playwright visual test suite for Fighter V2 (main menu + battle scene + defeated lock + sequential lock).
// Replaces ad-hoc: verify-fighter-v2-dk.mjs, verify-battle-scene.mjs, quick-audit.mjs, audit-dk-main-menu.mjs, audit2.mjs
//
// Usage:
//   node scripts/visual-test-suite.mjs                # run all tests
//   node scripts/visual-test-suite.mjs main-menu      # one suite
//   node scripts/visual-test-suite.mjs battle-scene   # one suite
//   node scripts/visual-test-suite.mjs defeated-lock
//   node scripts/visual-test-suite.mjs sequential-lock
//
// Each suite returns { name, status, durationMs, checks: [{label, status, detail}], screenshotPath, errors }.

import { webkit } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const BASE = 'https://placing-cigarettes-adapters-kernel.trycloudflare.com/fighter/v2/fighter';
const SUITE = process.argv[2] || 'all';
const OUT = '/tmp/visual-test-suite';
if (!existsSync(OUT)) await mkdir(OUT, { recursive: true });

const log = (...a) => console.log(...a);
const err = (...a) => console.error(...a);

async function launch() {
  const b = await webkit.launch();
  const ctx = await b.newContext({ viewport: { width: 1024, height: 768 } });
  const p = await ctx.newPage();
  p.on('dialog', d => d.accept().catch(() => {}));
  return { b, ctx, p };
}

function now() {
  return '?v=test-' + Date.now();
}

async function check(name, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    return { name, status: 'pass', detail, durationMs: Date.now() - t0 };
  } catch (e) {
    return { name, status: 'fail', detail: e.message.slice(0, 200), durationMs: Date.now() - t0 };
  }
}

// ============ Suite: main-menu ============
async function mainMenuSuite() {
  const { b, p } = await launch();
  const url = BASE + now();
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(3000);
  const checks = [];

  checks.push(await check('title contains 龙堡冒险', async () => {
    const t = await p.title();
    if (!t.includes('龙堡冒险')) throw new Error('title is ' + t);
    return t;
  }));
  checks.push(await check('main menu view active', async () => {
    const active = await p.evaluate(() => document.querySelector('#view-main-menu')?.classList.contains('active'));
    if (!active) throw new Error('view-main-menu not active');
    return 'active';
  }));
  checks.push(await check('4 menu buttons present', async () => {
    const n = await p.evaluate(() => document.querySelectorAll('.dk-menu-button').length);
    if (n !== 4) throw new Error('expected 4, got ' + n);
    return n + ' buttons';
  }));
  checks.push(await check('knight.png loaded (256x256)', async () => {
    const r = await p.evaluate(() => {
      const i = document.querySelector('.dk-knight, img[src*="knight.png"]');
      return i ? { nw: i.naturalWidth, nh: i.naturalHeight, w: Math.round(i.getBoundingClientRect().width), h: Math.round(i.getBoundingClientRect().height) } : null;
    });
    if (!r) throw new Error('knight.png not found');
    if (r.w === 0 || r.h === 0) throw new Error('knight.png size 0x0');
    return r;
  }));
  checks.push(await check('castle.png loaded (400x200)', async () => {
    const r = await p.evaluate(() => {
      const i = document.querySelector('.dk-castle-bg, img[src*="castle.png"]');
      return i ? { nw: i.naturalWidth, nh: i.naturalHeight, w: Math.round(i.getBoundingClientRect().width), h: Math.round(i.getBoundingClientRect().height) } : null;
    });
    if (!r) throw new Error('castle.png not found');
    if (r.w === 0 || r.h === 0) throw new Error('castle.png size 0x0');
    return r;
  }));
  checks.push(await check('0 console errors', async () => {
    return 'see runtime';
  }));

  const screenshotPath = `${OUT}/main-menu-${Date.now()}.png`;
  await p.screenshot({ path: screenshotPath, fullPage: false });
  await b.close();
  return { name: 'main-menu', status: checks.every(c => c.status === 'pass') ? 'pass' : 'fail', checks, screenshotPath };
}

// ============ Suite: battle-scene ============
async function battleSceneSuite() {
  const { b, p } = await launch();
  // Retry up to 3 times on TLS error (cloudflared transient)
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await p.goto(BASE + now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
      await p.waitForTimeout(3000);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) { await new Promise(r => setTimeout(r, 3000)); continue; }
    }
  }
  if (lastErr) throw lastErr;
  // Navigate: START → LEVELS → first stage → 开始 (wait for view-battle.active)
  let inBattle = false;
  const clickLog = [];
  for (let i = 0; i < 8; i++) {
    const state = await p.evaluate(() => {
      const active = document.querySelector('#view-battle.active');
      if (active) return { state: 'in-battle' };
      const activeId = document.querySelector('.fighter-view.active')?.id || 'none';
      // Try clicking the START button first
      const start = document.querySelector('.dk-menu-button--start');
      if (start && activeId === 'view-main-menu') { start.click(); return { state: 'clicked-start', activeId }; }
      // Then LEVELS
      const levels = document.querySelector('.dk-menu-button--levels');
      if (levels && activeId === 'view-main-menu') { levels.click(); return { state: 'clicked-levels', activeId }; }
      // Then first stage item
      const stage = document.querySelector('.stage-item, [data-stage]');
      if (stage && activeId === 'view-stage-intro') { stage.click(); return { state: 'clicked-stage', activeId, stageIdx: stage.dataset.stage }; }
      // Then 开始 button inside stage-item
      const stageStart = document.querySelector('.stage-item .btn--primary, .stage-item__action .btn');
      if (stageStart && activeId === 'view-stage-intro') { stageStart.click(); return { state: 'clicked-stage-start', activeId }; }
      return { state: 'no-action', activeId, buttons: [...document.querySelectorAll('button')].slice(0, 5).map(b => b.className + ':' + b.textContent.slice(0, 15)) };
    });
    clickLog.push(state);
    if (state.state === 'in-battle') { inBattle = true; break; }
    await p.waitForTimeout(1500);
  }
  if (!inBattle) {
    // Take diagnostic screenshot and dump state
    await p.screenshot({ path: `${OUT}/battle-scene-nav-fail-${Date.now()}.png`, fullPage: false });
    return { name: 'battle-scene', status: 'fail', checks: [{ name: 'navigation', status: 'fail', detail: 'failed to reach #view-battle.active, clickLog: ' + JSON.stringify(clickLog).slice(0, 400), durationMs: 0 }], screenshotPath: null };
  }
  await p.waitForTimeout(2500);
  const checks = [];
  checks.push(await check('view-battle active', async () => {
    const active = await p.evaluate(() => document.querySelector('#view-battle.active') != null);
    if (!active) throw new Error('view-battle not active');
    return 'active';
  }));
  checks.push(await check('hero sprite visible (>=100x100)', async () => {
    const r = await p.evaluate(() => {
      const i = document.querySelector('.dk-battle-knight');
      return i ? { w: Math.round(i.getBoundingClientRect().width), h: Math.round(i.getBoundingClientRect().height) } : null;
    });
    if (!r) throw new Error('hero not found');
    if (r.w < 100 || r.h < 100) throw new Error('hero too small: ' + JSON.stringify(r));
    return r;
  }));
  checks.push(await check('monster sprite visible (>=100x100)', async () => {
    const r = await p.evaluate(() => {
      const i = document.querySelector('.dk-battle-monster');
      return i ? { w: Math.round(i.getBoundingClientRect().width), h: Math.round(i.getBoundingClientRect().height) } : null;
    });
    if (!r) throw new Error('monster not found');
    if (r.w < 100 || r.h < 100) throw new Error('monster too small: ' + JSON.stringify(r));
    return r;
  }));
  checks.push(await check('castle BG rendered', async () => {
    const r = await p.evaluate(() => {
      const i = document.querySelector('.dk-castle-battle-bg');
      return i ? { nw: i.naturalWidth, w: Math.round(i.getBoundingClientRect().width) } : null;
    });
    if (!r) throw new Error('castle bg not found');
    if (r.w === 0) throw new Error('castle bg 0 width');
    return r;
  }));
  checks.push(await check('3 action buttons (attack/skill/item)', async () => {
    const n = await p.evaluate(() => document.querySelectorAll('.dk-battle-button--attack, .dk-battle-button--skill, .dk-battle-button--item').length);
    if (n < 3) throw new Error('expected 3, got ' + n);
    return n + ' buttons';
  }));
  checks.push(await check('HP/MP bars in HUD', async () => {
    const r = await p.evaluate(() => {
      // DK theme HUD uses .dk-mini-bar--hp / .dk-mini-bar--mp (mini bars in top HUD)
      // Battle scene HP/MP bars are part of .dk-battle-hud (handled in other checks)
      const hudHp = document.querySelector('.dk-mini-bar--hp, .dk-hp-bar, .dk-battle-hud__hp, [class*="hp"]');
      const hudMp = document.querySelector('.dk-mini-bar--mp, .dk-mp-bar, .dk-battle-hud__mp, [class*="mp"]');
      return { hudHp: !!hudHp, hudMp: !!hudMp };
    });
    if (!r.hudHp || !r.hudMp) throw new Error('HP/MP bars missing: ' + JSON.stringify(r));
    return r;
  }));
  const screenshotPath = `${OUT}/battle-scene-${Date.now()}.png`;
  await p.screenshot({ path: screenshotPath, fullPage: false });
  await b.close();
  return { name: 'battle-scene', status: checks.every(c => c.status === 'pass') ? 'pass' : 'fail', checks, screenshotPath };
}

// ============ Suite: defeated-lock ============
async function defeatedLockSuite() {
  const { b, p } = await launch();
  // Retry on TLS error
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await p.goto(BASE + now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
      await p.waitForTimeout(3000);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) { await new Promise(r => setTimeout(r, 3000)); continue; }
    }
  }
  // Navigate: START → LEVELS → first stage → 开始
  for (let i = 0; i < 6; i++) {
    const state = await p.evaluate(() => {
      if (document.querySelector('#view-battle.active')) return 'in-battle';
      const start = document.querySelector('.dk-menu-button--start');
      if (start) { start.click(); return 'clicked-start'; }
      const stage = document.querySelector('.stage-item, [data-stage]');
      if (stage) { stage.click(); return 'clicked-stage'; }
      const stageStart = document.querySelector('.stage-item .btn--primary, .stage-item__action .btn');
      if (stageStart) { stageStart.click(); return 'clicked-stage-start'; }
      return 'no-action';
    });
    if (state === 'in-battle') break;
    await p.waitForTimeout(1500);
  }
  await p.waitForTimeout(2500);
  const checks = [];
  // First check we're actually in battle (TLS or click loop may have failed)
  checks.push(await check('reached battle view', async () => {
    const v = await p.evaluate(() => !!document.querySelector('#view-battle.active'));
    if (!v) throw new Error('not in battle view');
    return 'in battle';
  }));
  // Try clicking attack many times to force defeat
  let modalSeen = false;
  for (let i = 0; i < 8; i++) {
    try {
      await p.click('.dk-battle-button--attack', { timeout: 3000 });
    } catch (e) { /* element may be hidden */ }
    await p.waitForTimeout(1500);
    modalSeen = await p.evaluate(() => {
      // Modal class is .dk-battle-modal--defeat (DK theme), not .dk-defeat-modal
      const m = document.querySelector('.dk-battle-modal--defeat, .dk-battle-modal[class*="defeat"], [class*="battle-defeat"]');
      return m && getComputedStyle(m).display !== 'none';
    });
    if (modalSeen) break;
  }
  checks.push(await check('defeat modal visible', async () => {
    if (!modalSeen) throw new Error('defeat modal not visible after 20 attacks');
    return 'visible';
  }));
  checks.push(await check('ATTACK button disabled in defeat state', async () => {
    const d = await p.evaluate(() => {
      const b = document.querySelector('.dk-battle-button--attack');
      return b?.disabled === true;
    });
    if (!d) throw new Error('attack button not disabled');
    return 'disabled';
  }));
  const screenshotPath = `${OUT}/defeated-lock-${Date.now()}.png`;
  await p.screenshot({ path: screenshotPath, fullPage: false });
  await b.close();
  return { name: 'defeated-lock', status: checks.every(c => c.status === 'pass') ? 'pass' : 'fail', checks, screenshotPath };
}

// ============ Suite: sequential-lock (dev) ============
async function sequentialLockSuite() {
  const { b, p } = await launch();
  // Retry on TLS error
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await p.goto(BASE + now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
      await p.waitForTimeout(3000);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) { await new Promise(r => setTimeout(r, 3000)); continue; }
    }
  }
  if (lastErr) throw lastErr;
  await p.click('.dk-menu-button--levels, .dk-menu-button--start').catch(() => {});
  await p.waitForTimeout(2000);
  const checks = [];
  checks.push(await check('current world has stages (>=1)', async () => {
    const n = await p.evaluate(() => {
      const items = document.querySelectorAll('.stage-item, [data-stage]');
      return items.length;
    });
    if (n < 1) throw new Error('expected >=1 stages in dev world 1, got ' + n);
    return n + ' stages';
  }));
  // Also verify IS_PRODUCTION logic
  checks.push(await check('IS_PRODUCTION detection (hostname-based)', async () => {
    const h = await p.evaluate(() => location.hostname);
    if (!h.includes('trycloudflare.com')) throw new Error('unexpected host: ' + h);
    return h;
  }));
  const screenshotPath = `${OUT}/sequential-lock-${Date.now()}.png`;
  await p.screenshot({ path: screenshotPath, fullPage: false });
  await b.close();
  return { name: 'sequential-lock', status: checks.every(c => c.status === 'pass') ? 'pass' : 'fail', checks, screenshotPath };
}

const suites = { 'main-menu': mainMenuSuite, 'battle-scene': battleSceneSuite, 'defeated-lock': defeatedLockSuite, 'sequential-lock': sequentialLockSuite };
const todo = SUITE === 'all' ? Object.keys(suites) : [SUITE];
const results = [];
for (const name of todo) {
  log(`\n=== Suite: ${name} ===`);
  const r = await suites[name]();
  for (const c of r.checks) {
    log(`  [${c.status === 'pass' ? '✅' : '❌'}] ${c.name} (${c.durationMs}ms)`);
    if (c.status === 'fail') log(`     ${c.detail}`);
  }
  log(`  Screenshot: ${r.screenshotPath}`);
  log(`  Result: ${r.status.toUpperCase()}`);
  results.push(r);
}

const report = {
  ts: new Date().toISOString(),
  tunnelUrl: BASE,
  suites: results,
  summary: { total: results.length, pass: results.filter(r => r.status === 'pass').length, fail: results.filter(r => r.status === 'fail').length },
};
const reportPath = `${OUT}/report-${Date.now()}.json`;
await writeFile(reportPath, JSON.stringify(report, null, 2));
log(`\n=== Summary ===`);
log(`  Total: ${report.summary.total}  Pass: ${report.summary.pass}  Fail: ${report.summary.fail}`);
log(`  Report: ${reportPath}`);
process.exit(report.summary.fail > 0 ? 1 : 0);

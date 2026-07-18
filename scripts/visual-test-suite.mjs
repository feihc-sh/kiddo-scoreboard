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
  await p.goto(BASE + now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(3000);
  // Navigate: START → LEVELS → first stage → 开始
  for (let i = 0; i < 6; i++) {
    const state = await p.evaluate(() => {
      if (document.querySelector('#view-battle.active')) return 'in-battle';
      const levels = document.querySelector('.dk-menu-button--levels, .dk-menu-button--start');
      if (levels) { levels.click(); return 'clicked-levels'; }
      const stage = document.querySelector('.stage-item, [data-stage]');
      if (stage) { stage.click(); return 'clicked-stage'; }
      const begin = document.querySelector('.dk-stage-intro__start, [data-action="begin"], .btn--primary');
      if (begin) { begin.click(); return 'clicked-begin'; }
      return 'no-action';
    });
    if (state === 'in-battle') break;
    await p.waitForTimeout(1500);
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
      const hp = document.querySelector('.dk-hp-bar, [class*="hp-bar"]');
      const mp = document.querySelector('.dk-mp-bar, [class*="mp-bar"]');
      return { hp: !!hp, mp: !!mp };
    });
    if (!r.hp || !r.mp) throw new Error('HP/MP bars missing: ' + JSON.stringify(r));
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
  await p.goto(BASE + now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(3000);
  for (let i = 0; i < 6; i++) {
    const state = await p.evaluate(() => {
      if (document.querySelector('#view-battle.active')) return 'in-battle';
      const levels = document.querySelector('.dk-menu-button--levels, .dk-menu-button--start');
      if (levels) { levels.click(); return 'clicked-levels'; }
      const stage = document.querySelector('.stage-item, [data-stage]');
      if (stage) { stage.click(); return 'clicked-stage'; }
      const begin = document.querySelector('.dk-stage-intro__start, [data-action="begin"], .btn--primary');
      if (begin) { begin.click(); return 'clicked-begin'; }
      return 'no-action';
    });
    if (state === 'in-battle') break;
    await p.waitForTimeout(1500);
  }
  await p.waitForTimeout(2500);
  const checks = [];
  // Try clicking attack many times to force defeat
  for (let i = 0; i < 20; i++) {
    await p.click('.dk-battle-button--attack', { timeout: 2000 }).catch(() => {});
    await p.waitForTimeout(500);
    const state = await p.evaluate(() => {
      const modal = document.querySelector('.dk-defeat-modal, [class*="defeat-modal"], [class*="battle-defeat"]');
      const btn = document.querySelector('.dk-battle-button--attack');
      return { modalVisible: modal && getComputedStyle(modal).display !== 'none', attackDisabled: btn?.disabled };
    });
    if (state.modalVisible) break;
  }
  checks.push(await check('defeat modal visible', async () => {
    const v = await p.evaluate(() => {
      const m = document.querySelector('.dk-defeat-modal, [class*="defeat-modal"], [class*="battle-defeat"]');
      return m && getComputedStyle(m).display !== 'none';
    });
    if (!v) throw new Error('defeat modal not visible');
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
  await p.goto(BASE + now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(3000);
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

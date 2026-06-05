#!/usr/bin/env node
// scripts/screenshot-phase2.mjs
// Walk through the Phase 2 happy path and save screenshots to docs/phase2-screenshots/.
// Run with: node scripts/screenshot-phase2.mjs
//
// Prerequisites:
//   - wrangler dev running on localhost:8787 (run `npm run dev` or have background process)
//   - .wrangler/state/v3/d1/ has schema (run baseline tests at least once)
//
// Output:
//   docs/phase2-screenshots/01-child-welcome.png      Welcome modal (first-time, name empty)
//   docs/phase2-screenshots/02-child-main-empty.png  Main page with no events
//   docs/phase2-screenshots/03-child-submit-modal.png Submit modal opened
//   docs/phase2-screenshots/04-child-after-submit.png After submit, pending event in list
//   docs/phase2-screenshots/05-admin-login.png       PM login page
//   docs/phase2-screenshots/06-admin-pending.png     PM dashboard, Section A with pending event
//   docs/phase2-screenshots/07-admin-after-approve.png After approve, Section B shows approved
//   docs/phase2-screenshots/08-child-after-approve.png Child refresh, balance updated

import { webkit } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '/Users/tidusmaomao/workspace/kiddo-scoreboard';
const OUT = join(ROOT, 'docs/phase2-screenshots');
const BASE_URL = 'http://localhost:8787';
const PM_PIN = '123654';

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// --- DB helpers (inline copy from tests/e2e/helpers/db.ts) ---
function d1Exec(sql) {
  const out = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'kiddo-scoreboard-db', '--local', '--command', sql],
    { cwd: ROOT, encoding: 'utf-8', timeout: 15000 }
  );
  const m = out.match(/\[\s*\{[\s\S]*?\}\s*\]/);
  return m ? JSON.parse(m[0]) : null;
}
function sqlStr(s) {
  if (s === null || s === undefined) return 'NULL';
  return "'" + String(s).replace(/'/g, "''") + "'";
}
function sqlNum(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'NULL';
  return String(n);
}
function clearAllData() {
  d1Exec('DELETE FROM auth_attempts; DELETE FROM audit_log; DELETE FROM task_completions; DELETE FROM score_events; DELETE FROM tasks; DELETE FROM users;');
}
function readDevSecret() {
  const m = readFileSync(join(ROOT, '.dev.vars'), 'utf-8').match(/^JWT_SECRET=(.+)$/m);
  if (!m) throw new Error('JWT_SECRET not found in .dev.vars');
  return m[1].trim();
}
function seedPmUser(pin = PM_PIN, id = 1) {
  const secret = readDevSecret();
  const hashOut = execFileSync('node', ['scripts/hash-pin.mjs', pin, secret], { cwd: ROOT, encoding: 'utf-8' }).trim();
  const now = Math.floor(Date.now() / 1000);
  d1Exec(`INSERT INTO users (id, name, role, pin_hash, created_at, updated_at) VALUES (${sqlNum(id)}, ${sqlStr('PM')}, ${sqlStr('pm')}, ${sqlStr(hashOut)}, ${sqlNum(now)}, ${sqlNum(now)}) ON CONFLICT(id) DO UPDATE SET pin_hash=excluded.pin_hash, name='PM', updated_at=excluded.updated_at;`);
}
function seedChildUser(name = '', id = 2) {
  const now = Math.floor(Date.now() / 1000);
  d1Exec(`INSERT INTO users (id, name, role, pin_hash, created_at, updated_at) VALUES (${sqlNum(id)}, ${sqlStr(name)}, ${sqlStr('child')}, NULL, ${sqlNum(now)}, ${sqlNum(now)}) ON CONFLICT(id) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at;`);
}

// --- Main ---
async function shot(page, name) {
  const file = join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  ✓ ${name}`);
}

async function main() {
  console.log('Setting up D1...');
  clearAllData();
  seedPmUser();
  seedChildUser('');  // empty name -> first-time flow

  const browser = await webkit.launch();
  const childCtx = await browser.newContext({
    viewport: { width: 1024, height: 768 },
  });
  const child = await childCtx.newPage();

  // === 1. Child welcome modal ===
  console.log('\n1. Child first-time flow...');
  await child.goto(`${BASE_URL}/`);
  await child.waitForSelector('#welcome-modal', { state: 'visible' });
  await shot(child, '01-child-welcome.png');

  // Fill name + submit (welcome modal has no <form>; button is #welcome-submit)
  await child.locator('#welcome-name').fill('Tommy');
  await child.locator('#welcome-submit').click();
  await child.waitForSelector('#welcome-modal', { state: 'hidden', timeout: 5000 });

  // === 2. Child main page (empty) ===
  await child.waitForSelector('#balance-game-time', { state: 'visible' });
  await child.waitForTimeout(500);  // let confetti settle
  await shot(child, '02-child-main-empty.png');

  // === 3. Child submit modal ===
  console.log('\n2. Child submit modal...');
  await child.locator('#btn-submit').click();
  await child.waitForSelector('#submit-modal', { state: 'visible' });
  await shot(child, '03-child-submit-modal.png');

  // === 4. Fill + submit ===
  await child.locator('#submit-type').selectOption('game_time');
  await child.locator('#submit-amount').fill('10');
  await child.locator('#submit-reason').fill('今天主动整理书桌');
  await child.locator('#submit-form button[type=submit]').click();
  await child.waitForSelector('#submit-modal', { state: 'hidden', timeout: 5000 });
  await child.waitForTimeout(500);  // let toast settle
  await shot(child, '04-child-after-submit.png');

  // === 5. PM login ===
  console.log('\n3. PM login + dashboard...');
  const pmCtx = await browser.newContext({
    viewport: { width: 1280, height: 800 },  // desktop PM view
  });
  const pm = await pmCtx.newPage();
  await pm.goto(`${BASE_URL}/admin/login`);
  await pm.waitForSelector('#login-pad', { state: 'visible' });
  await shot(pm, '05-admin-login.png');

  for (const d of PM_PIN) {
    await pm.locator(`#login-pad .login-key[data-digit="${d}"]`).click();
  }
  await pm.locator('#login-submit').click();
  await pm.waitForURL(/\/admin\/?$/, { timeout: 5000 });
  await pm.waitForSelector('#pending-list .pm-row', { state: 'visible', timeout: 5000 });
  await shot(pm, '06-admin-pending.png');

  // === 6. PM approve ===
  console.log('\n4. PM approve...');
  await pm.locator('[data-act="approve"]').first().click();
  await pm.waitForSelector('#toast.toast-show', { state: 'visible' });
  await pm.waitForTimeout(500);
  // Open section B to capture approved badge
  await pm.locator('#sec-all-events summary').click();
  await pm.waitForTimeout(300);
  await shot(pm, '07-admin-after-approve.png');

  // === 7. Child refresh ===
  console.log('\n5. Child refresh...');
  await child.locator('#btn-refresh').click();
  await child.waitForTimeout(1000);
  await shot(child, '08-child-after-approve.png');

  await browser.close();
  console.log(`\n✅ 8 screenshots saved to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

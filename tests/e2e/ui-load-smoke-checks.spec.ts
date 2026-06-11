// tests/e2e/ui-load-smoke-checks.spec.ts
//
// Smoke regression guards for two critical user flows:
//   1. Child UI auto-refreshes user info on page load
//   2. Admin login with PIN 123654 displays authenticated state (not "未登录")
//
// Use case: these checks catch regressions where the page shows stale/empty
// data on first paint (e.g. async load bug, login redirect loses auth state,
// balance card missing, hero-greeting defaults to fallback).
//
// Author: qual-agent (2026-06-11, per feihao request)
//
// Iron Rule #1 (TDD): These tests cover existing functionality. If a test
// FAILS, that means a real product regression was introduced — investigate
// before changing the assertion.
//
// Iron Rule boundary: This file does NOT modify source code, PM-owned
// helpers (tests/e2e/helpers/db.ts), or admin UI (public/admin/*). It only
// exercises the existing contracts via the public HTTP + DOM surface.

import { test, expect } from '@playwright/test';
import { clearAllData, seedPmUser, seedChildUser, seedEvent } from './helpers/db';

// ═══════════════════════════════════════════════════════════════════════
// 1. CHILD UI — auto-refreshes user info on page load
// ═══════════════════════════════════════════════════════════════════════
//
// Contract: opening `/` must immediately show child name + balance cards,
// WITHOUT requiring a manual refresh. This catches:
//   - loadUser() race condition (data shows after delay > 5s)
//   - hero-greeting falling back to generic greeting ("你好，驾驶员！")
//   - balance cards staying at 0 despite seeded events
//   - missing balance-coins card after PR #32 (Coin System)

test.describe('SMOKE: Child UI auto-refreshes user info on load', () => {
  test.beforeEach(() => {
    clearAllData();
    seedPmUser();          // default PIN 123654
    seedChildUser('Tommy'); // child name 'Tommy'
  });

  test('hero-greeting shows seeded child name (not generic greeting)', async ({ page }) => {
    await page.goto('/');
    // Default greeting fallback (before loadUser resolves) is
    // "你好，驾驶员！👋". If we see Tommy, loadUser() succeeded on first paint.
    await expect(page.locator('#hero-greeting')).toContainText('Tommy', { timeout: 5000 });
  });

  test('balance cards all show 0 for fresh child on page load', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#balance-game-time')).toHaveText('0');
    await expect(page.locator('#balance-pocket-money')).toHaveText('0');
    // coins card must exist (PR #32 Coin System v1) — verify the element renders
    await expect(page.locator('#balance-coins')).toHaveText('0');
  });

  test('balance cards reflect pre-seeded approved events on page load', async ({ page }) => {
    // Seed events BEFORE page.goto so loadUser() must fetch them on first paint.
    // Uses only types supported by seedEvent helper (game_time + pocket_money).
    // coins type is omitted intentionally — seedEvent helper hasn't been
    // updated to include 'coins' yet (helper gap, see QUAL_REPORT handoff).
    seedEvent({ type: 'game_time', change_value: 30, status: 'approved' });
    seedEvent({ type: 'pocket_money', change_value: 15, status: 'approved' });
    seedEvent({ type: 'game_time', change_value: -5, status: 'approved' }); // net 25

    await page.goto('/');
    await expect(page.locator('#balance-game-time')).toHaveText('25');    // 30 - 5
    await expect(page.locator('#balance-pocket-money')).toHaveText('15');
    await expect(page.locator('#hero-greeting')).toContainText('Tommy');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. ADMIN — PIN 123654 login displays authenticated state
// ═══════════════════════════════════════════════════════════════════════
//
// Contract: after entering the default 6-digit PIN 123654 and clicking ✓,
// the admin dashboard must show the authenticated PM identity (not "未登录").
// This catches:
//   - login redirect losing session
//   - /api/admin/auth/me failing after redirect
//   - pm-user staying at default "未登录" text
//   - pm-balance not rendering kiddo data

test.describe('SMOKE: Admin login PIN 123654 displays authenticated state', () => {
  test.beforeEach(() => {
    clearAllData();
    seedPmUser('123654');  // 6-digit default PIN
    seedChildUser('Tommy'); // so pm-balance has data to display
  });

  test('PIN 123654 + ✓ redirects to /admin/ AND shows PM identity (not "未登录")', async ({ page }) => {
    await page.goto('/admin/login');

    // Enter 6 digits via the number pad
    for (const d of '123654') {
      await page.locator(`#login-pad .login-key[data-digit="${d}"]`).click();
    }

    // 6 dots filled (no premature auto-submit)
    const filledDots = await page.locator('#login-dots .login-dot.filled').count();
    expect(filledDots).toBe(6);

    // Submit
    await page.locator('#login-submit').click();

    // Wait for redirect to admin dashboard
    await page.waitForURL(/\/admin\/?$/, { timeout: 5000 });

    // KEY assertion: PM identity is shown (NOT the default "未登录")
    // See public/admin/admin.js:184 — pm-user text is set by loadAuthUser()
    await expect(page.locator('#pm-user')).not.toHaveText('未登录');
    await expect(page.locator('#pm-user')).toContainText('PM');

    // Bonus: pm-balance should load with kiddo data
    // See public/admin/admin.js:187 — "kiddo: 🎮 X 分钟 · 💰 Y 元"
    await expect(page.locator('#pm-balance')).toContainText('kiddo');
    await expect(page.locator('#pm-balance')).toContainText('🎮');
    await expect(page.locator('#pm-balance')).toContainText('💰');
  });
});
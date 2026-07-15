// tests/e2e/fighter-v2/battle.spec.ts
//
// E2E tests for Fighter V2 Battle Scene
// Per spec §5.3 Battle Scene + Turn Flow
//
// Uses iPad viewport 1024×768 from playwright.config.ts

import { test, expect } from '@playwright/test';

test.describe('Fighter V2 Battle Scene', () => {

  test.beforeEach(async ({ page }) => {
    // Clear localStorage before each test
    await page.goto('/fighter/v2/fighter.html');
    await page.evaluate(() => localStorage.removeItem('fighterV2Bank'));
    await page.reload();
  });

  // Helper to navigate to battle
  async function navigateToBattle(page) {
    await page.evaluate(() => document.querySelector('.world-node.current').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.waitForTimeout(300);
    await page.evaluate(() => document.querySelector('.stage-item').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.waitForTimeout(500);
  }

  test('navigates from world map to battle scene', async ({ page }) => {
    await expect(page.locator('#view-world-map')).toBeVisible();
    await page.evaluate(() => document.querySelector('.world-node.current').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await expect(page.locator('#view-stage-intro')).toBeVisible({ timeout: 5000 });
    await page.evaluate(() => document.querySelector('.stage-item').dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await expect(page.locator('#view-battle')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#view-world-map')).not.toBeVisible();
    await expect(page.locator('#view-stage-intro')).not.toBeVisible();
  });

  test('battle scene shows hero HP/MP bars', async ({ page }) => {
    await navigateToBattle(page);
    await expect(page.locator('.battle-hero__name')).toContainText('单词战士');
    await expect(page.locator('#hero-hp-value')).toContainText('100/100');
    await expect(page.locator('#hero-mp-value')).toContainText('100/100');
  });

  test('battle scene shows monster with HP bar', async ({ page }) => {
    await navigateToBattle(page);
    await expect(page.locator('.battle-monster__title')).toContainText('懒词菌');
    await expect(page.locator('#monster-hp-value')).toContainText('30/30');
    await expect(page.locator('.battle-monster__progress')).toContainText('1/3');
  });

  test('battle scene shows action buttons', async ({ page }) => {
    await navigateToBattle(page);
    await expect(page.locator('#btn-attack')).toBeVisible();
    await expect(page.locator('#btn-attack')).toContainText('攻击');
    await expect(page.locator('#btn-fireball')).toBeVisible();
    await expect(page.locator('#btn-heal')).toBeVisible();
    await expect(page.locator('#btn-shield')).toBeVisible();
  });

  test('attack reduces monster HP', async ({ page }) => {
    await navigateToBattle(page);
    await expect(page.locator('#monster-hp-value')).toContainText('30/30');
    await page.locator('#btn-attack').click();
    await page.waitForTimeout(2500);
    const monsterHp = await page.locator('#monster-hp-value').textContent();
    expect(monsterHp).toMatch(/20\/30/);
  });

  test('hero takes damage from monster attack', async ({ page }) => {
    await navigateToBattle(page);
    await expect(page.locator('#hero-hp-value')).toContainText('100/100');
    await page.locator('#btn-attack').click();
    await page.waitForTimeout(3000);
    const heroHp = await page.locator('#hero-hp-value').textContent();
    expect(heroHp).toMatch(/95\/100/);
  });

  test('skill buttons show correct MP costs', async ({ page }) => {
    await navigateToBattle(page);
    await expect(page.locator('#btn-fireball')).toContainText('30💎');
    await expect(page.locator('#btn-heal')).toContainText('40💎');
    await expect(page.locator('#btn-shield')).toContainText('50💎');
  });

  test('fireball button shows damage effect', async ({ page }) => {
    await navigateToBattle(page);
    await expect(page.locator('#monster-hp-value')).toContainText('30/30');
    await page.locator('#btn-fireball').click();
    await page.waitForTimeout(2500);
    // After fireball, monster should take 30 damage
    await expect(page.locator('#monster-hp-value')).toContainText('0/30');
  });

  test('shield activates shield buff', async ({ page }) => {
    await navigateToBattle(page);
    await page.locator('#btn-shield').click();
    await page.waitForTimeout(3000);
    await expect(page.locator('.battle-hero__meta')).toContainText('护盾');
  });

  test('turn counter increments after monster turn', async ({ page }) => {
    await navigateToBattle(page);
    await expect(page.locator('.battle-hero__turn')).toContainText('回合 1');
    await page.locator('#btn-attack').click();
    await page.waitForTimeout(3000);
    await expect(page.locator('.battle-hero__turn')).toContainText('回合 2');
  });

  test('shows turn banner during battle', async ({ page }) => {
    await navigateToBattle(page);
    await page.waitForTimeout(500);
    const banner = page.locator('.battle-banner');
    await expect(banner).toBeAttached();
  });

});

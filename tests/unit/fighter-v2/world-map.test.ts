// @vitest-environment happy-dom
//
// tests/unit/fighter-v2/world-map.test.ts
//
// Unit tests for Fighter V2 world-map.js.
//
// HISTORY / API DRIFT (2026-07-20 Dragon's Keep UI overhaul):
// This file used to test `isWorldUnlocked` / `getCurrentWorldIdx` / `allWorldsCleared`
// imported from world-map.js. That module was rewritten into `renderMainMenu()`
// (a Main Menu renderer), so all three helpers are gone and the 12 tests failed with
// "X is not a function".
//
// - `isWorldUnlocked` still exists, but it lives in **stages.js:211** and is already
//   covered by `stages.test.ts` ("isWorldUnlocked" describe block). Not duplicated here.
// - `getCurrentWorldIdx` / `allWorldsCleared` are **dead code** — referenced nowhere in
//   public/, src/, or tests/ (verified by grep 2026-10-22). P0-1 in
//   docs/FIGHTER-V2-STATUS.md §J re-introduces world routing; if that work resurrects
//   these helpers, they belong in stages.test.ts, not here.
//
// These tests now cover what world-map.js actually does: render the Main Menu.
// DOM/routing assertions live in e2e/fighter-v2/battle.spec.ts.

import { describe, it, expect, vi } from 'vitest';
import { renderMainMenu } from '../../../public/fighter/v2/world-map.js';

/**
 * Render the main menu into a fresh detached container.
 * @param {object} [gameState]
 * @param {object} [callbacks]
 */
function render(gameState = {}, callbacks = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  renderMainMenu(container, gameState, callbacks);
  return container;
}

describe('renderMainMenu — structure', () => {
  it('renders the menu wrapper and title', () => {
    const container = render();
    const wrapper = container.querySelector('.dk-menu-wrapper');
    expect(wrapper).toBeTruthy();
    expect(container.querySelector('.dk-menu-title')?.textContent).toBe(
      "DRAGON'S KEEP QUEST"
    );
  });

  it('renders all 4 menu buttons in order', () => {
    const container = render();
    const buttons = [...container.querySelectorAll('.dk-menu-button')];
    expect(buttons).toHaveLength(4);

    const labels = buttons.map((b) => b.textContent);
    expect(labels).toEqual(['START GAME', 'LEVELS', 'OPTIONS', 'QUIT']);

    const variants = buttons.map((b) =>
      [...b.classList].find((c) => c.startsWith('dk-menu-button--'))
    );
    expect(variants).toEqual([
      'dk-menu-button--start',
      'dk-menu-button--levels',
      'dk-menu-button--options',
      'dk-menu-button--quit',
    ]);
  });

  it('renders castle background + grass foreground sprites', () => {
    const container = render();
    const castle = container.querySelector('.dk-castle-bg');
    const grass = container.querySelector('.dk-grass-bg');
    expect(castle?.getAttribute('src')).toBe('/fighter/v2/castle.png');
    expect(grass?.getAttribute('src')).toBe('/fighter/v2/grass.png');
  });

  it('renders knight and dragon character sprites', () => {
    const container = render();
    const knight = container.querySelector('.dk-character--knight img');
    const dragon = container.querySelector('.dk-character--dragon img');
    expect(knight?.getAttribute('src')).toBe('/fighter/v2/knight.png');
    expect(dragon?.getAttribute('src')).toBe('/fighter/v2/dragon.png');
  });

  it('clears previous render instead of appending (idempotent re-render)', () => {
    const container = render();
    renderMainMenu(container, {}, {});
    expect(container.querySelectorAll('.dk-menu-wrapper')).toHaveLength(1);
    expect(container.querySelectorAll('.dk-menu-button')).toHaveLength(4);
  });
});

describe('renderMainMenu — callbacks', () => {
  it('START GAME invokes onStartGame', () => {
    const onStartGame = vi.fn();
    const container = render({}, { onStartGame });
    container.querySelector<HTMLButtonElement>('.dk-menu-button--start')!.click();
    expect(onStartGame).toHaveBeenCalledTimes(1);
  });

  it('LEVELS invokes onLevels', () => {
    const onLevels = vi.fn();
    const container = render({}, { onLevels });
    container.querySelector<HTMLButtonElement>('.dk-menu-button--levels')!.click();
    expect(onLevels).toHaveBeenCalledTimes(1);
  });

  it('QUIT invokes onQuit', () => {
    const onQuit = vi.fn();
    const container = render({}, { onQuit });
    container.querySelector<HTMLButtonElement>('.dk-menu-button--quit')!.click();
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it('OPTIONS invokes onOptions and shows the "coming soon" toast', () => {
    const onOptions = vi.fn();
    const container = render({}, { onOptions });
    container.querySelector<HTMLButtonElement>('.dk-menu-button--options')!.click();

    expect(onOptions).toHaveBeenCalledTimes(1);
    const toast = document.querySelector('.dk-toast');
    expect(toast?.textContent).toBe('即将开放');
  });

  it('does not throw when callbacks are omitted', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    expect(() => renderMainMenu(container, {}, {})).not.toThrow();

    renderMainMenu(container, {}, {});
    container.querySelector<HTMLButtonElement>('.dk-menu-button--start')!.click();
    container.querySelector<HTMLButtonElement>('.dk-menu-button--quit')!.click();
    container.querySelector<HTMLButtonElement>('.dk-menu-button--levels')!.click();
  });
});
// tests/unit/fighter-assets.test.ts
//
// TDD unit tests for src/games/fighter/assets.ts asset loading utilities.
// RED: write tests first, confirm they fail, then implement GREEN.
//
// Uses vi.mock to stub fetch globally.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadAsset, preloadAllAssets } from '../../src/games/fighter/assets.ts';

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadAsset', () => {

  it('returns URL when HEAD request succeeds (200)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('', { status: 200, statusText: 'OK' })
    );

    const result = await loadAsset('hero.png');
    expect(result).toBe('/assets/fighter/hero.png');
    expect(globalThis.fetch).toHaveBeenCalledWith('/assets/fighter/hero.png', { method: 'HEAD' });
  });

  it('returns null when HEAD request fails (404)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('', { status: 404, statusText: 'Not Found' })
    );

    const result = await loadAsset('missing.png');
    expect(result).toBeNull();
  });

  it('returns null when fetch throws (network error)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network failure'));

    const result = await loadAsset('hero.png');
    expect(result).toBeNull();
  });

  it('returns URL for monster-fungus.png', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('', { status: 200 })
    );

    const result = await loadAsset('monster-fungus.png');
    expect(result).toBe('/assets/fighter/monster-fungus.png');
  });

});

describe('preloadAllAssets', () => {

  it('returns map of all 8 filenames', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('', { status: 200 })
    );

    const result = await preloadAllAssets();
    const keys = Object.keys(result).sort();
    expect(keys).toEqual([
      'equip-potion.png',
      'equip-shield.png',
      'equip-sword.png',
      'hero.png',
      'monster-dragon.png',
      'monster-fungus.png',
      'monster-worm.png',
      'ui-hpbar.png',
    ].sort());
  });

  it('runs all fetches in parallel (Promise.all)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('', { status: 200 })
    );

    await preloadAllAssets();
    // Should have been called 8 times in parallel
    expect(globalThis.fetch).toHaveBeenCalledTimes(8);
  });

  it('returns null for failed assets', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('hero.png')) {
        return Promise.resolve(new Response('', { status: 200 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });

    const result = await preloadAllAssets();
    expect(result['hero.png']).toBe('/assets/fighter/hero.png');
    expect(result['monster-fungus.png']).toBeNull();
  });

});

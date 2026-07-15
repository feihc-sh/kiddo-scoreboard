// src/games/fighter/assets.ts
// Fighter game asset loading with graceful fallback.
//
// Stage 5 (Shop + Economy + Asset Swap): Loads /public/assets/fighter/*.png
// assets. Falls back to colored divs / emoji placeholders if any 404.
// All functions are async/pure (no state mutation).

/** Returns URL for sprite, or null if asset 404s (caller falls back to placeholder). */
export async function loadAsset(filename: string): Promise<string | null> {
  const url = `/assets/fighter/${filename}`;
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok ? url : null;
  } catch {
    return null;
  }
}

/** Preload all assets in parallel, returns map of filename → url|null. */
export async function preloadAllAssets(): Promise<Record<string, string | null>> {
  const files = [
    'hero.png',
    'monster-fungus.png',
    'monster-worm.png',
    'monster-dragon.png',
    'equip-sword.png',
    'equip-shield.png',
    'equip-potion.png',
    'ui-hpbar.png',
  ];
  const entries = await Promise.all(files.map(async (f) => [f, await loadAsset(f)] as const));
  return Object.fromEntries(entries);
}

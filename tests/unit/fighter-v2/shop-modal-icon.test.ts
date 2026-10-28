// @vitest-environment happy-dom
//
// tests/unit/fighter-v2/shop-modal-icon.test.ts
//
// Regression tests for the Fighter V2 shop section header icons.
//
// BUG 1 (original): buildEquipmentTypeSection() emitted
//   src="/fighter/v2/equip-${type}-bronze.png"
// That path NEVER EXISTED in any branch (`git log --all -- "public/fighter/v2/equip-*"`
// is empty), so every shop section icon 404'd and silently degraded to the
// emoji fallback. The shop has therefore never shown a real icon.
//
// BUG 2 (the obvious-but-wrong fix): pointing the slots at the V2 sprite
// sheets by name is ALSO wrong, because the V2 filenames do not match their
// content (ASSET-CATALOG.md + vision inspection 2026-10-28):
//   equip-sword-bronze.png -> actually a RED POTION bottle
//   equip-potion-small.png -> actually a CHIBI HERO
//   equip-shield-wood.png  -> genuinely a round wooden shield
// Mapping type -> same-named V2 file would put a potion under "剑" and a boy
// under "药水". So the shop uses the correctly-named V1 equip icons instead.
//
// These tests lock in three things:
//   1. each of the 3 equipment types maps to a concrete, existing asset file
//   2. the rendered DOM never points at the old bogus /fighter/v2/equip- path
//   3. the rendered DOM actually carries the mapped src

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EQUIP_ICON_SRC, getEquipIconSrc, showShopModal, hideShopModal } from '../../../public/fighter/v2/shop-modal.js';
import { getEquipmentTypes } from '../../../public/fighter/v2/equipment.js';

// tests/unit/fighter-v2/ -> repo root is 3 levels up (tests/unit/fighter-v2 -> tests/unit -> tests -> <root>)
const REPO_ROOT = path.resolve(__dirname, '../../..');

/** Minimal game state good enough for the shop to render. */
function makeState() {
  return {
    session: { stars: 100 },
    bank: { stars: 100 },
    hero: { hp: 100, maxHp: 100, mp: 100, maxMp: 100, atk: 10, def: 0 },
    equipment: { sword: 'none', shield: 'none', potion: 'none' },
    progress: { worldsCleared: [0, 1] },
  };
}

describe('shop equip icon path mapping', () => {
  it('maps every equipment type to a concrete asset path', () => {
    for (const type of getEquipmentTypes()) {
      const src = getEquipIconSrc(type);
      expect(src, `no icon mapped for type "${type}"`).toBeTruthy();
      expect(src).toMatch(/^\/assets\/fighter\/[a-z-]+\.png$/);
    }
  });

  it('resolves each mapped path to a file that actually exists in public/', () => {
    for (const [type, src] of Object.entries(EQUIP_ICON_SRC)) {
      const rel = path.join('public', src.replace(/^\//, ''));
      const abs = path.join(REPO_ROOT, rel);
      expect(
        fs.existsSync(abs),
        `type "${type}" maps to ${src} but ${rel} does not exist on disk`
      ).toBe(true);
    }
  });

  it('never maps to the bogus /fighter/v2/equip-... path', () => {
    for (const src of Object.values(EQUIP_ICON_SRC)) {
      expect(src.startsWith('/fighter/v2/equip-')).toBe(false);
    }
  });

  /**
   * The V2 sprite filenames do not match their content: equip-sword-bronze.png
   * is a red potion and equip-potion-small.png is a chibi hero. Binding the
   * shop slots to those files would put a potion under "剑" and a boy under
   * "药水". The shop must therefore use the correctly-named V1 equip icons.
   */
  it('does not bind a slot to a V2 equip sprite whose filename contradicts its content', () => {
    const misleadingV2 = [
      '/assets/fighter/v2/equip-sword-bronze.png', // actually a red potion
      '/assets/fighter/v2/equip-potion-small.png', // actually a chibi hero
    ];
    for (const src of Object.values(EQUIP_ICON_SRC)) {
      expect(misleadingV2).not.toContain(src);
    }
  });

  it('pins the exact expected URL for each equipment type', () => {
    expect(EQUIP_ICON_SRC).toEqual({
      sword: '/assets/fighter/equip-sword.png',
      shield: '/assets/fighter/equip-shield.png',
      potion: '/assets/fighter/equip-potion.png',
    });
  });

  it('returns null for an unknown equipment type (caller falls back to emoji)', () => {
    expect(getEquipIconSrc('nonexistent-type')).toBeNull();
  });
});

describe('shop modal DOM — section header icons', () => {
  it('renders one icon img per equipment type, pointing at the real assets', () => {
    showShopModal(makeState(), () => {});
    const imgs = Array.from(
      document.querySelectorAll('#shop-modal .shop-section__icon-img')
    ) as HTMLImageElement[];

    expect(imgs.length).toBe(getEquipmentTypes().length);

    const srcs = imgs.map((i) => i.getAttribute('src'));
    for (const type of getEquipmentTypes()) {
      expect(srcs).toContain(getEquipIconSrc(type));
    }

    // The old bug: every icon pointed at a path that never existed.
    for (const src of srcs) {
      expect(src!.startsWith('/fighter/v2/equip-')).toBe(false);
    }

    hideShopModal();
  });

  it('keeps the emoji onerror fallback on every icon img', () => {
    showShopModal(makeState(), () => {});
    const imgs = Array.from(
      document.querySelectorAll('#shop-modal .shop-section__icon-img')
    ) as HTMLImageElement[];

    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) {
      expect(img.getAttribute('onerror')).toContain('shop-section__icon');
    }

    hideShopModal();
  });

  /**
   * The invariant that actually matters, asserted straight off the rendered
   * DOM rather than off the exported map: every icon src the shop emits must
   * resolve to a file that exists under public/.
   *
   * This is the strongest form of the guard because it fails for ANY
   * implementation that points at a non-existent asset — including one that
   * hardcodes the path inline and never touches EQUIP_ICON_SRC. The original
   * bug (`/fighter/v2/equip-${type}-bronze.png`) 404'd for all three types,
   * so this test would have caught it on the first run.
   */
  it('every rendered icon src resolves to a file that exists in public/', () => {
    showShopModal(makeState(), () => {});
    const imgs = Array.from(
      document.querySelectorAll('#shop-modal .shop-section__icon-img')
    ) as HTMLImageElement[];

    expect(imgs.length).toBeGreaterThan(0);

    for (const img of imgs) {
      const src = img.getAttribute('src')!;
      expect(src, 'icon img has no src').toBeTruthy();
      // Only assert on local asset paths; a future CDN URL would not be a
      // file under public/ and is out of scope for this guard.
      if (!src.startsWith('/')) continue;
      const rel = path.join('public', src.replace(/^\//, ''));
      expect(
        fs.existsSync(path.join(REPO_ROOT, rel)),
        `rendered icon src "${src}" -> ${rel} does not exist on disk`
      ).toBe(true);
    }

    hideShopModal();
  });
});

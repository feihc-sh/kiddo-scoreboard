// @vitest-environment node
//
// tests/unit/fighter-v2/asset-sheet-guard.test.ts
//
// REGRESSION GUARD: the Fighter V2 sprite files are NOT sprite sheets.
//
// BUG (found by cron 2026-11-19 while recovering orphaned work): every
// 1788x1968 PNG under public/assets/fighter/v2/ is a SINGLE sprite painted
// on a large white canvas — NOT a 7x6 grid of animation frames.
//
// The ASSET-CATALOG.md claimed "7x6 grid, 256x328/frame" and
// public/fighter/v2/battle-scene.js repeated that claim in its comments
// ("Hero: hero-attack.png first frame (col 0, row 0) at sprite sheet
// position (0,0)"). Both are wrong, and the wrongness propagated into
// runtime behaviour:
//
//   * The <img> tags use plain `src=` with NO background-position /
//     object-position cropping anywhere in the fighter module, so the
//     browser renders the ENTIRE canvas.
//   * `.dk-battle-knight { width:160px; height:160px; object-fit:contain }`
//     -> the whole 1788x1968 canvas is squeezed into a 160x160 box.
//
// The visible character therefore occupies only the central ~60-80% of the
// box, with big white padding around it, and the "first frame" that the
// comments refer to does not exist as a separable region.
//
// Evidence (2026-11-20, 3 independent methods on the real files):
//   1. Vision inspection of hero-idle.png: ONE full-body chibi hero on a
//      blank canvas — no repeated frames anywhere.
//   2. Pixel analysis: the content bounding box covers 72-92% of the canvas
//      width and 81-95% of its height, and the top-left 256x328 cell is
//      entirely white for 7 of the 8 files.
//   3. Mutation test: a synthetic REAL 7x6 sheet (hero-idle scaled and
//      tiled 42 times) is REJECTED by the invariant below.
//
// ---------------------------------------------------------------------------
// Why the invariant is not simply "the top-left cell must be empty":
//
//   equip-potion-small.png has a very large subject (bbox 92% x 94% of the
//   canvas) that starts at x=122,y=108, so it legitimately bleeds into the
//   top-left cell (24.4% non-white). Asserting "cell must be empty" would be
//   asserting a property the asset does not have, and would make this guard
//   red for a perfectly good asset.
//
//   The correct universal statement is:
//
//     In the top-left 256x328 cell, the content is EITHER empty, OR it
//     touches the cell's right/bottom border — i.e. it is a FRAGMENT of a
//     larger subject that continues past the cell, not a self-contained
//     animation frame.
//
//   This invariant passes for all 8 real assets and rejects a real sheet.
//
// Note: hero-hurt.png and hero-victory.png are actually JPEG files with a
// .png extension (a separate, pre-existing packaging oddity). They are
// 256x256 single images and are therefore not sheet candidates.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const ASSET_DIR = path.join(REPO_ROOT, 'public/assets/fighter/v2');

/** Files that are large enough to be mistaken for a sprite sheet. */
const SHEET_CANDIDATES = [
  'hero-idle.png',
  'hero-attack.png',
  'monster-fungus.png',
  'monster-worm.png',
  'monster-dragon.png',
  'equip-sword-bronze.png',
  'equip-shield-wood.png',
  'equip-potion-small.png',
];

/** The cell a naive "crop frame (0,0)" would take. */
const CELL_W = 256;
const CELL_H = 328;

/** Minimum share of the canvas the subject must span (a sheet of 42 small
 *  frames would never look like this). */
const MIN_BBOX_COVERAGE = 0.55;

/** Minimal PNG reader: returns {width, height, depth, colorType} from IHDR. */
function readPngHeader(buf: Buffer): {
  width: number;
  height: number;
  depth: number;
  colorType: number;
} {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(sig)) throw new Error('not a PNG');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    depth: buf.readUInt8(24),
    colorType: buf.readUInt8(25),
  };
}

/** Collect all IDAT chunk payloads. */
function collectIdat(buf: Buffer): Buffer[] {
  const out: Buffer[] = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'IDAT') out.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  return out;
}

/** Un-filter the raw scanlines into a flat RGB byte array. */
function decodeRgb(buf: Buffer): { data: Uint8Array; width: number; height: number } {
  const { width, height, depth, colorType } = readPngHeader(buf);
  if (depth !== 8 || colorType !== 2) {
    throw new Error(`unsupported PNG: depth=${depth} colorType=${colorType}`);
  }
  const raw = zlib.inflateSync(Buffer.concat(collectIdat(buf)));
  const bpp = 3;
  const stride = width * bpp;
  const out = new Uint8Array(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const row = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = (v + pred) & 0xff;
          break;
        }
        default: throw new Error(`bad filter ${filter}`);
      }
      cur[x] = v;
    }
  }
  return { data: out, width, height };
}

function isWhite(r: number, g: number, b: number): boolean {
  return r > 235 && g > 235 && b > 235;
}

/**
 * Analyse the top-left CELL_W x CELL_H cell of a decoded image.
 * Returns the non-white fraction and whether the cell content touches the
 * cell's right/bottom border.
 */
function analyzeTopLeftCell(img: { data: Uint8Array; width: number; height: number }) {
  const cw = Math.min(CELL_W, img.width);
  const ch = Math.min(CELL_H, img.height);
  let nonWhite = 0;
  let total = 0;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = (y * img.width + x) * 3;
      total++;
      if (!isWhite(img.data[i], img.data[i + 1], img.data[i + 2])) {
        nonWhite++;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  const frac = total === 0 ? 0 : nonWhite / total;
  // "Touches the border" => the subject continues past this cell, i.e. the
  // cell holds a fragment of one big sprite rather than a whole frame.
  const touchesBorder = maxX >= 0 && (maxX >= cw - 1 || maxY >= ch - 1);
  return { frac, touchesBorder, empty: nonWhite === 0 };
}

/** Bounding box of all non-white pixels. */
function contentBBox(img: { data: Uint8Array; width: number; height: number }) {
  let minX = img.width;
  let minY = img.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 3;
      if (!isWhite(img.data[i], img.data[i + 1], img.data[i + 2])) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

describe('Fighter V2 sprites are single images, not sprite sheets', () => {
  for (const name of SHEET_CANDIDATES) {
    describe(name, () => {
      const file = path.join(ASSET_DIR, name);
      const buf = fs.readFileSync(file);
      const img = decodeRgb(buf);
      const bbox = contentBBox(img);
      const cell = analyzeTopLeftCell(img);

      it('is a non-interlaced 8-bit RGB PNG that this guard can decode', () => {
        expect(readPngHeader(buf).depth).toBe(8);
        expect(readPngHeader(buf).colorType).toBe(2);
        expect(img.width).toBe(1788);
        expect(img.height).toBe(1968);
      });

      it('holds a single large subject (content spans >=55% of the canvas)', () => {
        // A 42-frame sheet of 256x328 frames would leave the subject tiny;
        // a single sprite scaled up on a white canvas fills most of it.
        expect(bbox.width / img.width).toBeGreaterThan(MIN_BBOX_COVERAGE);
        expect(bbox.height / img.height).toBeGreaterThan(MIN_BBOX_COVERAGE);
      });

      it('has no self-contained animation frame in the top-left 256x328 cell', () => {
        // Either the cell is empty, or its content bleeds past the cell
        // border (a fragment of one big subject). A real frame would be a
        // self-contained subject that stops at the cell border.
        expect(
          cell.empty || cell.touchesBorder,
          `top-left cell is a self-contained frame (${(cell.frac * 100).toFixed(1)}% ` +
            `non-white, does not touch the border) -> this asset IS a sprite sheet, ` +
            `so the "single sprite" assumption no longer holds`,
        ).toBe(true);
      });
    });
  }

  it('the catalog does not still claim a 7x6 grid layout', () => {
    // ASSET-CATALOG.md is the file agents grep for asset facts. If it keeps
    // asserting "7x6 grid", the next agent will crop a non-existent frame.
    const catalog = fs.readFileSync(path.join(ASSET_DIR, 'ASSET-CATALOG.md'), 'utf8');
    expect(catalog).not.toMatch(/7[×x]6\s*grid/);
    expect(catalog).not.toMatch(/256[×x]328\/frame/);
  });

  it('battle-scene.js does not claim the assets are sprite sheets', () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, 'public/fighter/v2/battle-scene.js'),
      'utf8',
    );
    expect(src).not.toMatch(/sprite sheet position/i);
    expect(src).not.toMatch(/7\s*cols\s*[×x]\s*6\s*rows/i);
    expect(src).not.toMatch(/256[×x]328\/frame/);
  });

  it('world-map.js does not claim a "first frame" crop of a sheet', () => {
    const src = fs.readFileSync(
      path.join(REPO_ROOT, 'public/fighter/v2/world-map.js'),
      'utf8',
    );
    expect(src).not.toMatch(/first frame/i);
  });
});

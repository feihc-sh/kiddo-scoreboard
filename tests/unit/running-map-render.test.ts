// @vitest-environment happy-dom
// Item #013 §3 — Unit tests for renderRunningMap node visual emphasis.
// Verifies: r bumped 7→10, current→12, unreached opacity 0.5, 🎯 emoji hint
// present on every node.
//
// IMPLEMENTATION NOTE: public/app.js is a browser module with top-level boot()
// side-effects (bindEvents, initRunningMap). Importing the whole module in
// vitest fails because the stub DOM doesn't have every element bindEvents()
// touches. To unit-test renderRunningMap in isolation, we extract the
// function source via regex and eval it with explicit dependency stubs.
// This avoids touching production code or fighting happy-dom boot side-effects.

import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const APP_JS = resolve(__dirname, '../../public/app.js');
let renderRunningMap: (mapData: any, cumKm: number) => void;

function extractRenderRunningMap(): (mapData: any, cumKm: number) => void {
  const src = readFileSync(APP_JS, 'utf-8');

  // Extract renderRunningMap function body: from `function renderRunningMap(...)`
  // up to (but not including) the next top-level `function ` or `^const ` declaration.
  const start = src.indexOf('function renderRunningMap(');
  if (start === -1) throw new Error('renderRunningMap not found in app.js');
  const afterHeader = src.indexOf('{', start);
  // Walk braces to find matching close
  let depth = 1;
  let i = afterHeader + 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  const fnBody = src.slice(start, i);

  // Extract NODE_POSITIONS const literal (used by renderRunningMap).
  const npMatch = src.match(/const NODE_POSITIONS = (\[[\s\S]*?\n\]);/);
  if (!npMatch) throw new Error('NODE_POSITIONS not found in app.js');
  const NODE_POSITIONS = eval('(' + npMatch[1] + ')');

  // Extract interpolateAvatarPosition function (dependency).
  const interpMatch = src.match(/function interpolateAvatarPosition[\s\S]*?\n\}/);
  if (!interpMatch) throw new Error('interpolateAvatarPosition not found');
  const buildRoutePathMatch = src.match(/function buildRoutePath[\s\S]*?\n\}/);
  if (!buildRoutePathMatch) throw new Error('buildRoutePath not found');

  // Stub state (renderRunningMap only writes state.running.activeMap).
  const state: any = { running: { activeMap: null } };

  // Build a function that, when called with (mapData, cumKm), runs renderRunningMap
  // in an isolated scope where the dependencies (state, NODE_POSITIONS,
  // buildRoutePath, interpolateAvatarPosition, document, setAttribute helper, etc.)
  // are available as locals.
  //
  // We prepend the dep definitions + then eval the function body.
  const wrapper = new Function(
    'state',
    'NODE_POSITIONS',
    'buildRoutePathSrc',
    'interpolateAvatarPositionSrc',
    'document',
    `
    ${buildRoutePathMatch[0]}
    ${interpMatch[0]}
    ${fnBody}
    return renderRunningMap;
    `,
  );

  return wrapper(state, NODE_POSITIONS, null, null, document) as any;
}

beforeAll(() => {
  renderRunningMap = extractRenderRunningMap();
});

beforeEach(() => {
  document.body.innerHTML = `
    <div id="running-map-section" hidden>
      <h2 id="running-map-title"></h2>
      <div id="running-map-progress"></div>
      <svg id="running-map-svg" viewBox="0 0 600 280">
        <path id="running-route-path"></path>
        <g id="running-nodes"></g>
        <g id="running-avatar-group"></g>
      </svg>
      <div id="running-point-labels"></div>
    </div>
  `;
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('renderRunningMap — Item #013 §3 visual emphasis', () => {
  it('renders nodes with r=10 (default) and r=12 (current)', () => {
    const mapData = {
      id: 1,
      name: '上海 → 苏州',
      total_km: 95,
      points: [
        { id: 1, cum_km: 0, name: '🏁 起点 (上海普陀区)' },
        { id: 2, cum_km: 20, name: '🏯 嘉定' },
        { id: 3, cum_km: 50, name: '🌉 昆山' },
        { id: 4, cum_km: 95, name: '🚩 终点 (苏州金鸡湖)' },
      ],
    };
    // cumKm=25 → cum_km=0 reached, cum_km=20 reached, cum_km=50 not yet
    // currentPointIdx: loops while cumKm >= points[i].cum_km; first idx where cumKm < cum_km
    //   i=0: 25 >= 0 → idx=0
    //   i=1: 25 >= 20 → idx=1
    //   i=2: 25 < 50 → break → currentPointIdx=1 (嘉定)
    renderRunningMap(mapData, 25);
    const circles = document.querySelectorAll('#running-nodes circle');
    expect(circles.length).toBe(4);
    // Order: [0]=起点 reached r=10, [1]=嘉定 current r=12, [2]=昆山 unreached r=10, [3]=终点 unreached r=10
    expect(circles[0].getAttribute('r')).toBe('10');
    expect(circles[1].getAttribute('r')).toBe('12');
    expect(circles[2].getAttribute('r')).toBe('10');
    expect(circles[3].getAttribute('r')).toBe('10');
  });

  it('applies opacity 0.5 to unreached nodes only', () => {
    const mapData = {
      id: 1, name: 'Test', total_km: 95,
      points: [
        { id: 1, cum_km: 0, name: 'A' },
        { id: 2, cum_km: 50, name: 'B' },
      ],
    };
    renderRunningMap(mapData, 10);  // A reached, B unreached
    const groups = document.querySelectorAll('#running-nodes .running-node');
    expect(groups.length).toBe(2);
    expect(groups[0].getAttribute('opacity')).toBeNull();    // reached → no opacity attr
    expect(groups[1].getAttribute('opacity')).toBe('0.5');   // unreached → 0.5
  });

  it('renders 🎯 emoji hint on every node', () => {
    const mapData = {
      id: 1, name: 'Test', total_km: 95,
      points: [
        { id: 1, cum_km: 0, name: 'A' },
        { id: 2, cum_km: 50, name: 'B' },
      ],
    };
    renderRunningMap(mapData, 0);
    const emojis = Array.from(document.querySelectorAll('#running-nodes text'))
      .filter((t: Element) => t.textContent === '🎯');
    expect(emojis.length).toBe(2);  // one per node
  });
});

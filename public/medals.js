// public/medals.js — kiddo-scoreboard 成就奖牌参数化 SVG 生成器 (ESM)
// 移植自 docs/design/medal-template-v3.html (金属雕刻版 v3, feihao 2026-10-28 过审)。
//
// Spec: docs/achievements-spec.md §0.2 (奖牌本体) + §4a (移植细节)。
//
// 移植策略 —— 忠实缩放 + 取景:
//   模板的坐标空间是 800×800 (整棵 SVG 原样搬过来, 所有几何量 —— 圆盘 / 环 /
//   星徽 / 挂环 / 刻纹 —— 的相对比例与过审 demo **完全一致**, 质感参数一个不改)。
//   差别只在**取景**: 模板的 800 见方画布里奖牌本体只占中间 ~45% (四周是 demo
//   留白), 直接缩到 512 会让奖牌在卡片的圆位里小到看不清刻字。所以这里用
//   <g transform="translate(256 4) scale(1.05) translate(-400 -180)"> 把
//   奖牌本体 (含挂环与偏移投影圆盘) 精确地放大并居中到 512 画布里 —— 奖牌直径
//   从 45% 提到 ~74%, 刻字在 140px 卡片位上才读得出来。
//
// 保留的全部质感参数 (移植时不得削减):
//   * 哑光古金 3-stop 线性渐变 (rim) + 2-stop 径向渐变 (象牙面)
//   * feTurbulence 颗粒 (baseFrequency .9 / numOctaves 2, opacity .06)
//   * 双层 text 刻槽 (底层亮色 translateY(2.5) + 上层深槽色) — 奖名 + 档位副文
//   * 象牙面凹进环 (r=153 面 + r=150 描边 + 上缘阴影路径)
//   * 偏移第二圆盘投影 (cx 408 / cy 486 / blur 4)
//   * bail 挂环 (双层 path)
//   * 奖名字号自适应 (min(60, floor(268 / max(len,2)))) —— 公式原样保留
//
// 档位命名与后端一致 (src/db/types.ts AchievementTier):
//   iron / bronze / silver / gold / king
// 模板里的 'champion' 已重命名为 'king' —— 后端 TIER_ORDER 用 'king'。
// 'flat' (平发奖, admin_flat) 没有金属阶梯, 用铁质渲染 + 副文标注「纪念奖」。
//
// 输出为 string (innerHTML 注入), 512×512 viewBox — 卡片 ~140px / 弹窗 160px 圆位。

/** All medal tiers in ascending order (铁 → 铜 → 银 → 金 → 王者). */
export const TIER_ORDER = Object.freeze(['iron', 'bronze', 'silver', 'gold', 'king']);

/**
 * Per-tier metal palette + labels.
 *
 * `rim`  — 3-stop gradient (light / mid / dark) for the metal ring
 * `face` — 2-stop radial gradient for the matte ivory face
 * `edge` — stroke colour of the disc / bail
 * `engrave` — deep groove colour for the engraved text
 * `enamel` — tier enamel ring colour (王者 = 紫)
 * `label` — Chinese tier label shown on the medal
 */
export const TIER_COLORS = Object.freeze({
  iron: Object.freeze({
    label: '铁',
    edge: '#3f4246',
    rim: Object.freeze(['#9aa0a6', '#787e85', '#5a5f66']),
    face: Object.freeze(['#dcdad4', '#c9c7c0']),
    engrave: '#4b4f55',
    enamel: '#6f747b',
    sub: '初次达成',
  }),
  bronze: Object.freeze({
    label: '铜',
    edge: '#7a4a28',
    rim: Object.freeze(['#cd9a66', '#b07a48', '#8a5a32']),
    face: Object.freeze(['#eadfd0', '#d9ccb6']),
    engrave: '#6e4526',
    enamel: '#a06a3c',
    sub: '继续努力',
  }),
  silver: Object.freeze({
    label: '银',
    edge: '#6f747c',
    rim: Object.freeze(['#d7dade', '#aeb3bb', '#8b9099']),
    face: Object.freeze(['#e9eaec', '#d3d5da']),
    engrave: '#565b64',
    enamel: '#9aa0a8',
    sub: '渐入佳境',
  }),
  gold: Object.freeze({
    label: '金',
    edge: '#8a6f42',
    rim: Object.freeze(['#dfc690', '#c8a870', '#9c8352']),
    face: Object.freeze(['#f0e9d6', '#e0d6bd']),
    engrave: '#6b5a3e',
    enamel: '#b39055',
    sub: '出类拔萃',
  }),
  king: Object.freeze({
    label: '王者',
    edge: '#8a6a2c',
    rim: Object.freeze(['#f0d695', '#d9b866', '#a8863f']),
    face: Object.freeze(['#f4ecd8', '#e6d9ba']),
    engrave: '#6e5424',
    enamel: '#6d5a9e',
    sub: '神殿传说',
  }),
  // 平发奖 (admin_flat) — 无阶梯, 用铁质渲染, 副文标注「特别纪念」
  flat: Object.freeze({
    label: '纪念',
    edge: '#3f4246',
    rim: Object.freeze(['#9aa0a6', '#787e85', '#5a5f66']),
    face: Object.freeze(['#dcdad4', '#c9c7c0']),
    engrave: '#4b4f55',
    enamel: '#6f747b',
    sub: '特别纪念',
  }),
});

/**
 * 取景变换 —— 把 800 空间的奖牌本体居中并缩放到 512 viewBox。
 *
 * 模板里奖牌本体 (圆盘 r=181, 中心 (400 398)) 连挂环 (顶 y≈180) 与偏移投影
 * 圆盘 (底 y≈656) 一共占 y ∈ [180, 656]。居中到 (400, 415) 后:
 *   挂环顶 → 256 + (180-415)·s, 投影底 → 256 + (656-415)·s
 * 取 s = 0.92 时挂环顶落在 ~40, 投影底落在 ~478, 两端都在 512 画布内 ——
 * 奖牌被放进**圆形**卡位 (spec §0.2 「圆位」) 时挂环与投影不会被裁掉。
 * 同时圆盘直径 (362) 占画布 ~65%, 卡片 140px 圆位上直径 ~91px, 刻字可读。
 */
const VIEW = 'translate(256 256) scale(0.92) translate(-400 -415)';

/** Escape text for safe inclusion in SVG markup. */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

/**
 * Five-pointed star path (used for the embossed top emblem).
 * @param {number} R outer radius
 * @returns {string} SVG path data
 */
function starPath(R) {
  const r2 = R * 0.42;
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? R : r2;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(r * Math.cos(a)).toFixed(1)},${(r * Math.sin(a)).toFixed(1)}`);
  }
  return `M${pts.join(' L')} Z`;
}

/** Monotonic uid counter — avoids Math.random() so the SVG is deterministic. */
let uidCounter = 0;

/**
 * Render a medal as an SVG string.
 *
 * @param {{tier?: string, name?: string, sub?: string}} options
 *   tier  — one of TIER_COLORS keys (default 'gold'); unknown tiers fall back to 'gold'
 *   name  — award name engraved on the medal
 *   sub   — optional override of the tier sub-label
 * @returns {string} SVG markup (512×512 viewBox), ready for innerHTML injection
 */
export function medalSVG({ tier = 'gold', name = '奖牌名称', sub } = {}) {
  const t = TIER_COLORS[tier] ?? TIER_COLORS.gold;
  const uid = `m${(uidCounter += 1)}`;
  const [rl, rm, rd] = t.rim;
  const [fl, fd] = t.face;
  // 奖名自适应字号 (spec §0.2 — 公式原样保留)
  const fs = Math.min(60, Math.floor(268 / Math.max(String(name).length, 2)));
  const isKing = tier === 'king';
  const starR = isKing ? 46 : 38;
  const subText = `${t.label}牌 · ${sub ?? t.sub}`;
  const safeName = esc(name);
  const safeSub = esc(subText);

  return `
<svg class="medal medal-${tier}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${t.label}牌 ${safeName}">
  <g transform="${VIEW}">
  <defs>
    <linearGradient id="rim-${uid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${rl}"/><stop offset=".5" stop-color="${rm}"/><stop offset="1" stop-color="${rd}"/>
    </linearGradient>
    <radialGradient id="face-${uid}" cx=".38" cy=".34" r=".9">
      <stop offset="0" stop-color="${fl}"/><stop offset="1" stop-color="${fd}"/>
    </radialGradient>
    <filter id="blur-${uid}"><feGaussianBlur stdDeviation="4"/></filter>
    <filter id="soft-${uid}"><feGaussianBlur stdDeviation="1.2"/></filter>
    <filter id="grain-${uid}">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.45  0 0 0 0 0.42  0 0 0 0 0.36  0 0 0 0.5 0"/>
      <feComposite operator="in" in2="SourceGraphic"/>
    </filter>
    <clipPath id="clip-${uid}"><circle cx="400" cy="398" r="181"/></clipPath>
  </defs>

  <!-- 偏移投影层（demo 的第二圆盘） -->
  <circle cx="408" cy="486" r="170" fill="#c9c4b4" opacity="0.8" filter="url(#blur-${uid})"/>

  <!-- 挂环 bail -->
  <g>
    <path d="M369 226 L376 190 Q400 180 424 190 L431 226 Z" fill="url(#rim-${uid})" stroke="${t.edge}" stroke-width="3"/>
    <path d="M384 219 L388 199 Q400 194 412 199 L416 219 Z" fill="#efe9d9" stroke="${t.edge}" stroke-width="2"/>
  </g>

  <!-- 主体圆盘（金属环） -->
  <circle cx="400" cy="398" r="181" fill="url(#rim-${uid})" stroke="${t.edge}" stroke-width="3"/>
  <!-- 环上高光/阴影倒角 -->
  <circle cx="400" cy="398" r="172" fill="none" stroke="rgba(255,252,240,.5)" stroke-width="6" filter="url(#soft-${uid})" stroke-dasharray="460 660" transform="rotate(-115 400 398)"/>
  <circle cx="400" cy="398" r="171" fill="none" stroke="rgba(40,32,18,.28)" stroke-width="5" filter="url(#soft-${uid})" stroke-dasharray="400 672" transform="rotate(60 400 398)"/>

  <!-- 内嵌牌面（哑光象牙面，凹进金属环） -->
  <circle cx="400" cy="398" r="153" fill="url(#face-${uid})"/>
  <circle cx="400" cy="398" r="150" fill="none" stroke="${t.edge}" stroke-width="2" opacity=".55"/>
  <!-- 面内上缘阴影（凹陷感） -->
  <path d="M262 330 A153 153 0 0 1 538 330" fill="none" stroke="rgba(80,68,44,.16)" stroke-width="12" filter="url(#soft-${uid})"/>

  <!-- 档位珐琅圈（王者=紫） -->
  <circle cx="400" cy="398" r="136" fill="none" stroke="${t.enamel}" stroke-width="9" opacity="${isKing ? 0.95 : 0.4}"/>
  <circle cx="400" cy="398" r="136" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2" stroke-dasharray="430 424" transform="rotate(-115 400 398)" opacity=".8"/>

  <!-- 哑光颗粒（限金属环 + 牌面） -->
  <g clip-path="url(#clip-${uid})">
    <circle cx="400" cy="398" r="181" fill="#736a54" filter="url(#grain-${uid})" opacity="0.06"/>
  </g>

  <!-- 顶部徽记：五角星（雕刻压印） -->
  <g transform="translate(400 300)">
    <path d="${starPath(starR)}" transform="translate(0 2.5)" fill="rgba(255,252,238,.85)"/>
    <path d="${starPath(starR)}" fill="none" stroke="${t.engrave}" stroke-width="5" stroke-linejoin="round"/>
  </g>
  ${isKing ? '<circle cx="400" cy="300" r="9" fill="#8f7bd0" stroke="#5a4a92" stroke-width="2"/>' : ''}

  <!-- 奖名（雕刻压印：下亮缘 + 深槽字） -->
  <text x="400" y="${418 + fs * 0.36}" text-anchor="middle" font-family="'PingFang SC','Noto Sans SC',sans-serif"
        font-size="${fs}" font-weight="700" letter-spacing="2"
        fill="rgba(255,252,238,.9)" transform="translate(0 2.5)">${safeName}</text>
  <text x="400" y="${418 + fs * 0.36}" text-anchor="middle" font-family="'PingFang SC','Noto Sans SC',sans-serif"
        font-size="${fs}" font-weight="700" letter-spacing="2"
        fill="${t.engrave}" opacity=".92">${safeName}</text>

  <!-- 档位副文（同样压印） -->
  <g transform="translate(400 492)">
    <text text-anchor="middle" font-size="30" font-weight="600" letter-spacing="6"
          font-family="'PingFang SC','Noto Sans SC',sans-serif"
          fill="rgba(255,252,238,.85)" transform="translate(0 1.8)">${safeSub}</text>
    <text text-anchor="middle" font-size="30" font-weight="600" letter-spacing="6"
          font-family="'PingFang SC','Noto Sans SC',sans-serif"
          fill="${t.engrave}" opacity=".85">${safeSub}</text>
  </g>

  <!-- 底部菱形分隔刻纹 -->
  <g transform="translate(400 548)">
    <rect x="-7" y="-7" width="14" height="14" transform="rotate(45)" fill="rgba(255,252,238,.85)"/>
    <rect x="-7" y="-7" width="14" height="14" transform="rotate(45)" fill="none" stroke="${t.engrave}" stroke-width="3"/>
  </g>
  </g>
</svg>`;
}

export default medalSVG;

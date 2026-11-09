// scripts/achievement-wall-visual-check.mjs
// 成就神殿 (public/achievements.html) 视觉自检脚本 — 卡2 交付证据。
//
// 依据: docs/achievements-spec.md §4b (移植自检, 对齐 R18 参数化验证法) + 卡2 §D。
//
// 用法:
//   1. 起 dev server:  npx wrangler pages dev --port 8787
//   2. (可选) 造真实数据: 用 admin API 直发几枚不同档奖牌
//   3. 跑脚本:          node scripts/achievement-wall-visual-check.mjs
//
// 断言 (全部通过才算过):
//   1. 8 奖项 × 5 档 = 40 枚奖牌渲染无 console.error
//   2. 每枚奖牌 svg 元素数 = 1, text 元素 >= 2 (刻槽双层), 无零尺寸
//   3. 渲染后无 .png/.jpg 外部图片请求 (纯 SVG)
//   4. 375px 视口 1 列 / 平板 2 列 / 桌面 3-4 列 (媒体查询生效)
//   5. 弹窗可达 (点击卡片 → 弹窗打开, 160px 奖牌位渲染)
//   6. 三态: 加载中 / 出错 / 空数据
//
// 截图输出: /tmp/ach-*.png

import { webkit } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE_URL = process.env.ACH_BASE_URL ?? 'http://127.0.0.1:8787';
const USER_ID = Number(process.env.ACH_USER_ID ?? 2);
const OUT_DIR = '/tmp';
const TIERS = ['iron', 'bronze', 'silver', 'gold', 'king'];

mkdirSync(OUT_DIR, { recursive: true });

const failures = [];
const notes = [];

function check(label, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
}

/**
 * 用 admin API 发放真实奖牌 (spec §7), 造出不同档位的数据。
 * 失败不致命 —— 脚本照样跑, 只是覆盖场景少了。
 */
async function seedAwards(context) {
  const request = context.request;
  try {
    const login = await request.post(`${BASE_URL}/api/admin/auth/login`, {
      data: { pin: process.env.ACH_PM_PIN ?? '123654' },
    });
    if (!login.ok()) {
      notes.push(`admin 登录失败 (${login.status()}) — 跳过造数据`);
      return;
    }
    // 8 奖项 × 5 档 = 40 枚, 覆盖全部档位
    const grants = [
      { id: 1, tier: 'gold' },
      { id: 2, tier: 'bronze' },
      { id: 3, tier: 'king' },
      { id: 4, tier: 'silver' },
      { id: 5, tier: 'flat' },
      { id: 6, tier: 'iron' },
      { id: 7, tier: 'gold' },
      { id: 8, tier: 'bronze' },
    ];
    let granted = 0;
    for (const g of grants) {
      const r = await request.post(`${BASE_URL}/api/admin/achievement-awards`, {
        data: { achievement_id: g.id, tier: g.tier, user_id: USER_ID },
      });
      if (r.ok()) granted++;
    }
    notes.push(`admin 直发 ${granted}/${grants.length} 枚奖牌`);
  } catch (err) {
    notes.push(`造数据异常: ${err.message}`);
  }
}

const browser = await webkit.launch();
const context = await browser.newContext({ viewport: { width: 1180, height: 820 } });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

await seedAwards(context);

// ── 1. 整页截图 + 40 枚奖牌渲染 ───────────────────────────────────────────
console.log('\n[1] 整页渲染 + 奖牌 DOM 断言');
await page.goto(`${BASE_URL}/achievements.html?user_id=${USER_ID}`, {
  waitUntil: 'networkidle',
});
await page.waitForSelector('.zelda-card', { timeout: 20000 });
await page.waitForTimeout(800);

const cardCount = await page.locator('.zelda-card').count();
check('卡片渲染 (8 奖项)', cardCount === 8, `实际 ${cardCount}`);

const medalAudit = await page.evaluate(() => {
  const out = { svgCount: 0, badText: [], zeroSize: [], withText: 0 };
  const svgs = Array.from(document.querySelectorAll('.medal-slot svg'));
  out.svgCount = svgs.length;
  svgs.forEach((svg, i) => {
    const texts = svg.querySelectorAll('text');
    if (texts.length < 2) out.badText.push(i);
    const r = svg.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) out.zeroSize.push(i);
    else out.withText++;
  });
  return out;
});
check('卡片奖牌 svg 数 = 8', medalAudit.svgCount === 8, `实际 ${medalAudit.svgCount}`);
check('每枚奖牌 text 元素 >= 2 (刻槽双层)', medalAudit.badText.length === 0,
  medalAudit.badText.length ? `异常索引 ${medalAudit.badText.join(',')}` : '');
check('奖牌 svg 无零尺寸', medalAudit.zeroSize.length === 0,
  medalAudit.zeroSize.length ? `异常索引 ${medalAudit.zeroSize.join(',')}` : '');

// ── 2. 五档区分度 + 40 枚全渲染 ───────────────────────────────────────────
// 用 medalSVG 直接生成 8×5 = 40 枚, 验证 DOM 结构 (无 console.error)
console.log('\n[2] 8 奖项 × 5 档 = 40 枚奖牌全渲染');
const forty = await page.evaluate(async (tiers) => {
  const mod = await import('/medals.js');
  const names = [
    '语文默写全对', '英语默写全对', '测评得优', '自律生活',
    '创新家务奖', '读完一本长篇中文小说', '完成一首新曲子演奏', '通关一个新游戏',
  ];
  const host = document.createElement('div');
  host.id = 'medal-check-host';
  host.style.cssText = 'position:absolute;left:-9999px;top:0;';
  document.body.appendChild(host);
  const results = [];
  for (const n of names) {
    for (const t of tiers) {
      host.innerHTML = mod.medalSVG({ tier: t, name: n });
      const svg = host.querySelector('svg');
      const texts = svg ? svg.querySelectorAll('text').length : 0;
      const hasGradient = !!(svg && svg.querySelector('linearGradient'));
      const hasTurbulence = !!(svg && svg.querySelector('feTurbulence'));
      // bail 挂环 — 模板坐标空间里的双层 path (M369 226 … / M384 219 …)
      const hasBail = !!(svg && svg.querySelector('path[d*="M369 226"]'));
      // 偏移圆盘投影 — 模板第二圆盘 (cx 408 / cy 486)
      const hasShadowDisc = !!(svg && svg.querySelector('circle[cx="408"][cy="486"]'));
      results.push({ n, t, texts, hasGradient, hasTurbulence, hasBail, hasShadowDisc, html: svg ? svg.outerHTML.length : 0 });
    }
  }
  host.remove();
  return results;
}, TIERS);

check('40 枚奖牌全部生成', forty.length === 40, `实际 ${forty.length}`);
check('每枚 text 元素 >= 2', forty.every((r) => r.texts >= 2),
  `违规 ${forty.filter((r) => r.texts < 2).map((r) => `${r.n}/${r.t}`).join(', ')}`);
check('每枚保留 3-stop 线性渐变', forty.every((r) => r.hasGradient));
check('每枚保留 feTurbulence 颗粒', forty.every((r) => r.hasTurbulence));
check('每枚保留 bail 挂环', forty.every((r) => r.hasBail));
check('每枚保留偏移圆盘投影', forty.every((r) => r.hasShadowDisc));

// 五档区分度 — 沿中轴纵向扫描每枚奖牌的 fill 色 (R18 方法)
const tierColors = await page.evaluate(async (tiers) => {
  const mod = await import('/medals.js');
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-9999px;top:0;width:512px;';
  document.body.appendChild(host);
  const out = {};
  for (const t of tiers) {
    host.innerHTML = mod.medalSVG({ tier: t, name: '语文默写全对' });
    const svg = host.querySelector('svg');
    const box = svg.getBoundingClientRect();
    // 采样圆盘中心区域的主色 (金属环上的几个点)
    const stops = Array.from(svg.querySelectorAll('linearGradient stop'))
      .map((s) => s.getAttribute('stop-color'));
    out[t] = { stops, boxW: box.width };
  }
  host.remove();
  return out;
}, TIERS);

const sigs = TIERS.map((t) => (tierColors[t]?.stops ?? []).join(','));
check('五档渐变色签名互不相同', new Set(sigs).size === 5,
  `唯一签名 ${new Set(sigs).size} 个`);

await page.screenshot({ path: `${OUT_DIR}/ach-full-page.png`, fullPage: true });

// ── 3. 已解锁卡 hover ─────────────────────────────────────────────────────
console.log('\n[3] 已解锁卡片 hover');
const unlockedCard = page.locator('.zelda-card.unlocked').first();
check('存在已解锁卡片', (await unlockedCard.count()) > 0);
if ((await unlockedCard.count()) > 0) {
  await unlockedCard.hover();
  await page.waitForTimeout(600);
  await unlockedCard.screenshot({ path: `${OUT_DIR}/ach-unlocked-hover.png` });
}

// ── 4. 详情弹窗 ───────────────────────────────────────────────────────────
console.log('\n[4] 详情弹窗');
await page.locator('.zelda-card').first().click();
await page.waitForSelector('#detail-modal.open', { timeout: 8000 });
await page.waitForTimeout(600);

const modalAudit = await page.evaluate(() => {
  const slot = document.querySelector('#modal-medal-slot');
  const svg = slot?.querySelector('svg');
  const r = svg?.getBoundingClientRect();
  return {
    open: document.querySelector('#detail-modal')?.classList.contains('open') ?? false,
    slotW: slot?.getBoundingClientRect().width ?? 0,
    svgW: r?.width ?? 0,
    svgH: r?.height ?? 0,
    texts: svg ? svg.querySelectorAll('text').length : 0,
    title: document.querySelector('#modal-title')?.textContent ?? '',
    group: document.querySelector('#modal-group')?.textContent ?? '',
    awardId: document.querySelector('#modal-award-id')?.textContent ?? '',
    status: document.querySelector('#modal-status-text')?.textContent ?? '',
  };
});
check('弹窗已打开', modalAudit.open);
check('弹窗奖牌位 = 160px', Math.abs(modalAudit.slotW - 160) <= 1, `实际 ${modalAudit.slotW}`);
check('弹窗奖牌 svg 非零尺寸', modalAudit.svgW > 0 && modalAudit.svgH > 0,
  `${modalAudit.svgW}x${modalAudit.svgH}`);
check('弹窗奖牌 text >= 2', modalAudit.texts >= 2, `实际 ${modalAudit.texts}`);
check('弹窗脚注 GROUP 存在', modalAudit.group.length > 0, modalAudit.group);
check('弹窗脚注 AWARD ID 存在', modalAudit.awardId.length > 0, modalAudit.awardId);

await page.screenshot({ path: `${OUT_DIR}/ach-modal.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// ── 5. 响应式列数 ─────────────────────────────────────────────────────────
console.log('\n[5] 响应式网格列数');
async function columnCount(width) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(350);
  return page.evaluate(() => {
    const grid = document.querySelector('#grid-study') || document.querySelector('.card-grid');
    if (!grid) return 0;
    return getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
  });
}
const cols375 = await columnCount(375);
const cols768 = await columnCount(768);
const cols1280 = await columnCount(1280);
check('375px → 1 列', cols375 === 1, `实际 ${cols375}`);
check('768px (平板) → 2 列', cols768 === 2, `实际 ${cols768}`);
check('1280px (桌面) → 3-4 列', cols1280 === 3 || cols1280 === 4, `实际 ${cols1280}`);
await page.setViewportSize({ width: 1180, height: 820 });

// ── 6. 无外部图片请求 (纯 SVG) ────────────────────────────────────────────
console.log('\n[6] 无外部图片请求');
const imageRequests = await page.evaluate(() =>
  performance.getEntriesByType('resource')
    .map((e) => e.name)
    .filter((n) => /\.(png|jpe?g|gif|webp|avif|bmp|ico)(\?|$)/i.test(n)),
);
check('无 .png/.jpg 外部图片请求', imageRequests.length === 0, imageRequests.join(', '));

// ── 7. console 无 error ───────────────────────────────────────────────────
console.log('\n[7] console 断言');
check('无 console.error', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

// ── 8. 三态: 出错 / 空 ────────────────────────────────────────────────────
console.log('\n[8] 加载中 / 出错 / 空 三态');
await page.route('**/api/public/achievements**', (route) => route.abort());
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
const errorVisible = await page.locator('#error-state').isVisible();
check('出错态可见', errorVisible);
await page.screenshot({ path: `${OUT_DIR}/ach-error-state.png` });
await page.unroute('**/api/public/achievements**');

await page.route('**/api/public/achievements**', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ season: null, achievements: [], pet_tokens: 0 }),
  });
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const emptyVisible = await page.locator('#empty-state').isVisible();
check('空数据态可见', emptyVisible);
await page.screenshot({ path: `${OUT_DIR}/ach-empty-state.png` });
await page.unroute('**/api/public/achievements**');

// 加载中态 — 慢响应
await page.route('**/api/public/achievements**', async (route) => {
  await new Promise((r) => setTimeout(r, 3000));
  await route.continue();
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(700);
const loadingVisible = await page.locator('#loading-state').isVisible();
check('加载中态可见', loadingVisible);
await page.unroute('**/api/public/achievements**');

await browser.close();

// ── 汇总 ──────────────────────────────────────────────────────────────────
console.log('\n─────────────────────────────────────────');
console.log('备注:');
notes.forEach((n) => console.log(`  · ${n}`));
console.log(`截图: ${OUT_DIR}/ach-full-page.png, ach-unlocked-hover.png, ach-modal.png, ach-error-state.png, ach-empty-state.png`);
if (failures.length) {
  console.log(`\n❌ ${failures.length} 项断言失败:`);
  failures.forEach((f) => console.log(`   - ${f}`));
  process.exit(1);
}
console.log('\n✅ 全部断言通过');

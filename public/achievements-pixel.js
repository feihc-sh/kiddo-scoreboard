// public/achievements-pixel.js — 像素成就墙 (PIXEL ACHIEVEMENT WALL) 前端逻辑
//
// Spec: docs/achievements-spec.md §7a (API 响应) + §7b (字段语义) + §2 (奖项清单) + §1 (三组五档)。
// 视觉稿: commit 830cde6 (feihao 2026-11-14 拍板) —— 8 奖项 × 5 档像素地牢墙。
//
// 数据来源: GET /api/public/achievements?user_id=[&season_id=]
//   → { season, achievements: [{ id, grp, name, description, grant_mode, ladder, award }], pet_tokens }
//   award = { tier, granted_at, count } (该赛季该奖项已获最高档) 或 null。
//
// ⚠️ 数据契约 (与设计稿演示数组的差异 —— **以 API 为准**):
//   * `ladder` 是**对象** { iron: 1, bronze: 3, silver: 5, gold: 8, king: 10 }, 不是数组;
//     平发奖 (admin_flat) 返回 `{}` (空对象), 不是 null。
//   * 最高档叫 `king` (王者), 不是 `royal`。
//   * `award.tier` = 该赛季已获的**最高档** → 当前档位以它为准。
//   * `award.count` = **该档位**的累计发放次数 (不是累计总数!)。
//     所以阶梯奖不能用 count 去比对 ladder 阈值来反推档位 —— 那会把「已拿金牌」
//     的孩子显示成铁牌。阶梯档位一律读 award.tier。
//
// 页面是**只读**的: 解锁态完全由服务端数据驱动, 页面不做任何状态写入。
//
// 牌级规则的单一事实源是 /shared/achievement-tiers.js (window.ACHIEVEMENT_TIERS),
// 与 admin 发放面板、后端 src/utils/achievements.ts 同构 —— 本页不另立一套档位表。

const API = '';                     // same origin
const CHILD_USER_ID = 2;           // 与 public/app.js + public/shop.js 同惯例 (M5 换真实鉴权)

/** 档位规则的单一事实源 (classic script 注入的全局)。 */
const TIER_RULES = (typeof window !== 'undefined' && window.ACHIEVEMENT_TIERS) || null;

/** 降级常量 —— shared 脚本没加载上时至少不白屏 (与后端 TIER_ORDER 一致)。 */
const FALLBACK_TIER_ORDER = ['iron', 'bronze', 'silver', 'gold', 'king'];
const FALLBACK_TIER_LABELS = {
  iron: '铁牌', bronze: '铜牌', silver: '银牌', gold: '金牌', king: '王者', flat: '平发',
};
const FALLBACK_GROUP_LABELS = { study: '学习组', life: '生活组', skill: '技能组' };

const TIER_ORDER = TIER_RULES?.TIER_ORDER ?? FALLBACK_TIER_ORDER;
const TIER_LABELS = TIER_RULES?.TIER_LABELS ?? FALLBACK_TIER_LABELS;
const GROUP_LABELS = TIER_RULES?.GROUP_LABELS ?? FALLBACK_GROUP_LABELS;

/** 档位显示名 (铁牌 / 铜牌 / / 王者 / 平发)。 */
function tierLabel(tier) {
  return TIER_LABELS[tier] ?? String(tier ?? '');
}

/** 分组显示名。 */
function groupLabel(grp) {
  return GROUP_LABELS[grp] ?? String(grp ?? '');
}

/**
 * ladder 的阈值单位: 自律生活 (auto_streak) 是「天」, 其余是「次」。
 * 走单一事实源 —— admin 面板的提示文案与本页一致。
 */
function ladderUnit(grantMode) {
  if (TIER_RULES?.ladderUnit) return TIER_RULES.ladderUnit({ grant_mode: grantMode });
  return grantMode === 'auto_streak' ? '天' : '次';
}

// =============================================================
// DOM
// =============================================================
const $ = (sel) => document.querySelector(sel);

const els = {
  wallRoot: $('#wall-root'),
  loading: $('#state-loading'),
  error: $('#state-error'),
  errorText: $('#state-error-text'),
  empty: $('#state-empty'),
  retry: $('#btn-retry'),
  petTokens: $('#pet-tokens'),
  seasonTag: $('#season-tag'),
  seasonName: $('#season-name'),
  seasonDates: $('#season-dates'),
  overallNum: $('#overall-num'),
  overallFill: $('#overall-fill'),
  modal: $('#detail-modal'),
  modalCard: $('#modal-card'),
  modalIcon: $('#modal-icon'),
  modalCategory: $('#modal-category'),
  modalTitle: $('#modal-title'),
  modalStatus: $('#modal-status-text'),
  modalBadge: $('#modal-tier-badge'),
  modalDesc: $('#modal-desc'),
  modalPips: $('#modal-pips'),
  modalLadder: $('#modal-ladder'),
  modalGroup: $('#modal-group'),
  modalAwardId: $('#modal-award-id'),
  modalGrantedAt: $('#modal-granted-at'),
  closeModalBtn: $('#close-modal-btn'),
};

/** 页面状态 —— 只读渲染用的单一数据源。 */
const state = {
  season: null,
  achievements: [],
  petTokens: 0,
  loadStatus: 'loading',   // 'loading' | 'ok' | 'error'
  selectedId: null,
};

// =============================================================
// 8-BIT 音效 (Web Audio 方波)
// =============================================================
let audioCtx = null;
let sfxEnabled = true;

function playRetroSound(type) {
  if (!sfxEnabled) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    const now = audioCtx.currentTime;
    if (type === 'step') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(587.33, now + 0.04);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      osc.start(now); osc.stop(now + 0.09);
    } else if (type === 'unlock') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.07);
      osc.frequency.setValueAtTime(783.99, now + 0.14);
      osc.frequency.setValueAtTime(1046.50, now + 0.21);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      osc.start(now); osc.stop(now + 0.45);
    }
  } catch (err) { /* 音频不可用不影响主流程 */ }
}

// =============================================================
// 16x16 像素图标 (每个奖项一个专属图标)
// =============================================================
const PIXEL_ICONS = {
  bookOpen: `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 4h5v7H2zM9 4h5v7H9z" fill="#bfdbfe"/>
      <path d="M3 5h3v5H3zM10 5h3v5h-3z" fill="#eff6ff"/>
      <path d="M7 4h2v8H7z" fill="#93c5fd"/>
      <path d="M1 11h14v2H1zM2 13h12v1H2z" fill="#1e40af"/>
      <path d="M1 11h14v1H1z" fill="#3b82f6"/>
      <path d="M11 2h2v3h-2z" fill="#ef4444"/>
    </svg>`,
  letterTile: `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 2h12v12H2z" fill="#1e3a8a"/>
      <path d="M3 3h10v10H3z" fill="#3b82f6"/>
      <path d="M3 3h10v1H3zM3 3h1v10H3z" fill="#60a5fa"/>
      <path d="M12 3h1v10h-1zM3 12h10v1H3z" fill="#1e40af"/>
      <path d="M5 4h6v1H5zM5 7h4v1H5zM5 10h6v1H5zM5 4h1v7H5z" fill="#fde047"/>
    </svg>`,
  scrollStar: `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 3h10v10H3z" fill="#fef9c3"/>
      <path d="M2 2h12v1H2zM2 13h12v1H2z" fill="#d4b106"/>
      <path d="M5 5h6v1H5zM5 7h6v1H5z" fill="#a16207"/>
      <path d="M9 9h4v4H9z" fill="#ef4444"/>
      <path d="M10 10h2v2h-2z" fill="#fca5a5"/>
    </svg>`,
  sun: `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 5h6v6H5z" fill="#fbbf24"/>
      <path d="M6 6h4v4H6z" fill="#fde047"/>
      <path d="M7 7h2v2H7z" fill="#fef9c3"/>
      <path d="M7 1h2v2H7zM7 13h2v2H7zM1 7h2v2H1zM13 7h2v2h-2z" fill="#f59e0b"/>
      <path d="M3 2h2v2H3zM11 2h2v2h-2zM3 12h2v2H3zM11 12h2v2H2z" fill="#fbbf24"/>
    </svg>`,
  broom: `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M12 1h2v2h-2zM11 2h2v2h-2zM10 3h2v2h-2zM9 4h2v2H9zM8 5h2v2H8z" fill="#a16207"/>
      <path d="M12 1h1v1h-1zM11 2h1v1h-1zM10 3h1v1h-1zM9 4h1v1H9zM8 5h1v1H8z" fill="#d97706"/>
      <path d="M2 8h7v1H2z" fill="#facc15"/>
      <path d="M1 9h8v4H1z" fill="#d97706"/>
      <path d="M1 9h8v1H1z" fill="#f59e0b"/>
      <path d="M1 13h2v2H1zM4 13h2v2H4zM7 13h2v2H7z" fill="#b45309"/>
    </svg>`,
  bookStack: `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 4h9v2H4z" fill="#ef4444"/>
      <path d="M4 4h9v1H4z" fill="#fca5a5"/>
      <path d="M13 4h1v2h-1z" fill="#fecaca"/>
      <path d="M3 7h10v2H3z" fill="#0d9488"/>
      <path d="M3 7h10v1H3z" fill="#2dd4bf"/>
      <path d="M12 7h1v2h-1z" fill="#99f6e4"/>
      <path d="M2 10h11v2H2z" fill="#7c3aed"/>
      <path d="M2 10h11v1H2z" fill="#a78bfa"/>
      <path d="M12 10h1v2h-1z" fill="#ddd6fe"/>
      <path d="M2 13h11v1H2z" fill="#4c1d95"/>
    </svg>`,
  musicNote: `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 10h5v3H3z" fill="#7e22ce"/>
      <path d="M4 10h2v1H4z" fill="#d8b4fe"/>
      <path d="M8 2h2v9H8z" fill="#a855f7"/>
      <path d="M10 2h4v2h-4zM11 4h3v2h-3z" fill="#c084fc"/>
      <path d="M10 2h2v1h-2z" fill="#e9d5ff"/>
    </svg>`,
  gamepad: `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1 5h14v6H1z" fill="#475569"/>
      <path d="M1 5h14v1H1z" fill="#64748b"/>
      <path d="M1 10h14v1H1z" fill="#334155"/>
      <path d="M4 6h2v4H4zM3 7h4v2H3z" fill="#e2e8f0"/>
      <path d="M10 6h2v2h-2z" fill="#4ade80"/>
      <path d="M12 8h2v2h-2z" fill="#ef4444"/>
      <path d="M10 6h2v1h-2z" fill="#86efac"/>
    </svg>`,
  trophyTitle: `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 2h8v2h1v3a5 5 0 0 1-4 4.9V14h3v1H4v-1h3v-2.1A5 5 0 0 1 3 7V4h1V2z" fill="#facc15"/>
      <path d="M4 3h8v4a4 4 0 0 1-8 0V3z" fill="#fde047"/>
      <path d="M6 5h1v3H6zM8 5h1v4H8z" fill="#fef9c3"/>
      <path d="M2 4h1v3H2zM13 4h1v3h-1z" fill="#ca8a04"/>
    </svg>`,
  bolt: `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1h3l-2 5h3l-6 9 2-7H5z" fill="#facc15"/>
      <path d="M8 3h1l-1 4h2l-4 6 1-5H5z" fill="#fef9c3"/>
    </svg>`,
  brokenBolt: `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1h3l-2 5h3l-6 9 2-7H5z" fill="#475569"/>
      <path d="M2 2h1v1H2zM13 13h1v1h-1z" fill="#ef4444"/>
    </svg>`,
  emptyBox: `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 5h12v8H2z" fill="#334155"/>
      <path d="M2 5h12v2H2z" fill="#64748b"/>
      <path d="M5 2h6v3H5z" fill="#475569"/>
      <path d="M5 2h6v1H5z" fill="#94a3b8"/>
      <path d="M6 9h4v2H6z" fill="#1e293b"/>
    </svg>`,
};

/**
 * 奖项 → 图标的映射。
 *
 * 优先按 **id** 匹配 (id 是 DB 主键, 最稳定), 再按 **name** 匹配,
 * 最后按 grp 兜底 —— 新增奖项时不会掉图标 (至少有组图标)。
 * id / name 都对齐 migrations/0021_achievements.sql 的 seed 目录。
 */
const ICON_BY_ID = {
  1: 'bookOpen',      // 语文默写全对
  2: 'letterTile',    // 英语默写全对
  3: 'scrollStar',    // 测评得优
  4: 'sun',           // 自律生活
  5: 'broom',         // 创新家务奖
  6: 'bookStack',     // 读完一本长篇中文小说
  7: 'musicNote',     // 完成一首新曲子演奏
  8: 'gamepad',       // 通关一个新游戏
};

const ICON_BY_NAME = {
  '语文默写全对': 'bookOpen',
  '英语默写全对': 'letterTile',
  '测评得优': 'scrollStar',
  '自律生活': 'sun',
  '创新家务奖': 'broom',
  '读完一本长篇中文小说': 'bookStack',
  '完成一首新曲子演奏': 'musicNote',
  '通关一个新游戏': 'gamepad',
};

/** 组 → 图标 (分组横幅 + 兜底图标)。 */
const ICON_BY_GROUP = {
  study: 'bookOpen',
  life: 'sun',
  skill: 'gamepad',
};

/**
 * 阶梯阈值单位覆盖 (spec §2 的「本数档 / 首数档 / 个数档」)。
 *
 * API 只带 ladder 阈值, 不带单位; 共享规则只能区分「天 / 次」。
 * 这三个技能组的奖项在 spec §2 里明确写了个别单位, 这里按 id 补回
 * (id 对齐 migrations/0021_achievements.sql 的 seed 目录)。
 */
const UNIT_BY_ID = {
  4: '天',   // 自律生活 —— 连续全卡 N 天
  6: '本',   // 读完一本长篇中文小说
  7: '首',   // 完成一首新曲子演奏
  8: '个',   // 通关一个新游戏
};

/** 取某个奖项的像素图标 key。 */
function iconKeyFor(achievement) {
  if (achievement?.id != null && ICON_BY_ID[achievement.id]) return ICON_BY_ID[achievement.id];
  const byName = ICON_BY_NAME[achievement?.name];
  if (byName) return byName;
  return ICON_BY_GROUP[achievement?.grp] ?? 'emptyBox';
}

/** 取某个奖项的阈值单位。 */
function unitFor(achievement) {
  if (achievement?.id != null && UNIT_BY_ID[achievement.id]) return UNIT_BY_ID[achievement.id];
  return ladderUnit(achievement?.grant_mode);
}

// =============================================================
// 数据模型 —— 把 API 响应规整成渲染用的形状
// =============================================================

/**
 * ladder 从 API 拿到的**对象** { iron: 1, ... } → 有序数组 (按 TIER_ORDER)。
 * 平发奖返回空对象 → 空数组 (前端据此判断「无阶梯」)。
 */
function ladderEntries(achievement) {
  const ladder = achievement?.ladder;
  if (!ladder || typeof ladder !== 'object' || Array.isArray(ladder)) return [];
  return TIER_ORDER
    .filter((tier) => typeof ladder[tier] === 'number')
    .map((tier) => ({ tier, need: ladder[tier] }));
}

/** 该奖项是否无阶梯 (平发奖 —— admin_flat)。 */
function isFlat(achievement) {
  return achievement?.grant_mode === 'admin_flat' || ladderEntries(achievement).length === 0;
}

/**
 * 当前档位 —— **以 API 的 award.tier 为准** (spec §7b: 该赛季已获最高档)。
 *
 * 不用 award.count 去比对 ladder 阈值反推档位: count 是「该档位的发放次数」,
 * 不是累计总数 —— 那样会把「已拿金牌」的孩子显示成铁牌。
 */
function tierOf(achievement) {
  const tier = achievement?.award?.tier;
  if (!tier) return 'locked';
  if (isFlat(achievement)) return 'flat';
  return TIER_ORDER.includes(tier) ? tier : 'locked';
}

/** 是否已解锁 (有发放记录)。 */
function isUnlocked(achievement) {
  return Boolean(achievement?.award);
}

/** 下一档目标 —— 已达最高档则 null。 */
function nextGoal(achievement) {
  const entries = ladderEntries(achievement);
  if (entries.length === 0) return null;
  const idx = entries.findIndex((e) => e.tier === tierOf(achievement));
  if (idx === -1) return null;
  return entries[idx + 1] ?? null;
}

/** 已达档位的下标 (-1 = 一个都没到)。 */
function reachedIndex(achievement) {
  const entries = ladderEntries(achievement);
  return entries.findIndex((e) => e.tier === tierOf(achievement));
}

/** 5 档 pip 行 —— 已达档位点亮, 下一档闪烁。 */
function pipsHtml(achievement) {
  const entries = ladderEntries(achievement);
  if (entries.length === 0) return '';
  const reached = reachedIndex(achievement);
  const next = nextGoal(achievement);
  return '<div class="tier-pips" aria-hidden="true">' + entries.map(({ tier }) => {
    const isReached = reached >= 0 && TIER_ORDER.indexOf(tier) <= TIER_ORDER.indexOf(entries[reached].tier);
    const isNext = next?.tier === tier;
    return `<span class="pip${isReached ? ' reached ' + tier : ''}${isNext ? ' next' : ''}"></span>`;
  }).join('') + '</div>';
}

// =============================================================
// 渲染
// =============================================================

/** HTML 转义 —— 奖项名/描述来自 DB, 必须转义后再 innerHTML。 */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/** 单张成就卡片。 */
function cardHtml(achievement) {
  const tier = tierOf(achievement);
  const count = achievement?.award?.count ?? 0;
  const unit = unitFor(achievement);
  const goal = nextGoal(achievement);
  const flat = isFlat(achievement);
  const entries = ladderEntries(achievement);

  let statusLine, pct, labelHtml;

  if (flat) {
    // 单发特别奖 (创新家务): 无档位阶梯, count = 累计平发次数
    statusLine = count > 0 ? `SPECIAL AWARD × ${count}` : 'NOT EARNED YET';
    pct = count > 0 ? 100 : 0;
    labelHtml = count > 0
      ? `<span>已获 ${count} ${unit}</span><span class="next-tier">★ 每次平发</span>`
      : `<span>尚未获得</span><span class="next-tier">等待点亮</span>`;
  } else if (tier === 'locked') {
    statusLine = 'LOCKED · 继续努力';
    pct = 0;
    const first = entries[0];
    labelHtml = `<span>未解锁</span><span class="next-tier">→ ${tierLabel(first.tier)} ${first.tier.toUpperCase()} · 累计 ${first.need} ${unit}</span>`;
  } else if (goal) {
    // 进度按**已达档位**算 (阶梯档位来自 award.tier, 不从 count 反推)
    const reached = reachedIndex(achievement);
    pct = Math.round(((reached + 1) / entries.length) * 100);
    statusLine = `UNLOCKED · ${tier.toUpperCase()} ${tierLabel(tier)}`;
    labelHtml = `<span>${tierLabel(tier)} ×${count}</span><span class="next-tier">→ ${tierLabel(goal.tier)} · 累计 ${goal.need} ${unit}</span>`;
  } else {
    pct = 100;
    statusLine = `MAX UNLOCKED · ${tier.toUpperCase()} ${tierLabel(tier)}`;
    labelHtml = `<span>${tierLabel(tier)} ×${count}</span><span class="next-tier">★ 已达最高档</span>`;
  }

  return `
    <div class="pixel-card tier-${tier}" data-award="${escapeHtml(achievement.id)}" role="button" tabindex="0"
         aria-label="${escapeHtml(achievement.name)}">
      <div class="pixel-icon-slot">${PIXEL_ICONS[iconKeyFor(achievement)] ?? ''}</div>
      <div class="card-info">
        <div class="card-top">
          <span class="card-name">${escapeHtml(achievement.name)}</span>
          ${count > 0 ? `<span class="card-count">×${count}</span>` : ''}
        </div>
        <div class="card-status">${statusLine}</div>
        ${pipsHtml(achievement)}
        <div class="card-progress">
          <div class="pixel-progress-track">
            <div class="pixel-progress-fill" style="width:${pct}%"></div>
          </div>
          <div class="progress-label">${labelHtml}</div>
        </div>
      </div>
    </div>`;
}

/** 渲染整面墙 (按组分区分区)。 */
function renderWall() {
  const root = els.wallRoot;
  if (!root) return;

  const groups = ['study', 'life', 'skill'].map((id) => ({
    id,
    items: state.achievements.filter((a) => a.grp === id),
  }));

  root.innerHTML = groups.map((g) => {
    const unlocked = g.items.filter((a) => isUnlocked(a)).length;
    const groupIcon = PIXEL_ICONS[ICON_BY_GROUP[g.id]] ?? '';
    return `
      <div class="group-block">
        <div class="group-banner">
          <span class="gb-icon">${groupIcon}</span>
          <h2>${escapeHtml(groupLabel(g.id))}</h2>
          <span class="gb-en">${g.id.toUpperCase()}</span>
          <span class="gb-line"></span>
          <span class="gb-count">${unlocked}/${g.items.length}</span>
        </div>
        <div class="card-grid">${g.items.map(cardHtml).join('')}</div>
      </div>`;
  }).join('');

  // 总进度
  const total = state.achievements.length;
  const unlockedAll = state.achievements.filter((a) => isUnlocked(a)).length;
  if (els.overallNum) {
    els.overallNum.textContent = `${unlockedAll} / ${total}`;
  }
  if (els.overallFill) {
    const pct = total > 0 ? Math.round((unlockedAll / total) * 100) : 0;
    els.overallFill.style.width = `${pct}%`;
  }
}

/** 渲染赛季条 + 星币余额。 */
function renderMeta() {
  if (els.seasonTag) {
    els.seasonTag.textContent = state.season ? `SEASON ${state.season.id}` : 'NO SEASON';
  }
  if (els.seasonName) {
    els.seasonName.textContent = state.season?.name ?? '尚未开启赛季';
  }
  if (els.seasonDates) {
    const s = state.season;
    els.seasonDates.textContent = s
      ? `${s.starts_on ?? '—'}${s.ends_on ? ` — ${s.ends_on}` : ''}`
      : '—';
  }
  if (els.petTokens) {
    els.petTokens.textContent = String(state.petTokens ?? 0);
  }
}

/** 三态切换: loading / error / empty / ok。 */
function showState(which) {
  if (els.loading) els.loading.hidden = which !== 'loading';
  if (els.error) els.error.hidden = which !== 'error';
  if (els.empty) els.empty.hidden = which !== 'empty';
  if (els.wallRoot) els.wallRoot.hidden = which !== 'ok';
}

// =============================================================
// 数据加载
// =============================================================

/** 取得 URL query 里的 user_id (缺省用 CHILD_USER_ID, 与现有页面惯例一致)。 */
function resolveUserId() {
  const raw = new URLSearchParams(window.location.search).get('user_id');
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : CHILD_USER_ID;
}

/** 取得 URL query 里的 season_id (可选 —— 归档赛季视图)。 */
function resolveSeasonId() {
  const raw = new URLSearchParams(window.location.search).get('season_id');
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** 拉取成就墙数据并渲染。 */
async function loadWall() {
  state.loadStatus = 'loading';
  showState('loading');

  const params = new URLSearchParams({ user_id: String(resolveUserId()) });
  const seasonId = resolveSeasonId();
  if (seasonId !== null) params.set('season_id', String(seasonId));

  try {
    const r = await fetch(`${API}/api/public/achievements?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    const text = await r.text();
    const data = text ? safeJson(text) : null;
    if (!r.ok) {
      const msg = data?.error?.message || `HTTP ${r.status}`;
      throw new Error(msg);
    }

    state.season = data?.season ?? null;
    state.achievements = Array.isArray(data?.achievements) ? data.achievements : [];
    state.petTokens = Number(data?.pet_tokens ?? 0);

    renderMeta();

    if (state.achievements.length === 0) {
      state.loadStatus = 'ok';
      showState('empty');
      return;
    }

    state.loadStatus = 'ok';
    showState('ok');
    renderWall();
  } catch (err) {
    state.achievements = [];
    state.loadStatus = 'error';
    if (els.errorText) els.errorText.textContent = `加载失败：${err.message}`;
    showState('error');
  }
}

// =============================================================
// 详情弹窗 (像素风)
// =============================================================

/** 打开某个奖项的详情弹窗。 */
function openModal(id) {
  const achievement = state.achievements.find((a) => String(a.id) === String(id));
  if (!achievement) return;
  state.selectedId = id;

  const unlocked = isUnlocked(achievement);
  const tier = tierOf(achievement);
  const flat = isFlat(achievement);
  const unit = unitFor(achievement);
  const entries = ladderEntries(achievement);
  const count = achievement.award?.count ?? 0;

  if (els.modalCard) {
    els.modalCard.classList.toggle('unlocked', unlocked);
    els.modalCard.classList.toggle('locked', !unlocked);
  }
  if (els.modalIcon) {
    els.modalIcon.innerHTML = PIXEL_ICONS[iconKeyFor(achievement)] ?? '';
  }
  if (els.modalCategory) {
    els.modalCategory.textContent = `${groupLabel(achievement.grp)} · ${String(achievement.grp).toUpperCase()}`;
  }
  if (els.modalTitle) {
    els.modalTitle.textContent = achievement.name ?? '';
  }
  if (els.modalStatus) {
    els.modalStatus.textContent = unlocked ? '已获得' : '未解锁 — 继续努力，小骑士！';
    els.modalStatus.className = `modal-status-value ${unlocked ? 'unlocked' : 'locked'}`;
  }
  if (els.modalBadge) {
    els.modalBadge.textContent = unlocked ? tierLabel(tier) : '未解锁';
    els.modalBadge.className = `tier-badge ${unlocked ? 'unlocked' : ''}`;
  }
  if (els.modalDesc) {
    els.modalDesc.textContent = achievement.description ?? '暂无描述';
  }
  if (els.modalPips) {
    els.modalPips.innerHTML = flat ? '' : pipsHtml(achievement);
  }
  if (els.modalLadder) {
    if (flat) {
      // 平发奖没有阶梯 —— 展示「每次平发」的规则说明
      els.modalLadder.innerHTML =
        `<li><span class="ladder-tier">${escapeHtml(tierLabel('flat'))}</span>` +
        `<span class="ladder-need">每次平发 · 已获 ${count} ${unit}</span></li>`;
    } else {
      const reached = reachedIndex(achievement);
      els.modalLadder.innerHTML = entries.map(({ tier: t, need }, i) => {
        const isReached = reached >= 0 && i <= reached;
        return `<li class="${isReached ? 'reached' : ''}">` +
          `<span class="ladder-tier">${escapeHtml(tierLabel(t))} ${t.toUpperCase()}</span>` +
          `<span class="ladder-need">累计 ${need} ${unit}</span></li>`;
      }).join('');
    }
  }
  if (els.modalGroup) {
    els.modalGroup.textContent = groupLabel(achievement.grp).toUpperCase();
  }
  if (els.modalAwardId) {
    els.modalAwardId.textContent = `#${String(achievement.id).padStart(3, '0')}`;
  }
  if (els.modalGrantedAt) {
    els.modalGrantedAt.textContent = achievement.award?.granted_at
      ? new Date(achievement.award.granted_at).toLocaleDateString('zh-CN')
      : '—';
  }

  if (els.modal) {
    els.modal.hidden = false;
    els.modal.classList.add('open');
    els.modal.setAttribute('aria-hidden', 'false');
  }
  if (els.closeModalBtn) els.closeModalBtn.focus();
}

/** 关闭详情弹窗。 */
function closeModal() {
  if (els.modal) {
    els.modal.classList.remove('open');
    els.modal.setAttribute('aria-hidden', 'true');
    // 等淡出动画结束再隐藏, 避免闪现
    window.setTimeout(() => {
      if (els.modal && !els.modal.classList.contains('open')) els.modal.hidden = true;
    }, 140);
  }
  state.selectedId = null;
}

// =============================================================
// 事件绑定
// =============================================================

/** 卡片点击 → 音效 + 打开详情弹窗。 */
function onWallClick(e) {
  const card = e.target.closest('.pixel-card');
  if (!card) return;
  playRetroSound('step');
  openModal(card.dataset.award);
}

/** 卡片键盘可达 (Enter / Space)。 */
function onWallKeydown(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const card = e.target.closest('.pixel-card');
  if (!card) return;
  e.preventDefault();
  playRetroSound('step');
  openModal(card.dataset.award);
}

function init() {
  // 标题图标
  const titleIcon = document.getElementById('title-icon');
  if (titleIcon) titleIcon.innerHTML = PIXEL_ICONS.trophyTitle ?? '';

  // 三态图标 (加载 / 出错 / 空)
  const stateIcons = [
    ['state-loading-icon', 'bolt'],
    ['state-error-icon', 'brokenBolt'],
    ['state-empty-icon', 'emptyBox'],
  ];
  for (const [id, icon] of stateIcons) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = PIXEL_ICONS[icon] ?? '';
  }

  // SFX 开关
  const soundToggle = document.getElementById('sound-toggle');
  if (soundToggle) {
    soundToggle.addEventListener('click', (e) => {
      sfxEnabled = !sfxEnabled;
      e.target.textContent = sfxEnabled ? 'SFX: ON' : 'SFX: OFF';
      if (sfxEnabled) playRetroSound('step');
    });
  }

  // 卡片点击 / 键盘
  if (els.wallRoot) {
    els.wallRoot.addEventListener('click', onWallClick);
    els.wallRoot.addEventListener('keydown', onWallKeydown);
  }

  // 重试按钮
  if (els.retry) {
    els.retry.addEventListener('click', () => {
      playRetroSound('step');
      loadWall();
    });
  }

  // 弹窗关闭: 关闭按钮 + 遮罩点击 + Esc
  if (els.closeModalBtn) els.closeModalBtn.addEventListener('click', closeModal);
  if (els.modal) {
    els.modal.addEventListener('click', (e) => {
      // 只有点在遮罩本身 (不是弹窗内容) 时才关闭
      if (e.target === els.modal) closeModal();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.modal?.classList.contains('open')) closeModal();
  });

  loadWall();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

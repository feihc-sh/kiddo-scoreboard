// public/achievements.js — 成就神殿 (Zelda sanctuary) 前端逻辑
//
// Spec: docs/achievements-spec.md §0.1 (G1-G12a 设计基因) + §7a (API 响应)
//   + §3a (与参考 demo 的差异清单 —— 不搬手动切换解锁 / reset / localStorage 存档)。
//
// 数据来源: GET /api/public/achievements?user_id=[&season_id=]
//   → { season, achievements: [{ id, grp, name, description, grant_mode, ladder, award }], pet_tokens }
//   award = { tier, granted_at, count } (该赛季该奖项已获最高档) 或 null。
//
// 页面是**只读**的: 解锁态完全由服务端数据驱动, 页面不做任何状态写入。

import { medalSVG, TIER_ORDER, TIER_COLORS } from './medals.js';

const API = '';                     // same origin
const CHILD_USER_ID = 2;           // 与 public/app.js + public/shop.js 同惯例 (M5 换真实鉴权)
const SOUND_PREF_KEY = 'kiddo_achievements_sound_on';

// ---------- DOM ----------
const $ = (sel) => document.querySelector(sel);

const els = {
  gridStudy: $('#grid-study'),
  gridLife: $('#grid-life'),
  gridSkill: $('#grid-skill'),
  groupStudy: $('#group-study'),
  groupLife: $('#group-life'),
  groupSkill: $('#group-skill'),
  countStudy: $('#count-study'),
  countLife: $('#count-life'),
  countSkill: $('#count-skill'),
  loading: $('#loading-state'),
  error: $('#error-state'),
  errorText: $('#error-text'),
  empty: $('#empty-state'),
  progressBar: $('#progress-bar'),
  progressText: $('#progress-text'),
  petTokens: $('#pet-tokens'),
  seasonName: $('#season-name'),
  seasonHint: $('#season-hint'),
  search: $('#search-input'),
  soundBtn: $('#sound-btn'),
  modal: $('#detail-modal'),
  modalCard: $('#modal-card'),
  modalMedalSlot: $('#modal-medal-slot'),
  modalMedal: $('#modal-medal'),
  modalCategory: $('#modal-category'),
  modalTitle: $('#modal-title'),
  modalSubtitle: $('#modal-subtitle'),
  modalDesc: $('#modal-desc'),
  modalStatusText: $('#modal-status-text'),
  modalTierBadge: $('#modal-tier-badge'),
  modalGroup: $('#modal-group'),
  modalAwardId: $('#modal-award-id'),
  closeModalBtn: $('#close-modal-btn'),
  retryBtn: $('#retry-btn'),
};

// ---------- 状态 ----------
const state = {
  achievements: [],   // 服务端返回的原始数组
  filter: 'all',
  search: '',
  selectedId: null,
  loadStatus: 'loading', // 'loading' | 'ok' | 'error' — 决定三态显示
};

/** 分组显示名 (spec §1) */
const GROUP_LABELS = {
  study: '学习组',
  life: '生活组',
  skill: '技能组',
};

/** 分组渲染顺序 */
const GROUP_ORDER = ['study', 'life', 'skill'];

// =============================================================
// G8 — Web Audio 8-bit 音效
// =============================================================

const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;
let soundEnabled = true;

function loadSoundPref() {
  try {
    const saved = localStorage.getItem(SOUND_PREF_KEY);
    if (saved !== null) soundEnabled = saved === '1';
  } catch {
    // localStorage 不可用 (隐私模式) — 保持默认开
  }
  syncSoundBtn();
}

function saveSoundPref() {
  try {
    localStorage.setItem(SOUND_PREF_KEY, soundEnabled ? '1' : '0');
  } catch {
    // 忽略 — 音效偏好只是锦上添花
  }
}

function syncSoundBtn() {
  if (!els.soundBtn) return;
  els.soundBtn.textContent = soundEnabled ? '🔊' : '🔇';
  els.soundBtn.classList.toggle('off', !soundEnabled);
  els.soundBtn.setAttribute('aria-pressed', soundEnabled ? 'true' : 'false');
}

/**
 * 播放 8-bit 合成音效。
 * @param {'unlock'|'lock'|'click'} type
 */
function playSound(type) {
  if (!soundEnabled) return;
  try {
    if (!audioCtx) audioCtx = new AudioCtx();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    const now = audioCtx.currentTime;

    if (type === 'unlock') {
      // Retro 8-Bit 解锁琶音: E5 → G#5 → B5 → E6
      osc.type = 'square';
      osc.frequency.setValueAtTime(659.25, now);
      osc.frequency.setValueAtTime(830.61, now + 0.08);
      osc.frequency.setValueAtTime(987.77, now + 0.16);
      osc.frequency.setValueAtTime(1318.51, now + 0.24);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      osc.start(now);
      osc.stop(now + 0.6);
    } else if (type === 'lock') {
      // Retro 8-bit 锁定噪音 (锯齿降频)
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.18);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.18);
    } else if (type === 'click') {
      osc.type = 'square';
      osc.frequency.setValueAtTime(800, now);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.start(now);
      osc.stop(now + 0.05);
    }
  } catch {
    // 静默降级 — 音效失败不能影响主流程
  }
}

// =============================================================
// G7 — canvas 粒子背景层
// =============================================================

const PARTICLE_COUNT = 40;

function initCanvasParticles() {
  const canvas = document.getElementById('particle-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let particles = [];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size: Math.random() * 2.5 + 1,
      speedY: -(Math.random() * 0.4 + 0.1),
      speedX: (Math.random() - 0.5) * 0.3,
      opacity: Math.random() * 0.6 + 0.2,
      color: Math.random() > 0.5 ? '#f3c959' : '#00e5ff',
    });
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p) => {
      p.y += p.speedY;
      p.x += p.speedX;
      if (p.y < -10) {
        p.y = canvas.height + 10;
        p.x = Math.random() * canvas.width;
      }
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.opacity;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    });
    requestAnimationFrame(animate);
  }
  animate();
}

// =============================================================
// 工具
// =============================================================

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

/** 取得 URL query 里的 user_id (缺省用 CHILD_USER_ID, 与现有页面惯例一致)。 */
function resolveUserId() {
  const raw = new URLSearchParams(window.location.search).get('user_id');
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : CHILD_USER_ID;
}

/** 取得 URL query 里的 season_id (可选 — 上赛季归档视图)。 */
function resolveSeasonId() {
  const raw = new URLSearchParams(window.location.search).get('season_id');
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * 奖牌渲染用的档位。
 * - 已解锁 → 该奖项已获的最高档
 * - 未解锁 → 'iron' 灰显 (G5 锁定卡)
 */
function medalTierFor(item) {
  return item.award?.tier ?? 'iron';
}

/** 档位显示名 (铁/铜/银/金/王者)。 */
function tierLabel(tier) {
  return TIER_COLORS[tier]?.label ?? '未解锁';
}

/** 每一档的达档条件文案 (ladder)。 */
function ladderText(ladder) {
  if (!ladder || typeof ladder !== 'object') return '';
  const parts = TIER_ORDER
    .filter((t) => typeof ladder[t] === 'number')
    .map((t) => `${TIER_COLORS[t]?.label ?? t} ${ladder[t]}`);
  return parts.length ? parts.join(' / ') : '';
}

// =============================================================
// 渲染
// =============================================================

/** 当前筛选 + 搜索后可见的奖项。 */
function visibleItems() {
  const q = state.search.trim().toLowerCase();
  return state.achievements.filter((item) => {
    if (state.filter === 'unlocked' && !item.award) return false;
    if (state.filter === 'locked' && item.award) return false;
    if (state.filter === 'study' || state.filter === 'life' || state.filter === 'skill') {
      if (item.grp !== state.filter) return false;
    }
    if (q) {
      const hay = `${item.name ?? ''} ${item.description ?? ''} ${GROUP_LABELS[item.grp] ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** 单张卡片 (G4/G5/G6/G12a)。 */
function cardHtml(item) {
  const unlocked = Boolean(item.award);
  const tier = medalTierFor(item);
  const tierBadge = unlocked
    ? `<span class="tier-badge ${tier}">${escapeHtml(tierLabel(tier))}牌</span>`
    : '<span class="tier-badge none">未解锁</span>';

  // 各级状态小菱形 (已到达的档位点亮)
  const pips = TIER_ORDER.map((t) => {
    const reached = unlocked && item.award.tier === t;
    return `<span class="tier-pip${reached ? ` reached ${t}` : ''}" title="${TIER_COLORS[t]?.label ?? t}"></span>`;
  }).join('');

  const count = unlocked && item.award.count > 1
    ? `<span class="card-count">×${item.award.count}</span>`
    : '<span class="card-count"></span>';

  return `
    <div class="card-container">
      <div class="zelda-card ${unlocked ? 'unlocked' : 'locked'}" role="button" tabindex="0"
           data-id="${item.id}" aria-label="${escapeHtml(item.name ?? '')}">
        <div class="corner-tl" aria-hidden="true"></div>
        <div class="corner-tr" aria-hidden="true"></div>
        <div class="corner-bl" aria-hidden="true"></div>
        <div class="corner-br" aria-hidden="true"></div>

        <div class="card-top">
          ${tierBadge}
          <span class="card-status ${unlocked ? 'unlocked' : 'locked'}">
            ${unlocked ? '✔ 已获得' : '🔒 未解锁'}
          </span>
        </div>

        <div class="medal-slot ${unlocked ? 'unlocked' : 'locked'}">${medalSVG({ tier, name: item.name ?? '荣誉' })}</div>

        <div class="card-title">${escapeHtml(item.name ?? '')}</div>
        <div class="tier-pips" aria-hidden="true">${pips}</div>
        <div class="card-desc">${escapeHtml(item.description ?? '')}</div>

        <div class="card-foot">
          <span>${escapeHtml(GROUP_LABELS[item.grp] ?? item.grp ?? '')}</span>
          ${count}
        </div>
      </div>
    </div>`;
}

function renderGrid() {
  const items = visibleItems();

  // 按组分区渲染 (spec §9)
  for (const grp of GROUP_ORDER) {
    const grid = grp === 'study' ? els.gridStudy : grp === 'life' ? els.gridLife : els.gridSkill;
    const section = grp === 'study' ? els.groupStudy : grp === 'life' ? els.groupLife : els.groupSkill;
    const countEl = grp === 'study' ? els.countStudy : grp === 'life' ? els.countLife : els.countSkill;
    if (!grid || !section) continue;

    const groupItems = items.filter((i) => i.grp === grp);
    grid.innerHTML = groupItems.map(cardHtml).join('');
    section.hidden = groupItems.length === 0;
    if (countEl) {
      const unlockedInGrp = groupItems.filter((i) => i.award).length;
      countEl.textContent = `${unlockedInGrp} / ${groupItems.length} 已解锁`;
    }
  }

  // 空状态: 加载成功但一件都没显示 (空数据 or 筛选/搜索全滤掉)
  if (els.empty) {
    els.empty.hidden = !(state.loadStatus === 'ok' && items.length === 0);
  }

  updateProgress();
}

/** G3a + G11 — 总进度条。 */
function updateProgress() {
  const total = state.achievements.length;
  const unlockedCount = state.achievements.filter((a) => a.award).length;
  const pct = total > 0 ? Math.round((unlockedCount / total) * 100) : 0;
  if (els.progressBar) els.progressBar.style.width = `${pct}%`;
  if (els.progressText) els.progressText.textContent = `${unlockedCount} / ${total} (${pct}%)`;
}

// =============================================================
// G10 — 详情弹窗
// =============================================================

function openModal(id) {
  const item = state.achievements.find((a) => a.id === id);
  if (!item) return;
  state.selectedId = id;

  const unlocked = Boolean(item.award);
  const tier = medalTierFor(item);

  if (els.modalMedal) {
    els.modalMedal.innerHTML = medalSVG({ tier, name: item.name ?? '荣誉' });
  }
  if (els.modalMedalSlot) {
    els.modalMedalSlot.classList.toggle('locked', !unlocked);
  }
  if (els.modalCategory) {
    els.modalCategory.textContent = GROUP_LABELS[item.grp] ?? item.grp ?? '';
  }
  if (els.modalTitle) els.modalTitle.textContent = item.name ?? '';
  if (els.modalSubtitle) {
    els.modalSubtitle.textContent = item.award
      ? `已获得 ${tierLabel(tier)}牌 · ${new Date(item.award.granted_at).toLocaleDateString('zh-CN')}`
      : '继续努力，小骑士！';
  }
  if (els.modalDesc) {
    const ladder = ladderText(item.ladder);
    els.modalDesc.innerHTML = `${escapeHtml(item.description ?? '暂无描述')}` +
      (ladder ? `<span class="ladder-line">达档条件：${escapeHtml(ladder)}</span>` : '');
  }
  if (els.modalStatusText) {
    els.modalStatusText.textContent = unlocked ? '已获得 (Unlocked)' : '未解锁 — 继续努力，小骑士！';
    els.modalStatusText.className = `modal-status-value ${unlocked ? 'unlocked' : 'locked'}`;
  }
  if (els.modalTierBadge) {
    els.modalTierBadge.textContent = unlocked ? `${tierLabel(tier)}牌` : '未解锁';
    els.modalTierBadge.className = `tier-badge ${unlocked ? tier : 'none'}`;
  }
  if (els.modalGroup) els.modalGroup.textContent = (GROUP_LABELS[item.grp] ?? item.grp ?? '').toUpperCase();
  if (els.modalAwardId) els.modalAwardId.textContent = item.award ? `#${String(item.id).padStart(3, '0')}` : '—';

  if (els.modal) {
    els.modal.classList.add('open');
    els.modal.setAttribute('aria-hidden', 'false');
  }
  if (els.closeModalBtn) els.closeModalBtn.focus();
}

function closeModal() {
  if (els.modal) {
    els.modal.classList.remove('open');
    els.modal.setAttribute('aria-hidden', 'true');
  }
  state.selectedId = null;
}

// =============================================================
// 数据加载
// =============================================================

function showState(which) {
  if (els.loading) els.loading.hidden = which !== 'loading';
  if (els.error) els.error.hidden = which !== 'error';
}

async function loadWall() {
  state.loadStatus = 'loading';
  showState('loading');
  if (els.empty) els.empty.hidden = true;

  const userId = resolveUserId();
  const seasonId = resolveSeasonId();
  const params = new URLSearchParams({ user_id: String(userId) });
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

    state.achievements = Array.isArray(data?.achievements) ? data.achievements : [];
    state.loadStatus = 'ok';

    if (els.seasonName) els.seasonName.textContent = data?.season?.name ?? '尚未开启赛季';
    if (els.seasonHint) {
      els.seasonHint.textContent = data?.season
        ? `开始于 ${data.season.starts_on ?? '—'}${data.season.ends_on ? ` · 结束于 ${data.season.ends_on}` : ''}`
        : '成就系统尚未开放';
    }
    if (els.petTokens) els.petTokens.textContent = String(data?.pet_tokens ?? 0);

    showState(null);
    renderGrid();
  } catch (err) {
    state.achievements = [];
    state.loadStatus = 'error';
    if (els.errorText) els.errorText.textContent = `加载失败：${err.message}`;
    showState('error');
    renderGrid();
  }
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// =============================================================
// 事件绑定
// =============================================================

function setupEvents() {
  // 筛选 tab
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      playSound('click');
      document.querySelectorAll('.filter-btn').forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      state.filter = btn.dataset.filter || 'all';
      renderGrid();
    });
  });

  // 搜索
  if (els.search) {
    els.search.addEventListener('input', (e) => {
      state.search = e.target.value;
      renderGrid();
    });
  }

  // 卡片点击 (事件委托 — 卡片是动态渲染的)
  document.addEventListener('click', (e) => {
    const card = e.target.closest?.('.zelda-card');
    if (!card) return;
    const id = Number(card.dataset.id);
    if (!Number.isInteger(id)) return;
    playSound('click');
    openModal(id);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest?.('.zelda-card');
    if (!card) return;
    e.preventDefault();
    const id = Number(card.dataset.id);
    if (Number.isInteger(id)) {
      playSound('click');
      openModal(id);
    }
  });

  // 弹窗关闭
  if (els.closeModalBtn) els.closeModalBtn.addEventListener('click', closeModal);
  if (els.modal) {
    els.modal.addEventListener('click', (e) => {
      if (e.target === els.modal) closeModal();
    });
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.selectedId !== null) closeModal();
  });

  // 音效开关 (G8)
  if (els.soundBtn) {
    els.soundBtn.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      saveSoundPref();
      syncSoundBtn();
      if (soundEnabled) playSound('click');
    });
  }

  // 重试
  if (els.retryBtn) els.retryBtn.addEventListener('click', () => {
    playSound('click');
    loadWall();
  });
}

// =============================================================
// 启动
// =============================================================

function init() {
  loadSoundPref();
  initCanvasParticles();
  setupEvents();
  loadWall();
  // 供 e2e 自检脚本 introspect
  window.__achievementState = state;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

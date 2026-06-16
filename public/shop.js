// public/shop.js — kiddo-scoreboard child shop UI (M4)
// Loads /api/shop/items, /api/coins/redemptions, renders cards with
// disabled-state hints, drives the confirm modal, and POSTs to
// /api/coins/exchange. Visual style follows the existing Mecha CSS in
// /app.css (CSS variables only — no new colors).
//
// Auth: child user_id is HARDCODED to 2 (CHILD_USER_ID) to match
// /api/coins/* routes + seeds/local.sql. M5 will swap to real auth.

const API = '';                  // same origin
const CHILD_USER_ID = 2;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ---------- State ----------
const state = {
  balance: 0,
  weekOf: '',
  items: [],                    // ShopItem[] from /api/shop/items
  redemptions: [],              // Redemption[] from /api/coins/redemptions
  pendingExchange: null,        // { item, $btn } — currently-confirming item
};

// ---------- Toast (reuses .toast + #toast in app.css) ----------
let toastTimer = null;
function toast(msg, kind = 'info') {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast toast-' + kind + ' toast-show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('toast-show'), 2400);
}

// ---------- API helper ----------
async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(API + path, opts);
  const text = await r.text();
  const data = text ? safeJson(text) : null;
  if (!r.ok) {
    const code = data?.error?.code || 'HTTP_' + r.status;
    const err = new Error(code);
    // Stash server-supplied details for callers that want them
    err.details = data?.error || null;
    err.status = r.status;
    throw err;
  }
  return data;
}
function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function fmtTime(unixSec) {
  if (!unixSec) return '—';
  const d = new Date(Number(unixSec) * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------- Loaders ----------
async function loadBalance() {
  const data = await api('GET', '/api/coins/balance');
  state.balance = Number(data.balance || 0);
}
async function loadShopItems() {
  const data = await api('GET', '/api/shop/items');
  state.weekOf = data.week_of || '';
  state.items = Array.isArray(data.items) ? data.items : [];
}
async function loadRedemptions() {
  const data = await api('GET', '/api/coins/redemptions');
  state.redemptions = Array.isArray(data.redemptions) ? data.redemptions : [];
}

// ---------- Compute per-item disabled state ----------
function computeBtnState(item) {
  // Insufficient coins wins (more actionable feedback than weekly-limit).
  if (state.balance < item.cost_coins) {
    return {
      disabled: true,
      label: `兑换 (还差 ${item.cost_coins - state.balance} 金币)`,
    };
  }
  if (item.weekly_limit > 0 && (item.weekly_limit_remaining ?? 0) <= 0) {
    const used = item.weekly_limit_used ?? item.weekly_limit;
    return {
      disabled: true,
      label: `本周已用 ${used} / ${item.weekly_limit} 次`,
    };
  }
  return { disabled: false, label: '兑换' };
}

// ---------- Render: shop items grid ----------
function renderShopItems() {
  const root = $('#shop-items');
  if (!root) return;
  if (state.items.length === 0) {
    root.innerHTML = '<div class="shop-empty">商店暂无商品</div>';
    return;
  }
  root.innerHTML = state.items.map((it) => {
    const btn = computeBtnState(it);
    const icon = escapeHtml(it.icon || '🎁');
    const name = escapeHtml(it.name);
    const desc = escapeHtml(it.description || '');
    return `
      <div class="shop-item" data-testid="shop-item-${it.id}">
        <div class="shop-item-icon" aria-hidden="true">${icon}</div>
        <div class="shop-item-name">${name}</div>
        <div class="shop-item-desc">${desc}</div>
        <div class="shop-item-cost">${it.cost_coins}<span class="cost-label">金币</span></div>
        <button type="button"
                class="btn btn-primary shop-item-btn"
                data-testid="exchange-btn-${it.id}"
                data-item-id="${it.id}"
                ${btn.disabled ? 'disabled' : ''}>
          ${btn.label}
        </button>
      </div>`;
  }).join('');
  // Bind click handlers
  $$('.shop-item-btn').forEach((b) => {
    b.addEventListener('click', (e) => {
      const id = Number(e.currentTarget.dataset.itemId);
      const item = state.items.find((x) => x.id === id);
      if (item) onExchangeClick(item);
    });
  });

  // Weekly remaining widget — pick first item with a weekly_limit; show "—"
  // if catalog is unlimited across the board (catalog size is bounded so
  // this is a stable per-week aggregate).
  const limitedItem = state.items.find((it) => it.weekly_limit > 0);
  const remainingEl = $('[data-testid="weekly-remaining"]');
  if (remainingEl) {
    if (!limitedItem) {
      remainingEl.textContent = '不限';
    } else {
      const used = limitedItem.weekly_limit_used ?? 0;
      remainingEl.textContent = `${used} / ${limitedItem.weekly_limit}`;
    }
  }
}

// ---------- Render: redemption history ----------
function renderHistory() {
  const weekEl = $('#week-history');
  const allEl = $('#all-history');
  if (!weekEl || !allEl) return;

  const week = state.weekOf;
  const weekList = state.redemptions.filter((r) => r.week_of === week);
  const allList = state.redemptions; // server already returns desc-by-time, limit 50

  weekEl.innerHTML = weekList.length === 0
    ? '<div class="shop-empty">暂无本周兑换</div>'
    : weekList.map(historyRowHtml).join('');
  allEl.innerHTML = allList.length === 0
    ? '<div class="shop-empty">暂无历史兑换</div>'
    : allList.map(historyRowHtml).join('');
}

function historyRowHtml(r) {
  const icon = escapeHtml(r.item_icon || '🎁');
  const name = escapeHtml(r.item_name || `item#${r.item_id}`);
  const time = fmtTime(r.redeemed_at);
  const status = r.status || 'approved';
  const statusLabel = status === 'pending' ? '待发' : '已发';
  const statusClass = status === 'pending' ? '' : 'approved';
  return `
    <div class="shop-history-item" data-testid="history-item" data-redemption-id="${r.id}">
      <span class="h-icon" aria-hidden="true">${icon}</span>
      <span class="h-name">${name}</span>
      <span class="h-cost">${r.cost_coins} 🪙</span>
      <span class="h-time">${time}</span>
      <span class="h-status ${statusClass}">${statusLabel}</span>
    </div>`;
}

// ---------- Confirm modal ----------
function onExchangeClick(item) {
  state.pendingExchange = item;
  const modal = $('#confirm-modal');
  const text = $('#confirm-text');
  if (!modal || !text) return;
  // Reward summary — kind-aware wording (custom → "PM 手动发", game_time → "自动到账")
  const rewardText = item.kind === 'custom'
    ? `1 件「${item.name}」 (PM 手动发货)`
    : `${item.reward_value} ${item.reward_type === 'game_time' ? '分钟游戏时间' : item.reward_type}`;
  text.innerHTML = `确定花 <strong>${item.cost_coins}</strong> 金币换 <strong>${escapeHtml(rewardText)}</strong>?`;
  modal.hidden = false;
}

function closeConfirm() {
  const modal = $('#confirm-modal');
  if (modal) modal.hidden = true;
  state.pendingExchange = null;
}

async function confirmExchange() {
  const item = state.pendingExchange;
  if (!item) return;
  const okBtn = $('#confirm-ok');
  if (okBtn) okBtn.disabled = true;
  try {
    const res = await api('POST', '/api/coins/exchange', { item_id: item.id });
    // Update balance immediately for snappy UI; reload from server in background
    state.balance = Number(res.new_balance ?? state.balance - item.cost_coins);
    toast('✅ 兑换成功!', 'success');
    closeConfirm();
    // Refresh balance header + items (weekly_limit_used changed) + history
    await Promise.all([loadBalance(), loadShopItems(), loadRedemptions()]);
    renderShopItems();
    $('#shop-balance').textContent = String(state.balance);
    renderHistory();
  } catch (e) {
    // Map server error codes → human message
    const code = e.message || '';
    const details = e.details || {};
    let msg;
    if (code === 'INSUFFICIENT_COINS') {
      msg = `❌ 金币不足 (需要 ${details.need ?? '?'}, 现有 ${details.have ?? '?'})`;
    } else if (code === 'WEEKLY_LIMIT_REACHED') {
      msg = `❌ 本周次数已用完 (${details.used}/${details.limit})`;
    } else if (code === 'ITEM_NOT_FOUND') {
      msg = '❌ 商品已下架';
    } else if (code === 'UNAUTHORIZED') {
      msg = '❌ 请重新登录';
    } else {
      msg = '❌ 兑换失败: ' + code;
    }
    toast(msg, 'error');
    // Keep modal open so user can retry or cancel
  } finally {
    if (okBtn) okBtn.disabled = false;
  }
}

// ---------- Render: balance header ----------
function renderBalance() {
  const el = $('#shop-balance');
  if (el) el.textContent = String(state.balance);
}

// ---------- Bind + boot ----------
function bindEvents() {
  $('#confirm-cancel')?.addEventListener('click', closeConfirm);
  $('#confirm-ok')?.addEventListener('click', confirmExchange);
  // Click backdrop to dismiss
  $('#confirm-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'confirm-modal') closeConfirm();
  });
}

async function refreshAll() {
  await Promise.all([loadBalance(), loadShopItems(), loadRedemptions()]);
  renderBalance();
  renderShopItems();
  renderHistory();
}

async function boot() {
  bindEvents();
  try {
    await refreshAll();
  } catch (e) {
    toast('加载失败: ' + (e.message || 'unknown'), 'error');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}